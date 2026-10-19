import {
  BRIDGE_LIMITS,
  GATEWAY_OPS,
  isGatewayOp,
  parseSandboxMessage,
  SDK_VERSION,
  type WidgetContext,
} from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from './widget.ts'

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
    // A confirmable op waits for the user; its dialog deadline ends it first (BRIDGE_LIMITS comment).
    const timeoutMs = isGatewayOp(op) && GATEWAY_OPS[op].confirm !== 'never' ? BRIDGE_LIMITS.confirmTimeoutMs : BRIDGE_LIMITS.requestTimeoutMs
    const timer = setTimeout(() => settle({ error: new WidgetError('TIMEOUT', 'The request timed out') }), timeoutMs)
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
