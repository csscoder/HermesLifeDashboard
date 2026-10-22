<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { ScreenBoard, WidgetAppearance, WidgetInstance, WidgetSource } from '@lifedashboard/contracts/board'
import { GRID_COLS, ROWS, findFreeRect, gridRows, type Rect } from '@lifedashboard/contracts/grid'
import { api } from '../api'
import { askDelete, pendingDelete } from '../spaces/confirm-delete'
import { afterDelete, needsDeleteConfirm } from '../spaces/nav'
import { resolveWidgetLook } from '../theme/resolve'
import { describeSource, installedPackages } from '../widgets/catalog'
import { refreshSecretFlags, useSecretFlags } from '../widgets/secret-flags'
import WidgetHost from '../widgets/WidgetHost.vue'
import { addInstance, focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setAppearance, setConfig, setPackageVersion, setPlacement, withRows, type BoardMode } from './edit-session'
import { isFormControlTarget } from './keyboard'
import { afterLoad, afterManage, afterSave, afterStaySave, useSpaceSync, type Reaction } from './space-sync'
import { screenNamed, useScreenModel } from './screen-model'
import { runDeleteScreen, runPreSave } from './switch-flow'
import { useActiveRect } from './use-active-rect'
import WidgetSettings from './WidgetSettings.vue'

const mode = defineModel<BoardMode>('mode', { required: true })
// Both ids are v-model: the app reads them, the board writes them when it switches.
const spaceId = defineModel<string>('spaceId', { required: true })
const screenId = defineModel<string | null>('screenId', { required: true })
const props = defineProps<{ themeId: string; draftSource: WidgetSource }>()
const emit = defineEmits<{
  notice: [message: string | null]
  // 'down' after a failed save: the board stays, the header shows the API as unavailable.
  api: [status: 'ok' | 'down']
  unauthorized: []
  // A load failed: the app replaces the board with «Повторить».
  unavailable: []
}>()

const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}
// A card that is not active fills its grid area.
const fill = { width: '100%', height: '100%' }
const emptyScreen: ScreenBoard = { id: '', rows: ROWS.default, instances: [], layout: [] }
const draftSizing = computed(() => describeSource(props.draftSource)?.sizing ?? null)

// A load that finishes while a mode is open is dropped (DATA-06); `saving` blocks input during a PUT.
const {
  space,
  saving,
  loaded,
  load: loadSpace,
  save: saveSpace,
  saveAndStay,
  switchSpace: loadSwitchedSpace,
  addScreen: createScreen,
  deleteScreen: deleteScreenOnServer,
} = useSpaceSync(
  api,
  () => spaceId.value,
  () => mode.value === 'view',
)
// The screen screenId names; the first one when it names none (the board never shows an empty space).
const screenModel = useScreenModel({ space, spaceId, screenId })
const doc = computed<ScreenBoard>(() => screenModel.doc.value ?? emptyScreen)
const screens = computed(() => space.value?.screens.map((screen) => screen.id) ?? [])
const revision = computed(() => space.value?.revision ?? null)
// Edit mode changes a working copy; `doc` keeps the loaded screen for the «unchanged» check.
const working = ref<ScreenBoard>(emptyScreen)
// Direction of the last screen switch: the grid slides in from that side for one frame.
const slide = ref<'enter-next' | 'enter-prev' | null>(null)
const activeId = ref<string | null>(null)
// Template ref keys must differ from setup bindings: ref="draft" would overwrite a setup binding.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')
const settings = useTemplateRef<InstanceType<typeof WidgetSettings>>('settingsPanel')
// The widget the settings panel edits; kept after the panel closes, so its gear can take focus back.
const settingsId = ref<string | null>(null)
// Mirrors the popover for aria-expanded; logic asks settings.value.isOpen(), which is synchronous.
const settingsOpen = ref(false)
// Board-caused closes (widget removed, mode left, save started) keep the board's own focus rules.
let boardClosing = false
// Light dismiss closes the panel on pointerup, before the gear's click; this is its state at pointerdown.
let openAtPress: boolean | null = null

