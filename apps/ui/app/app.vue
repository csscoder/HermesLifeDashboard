<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, useTemplateRef } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { ROWS } from '@lifedashboard/contracts/grid'
import { SPACE_LIMITS, type SpacePatch, type SpaceSummary } from '@lifedashboard/contracts/space'
import { api } from './api'
import WidgetModal from './widgets/WidgetModal.vue'
import SandboxWidget from './widgets/SandboxWidget.vue'
import { widgetModals } from './widgets/modals'
import WidgetBoard from './board/WidgetBoard.vue'
import PixiBackground from './background/PixiBackground.vue'
import type { BoardMode } from './board/edit-session'
import { connect, type Reaction } from './board/space-sync'
import PairingForm from './PairingForm.vue'
import SettingsPanel from './SettingsPanel.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { askDelete } from './spaces/confirm-delete'
import ConfirmDelete from './spaces/ConfirmDelete.vue'
import { screenSuffix } from './spaces/nav'
import { loadLastOpen, resolveLastOpen, saveLastOpen, type LastOpen } from './spaces/last-open'
import ScreenDots from './spaces/ScreenDots.vue'
import { canRemoveScreen, LAST_SPACE_HINT, runCreateSpace, runDeleteSpace, runEditSpace } from './spaces/space-flow'
import SpaceSwitcher from './spaces/SpaceSwitcher.vue'
import SpaceTitle from './spaces/SpaceTitle.vue'
import { toasts } from './toasts'
import { installedPackages, loadPackages, pickerEntries } from './widgets/catalog'
import PackagesDialog from './widgets/PackagesDialog.vue'
import { loadAppearance, saveAppearance } from './theme/appearance'
import { BUILTIN_THEME_IDS, themeMeta } from './theme/builtin'
import { resolveThemeId, themeClass } from './theme/resolve'

type AppState = 'checking' | 'pairing' | 'ready' | 'unavailable'

const state = ref<AppState>('checking')
const { activeModal, error: modalError, retryVersion: modalRetryVersion } = widgetModals
const modalContext = computed(() => widgetModals.context())
watch(state, value => { if (value !== 'ready') widgetModals.cancelAll() }, { flush: 'sync' })
onUnmounted(() => widgetModals.dispose())
const spaces = ref<SpaceSummary[]>([])
// The space on display. It changes only after the board confirms a switch.
const currentId = ref<string | null>(null)
// The board's model: the board sets it while it switches, so it can lead currentId during a switch.
const spaceId = ref<string | null>(null)
// The screen on display; the board keeps it in step with what it shows.
const screenId = ref<string | null>(null)
// The last space and screen per space, remembered in this browser (spec «Persistence»).
let memory: LastOpen = loadLastOpen()
// Set after a space is created, so its name opens for editing.
const startRename = ref(false)
// A failed save keeps the board but marks the API as unavailable in the header.
const apiDown = ref(false)
const mode = ref<BoardMode>('view')
const notice = ref<string | null>(null)
const boardRef = useTemplateRef<InstanceType<typeof WidgetBoard>>('board')

// The widget the next build draft places; set by the «Добавить виджет» picker.
const draftSource = ref<WidgetSource>({ kind: 'builtin', type: 'placeholder' })
const packagesOpen = ref(false)
const entries = computed(() => pickerEntries(installedPackages.value))

