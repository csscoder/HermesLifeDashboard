import { onUnmounted, watch } from 'vue'
import { leaseMedia, releaseMedia } from './media-api'

/** Protect saved and draft media with one serialized, renewable page lease. */
export function useBackgroundLeases(videoIds: () => readonly string[], onError: (message: string | null) => void): void {
  const leaseId = crypto.randomUUID()
  let desired: string[] = []
  let pending = false
  let running = false
  let stopped = false
  // A failed response may still have committed a lease on the server.
  let touched = false
  let errorShown = false

  async function flush() {
    if (running) return
    running = true
    try {
      while (pending) {
        pending = false
        if (stopped) {
          if (touched) {
            await releaseMedia(leaseId)
            touched = false
          }
          return
        }
        const ids = desired.slice()
        if (!ids.length && !touched) continue
        if (ids.length) touched = true
        const result = ids.length ? await leaseMedia(leaseId, ids) : await releaseMedia(leaseId)
        if (result.ok && !ids.length) touched = false
        if (stopped) continue
        if (!result.ok) {
          errorShown = true
          onError('Не удалось защитить фон от удаления. Проверим соединение повторно через минуту.')
        } else if (errorShown) {
          errorShown = false
          onError(null)
        }
      }
    } finally {
      running = false
    }
  }

  function request() {
    pending = true
    void flush()
  }
  const stopWatch = watch(() => JSON.stringify([...new Set(videoIds())].sort()), key => {
    desired = JSON.parse(key) as string[]
    request()
  }, { immediate: true, flush: 'sync' })
  const heartbeat = setInterval(request, 60000)
  onUnmounted(() => {
    stopped = true
    stopWatch()
    clearInterval(heartbeat)
    request()
  })
}