const editing = computed(() => mode.value === 'edit')
// The screen on display: the working copy in edit mode, the loaded screen otherwise.
const shown = computed(() => (editing.value ? working.value : doc.value))
// Pending widget edits: the working copy differs from the saved screen.
const dirty = computed(() => editing.value && !isSameBoard(working.value, doc.value))

const placed = computed(() =>
  shown.value.layout.flatMap((placement) => {
    const instance = shown.value.instances.find((item) => item.id === placement.instanceId)
    return instance ? [{ instance, placement, look: resolveWidgetLook(instance.appearance, props.themeId) }] : []
  }),
)

function sizingOf(instance: WidgetInstance) {
  return describeSource(instance.source)?.sizing ?? null
}

const activeSizing = computed(() => {
  const instance = working.value.instances.find((item) => item.id === activeId.value)
  return instance ? sizingOf(instance) : null
})

// Held during a pointer operation, so the grid never shrinks under the pointer (spec «Board»).
const heldRows = ref<number | null>(null)
const renderedRows = computed(() => heldRows.value ?? gridRows(shown.value.rows, shown.value.layout))
const cells = computed(() =>
  Array.from({ length: GRID_COLS * renderedRows.value }, (_, index) => ({
    x: index % GRID_COLS,
    y: Math.floor(index / GRID_COLS),
    w: 1,
    h: 1,
  })),
)

const {
  rect: activeRect,
  moving,
  dragging,
  cardStyle,
  activate,
  deactivate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  step,
} = useActiveRect({
  gridEl,
  others: () =>
    editing.value ? working.value.layout.filter((item) => item.instanceId !== activeId.value) : doc.value.layout,
  sizing: () => (editing.value ? activeSizing.value : draftSizing.value),
  rows: () => shown.value.rows,
  gridRows: () => renderedRows.value,
})

watch(
  dragging,
  (active) => {
    heldRows.value = active ? gridRows(shown.value.rows, shown.value.layout) : null
  },
  { flush: 'sync' },
)

// Every change of the edited widget's rect lands in the working copy at once.
watch(
  activeRect,
  (rect) => {
    if (editing.value && rect && activeId.value) working.value = setPlacement(working.value, activeId.value, rect)
  },
  { flush: 'sync' },
)

function rectLabel(rect: Rect) {
  return `Виджет ${rect.w}×${rect.h}, колонка ${rect.x + 1}, ряд ${rect.y + 1}`
}

const liveLabel = computed(() => (activeRect.value ? rectLabel(activeRect.value) : ''))

function area(rect: Rect) {
  return { gridColumn: `${rect.x + 1} / span ${rect.w}`, gridRow: `${rect.y + 1} / span ${rect.h}` }
}

// Applies a tested reaction (space-sync); no decisions here.
async function apply(reaction: Reaction) {
  if (reaction.leaveMode) stop()
  if (reaction.notice !== undefined) emit('notice', reaction.notice)
  if (reaction.api) emit('api', reaction.api)
  if (reaction.app === 'pairing') emit('unauthorized')
  else if (reaction.app === 'unavailable') emit('unavailable')
  if (reaction.reload) await load()
}

async function load() {
  await apply(afterLoad(await loadSpace()))
}

async function save(next: ScreenBoard) {
  await apply(afterSave(await saveSpace(next)))
}

// Saves pending edits before a switch. A failure applies its reaction and keeps the working copy.
async function saveIfDirty(): Promise<boolean> {
  const pending = dirty.value
  const result = await runPreSave({
    editing: editing.value,
    dirty: pending,
    saveAndStay: () => saveAndStay(working.value),
  })
  if (!result.ok) await apply(result.reaction)
  // A save that went through clears an earlier failure notice and the API status.
  else if (pending) await apply(afterStaySave('saved'))
  return result.ok
}