function pickWidget(key: string) {
  const entry = entries.value.find((item) => item.key === key)
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
const titleSuffix = computed(() => screenSuffix(screenIndex.value, screenCount.value))
const current = computed(() => spaces.value.find((space) => space.id === currentId.value) ?? null)
// Build and save block the switcher and the screen controls; so does a switch that is in flight.
const busy = computed(
  () => mode.value === 'build' || managing.value || !!boardRef.value?.saving || !!boardRef.value?.switching,
)
const canRemove = computed(() => canRemoveScreen(spaces.value.length, screenCount.value))
const removeTitle = computed(() => (canRemove.value ? '' : LAST_SPACE_HINT))

// The screen remembered for a space; the board falls back to its first screen when it is gone.
function rememberedScreen(id: string): string | null {
  return memory.screens[id] ?? null
}

// Stores the space and screen on display. Called after a switch the board confirmed.
async function remember() {
  await nextTick()
  if (currentId.value === null || screenId.value === null) return
  memory = { ...memory, spaceId: currentId.value, screens: { ...memory.screens, [currentId.value]: screenId.value } }
  saveLastOpen(memory)
}

async function goScreen(index: number) {
  const board = boardRef.value
  const id = board?.screens[index]
  if (board && id && (await board.switchScreen(id))) await remember()
}

async function addScreen() {
  if (await boardRef.value?.addScreen()) await remember()
}

async function select(id: string) {
  if (id === currentId.value) return
  if (await boardRef.value?.switchSpace(id, rememberedScreen(id))) {
    currentId.value = id
    await remember()
  }
}

// One space create or delete at a time: a repeated « + » or ✕ while one runs, or waits for its confirmation, is ignored.
const managing = ref(false)
async function once(task: () => Promise<void>) {
  if (managing.value) return
  managing.value = true
  try {
    await task()
  } finally {
    managing.value = false
  }
}
function create() {
  return once(createSpace)
}
function removeScreen() {
  return once(deleteScreenOrSpace)
}

async function createSpace() {
  const board = boardRef.value
  if (!board) return
  startRename.value = false
  const result = await runCreateSpace({
    saveIfDirty: () => board.saveIfDirty(),
    createSpace: () => api.createSpace(),
    switchTo: (id) => board.switchSpace(id, null),
  })
  if (result.kind === 'failed') return applyReaction(result.reaction)
  if (result.kind !== 'created') return
  spaces.value = [...spaces.value, result.space]
  if (!result.switched) return
  currentId.value = result.space.id
  await remember()
  startRename.value = true
}

async function edit(id: string, patch: SpacePatch) {
  const result = await runEditSpace(() => api.updateSpace(id, patch))
  if (result.kind === 'failed') return applyReaction(result.reaction)
  spaces.value = spaces.value.map((space) => (space.id === id ? result.space : space))
}

function rename(title: string) {
  if (current.value) void edit(current.value.id, { title })
}

// ✕ on the screen. The board deletes a screen; its only screen deletes the space, after a confirmation.
async function deleteScreenOrSpace() {
  const board = boardRef.value
  if (!board) return
  const outcome = await board.removeScreen()
  if (outcome === 'deleted') return remember()
  const space = current.value
  const revision = board.revision
  if (outcome !== 'last' || !space || revision === null) return
  const result = await runDeleteSpace(space, spaces.value.map((item) => item.id), {
    ask: askDelete,
    remove: () => api.deleteSpace(space.id, revision),
    switchTo: (id) => board.switchSpace(id, rememberedScreen(id), { discard: true }),
  })
  if (result.kind === 'failed') return applyReaction(result.reaction)
  if (result.kind !== 'deleted') return
  spaces.value = spaces.value.filter((item) => item.id !== space.id)
  if (!result.switched) return
  currentId.value = result.target
  await remember()
}

// Applies a reaction of a space operation; the board keeps its own state.
function applyReaction(reaction: Reaction) {
  if (reaction.leaveMode) mode.value = 'view'
  if (reaction.notice !== undefined) notice.value = reaction.notice
  if (reaction.api) apiDown.value = reaction.api === 'down'
  if (reaction.app === 'pairing') onUnauthorized()
  else if (reaction.app === 'unavailable') onUnavailable()
}

const apiLabel = computed(() => {
  if (state.value === 'unavailable' || apiDown.value) return 'API: недоступен'
  return state.value === 'checking' ? 'API: проверка…' : 'API: работает'
})

// The dashboard default is independent of the theme resolved for the displayed screen.
const storedThemeId = loadAppearance().themeId
const dashboardThemeId = ref(resolveThemeId([storedThemeId], BUILTIN_THEME_IDS))
const themeId = computed<string>(() => resolveThemeId([
  boardRef.value?.screenThemeId ?? null,
  spaces.value.find(space => space.id === boardRef.value?.themeSpaceId)?.themeId ?? null,
  dashboardThemeId.value,
], BUILTIN_THEME_IDS))
// An unknown stored id (deleted theme) is kept as it is; the default theme is shown meanwhile.
const backgroundNotice = ref<string | null>(null)
const themeNotice = ref<string | null>(
  storedThemeId !== null && !BUILTIN_THEME_IDS.has(storedThemeId) ? 'Тема не найдена, показана тема по умолчанию' : null,
)
const headerNotice = computed(() => [notice.value, themeNotice.value, backgroundNotice.value, boardRef.value?.backgroundLeaseError].filter(Boolean).join(' · ') || null)
const statusText = computed(() => [apiDown.value ? apiLabel.value : null, headerNotice.value].filter(Boolean).join(' · '))

function selectTheme(id: string) {
  dashboardThemeId.value = resolveThemeId([id], BUILTIN_THEME_IDS)
  // A failed save keeps the theme applied for this session.
  themeNotice.value = saveAppearance({ schemaVersion: 1, themeId: dashboardThemeId.value }) ? null : 'Не удалось сохранить тему'
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
    spaces.value = result.spaces
    // The remembered space, or the first one when it is gone; its remembered screen, or the board's first.
    const id = resolveLastOpen(memory, result.spaces)
    if (id) {
      currentId.value = spaceId.value = id
      screenId.value = rememberedScreen(id)
    }
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
    <div class="space__backdrop" />
    <PixiBackground v-if="state === 'ready'" :background="boardRef?.background ?? null" @error="backgroundNotice = $event" />
    <div class="app">
      <header class="app__header">
        <div class="app__start">
          <SpaceTitle
            v-if="state === 'ready'"
            :title="current?.title ?? ''"
            :suffix="titleSuffix"
            :editing="mode === 'edit'"
            :start-rename="startRename"
            @rename="rename"
          />
        </div>
        <!-- Keep the existing space fan anchored to its corner. -->
        <SpaceSwitcher
          v-if="state === 'ready' && spaces.length > 0"
          :spaces="spaces"
          :dashboard-theme-id="dashboardThemeId"
          :current-id="currentId ?? ''"
          :editing="mode === 'edit'"
          :disabled="busy"
          @select="select"
          @create="create"
          @edit="edit"
        />
      </header>
      <main class="app__main" data-board-focus tabindex="-1">
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
      <footer v-if="state === 'ready'" class="app__footer">
        <ScreenDots
          :count="screenCount"
          :index="screenIndex"
          :editing="mode === 'edit'"
          :disabled="!boardRef?.loaded || busy"
          :theme-id="boardRef?.screenThemeId ?? null"
          :background="boardRef?.background ?? null"
          :screen-key="boardRef?.backgroundKey ?? ''"
          :can-add="screenCount < SPACE_LIMITS.screens"
          :can-remove="canRemove"
          :remove-title="removeTitle"
          @go="goScreen"
          @add="addScreen"
          @remove="removeScreen"
          @theme="boardRef?.setScreenTheme($event)"
          @background="boardRef?.setBackground($event)"
        />
        <div v-if="mode !== 'view'" class="app__edit-controls" role="group" aria-label="Редактирование доски">
          <label v-if="mode === 'edit'" class="app__theme">
            Ряды
            <input class="app__select app__rows" type="number" required :min="ROWS.min" :max="ROWS.max" step="1"
              :value="boardRef?.rows" :disabled="boardRef?.saving" @input="setRows" />
          </label>
          <button type="button" class="app__button app__button--primary" :disabled="boardRef?.saving" @click="boardRef?.confirm()">Готово</button>
          <button type="button" class="app__button" :disabled="boardRef?.saving" @click="boardRef?.cancel()">Отмена</button>
        </div>
      </footer>
      <SettingsPanel
        v-if="state === 'ready'"
        :entries="entries"
        :loaded="!!boardRef?.loaded"
        :viewing="mode === 'view'"
        :space-title="current?.title ?? ''"
        :space-icon="current?.icon ?? ''"
        :screen-index="screenIndex"
        :screen-count="screenCount"
        :rows="boardRef?.rows ?? null"
        :theme-id="dashboardThemeId"
        :api-label="apiLabel"
        :api-down="apiDown"
        @pick="pickWidget"
        @edit="mode = 'edit'"
        @library="packagesOpen = true"
        @theme="selectTheme"
      />
      <p v-if="statusText" class="app__notice" role="status">{{ statusText }}</p>
    </div>
    <PackagesDialog v-if="state === 'ready'" v-model:open="packagesOpen" />
    <WidgetModal :record="activeModal" :error="modalError" @close="widgetModals.close" @retry="widgetModals.retry">
      <template #default="{ ready }">
        <SandboxWidget v-if="activeModal && modalContext && activeModal.state !== 'refreshing'"
          :key="activeModal.id + ':' + modalRetryVersion" surface="modal" :surface-id="activeModal.id"
          :widget-id="activeModal.owner.widgetId" :hash="activeModal.owner.hash"
          :title="activeModal.owner.title" :package-id="activeModal.owner.packageId" :version="activeModal.owner.version"
          :mount="{ view: activeModal.input.view, props: activeModal.input.props }" :context="modalContext" @ready="ready"
        />
      </template>
    </WidgetModal>
    <ConfirmDialog :application-modal-id="activeModal?.id" />
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
  grid-template-rows: 3.5rem minmax(0, 1fr) 3.5rem;
  height: 100dvh;
}

.app__header {
  display: flex;
  align-items: center;
  padding: 0 5rem 0 1rem;
}

.app__start { min-width: 0; }

@media (hover: hover) and (pointer: fine) {
  .app:not(:hover) :is(.dots, .settings .settings__trigger, .space-switcher .space-switcher__trigger) {
    opacity: 0;
    pointer-events: none;
  }

  .app:hover :is(.dots, .settings .settings__trigger, .space-switcher .space-switcher__trigger) {
    opacity: 0.25;
    pointer-events: auto;
  }

  .app :is(
    .dots:is(:hover, :focus-within, :has(:popover-open)),
    .settings__trigger:is(:hover, :focus, [aria-expanded='true']),
    .space-switcher:is(:hover, :focus-within, .space-switcher--open) .space-switcher__trigger
  ) {
    opacity: 1;
    pointer-events: auto;
  }
}

.app__notice {
  position: fixed;
  top: 3.5rem;
  left: 50%;
  z-index: 10;
  max-width: calc(100vw - 10rem);
  max-height: 25dvh;
  overflow-y: auto;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.5rem 0.875rem;
  border: var(--ld-border-width) solid var(--ld-danger);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-1-solid);
  color: var(--ld-danger-text);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.app__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.25rem 5.5rem;
}

.app__edit-controls { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }

.app__button--primary { border-color: var(--ld-info); color: var(--ld-info-text); }

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
  bottom: 5.25rem;
  z-index: 10;
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
