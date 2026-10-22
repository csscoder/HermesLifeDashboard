import { BRIDGE_LIMITS, GATEWAY_OPS, isGatewayOp, type ContextMessage, type ResponseMessage, type WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from './widget.ts'

/** The sandbox end of the bridge: requests go out on the port, answers and context patches come in. */
export function createPortClient(port: MessagePort, onContext: (patch: Partial<WidgetContext>) => void): WidgetCall {
  let nextId = 0
  let closed = false
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: WidgetError): void; timer: ReturnType<typeof setTimeout> }>()

  // Setting onmessage also starts the port.
  port.onmessage = (event: MessageEvent) => {
    const message = event.data as ResponseMessage | ContextMessage | { t: 'close' } | null
    if (message?.t === 'close') {
      if (Array.isArray(message) || Object.keys(message).length !== 1) return
      closed = true
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new WidgetError('BRIDGE_CLOSED', 'The bridge was closed'))
      }
      pending.clear()
      port.onmessage = null
      port.close()
      return
    }
    if (message?.t === 'context') {
      onContext(message.patch)
      return
    }
    if (message?.t !== 'res') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.value)
    else entry.reject(new WidgetError(message.error.code, message.error.message))
  }

  return (op, input) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new WidgetError('BRIDGE_CLOSED', 'The bridge was closed'))
      const id = nextId++
      const timeoutMs = isGatewayOp(op) && GATEWAY_OPS[op].confirm !== 'never' ? BRIDGE_LIMITS.confirmTimeoutMs : BRIDGE_LIMITS.requestTimeoutMs
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new WidgetError('TIMEOUT', 'The request timed out'))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        port.postMessage({ t: 'req', id, op, input })
      } catch {
        // A function or a DOM node cannot be structured-cloned; the host would never see the request.
        pending.delete(id)
        clearTimeout(timer)
        reject(new WidgetError('INVALID_INPUT', 'The input cannot be sent to the host'))
      }
    })
}