// Puts the working copy on a screen and drops any widget selection of the previous one.
function openWorking(id: string | null) {
  deactivate()
  activeId.value = null
  working.value = screenNamed(space.value?.screens ?? [], id) ?? emptyScreen
}

// Slides the grid in from the side the move comes from. The start pose is applied for one frame,
// then released, so the transition runs from it.
async function slideIn(from: number, to: number) {
  slide.value = to < from ? 'enter-prev' : 'enter-next'
  await nextTick()
  void gridEl.value?.getBoundingClientRect()
  slide.value = null
}

// Switches screen. In edit mode the pending edits are saved first and edit mode continues on the target.
async function switchScreen(id: string): Promise<boolean> {
  if (saving.value || mode.value === 'build' || !screens.value.includes(id)) return false
  if (id === doc.value.id) return true
  if (!(await saveIfDirty())) return false
  const from = screens.value.indexOf(doc.value.id)
  const to = screens.value.indexOf(id)
  screenId.value = id
  if (editing.value) openWorking(id)
  void slideIn(from, to)
  return true
}

// One space switch at a time: a request made meanwhile is refused, so two loads never finish out of order.
const switching = ref(false)
async function switchSpace(target: string, screen: string | null, opts?: { discard: boolean }): Promise<boolean> {
  if (switching.value) return false
  switching.value = true
  try {
    return await runSwitchSpace(target, screen, opts)
  } finally {
    switching.value = false
  }
}
// Switches space and loads it. The screen id is written after the load, to the screen the board shows then.
async function runSwitchSpace(target: string, screen: string | null, opts?: { discard: boolean }): Promise<boolean> {
  if (saving.value || mode.value === 'build') return false
  if (!opts?.discard && !(await saveIfDirty())) return false
  const switched = await screenModel.switchTo(target, screen, loadSwitchedSpace)
  await apply(afterLoad(switched.outcome))
  if (switched.outcome !== 'loaded') return false
  if (editing.value) openWorking(switched.screenId)
  return true
}

// Adds a screen after the last one and switches to it; edit mode continues on the empty screen.
async function addScreen(): Promise<boolean> {
  if (saving.value || mode.value === 'build') return false
  if (!(await saveIfDirty())) return false
  const from = screens.value.indexOf(doc.value.id)
  const result = await createScreen()
  await apply(afterManage(result.outcome))
  if (result.outcome !== 'saved' || !result.screenId) return false
  screenId.value = result.screenId
  if (editing.value) openWorking(result.screenId)
  void slideIn(from, screens.value.indexOf(result.screenId))
  return true
}

// ✕ on the active screen. It does not save pending edits: the working copy is kept until the delete succeeds.
// 'last' is the space's only screen; the caller deletes the space instead.
async function removeScreen(): Promise<'deleted' | 'last' | 'cancelled' | 'failed'> {
  if (saving.value || mode.value === 'build') return 'cancelled'
  if (screens.value.length <= 1) return 'last'
  const id = doc.value.id
  const ids = screens.value
  const saved = space.value?.screens.find((screen) => screen.id === id)
  const result = await runDeleteScreen({
    needsConfirm: needsDeleteConfirm(saved, editing.value ? working.value : null),
    ask: () => askDelete('Удалить экран? Виджеты на нём будут удалены.'),
    remove: () => deleteScreenOnServer(id),
  })
  if ('cancelled' in result) return 'cancelled'
  if (!result.ok) {
    await apply(result.reaction)
    return 'failed'
  }
  await apply(afterManage('saved'))
  const target = afterDelete(ids, id)
  screenId.value = target
  if (editing.value) openWorking(target)
  if (target) void slideIn(ids.indexOf(id), screens.value.indexOf(target))
  return 'deleted'
}

