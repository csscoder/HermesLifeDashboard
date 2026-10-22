import {
  isGatewayOp,
  parseGatewayInput,
  widgetFailure,
  type GatewayOp,
  type NotificationInput,
} from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { createHandshakes } from '@lifedashboard/widget-sdk/host'
import type { api, ApiFailure, ApiResult } from '../api.ts'
import type { ConfirmationAnswer } from '../confirmations.ts'

export { createBridge, createHandshakes, type Bridge, type HelloEvent } from '@lifedashboard/widget-sdk/host'

export type GatewayApi = Pick<typeof api, 'createWidgetSession' | 'endWidgetSession' | 'gateway' | 'declineConfirmation'>

export interface GatewayClient {
  start(): Promise<boolean>
  call: WidgetCall
  close(): Promise<void>
}

function toWidgetError(failure: ApiFailure): WidgetError {
  let mapped: ReturnType<typeof widgetFailure>
  switch (failure.kind) {
    case 'conflict':
      mapped = widgetFailure('CONFLICT', '')
      break
    case 'rate-limited':
      mapped = widgetFailure('RATE_LIMITED', '')
      break
    case 'invalid':
      mapped = widgetFailure(failure.code, failure.message)
      break
    case 'upstream':
      mapped = widgetFailure('UPSTREAM_ERROR', failure.message)
      break
    // Only a repeat that carried an id gets here: it is never asked again.
    case 'confirmation-required':
      return new WidgetError('DECLINED', 'The confirmation expired')
    default:
      return new WidgetError('UNAVAILABLE', 'The LifeDashboard API is unavailable')
  }
  return new WidgetError(mapped.code, mapped.message)
}

/**
 * A widget's way to the gateway, shared by both hosts. It holds the widget session (the frame never
 * sees the token), checks op and input with the shared contracts, and renews an expired session once:
 * a session failure happens before the operation runs, so one repeat is safe. When the API asks for a
 * confirmation, the user answers in the host dialog; only an approval sends the id, on one repeat.
 */
export function createGatewayClient(deps: {
  api: GatewayApi
  widgetId: string
  source?: WidgetSource
  // The host dialog (confirmations.ts); `input` is the parsed value the API binds the id to.
  confirm(op: GatewayOp, input: unknown): Promise<ConfirmationAnswer>
  onNotify(message: NotificationInput): void
  onSessionLost(): void
}): GatewayClient {
  const source = deps.source === undefined ? undefined : { ...deps.source }
  let token: string | null = null
  let starting: Promise<boolean> | null = null
  let closed = false

  function start(): Promise<boolean> {
    if (closed) return Promise.resolve(false)
    if (token !== null) return Promise.resolve(true)
    starting ??= (async () => {
      const result = await (source === undefined ? deps.api.createWidgetSession(deps.widgetId) : deps.api.createWidgetSession(deps.widgetId, source))
      // Closed while the session was created: nothing would ever end it.
      if (closed && result.ok) void deps.api.endWidgetSession(result.data.widgetSession)
      token = result.ok && !closed ? result.data.widgetSession : null
      return token !== null
    })().finally(() => { starting = null })
    return starting
  }

  function closedError(): WidgetError {
    return new WidgetError('DECLINED', 'The widget was closed')
  }

  // One call on its owning session; an approval repeats on that same session with the bound id.
  async function attempt(op: GatewayOp, input: unknown): Promise<{ owner: string | null; result: ApiResult<unknown> | null }> {
    // A removed widget opens no session and no dialog.
    if (closed) throw closedError()
    if (token === null && !(await start())) {
      if (closed) throw closedError()
      return { owner: null, result: null }
    }
    if (closed) throw closedError()
    const owner = token!
    const result = await deps.api.gateway(op, owner, input, undefined)
    if (result.ok || result.kind !== 'confirmation-required') return { owner, result }
    // Closed while the 428 was in flight: teardown already cancelled the queue, so do not add to it.
    if (closed) throw closedError()
    const answer = await deps.confirm(op, input)
    // Closed meanwhile: ending the session drops the id, so nothing is declined (spec «Error handling»).
    if (closed) throw closedError()
    if (answer === 'approved') return { owner, result: await deps.api.gateway(op, owner, input, result.confirmationId) }
    void deps.api.declineConfirmation(owner, result.confirmationId)
    throw new WidgetError('DECLINED', answer === 'expired' ? 'The confirmation expired' : 'The user declined the call')
  }

  function lost(owner: string | null): WidgetError {
    if (token === owner) {
      token = null
      deps.onSessionLost()
    }
    return new WidgetError('SESSION_EXPIRED', 'Widget session expired')
  }

  async function call(op: string, input: unknown): Promise<unknown> {
    if (!isGatewayOp(op)) throw new WidgetError('UNKNOWN_OP', `Unknown operation "${op.slice(0, 100)}"`)
    const parsed = parseGatewayInput(op, input)
    if (!parsed.ok) throw new WidgetError('INVALID_INPUT', parsed.error)
    let response = await attempt(op, parsed.value)
    if (response.result && !response.result.ok && response.result.kind === 'session-expired') {
      // A late failure on an old token must not replace a session another call already renewed.
      if (token === response.owner) token = null
      response = await attempt(op, parsed.value)
    }
    const { result } = response
    if (!result || (!result.ok && result.kind === 'session-expired')) throw lost(response.owner)
    if (!result.ok) throw toWidgetError(result)
    if (op === 'notifications.send') deps.onNotify(parsed.value as NotificationInput)
    return result.data
  }

  async function close(): Promise<void> {
    closed = true
    const current = token
    token = null
    if (current !== null) await deps.api.endWidgetSession(current)
  }

  return { start, call, close }
}

const handshakes = createHandshakes()
let listening = false

/** Waits for the hello of one frame; the returned function stops waiting. One window listener for all frames. */
export function listenForHello(frame: Window, onHello: () => void): () => void {
  if (!listening) {
    window.addEventListener('message', (event) => handshakes.handle(event))
    listening = true
  }
  return handshakes.register(frame, onHello)
}
