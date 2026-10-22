import { onScopeDispose, ref, watch } from 'vue'
import { parseWeather, weatherUrl, type WeatherSnapshot } from './weather.ts'

const REFRESH_MS = 15 * 60_000

interface WeatherHost {
  context: { readonly visible: boolean; readonly config: { readonly city: string; readonly latitude: number; readonly longitude: number } }
  http: { get(url: string, options?: { accept?: string }): Promise<{ status: number; body: string }> }
}

export function useWeather(widget: WeatherHost) {
  const data = ref<WeatherSnapshot | null>(null)
  const loading = ref(false)
  const error = ref(false)
  const stale = ref(false)
  let generation = 0
  let disposed = false
  let lastSuccess = 0
  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    if (disposed || !widget.context.visible || loading.value) return
    const request = ++generation
    loading.value = true
    if (data.value && Date.now() - lastSuccess >= REFRESH_MS) stale.value = true
    try {
      const response = await widget.http.get(weatherUrl(widget.context.config), { accept: 'application/json' })
      if (disposed || request !== generation) return
      const snapshot = response.status >= 200 && response.status < 300 ? parseWeather(JSON.parse(response.body)) : null
      if (!snapshot) throw new Error('Invalid weather response')
      data.value = snapshot
      error.value = false
      stale.value = false
      lastSuccess = Date.now()
    } catch {
      if (disposed || request !== generation) return
      error.value = true
      stale.value = data.value !== null
    } finally {
      if (!disposed && request === generation) loading.value = false
    }
  }

  watch(
    () => weatherUrl(widget.context.config),
    () => {
      generation++
      loading.value = false
      data.value = null
      error.value = false
      stale.value = false
      void refresh()
    },
    { flush: 'sync' },
  )

  watch(() => widget.context.visible, (visible) => {
    clearInterval(timer)
    timer = undefined
    if (visible) {
      void refresh()
      timer = setInterval(() => { void refresh() }, REFRESH_MS)
    }
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(() => {
    disposed = true
    generation++
    loading.value = false
    clearInterval(timer)
  })

  return { data, loading, error, stale, refresh }
}