function start() {
  emit('notice', null)
  const sizing = draftSizing.value
  const others = doc.value.layout
  const rect =
    sizing &&
    (findFreeRect(sizing.default, others, doc.value.rows) ?? findFreeRect(sizing.min, others, doc.value.rows))
  if (!rect) {
    emit('notice', 'Нет свободного места')
    mode.value = 'view'
    return
  }
  activate(rect)
  void nextTick(() => draftEl.value?.focus())
}

function enterEdit() {
  emit('notice', null)
  working.value = doc.value
  activeId.value = null
  const first = readingOrder(working.value.layout)[0]
  if (first) void nextTick(() => focusWidget(first.instanceId))
}

function stop() {
  deactivate()
  activeId.value = null
  mode.value = 'view'
}

function focusWidget(id: string) {
  gridEl.value?.querySelector<HTMLElement>(`[data-instance="${CSS.escape(id)}"]`)?.focus()
}

// Makes a widget active. Grabbing the widget that is already active keeps its visible pose.
function select(id: string) {
  if (activeId.value === id) return
  const placement = working.value.layout.find((item) => item.instanceId === id)
  if (!placement) return
  activeId.value = id
  activate(placement)
}

function grab(event: PointerEvent, id: string, how: 'move' | 'resize') {
  select(id)
  onPointerDown(event, how)
}

function removeWidget(id: string) {
  const next = focusAfterRemoval(working.value.layout, id)
  if (activeId.value === id) {
    deactivate()
    activeId.value = null
  }
  working.value = removeInstance(working.value, id)
  if (next) void nextTick(() => focusWidget(next))
}

function gearOf(id: string) {
  return gridEl.value?.querySelector<HTMLElement>(`[data-settings="${CSS.escape(id)}"]`) ?? null
}

function isSettingsOpenFor(id: string) {
  return settings.value?.isOpen() === true && settingsId.value === id
}

function pressGear(id: string) {
  openAtPress = isSettingsOpenFor(id)
}

// The same gear closes its panel; another gear moves the panel to its widget.
function toggleSettings(event: MouseEvent, id: string) {
  // detail 0: a keyboard click, no pointerdown before it.
  const wasOpen = event.detail > 0 && openAtPress !== null ? openAtPress : isSettingsOpenFor(id)
  openAtPress = null
  select(id)
  if (wasOpen) {
    settings.value?.close()
    return
  }
  settingsId.value = id
  // The panel anchors to the whole widget, not the gear: its own «⚙» and «×» stay reachable.
  const anchor = gearOf(id)?.closest('.board__item') ?? gearOf(id)
  if (anchor) settings.value?.open(anchor)
}

// The panel is placed once from its widget's rect; scrolling or resizing would leave it detached.
// A scroll inside the panel itself is not that.
function closeSettings(event?: Event) {
  if (event?.target instanceof Node && settings.value?.$el.contains(event.target)) return
  settings.value?.close()
}

function onSettingsToggle(open: boolean) {
  settingsOpen.value = open
  const byBoard = boardClosing
  boardClosing = false
  if (open || byBoard || !settingsId.value) return
  // Esc, light dismiss or the gear: focus goes back to the gear, unless the user already moved it
  // to another element (clicking another widget focuses that widget).
  const focus = document.activeElement
  if (!focus || focus === document.body || settings.value?.$el.contains(focus)) gearOf(settingsId.value)?.focus({ preventScroll: true })
}

function changeAppearance(next: WidgetAppearance | null) {
  if (editing.value && !saving.value && settingsId.value) working.value = setAppearance(working.value, settingsId.value, next)
}

function changeConfig(next: Record<string, unknown>) {
  if (editing.value && !saving.value && settingsId.value) working.value = setConfig(working.value, settingsId.value, next)
}

