<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'
import WidgetBoard from './board/WidgetBoard.vue'

type ApiState = 'checking' | 'ok' | 'unavailable'

const labels: Record<ApiState, string> = {
  checking: 'API: проверка…',
  ok: 'API: работает',
  unavailable: 'API: недоступен',
}

const apiState = ref<ApiState>('checking')
const building = ref(false)
const notice = ref<string | null>(null)
const boardRef = useTemplateRef('board')

const HEALTH_TIMEOUT_MS = 5000

async function isApiHealthy(): Promise<boolean> {
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    const response = await fetch('/health', { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    if (response.status !== 200) return false
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}

onMounted(async () => {
  apiState.value = (await isApiHealthy()) ? 'ok' : 'unavailable'
})
</script>

<template>
  <div class="app">
    <header class="app__header">
      <h1 class="app__title">LifeDashboard</h1>
      <template v-if="building">
        <button type="button" class="app__button" @click="boardRef?.confirm()">Готово</button>
        <button type="button" class="app__button" @click="boardRef?.cancel()">Отмена</button>
      </template>
      <button v-else type="button" class="app__button" aria-label="Добавить виджет" @click="building = true">+</button>
      <p class="app__notice" role="status">{{ notice }}</p>
      <p class="app__api">{{ labels[apiState] }}</p>
    </header>
    <main class="app__main">
      <WidgetBoard ref="board" v-model:building="building" @notice="notice = $event" />
    </main>
  </div>
  <p class="app__narrow">Окно слишком узкое</p>
</template>

<style>
/* One scale for the whole UI (base design §7.4): every size is rem, only the root font size changes. */
html {
  font-size: max(16px, min(1vw, calc(100dvh / 43.75)));
}

body {
  margin: 0;
  background: radial-gradient(circle at 20% 10%, #3a3f6b, #12131c 60%) fixed;
  color: #f4f4f8;
  font-family: system-ui, sans-serif;
}

.app {
  display: grid;
  grid-template-rows: 3.5rem 1fr;
  height: 100dvh;
}

.app__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 1rem;
}

.app__title {
  margin: 0;
  font-size: 1.125rem;
}

.app__button {
  height: 2.25rem;
  min-width: 2.25rem;
  padding: 0 0.875rem;
  border: 0.0625rem solid rgb(255 255 255 / 0.25);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.app__notice {
  margin: 0;
  color: #ffb4b4;
  font-size: 0.875rem;
}

.app__api {
  margin: 0 0 0 auto;
  font-size: 0.875rem;
  opacity: 0.7;
}

.app__main {
  min-height: 0;
}

.app__narrow {
  display: none;
}

@media (max-width: 1279.98px) {
  .app {
    display: none;
  }

  .app__narrow {
    display: grid;
    place-items: center;
    height: 100dvh;
    margin: 0;
  }
}
</style>
