import { onScopeDispose, ref, watch } from 'vue'

export function useClock(visible: () => boolean) {
  const now = ref(Date.now())
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const reducedMotion = ref(media.matches)
  const updatePreference = () => { reducedMotion.value = media.matches }
  media.addEventListener('change', updatePreference)
  onScopeDispose(() => media.removeEventListener('change', updatePreference))

  watch([visible, reducedMotion], ([isVisible, reduced], _, onCleanup) => {
    if (!isVisible) return
    now.value = Date.now()
    if (reduced) {
      const timer = setInterval(() => { now.value = Date.now() }, 1000)
      onCleanup(() => clearInterval(timer))
    } else {
      let frame: number
      const tick = () => {
        now.value = Date.now()
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      onCleanup(() => cancelAnimationFrame(frame))
    }
  }, { immediate: true })

  return { now, reducedMotion }
}