const settingsInstance = computed(() => working.value.instances.find((item) => item.id === settingsId.value))
const settingsSchema = computed(() => settingsInstance.value ? describeSource(settingsInstance.value.source)?.settings : undefined)
const settingsWidgetId = computed(() => doc.value.instances.find((item) => item.id === settingsInstance.value?.id)?.id ?? null)
const settingsSecrets = useSecretFlags(() => settingsSchema.value && settingsWidgetId.value ? settingsWidgetId.value : undefined)
const settingsVersion = computed(() => settingsInstance.value?.source.kind === 'package' ? settingsInstance.value.source.version : '')
const settingsVersions = computed(() => {
  const source = settingsInstance.value?.source
  return source?.kind === 'package' ? installedPackages.value.find((pkg) => pkg.id === source.packageId)?.versions.map((item) => item.version) ?? [] : []
})

async function changeVersion(version: string) {
  if (!editing.value || saving.value || !settingsId.value) return
  const id = settingsId.value
  const next = setPackageVersion(working.value, id, version, installedPackages.value)
  if (!next.ok) { emit('notice', next.error); return }
  const outcome = await saveAndStay(next.value)
  await apply(afterStaySave(outcome))
  if (outcome !== 'saved') return
  refreshSecretFlags(id, {})
  working.value = doc.value
  const rect = working.value.layout.find((item) => item.instanceId === id)
  if (activeId.value === id && rect) activate(rect)
  const flags = await api.widgetSecrets(id)
  if (flags.ok) refreshSecretFlags(id, flags.data)
}

// The panel closes with its widget, when the mode leaves edit and when a save starts.
watch(
  () => editing.value && !saving.value && settingsInstance.value !== undefined,
  (keep) => {
    if (keep || !settings.value?.isOpen()) return
    boardClosing = true
    settings.value.close()
  },
)

function confirmBuild() {
  const rect = activeRect.value
  if (!rect) return
  const id = crypto.randomUUID()
  void save(addInstance(doc.value, id, props.draftSource, rect, describeSource(props.draftSource)?.frame))
}

function confirmEdit() {
  if (isSameBoard(working.value, doc.value)) stop()
  else void save(working.value)
}

function confirm() {
  if (saving.value) return
  if (editing.value) confirmEdit()
  else confirmBuild()
}

function cancel() {
  if (saving.value) return
  const leavingEdit = editing.value
  stop()
  // A save from another tab may have moved the space on: reload after leaving, so a retry uses the fresh revision.
  if (leavingEdit) void load()
}

function onKeydown(event: KeyboardEvent) {
  // A held Esc: the first keydown closed the panel natively, its auto-repeats must not cancel the edit.
  if (event.key === 'Escape' && event.repeat) return
  // The open panel owns the keyboard: Esc closes only it (native), Backspace never deletes, Enter never confirms.
  if (settings.value?.isOpen()) return
  // The open screen-delete dialog owns it too: its Esc declines the delete and must not leave edit mode.
  if (pendingDelete.value) return
  if (saving.value || mode.value === 'view' || isFormControlTarget(event.target)) return
  const arrow = arrows[event.key]
  if (arrow) {
    if (!activeRect.value) return
    event.preventDefault()
    step(arrow[0], arrow[1], event.shiftKey)
  } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
    // A focused button handles Enter itself (Готово confirms, Отмена cancels, × deletes).
    event.preventDefault()
    confirm()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  } else if (
    editing.value &&
    activeId.value &&
    (event.key === 'Delete' || event.key === 'Backspace') &&
    event.target instanceof Node &&
    gridEl.value?.contains(event.target)
  ) {
    // Only from inside the board, so Backspace on a header button never deletes a widget.
    event.preventDefault()
    removeWidget(activeId.value)
  }
}

// Picks up saves from other tabs; the API is not polled (spec «UI flow»).
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && mode.value === 'view' && !saving.value) void load()
}

watch(mode, (next) => {
  if (next === 'build' && !activeRect.value) start()
  else if (next === 'edit') enterEdit()
})

