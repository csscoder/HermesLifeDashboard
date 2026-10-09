<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { ROWS } from '@lifedashboard/contracts/grid'
import { api } from './api'
import WidgetBoard from './board/WidgetBoard.vue'
import type { BoardMode } from './board/edit-session'
import { connect } from './board/room-sync'
import PairingForm from './PairingForm.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { toasts } from './toasts'
import { installedPackages, loadPackages, pickerEntries } from './widgets/catalog'
import PackagesDialog from './widgets/PackagesDialog.vue'
import { loadAppearance, saveAppearance } from './theme/appearance'
import { BUILTIN_THEMES, BUILTIN_THEME_IDS, themeMeta } from './theme/builtin'
import { resolveThemeId, themeClass } from './theme/resolve'

type AppState = 'checking' | 'pairing' | 'ready' | 'unavailable'

const state = ref<AppState>('checking')
// The first room; the rooms UI arrives with step 2 of GO-3.
const roomId = ref<string | null>(null)
// A failed save keeps the board but marks the API as unavailable in the header.
const apiDown = ref(false)
const mode = ref<BoardMode>('view')
const notice = ref<string | null>(null)
const boardRef = useTemplateRef('board')

// The widget the next build draft places; set by the «Добавить виджет» picker.
const draftSource = ref<WidgetSource>({ kind: 'builtin', type: 'placeholder' })
const packagesOpen = ref(false)
const entries = computed(() => pickerEntries(installedPackages.value))

function pickWidget(event: Event) {
  const select = event.target as HTMLSelectElement
  const entry = entries.value.find((item) => item.key === select.value)
  select.value = ''
  if (!entry) return
  draftSource.value = entry.source
  mode.value = 'build'
}

// An empty or out-of-range value leaves the working copy unchanged; :invalid marks the field.
function setRows(event: Event) {
  boardRef.value?.setRows((event.target as HTMLInputElement).valueAsNumber)
}

const apiLabel = computed(() => {
  if (state.value === 'unavailable' || apiDown.value) return 'API: недоступен'
  return state.value === 'checking' ? 'API: проверка…' : 'API: работает'
})

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

async function check() {
  state.value = 'checking'
  mode.value = 'view'
  notice.value = null
  apiDown.value = false
  const result = await connect(api)
  if (result.state === 'ready') {
    roomId.value = result.roomId
    void loadPackages(api)
  }
  state.value = result.state
}

function onUnauthorized() {
  // An unsaved working copy is discarded; pairing starts over (spec «App states»).
  mode.value = 'view'
  notice.value = null
  state.value = 'pairing'
}

function onUnavailable() {
  mode.value = 'view'
  state.value = 'unavailable'
}

onMounted(check)
</script>

<template>
  <div :class="rootClass">
    <div class="room__backdrop" />
    <div class="app">
      <header class="app__header">
        <h1 class="app__title">LifeDashboard</h1>
        <template v-if="state === 'ready'">
          <template v-if="mode !== 'view'">
            <button type="button" class="app__button" :disabled="boardRef?.saving" @click="boardRef?.confirm()">
              Готово
            </button>
            <button type="button" class="app__button" :disabled="boardRef?.saving" @click="boardRef?.cancel()">
              Отмена
            </button>
            <label v-if="mode === 'edit'" class="app__theme">
              Ряды
              <input
                class="app__select app__rows"
                type="number"
                required
                :min="ROWS.min"
                :max="ROWS.max"
                step="1"
                :value="boardRef?.rows"
                :disabled="boardRef?.saving"
                @input="setRows"
              />
            </label>
          </template>
          <template v-else>
            <!-- Disabled until the board is loaded: a draft on an empty placeholder board could not be saved. -->
            <select
              class="app__select"
              aria-label="Добавить виджет"
              :disabled="!boardRef?.loaded"
              @change="pickWidget"
            >
              <option value="" selected>Добавить виджет…</option>
              <option v-for="entry in entries" :key="entry.key" :value="entry.key">{{ entry.title }}</option>
            </select>
            <button type="button" class="app__button" :disabled="!boardRef?.loaded" @click="mode = 'edit'">
              Изменить
            </button>
            <button type="button" class="app__button" @click="packagesOpen = true">Виджеты</button>
          </template>
        </template>
        <label class="app__theme">
          Тема
          <select class="app__select" :value="themeId" @change="selectTheme">
            <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
          </select>
        </label>
        <p class="app__notice" role="status">{{ headerNotice }}</p>
        <p class="app__api">{{ apiLabel }}</p>
      </header>
      <main class="app__main">
        <p v-if="state === 'checking'" class="app__status">Подключение…</p>
        <PairingForm v-else-if="state === 'pairing'" @paired="check" />
        <div v-else-if="state === 'unavailable'" class="app__status">
          <p>API: недоступен</p>
          <button type="button" class="app__button" @click="check">Повторить</button>
        </div>
        <WidgetBoard
          v-else-if="roomId"
          ref="board"
          v-model:mode="mode"
          :room-id="roomId"
          :theme-id="themeId"
          :draft-source="draftSource"
          @notice="notice = $event"
          @api="apiDown = $event === 'down'"
          @unauthorized="onUnauthorized"
          @unavailable="onUnavailable"
        />
      </main>
    </div>
    <PackagesDialog v-if="state === 'ready'" v-model:open="packagesOpen" />
    <ConfirmDialog />
    <ul class="app__toasts" aria-live="polite">
      <li v-for="toast in toasts" :key="toast.id" class="app__toast">
        <p class="app__toast-source">{{ toast.source }}</p>
        <p class="app__toast-title">{{ toast.title }}</p>
        <p v-if="toast.body" class="app__toast-body">{{ toast.body }}</p>
      </li>
    </ul>
    <p class="app__narrow">Окно слишком узкое</p>
  </div>
</template>

<style>
/* One scale for the whole UI (base design §7.4): every size is rem, only the root font size changes. */
html {
  font-size: calc(100vw / 80);
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

.app__rows {
  width: 4.5rem;
}

.app__rows:invalid {
  outline: 0.125rem solid var(--ld-danger);
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

.app__status {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  margin: 4rem 0 0;
  color: var(--ld-text-muted);
}

.app__narrow {
  display: none;
}

.app__toasts {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  gap: 0.5rem;
  width: 20rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.app__toast {
  padding: 0.75rem 1rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
}

.app__toast p {
  margin: 0;
}

.app__toast-source {
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}

.app__toast-title {
  font-weight: var(--ld-weight-strong);
}

.app__toast-body {
  font-size: 0.875rem;
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
