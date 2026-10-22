import { shallowRef } from 'vue'

export interface PendingDelete {
  message: string
  answer(ok: boolean): void
}

/** The delete request ConfirmDelete.vue shows; null when none is waiting. Shallow, so the entry keeps its identity. */
export const pendingDelete = shallowRef<PendingDelete | null>(null)

/** Asks before a screen delete. A request that arrives while another waits settles that one with false. */
export function askDelete(message: string): Promise<boolean> {
  pendingDelete.value?.answer(false)
  return new Promise((resolve) => {
    let settled = false
    const entry: PendingDelete = {
      message,
      answer(ok) {
        if (settled) return
        settled = true
        if (pendingDelete.value === entry) pendingDelete.value = null
        resolve(ok)
      },
    }
    pendingDelete.value = entry
  })
}