onMounted(() => {
  void load()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', closeSettings)
  // Capturing: scroll events do not bubble, and both the board and the page can scroll.
  window.addEventListener('scroll', closeSettings, true)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', closeSettings)
  window.removeEventListener('scroll', closeSettings, true)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

const rows = computed(() => shown.value.rows)

function setRows(value: number) {
  if (editing.value && !saving.value) working.value = withRows(working.value, value)
}

defineExpose({
  confirm,
  cancel,
  saving,
  switching,
  loaded,
  rows,
  setRows,
  screens,
  revision,
  dirty,
  switchScreen,
  switchSpace,
  addScreen,
  saveIfDirty,
  removeScreen,
})
</script>

<template>
  <div class="board">
    <div
      ref="gridBox"
      class="board__grid"
      :class="{
        'board__grid--building': mode === 'build',
        'board__grid--enter-next': slide === 'enter-next',
        'board__grid--enter-prev': slide === 'enter-prev',
      }"
      :style="{ '--grid-rows': renderedRows }"
      :inert="saving"
    >
      <template v-if="mode !== 'view'">
        <span
          v-for="cell in cells"
          :key="`${cell.x}-${cell.y}`"
          class="board__dot"
          :class="{ 'board__dot--out': cell.y >= shown.rows }"
          :style="area(cell)"
        />
      </template>
      <div
        v-for="{ instance, placement, look } in placed"
        :key="instance.id"
        class="board__item"
        :class="{
          'board__item--editable': editing,
          'board__item--active': editing && instance.id === activeId,
          'board__item--moving': editing && moving && instance.id === activeId,
        }"
        :style="area(placement)"
        :data-instance="editing ? instance.id : undefined"
        :role="editing ? 'group' : undefined"
        :tabindex="editing ? 0 : undefined"
        :aria-label="editing ? rectLabel(placement) : undefined"
        @focusin="editing && select(instance.id)"
        @pointerdown="editing && grab($event, instance.id, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="board__card" :style="editing && instance.id === activeId ? cardStyle : fill">
          <WidgetHost
            class="board__content"
            :source="instance.source"
            :size="placement"
            :theme-id="look.themeId"
            :skin="look.skin"
            :foreign="look.foreign"
            :shadow="instance.appearance?.shadow"
            :widget-id="instance.id"
            :config="instance.config"
          />
          <span
            v-if="editing && sizingOf(instance)"
            class="board__resize"
            aria-hidden="true"
            @pointerdown.stop="grab($event, instance.id, 'resize')"
          />
        </div>
        <button
          v-if="editing"
          type="button"
          class="board__remove"
          :aria-label="`Удалить виджет ${placement.w}×${placement.h}`"
          @pointerdown.stop
          @click="removeWidget(instance.id)"
        >
          ×
        </button>
        <button
          v-if="editing"
          type="button"
          class="board__settings"
          :data-settings="instance.id"
          aria-label="Настройки виджета"
          :aria-expanded="settingsOpen && settingsId === instance.id"
          @pointerdown.stop="pressGear(instance.id)"
          @click="toggleSettings($event, instance.id)"
        >
          ⚙
        </button>
      </div>
      <div
        v-if="mode === 'build' && activeRect"
        ref="draftBox"
        class="board__item board__draft"
        :class="{ 'board__item--moving': moving }"
        role="group"
        tabindex="0"
        :aria-label="liveLabel"
        :style="area(activeRect)"
        @pointerdown="onPointerDown($event, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="board__card" :style="cardStyle">
          <WidgetHost :source="draftSource" :size="activeRect" :theme-id="themeId" />
          <span class="board__resize" aria-hidden="true" @pointerdown.stop="onPointerDown($event, 'resize')" />
        </div>
      </div>
    </div>
    <WidgetSettings
      ref="settingsPanel"
      :appearance="settingsInstance?.appearance"
      :schema="settingsSchema"
      :config="settingsInstance?.config ?? {}"
      :widget-id="settingsWidgetId"
      :secrets="settingsSecrets"
      :version="settingsVersion"
      :versions="settingsVersions"
      @change="changeAppearance"
      @config="changeConfig"
      @version="changeVersion"
      @toggle="onSettingsToggle"
    />
    <p class="board__live" aria-live="polite">{{ liveLabel }}</p>
  </div>
