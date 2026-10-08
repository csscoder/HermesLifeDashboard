import { ref } from 'vue'

export interface Toast {
  id: number
  // The widget title: the user sees which widget speaks.
  source: string
  title: string
  body: string
}

const TOAST_MS = 6000
let nextId = 0

export const toasts = ref<Toast[]>([])

/** Shows a widget notification in web mode (the Tauri notification plugin replaces it at E7). */
export function showToast(message: Omit<Toast, 'id'>): void {
  const toast = { ...message, id: nextId++ }
  toasts.value = [...toasts.value, toast]
  setTimeout(() => {
    toasts.value = toasts.value.filter((item) => item.id !== toast.id)
  }, TOAST_MS)
}
