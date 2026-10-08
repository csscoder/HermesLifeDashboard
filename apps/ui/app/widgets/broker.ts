import {
  BRIDGE_LIMITS,
  isGatewayOp,
  parseGatewayInput,
  parseSandboxMessage,
  SDK_VERSION,
  type NotificationInput,
  type WidgetContext,
  type WidgetErrorCode,
} from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import type { api, ApiFailure, ApiResult } from '../api'

export type GatewayApi = Pick<typeof api, 'createWidgetSession' | 'endWidgetSession' | 'gateway'>

export interface GatewayClient {
  start(): Promise<boolean>
  call: WidgetCall
  close(): Promise<void>
}

const GATEWAY_CODES: ReadonlySet<string> = new Set<WidgetErrorCode>(['UNKNOWN_OP', 'PERMISSION_DENIED', 'INVALID_INPUT'])

function toWidgetError(failure: ApiFailure): WidgetError {
  switch (failure.kind) {
    case 'conflict':
      return new WidgetError('CONFLICT', 'The widget state changed since it was read')
    case 'rate-limited':
      return new WidgetError('RATE_LIMITED', 'Too many calls')
    case 'invalid':
      return new WidgetError(GATEWAY_CODES.has(failure.code) ? (failure.code as WidgetErrorCode) : 'INVALID_INPUT', failure.message)
    default:
      return new WidgetError('UNAVAILABLE', 'The LifeDashboard API is unavailable')
  }
}

/**
 * A widget's way to the gateway, shared by both hosts. It holds the widget session (the frame never
 * sees the token), checks op and input with the shared contracts, and renews an expired session once:
 * a session failure happens before the operation runs, so one repeat is safe.
 */
export function createGatewayClient(deps: {
  api: GatewayApi
  widgetId: string
  onNotify(message: NotificationInput): void
  onSessionLost(): void
}): GatewayClient {
  let token: string | null = null

  async function start(): Promise<boolean> {
    const result = await deps.api.createWidgetSession(deps.widgetId)
    token = result.ok ? result.data.widgetSession : null
    return token !== null
  }

  async function send(op: string, input: unknown): Promise<ApiResult<unknown> | null> {
    if (token === null && !(await start())) return null
    return deps.api.gateway(op, token!, input)
  }

  function lost(): WidgetError {
    token = null
    deps.onSessionLost()
    return new WidgetError('SESSION_EXPIRED', 'Widget session expired')
  }

  async function call(op: string, input: unknown): Promise<unknown> {
    if (!isGatewayOp(op)) throw new WidgetError('UNKNOWN_OP', `Unknown operation "${op.slice(0, 100)}"`)
    const parsed = parseGatewayInput(op, input)
    if (!parsed.ok) throw new WidgetError('INVALID_INPUT', parsed.error)
    let result = await send(op, parsed.value)
    if (result && !result.ok && result.kind === 'session-expired') {
      token = null
      result = await send(op, parsed.value)
    }
    if (!result || (!result.ok && result.kind === 'session-expired')) throw lost()
    if (!result.ok) throw toWidgetError(result)
    if (op === 'notifications.send') deps.onNotify(parsed.value as NotificationInput)
    return result.data
  }

  async function close(): Promise<void> {
    const current = token
    token = null
    if (current !== null) await deps.api.endWidgetSession(current)
  }

  return { start, call, close }
}

export interface HelloEvent {
  data: unknown
  source: unknown
}

/**
 * The bootstrap check (spec «RPC bridge» step 2): a hello counts only when its source is a registered
 * frame window that has not shaken hands yet. `event.source` is the only identity an opaque origin has.
 */
export function createHandshakes() {
  const waiting = new Map<unknown, () => void>()
  return {
    register(frame: unknown, onHello: () => void): () => void {
      waiting.set(frame, onHello)
      return () => {
        if (waiting.get(frame) === onHello) waiting.delete(frame)
      }
    },
    handle(event: HelloEvent): boolean {
      const onHello = waiting.get(event.source)
      const data = event.data as { t?: unknown; sdk?: unknown } | null
      if (!onHello || typeof data !== 'object' || data === null || data.t !== 'ld:hello' || data.sdk !== SDK_VERSION) return false
      waiting.delete(event.source)
      onHello()
      return true
    },
  }
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

export interface Bridge {
  push(patch: Partial<WidgetContext>): void
  close(): void
}

/** The host end of one widget's port, with the limits of spec «RPC bridge» step 4. */
export function createBridge(
  port: MessagePort,
  deps: { call: WidgetCall; onError(message: string): void; onClose(): void },
): Bridge {
  const encoder = new TextEncoder()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let inFlight = 0
  let malformed = 0
  let closed = false

  function reply(id: number, outcome: { value: unknown } | { error: WidgetError }): void {
    if (closed) return
    port.postMessage(
      'value' in outcome
        ? { t: 'res', id, ok: true, value: outcome.value }
        : { t: 'res', id, ok: false, error: { code: outcome.error.code, message: outcome.error.message } },
    )
  }

  function close(): void {
    if (closed) return
    closed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    port.onmessage = null
    port.close()
  }

  function dropMalformed(): void {
    malformed += 1
    if (malformed < BRIDGE_LIMITS.maxMalformed) return
    close()
    deps.onClose()
  }

  function sizeOf(data: unknown): number {
    try {
      return encoder.encode(JSON.stringify(data) ?? '').length
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  function run(id: number, op: string, input: unknown): void {
    if (inFlight >= BRIDGE_LIMITS.maxInFlight) {
      reply(id, { error: new WidgetError('RATE_LIMITED', 'Too many requests in flight') })
      return
    }
    inFlight += 1
    let settled = false
    const settle = (outcome: { value: unknown } | { error: WidgetError }) => {
      if (settled) return
      settled = true
      inFlight -= 1
      clearTimeout(timer)
      timers.delete(timer)
      reply(id, outcome)
    }
    const timer = setTimeout(() => settle({ error: new WidgetError('TIMEOUT', 'The request timed out') }), BRIDGE_LIMITS.requestTimeoutMs)
    timers.add(timer)
    deps.call(op, input).then(
      (value) => settle({ value }),
      (error: unknown) => settle({ error: error instanceof WidgetError ? error : new WidgetError('UNAVAILABLE', 'The request failed') }),
    )
  }

  port.onmessage = (event: MessageEvent) => {
    if (closed) return
    const message = parseSandboxMessage(event.data)
    if (!message) {
      dropMalformed()
      return
    }
    if (sizeOf(event.data) > BRIDGE_LIMITS.maxMessageBytes) {
      if (message.t === 'req') reply(message.id, { error: new WidgetError('INVALID_INPUT', 'The message is larger than 128 KB') })
      dropMalformed()
      return
    }
    if (message.t === 'error') deps.onError(message.message)
    else run(message.id, message.op, message.input)
  }

  return {
    push(patch) {
      if (!closed) port.postMessage({ t: 'context', patch })
    },
    close,
  }
}
