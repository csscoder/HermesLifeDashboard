<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import WidgetBoard from './board/WidgetBoard.vue'
import type { BoardMode } from './board/edit-session'
import { loadAppearance, saveAppearance } from './theme/appearance'
import { BUILTIN_THEMES, BUILTIN_THEME_IDS, themeMeta } from './theme/builtin'
import { resolveThemeId, themeClass } from './theme/resolve'

type ApiState = 'checking' | 'ok' | 'unavailable'

const labels: Record<ApiState, string> = {
  checking: 'API: проверка…',
  ok: 'API: работает',
  unavailable: 'API: недоступен',
}

const apiState = ref<ApiState>('checking')
const mode = ref<BoardMode>('view')
const notice = ref<string | null>(null)
const boardRef = useTemplateRef('board')

// Workspace theme; Rooms (E2) will put their own id in front of it in the chain.
const storedThemeId = loadAppearance().themeId
const themeId = ref(resolveThemeId([storedThemeId], BUILTIN_THEME_IDS))
// An unknown stored id (deleted theme) is kept as it is; the default theme is shown meanwhile.
const themeNotice = ref<string | null>(
  storedThemeId !== null && !BUILTIN_THEME_IDS.has(storedThemeId) ? 'Тема не найдена, показана тема по умолчанию' : null,
)
const headerNotice = computed(() => [notice.value, themeNotice.value].filter(Boolean).join(' · ') || null)

function selectTheme(event: Event) {
  themeId.value = resolveThemeId([(event.target as HTMLSelectElement).value], BUILTIN_THEME_IDS)
  // A failed save keeps the theme applied for this session.
  themeNotice.value = saveAppearance({ schemaVersion: 1, themeId: themeId.value }) ? null : 'Не удалось сохранить тему'
}

const rootClass = computed(() => [
  'room',
  `room--theme-${themeClass(themeId.value)}`,
  `room--skin-${themeMeta(themeId.value).skin}`,
])

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
  <div :class="rootClass">
    <div class="room__backdrop" />
    <div class="app">
      <header class="app__header">
        <h1 class="app__title">LifeDashboard</h1>
        <template v-if="mode !== 'view'">
          <button type="button" class="app__button" @click="boardRef?.confirm()">Готово</button>
          <button type="button" class="app__button" @click="boardRef?.cancel()">Отмена</button>
        </template>
        <template v-else>
          <button type="button" class="app__button" aria-label="Добавить виджет" @click="mode = 'build'">+</button>
          <button type="button" class="app__button" :disabled="!boardRef?.hasWidgets" @click="mode = 'edit'">
            Изменить
          </button>
        </template>
        <label class="app__theme">
          Тема
          <select class="app__select" :value="themeId" @change="selectTheme">
            <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
          </select>
        </label>
        <p class="app__notice" role="status">{{ headerNotice }}</p>
        <p class="app__api">{{ labels[apiState] }}</p>
      </header>
      <main class="app__main">
        <WidgetBoard ref="board" v-model:mode="mode" :theme-id="themeId" @notice="notice = $event" />
      </main>
    </div>
    <p class="app__narrow">Окно слишком узкое</p>
  </div>
</template>

<style>
/* One scale for the whole UI (base design §7.4): every size is rem, only the root font size changes. */
html {
  font-size: max(16px, min(1vw, calc(100dvh / 43.75)));
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
  height: var(--ld-control-height);
  min-width: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.app__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.app__button:disabled {
  cursor: default;
  opacity: 0.5;
}

.app__theme {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}

.app__select {
  height: var(--ld-control-height);
  padding: 0 0.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
}

.app__select:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.app__notice {
  margin: 0;
  color: var(--ld-danger-text);
  font-size: 0.875rem;
}

.app__api {
  margin: 0 0 0 auto;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
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
