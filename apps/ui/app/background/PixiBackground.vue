<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ScreenBackground } from '@lifedashboard/contracts/board'
import type { createBackgroundRenderer } from './renderer'

const props = defineProps<{ background: ScreenBackground | null }>()
const emit = defineEmits<{ error: [message: string | null] }>()
const host = ref<HTMLElement | null>(null)
let renderer: Awaited<ReturnType<typeof createBackgroundRenderer>> | null = null
let creating = false
let disposed = false

async function update() {
  if (disposed || !host.value || creating) return
  try {
    if (!renderer) {
      if (!props.background) return
      creating = true
      const { createBackgroundRenderer } = await import('./renderer')
      if (disposed) return
      const initialized = await createBackgroundRenderer(host.value, message => {
        if (!disposed) emit('error', message)
      })
      if (disposed) { initialized.destroy(); return }
      renderer = initialized
      creating = false
    }
    await renderer.setBackground(props.background)
  } catch {
    if (!disposed) emit('error', 'Не удалось показать фон. Используется фон темы.')
  } finally { creating = false }
}
onMounted(() => watch(() => props.background, () => { void update() }, { immediate: true, deep: true }))
onBeforeUnmount(() => {
  disposed = true
  renderer?.destroy()
})
</script>

<template>
  <div ref="host" class="video-background" aria-hidden="true" />
</template>

<style scoped>
.video-background { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.video-background :deep(canvas) { display: block; width: 100%; height: 100%; }
.video-background :deep(canvas[hidden]) { display: none; }
</style>
