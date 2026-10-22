<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { ROWS } from '@lifedashboard/contracts/grid'
import { SPACE_LIMITS } from '@lifedashboard/contracts/space'
import { api } from './api'
import WidgetBoard from './board/WidgetBoard.vue'
import type { BoardMode } from './board/edit-session'
import { connect } from './board/space-sync'
import PairingForm from './PairingForm.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ConfirmDelete from './spaces/ConfirmDelete.vue'
import { headerTitle } from './spaces/nav'
import ScreenDots from './spaces/ScreenDots.vue'
import { toasts } from './toasts'
import { installedPackages, loadPackages, pickerEntries } from './widgets/catalog'
import PackagesDialog from './widgets/PackagesDialog.vue'
import { loadAppearance, saveAppearance } from './theme/appearance'
import { BUILTIN_THEMES, BUILTIN_THEME_IDS, themeMeta } from './theme/builtin'
import { resolveThemeId, themeClass } from './theme/resolve'

type AppState = 'checking' | 'pairing' | 'ready' | 'unavailable'

const state = ref<AppState>('checking')
// The first space; the spaces UI arrives with step 2 of GO-3.
const spaceId = ref<string | null>(null)
// The screen on display; the board keeps it in step with what it shows.
const screenId = ref<string | null>(null)
const spaceTitle = ref('')
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

const screenCount = computed(() => boardRef.value?.screens.length ?? 0)
const screenIndex = computed(() => Math.max(0, boardRef.value?.screens.indexOf(screenId.value ?? '') ?? 0))
const headerText = computed(() => headerTitle(spaceTitle.value, screenIndex.value, screenCount.value))

function goScreen(index: number) {
  const id = boardRef.value?.screens[index]
  if (id) void boardRef.value?.switchScreen(id)
}

const apiLabel = computed(() => {
  if (state.value === 'unavailable' || apiDown.value) return 'API: недоступен'
  return state.value === 'checking' ? 'API: проверка…' : 'API: работает'
})

// Workspace theme; Spaces (E2) will put their own id in front of it in the chain.
const storedThemeId = loadAppearance().themeId
const themeId = ref(resolveThemeId([storedThemeId], BUILTIN_THEME_IDS))
// An unknown stored id (deleted theme) is kept as it is; the default theme is shown meanwhile.
const themeNotice = ref<string | null>(
  storedThemeId !== null && !BUILTIN_THEME_IDS.has(storedThemeId) ? 'Тема не найдена, показана тема по умолчанию' : null,
)
const headerNotice = computed(() => [notice.value, themeNotice.value].filter(Boolean).join(' · ') || null)
const statusText = computed(() => [apiLabel.value, headerNotice.value].filter(Boolean).join(' · '))

function selectTheme(event: Event) {
  themeId.value = resolveThemeId([(event.target as HTMLSelectElement).value], BUILTIN_THEME_IDS)
  // A failed save keeps the theme applied for this session.
  themeNotice.value = saveAppearance({ schemaVersion: 1, themeId: themeId.value }) ? null : 'Не удалось сохранить тему'
}

const rootClass = computed(() => [
  'space',
  `space--theme-${themeClass(themeId.value)}`,
  `space--skin-${themeMeta(themeId.value).skin}`,
])

async function check() {
  state.value = 'checking'
  mode.value = 'view'
  notice.value = null
  apiDown.value = false
  const result = await connect(api)
  if (result.state === 'ready') {
    spaceId.value = result.spaceId
    void loadPackages(api)
    void loadTitle(result.spaceId)
  }
  state.value = result.state
}

// The header shows the space title; connect() yields only the id, so the list is read for the title.
async function loadTitle(id: string) {
  const result = await api.spaces()
  if (result.ok) spaceTitle.value = result.data.find((space) => space.id === id)?.title ?? ''
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
    <div class="space__backdrop" />
    <div class="app">
      <header class="app__header">
        <div class="app__start">
          <p v-if="state === 'ready'" class="app__title">{{ headerText }}</p>
          <!-- The API status and the notice share one line; the notice is cut first when there is no room. -->
          <p class="app__meta" role="status" :title="statusText">
            <span>{{ apiLabel }}</span>
            <span v-if="headerNotice" class="app__notice"> · {{ headerNotice }}</span>
          </p>
        </div>
        <ScreenDots
          v-if="state === 'ready'"
          :count="screenCount"
          :index="screenIndex"
          :editing="mode === 'edit'"
          :disabled="mode === 'build' || !!boardRef?.saving"
          :can-add="screenCount < SPACE_LIMITS.screens"
          :can-remove="true"
          remove-title=""
          @go="goScreen"
          @add="boardRef?.addScreen()"
          @remove="boardRef?.removeScreen()"
        />
        <div class="app__end">
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
        </div>
      </header>
      <main class="app__main">
        <p v-if="state === 'checking'" class="app__status">Подключение…</p>
        <PairingForm v-else-if="state === 'pairing'" @paired="check" />
        <div v-else-if="state === 'unavailable'" class="app__status">
          <p>API: недоступен</p>
          <button type="button" class="app__button" @click="check">Повторить</button>
        </div>
        <WidgetBoard
          v-else-if="spaceId"
          ref="board"
          v-model:mode="mode"
          v-model:space-id="spaceId"
          v-model:screen-id="screenId"
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
    <ConfirmDelete />
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

/* Three columns: title and status (column 1), screen dots (column 2, centred by the equal side columns),
   controls (column 3). The right padding reserves the corner slot. */
.app__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  padding: 0 3.5rem 0 1rem;
}

.app__start {
  grid-column: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

/* The title keeps its width until the status needs the room; it is capped at half the column. */
.app__title {
  flex: 0 1 auto;
  max-width: 50%;
  min-width: 0;
  margin: 0;
  font-size: 1.125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* API status first, then the notice; the notice is cut first. Full text in the title attribute. */
.app__meta {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}

.app__notice {
  color: var(--ld-danger-text);
}

/* The controls and the theme select sit at the right edge, before the corner slot. */
.app__end {
  grid-column: 3;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.375rem;
  min-width: 0;
}

.app__end > * {
  flex-shrink: 0;
}

.app__button {
  height: var(--ld-control-height);
  min-width: var(--ld-control-height);
  padding: 0 0.625rem;
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
  gap: 0.375rem;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}

.app__select {
  height: var(--ld-control-height);
  padding: 0 0.375rem;
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
  width: 3.5rem;
}

.app__rows:invalid {
  outline: 0.125rem solid var(--ld-danger);
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
