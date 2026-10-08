import type { ContextMessage, ResponseMessage, WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from './widget.ts'

/** The sandbox end of the bridge: requests go out on the port, answers and context patches come in. */
export function createPortClient(port: MessagePort, onContext: (patch: Partial<WidgetContext>) => void): WidgetCall {
  let nextId = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: WidgetError): void }>()

  // Setting onmessage also starts the port.
  port.onmessage = (event: MessageEvent) => {
    const message = event.data as ResponseMessage | ContextMessage | null
    if (message?.t === 'context') {
      onContext(message.patch)
      return
    }
    if (message?.t !== 'res') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok) entry.resolve(message.value)
    else entry.reject(new WidgetError(message.error.code, message.error.message))
  }

  return (op, input) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      try {
        port.postMessage({ t: 'req', id, op, input })
      } catch {
        // A function or a DOM node cannot be structured-cloned; the host would never see the request.
        pending.delete(id)
        reject(new WidgetError('INVALID_INPUT', 'The input cannot be sent to the host'))
      }
    })
}
