import { ref } from 'vue'
import { CONFIRMATION_DIALOG_MS, type GatewayOp } from '@lifedashboard/contracts/widget-gateway'

export type ConfirmationAnswer = 'approved' | 'declined' | 'expired'

export interface ConfirmationRequest {
  // Keys the entry: two instances of one package share a title.
  widgetId: string
  // Shown only.
  title: string
  op: GatewayOp
  // The parsed input the API bound the confirmation id to; the dialog previews it.
  input: unknown
}

export interface Confirmation extends ConfirmationRequest {
  id: number
  // The first answer wins; a double click or the deadline after it does nothing.
  answer(result: ConfirmationAnswer): void
}

let nextId = 0

/** Waiting confirmations, oldest first; ConfirmDialog shows the head. */
export const confirmations = ref<Confirmation[]>([])

/**
 * Asks the user in the host dialog. The deadline counts from the request, shown or still queued, so an
 * approval always reaches the API before the id expires (CONFIRMATION_TTL_MS).
 */
export function requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationAnswer> {
  return new Promise((resolve) => {
    const id = nextId++
    let settled = false
    const answer = (result: ConfirmationAnswer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      confirmations.value = confirmations.value.filter((item) => item.id !== id)
      resolve(result)
    }
    const timer = setTimeout(() => answer('expired'), CONFIRMATION_DIALOG_MS)
    confirmations.value = [...confirmations.value, { ...request, id, answer }]
  })
}

/** Widget teardown and unmount: its entries leave the queue declined. */
export function cancelConfirmations(widgetId: string): void {
  for (const item of confirmations.value.filter((entry) => entry.widgetId === widgetId)) item.answer('declined')
}