</template>

<style scoped>
/* The padding lives here, not on the grid, so pointer math starts at the first cell. The board is the
   size container: 24 square cells fill its content width, and it scrolls when the grid is taller. */
.board {
  box-sizing: border-box;
  container-type: inline-size;
  height: 100%;
  overflow-x: hidden; /* the screen slide starts beyond the padding */
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 1rem;
}

.board__grid {
  --ld-cell: calc((100cqw - 23 * 0.5rem) / 24);
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  grid-template-rows: repeat(var(--grid-rows), var(--ld-cell));
  gap: 0.5rem;
  transition:
    transform var(--ld-duration-slow) var(--ld-ease-standard),
    opacity var(--ld-duration-slow) var(--ld-ease-standard);
}

/* Screen switch: the grid starts beside its place and settles into it (see slideIn). */
.board__grid--enter-next,
.board__grid--enter-prev {
  transition: none;
  opacity: 0;
}

.board__grid--enter-next {
  transform: translateX(2.5rem);
}

.board__grid--enter-prev {
  transform: translateX(-2.5rem);
}

@media (prefers-reduced-motion: reduce) {
  .board__grid,
  .board__grid--enter-next,
  .board__grid--enter-prev {
    transition: none;
    transform: none;
    opacity: 1;
  }
}

.board__dot {
  place-self: center;
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 50%;
  background: var(--ld-success);
  pointer-events: none;
}

/* Rows below the configured rows: widgets there can only be brought out (spec «Grid rules»). */
.board__dot--out {
  background: var(--ld-danger);
}

.board__item {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.board__grid--building .board__item:not(.board__draft) {
  opacity: 0.4;
}

.board__draft,
.board__item--editable {
  cursor: grab;
  touch-action: none;
  outline-offset: 0.25rem;
}

.board__draft:active,
.board__item--editable:active {
  cursor: grabbing;
}

/* The moving card floats above its neighbours. */
.board__draft,
.board__item--active {
  z-index: 1;
}

.board__draft:focus-visible,
.board__item--editable:focus-visible,
.board__remove:focus-visible,
.board__settings:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
}

.board__remove:focus-visible,
.board__settings:focus-visible {
  outline-offset: 0.125rem;
}

/* Widget content (sandbox iframes included) stays inert while the board is built or edited, so a drag never reaches it. */
.board__grid--building .board__content,
.board__item--editable .board__content {
  pointer-events: none;
}

/* Landing slot shown while the card floats under the pointer. */
.board__item--moving::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 0.125rem dashed var(--ld-border-strong);
  border-radius: var(--ld-radius-widget);
}

/* Explicit px size (not the grid area) so resize can transition; the transform is driven by GSAP. */
.board__card {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  transition:
    width 0.15s ease-out,
    height 0.15s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .board__card {
    transition: none;
  }
}

.board__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1rem;
  height: 1rem;
  border-right: 0.1875rem solid var(--ld-text-primary);
  border-bottom: 0.1875rem solid var(--ld-text-primary);
  border-bottom-right-radius: var(--ld-radius-widget);
  cursor: nwse-resize;
}

.board__remove,
.board__settings {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: 50%;
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}

.board__settings {
  right: 2rem;
}

.board__item:hover .board__remove,
.board__item:focus-within .board__remove,
.board__item:hover .board__settings,
.board__item:focus-within .board__settings,
.board__settings[aria-expanded='true'] {
  opacity: 1;
}

.board__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
