<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'
import { useWidget, WidgetError } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const count = ref(0)
const revision = ref(0)
const status = ref('')
const video = useTemplateRef<HTMLVideoElement>('videoBox')

async function load() {
  const state = await widget.state.get<{ count: number }>()
  count.value = state.data?.count ?? 0
  revision.value = state.revision
}

async function increment() {
  try {
    revision.value = (await widget.state.set({ count: count.value + 1 }, revision.value)).revision
    count.value += 1
    status.value = ''
  } catch (error) {
    if (!(error instanceof WidgetError) || error.code !== 'CONFLICT') throw error
    status.value = 'Изменено в другой вкладке'
    await load()
  }
}

async function remind() {
  try {
    await widget.notify({ title: 'Напоминание', body: `Счётчик: ${count.value}` })
    status.value = ''
  } catch (error) {
    // The user declined in the host dialog, or the dialog expired.
    if (!(error instanceof WidgetError) || error.code !== 'DECLINED') throw error
    status.value = 'Уведомление отклонено'
  }
}

function seek() {
  if (!video.value) return
  video.value.currentTime = 2
  status.value = `Видео: ${video.value.currentTime.toFixed(1)} с`
}

onMounted(load)
</script>

<template>
  <div class="hello" :data-size="widget.context.sizeClass">
    <video ref="videoBox" class="hello__bg" src="assets/bg.mp4" autoplay muted loop playsinline />
    <p class="hello__count">{{ count }}</p>
    <div class="hello__actions">
      <button type="button" class="hello__button" @click="increment">+1</button>
      <button type="button" class="hello__button" @click="remind">Напомнить</button>
      <button type="button" class="hello__button" @click="seek">Перемотать</button>
    </div>
    <p class="hello__status" role="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.hello {
  position: relative;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.5rem;
  height: 100vh;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.hello__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.35;
  z-index: -1;
}

.hello__count {
  margin: 0;
  font-size: 2rem;
  font-weight: var(--ld-weight-strong);
}

.hello__actions {
  display: flex;
  gap: 0.5rem;
}

.hello__button {
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.hello__status {
  min-height: 1rem;
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}
</style>
