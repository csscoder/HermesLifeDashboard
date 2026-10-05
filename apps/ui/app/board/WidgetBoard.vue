<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import {
  BOARD_STORAGE_KEY,
  emptyBoard,
  loadBoard,
  saveBoard,
  type BoardDocument,
  type WidgetInstance,
  type WidgetSource,
} from '../widgets/board-document'
import { findManifest, placeholderManifest } from '../widgets/catalog'
import { GRID, findFreeRect, isFree, type Rect } from '@lifedashboard/contracts/grid'
import WidgetHost from '../widgets/WidgetHost.vue'
import {
  confirmOutcome,
  focusAfterRemoval,
  readingOrder,
  removeInstance,
  setPlacement,
  type BoardMode,
} from './edit-session'
import { isFormControlTarget } from './keyboard'
import { useActiveRect } from './use-active-rect'

const mode = defineModel<BoardMode>('mode', { required: true })
const emit = defineEmits<{ notice: [message: string | null] }>()
defineProps<{ themeId: string }>()

const draftSource: WidgetSource = { kind: 'builtin', type: placeholderManifest.type }
const sizing = placeholderManifest.sizing
const cells = Array.from({ length: GRID.cols * GRID.rows }, (_, index) => ({
  x: index % GRID.cols,
  y: Math.floor(index / GRID.cols),
  w: 1,
  h: 1,
}))
const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}
// A card that is not active fills its grid area.
const fill = { width: '100%', height: '100%' }

const doc = ref<BoardDocument>(emptyBoard())
// Edit mode changes a working copy. `doc` keeps the document loaded on entry (storage events are
// ignored meanwhile), so it is also the snapshot for the conflict check on «Готово».
const working = ref<BoardDocument>(emptyBoard())
const activeId = ref<string | null>(null)
// Template ref keys must differ from setup bindings: ref="draft" would overwrite a setup binding.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')
// True after a failed save: the in-memory document is then newer than storage and must not be replaced.
let unsaved = false
let persistenceNotice: string | null = null
let placementNotice: string | null = null

const editing = computed(() => mode.value === 'edit')
const hasWidgets = computed(() => doc.value.layout.length > 0)

const placed = computed(() => {
  const shown = editing.value ? working.value : doc.value
  return shown.layout.flatMap((placement) => {
    const instance = shown.instances.find((item) => item.id === placement.instanceId)
    return instance ? [{ instance, placement }] : []
  })
})

function sizingOf(instance: WidgetInstance) {
  return findManifest(instance.source.type)?.sizing ?? null
}

const activeSizing = computed(() => {
  const instance = working.value.instances.find((item) => item.id === activeId.value)
  return instance ? sizingOf(instance) : null
})

const {
  rect: activeRect,
  moving,
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
  sizing: () => (editing.value ? activeSizing.value : sizing),
})

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

function emitNotice() {
  emit('notice', [persistenceNotice, placementNotice].filter(Boolean).join(' · ') || null)
}

function applyLoad(result: ReturnType<typeof loadBoard>) {
  doc.value = result.doc
  persistenceNotice = result.error?.kind === 'storage' ? 'Хранилище недоступно' : null
  emitNotice()
  if (result.error?.kind === 'invalid-document') console.warn(`Board document ignored: ${result.error.message}`)
}

function persist() {
  unsaved = !saveBoard(doc.value)
  persistenceNotice = unsaved ? 'Не удалось сохранить доску' : null
  placementNotice = null
  emitNotice()
}

// Applies changes to the latest stored document so another tab's saved widgets are kept.
// Sequential changes only: simultaneous writes from two tabs are not atomic.
function refresh() {
  const result = loadBoard()
  if (!unsaved && !result.error) applyLoad(result)
}

function start() {
  placementNotice = null
  emitNotice()
  const others = doc.value.layout
  const rect = findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others)
  if (!rect) {
    placementNotice = 'Нет свободного места'
    emitNotice()
    mode.value = 'view'
    return
  }
  activate(rect)
  void nextTick(() => draftEl.value?.focus())
}

function enterEdit() {
  placementNotice = null
  emitNotice()
  refresh()
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

function confirmBuild() {
  const rect = activeRect.value
  if (!rect) return
  refresh()
  // Another tab may have taken the place since the draft was positioned.
  if (!isFree(rect, doc.value.layout)) {
    placementNotice = 'Место занято, переместите виджет'
    emitNotice()
    return
  }
  const id = crypto.randomUUID()
  doc.value = {
    schemaVersion: 1,
    instances: [...doc.value.instances, { id, source: { ...draftSource }, config: {} }],
    layout: [...doc.value.layout, { instanceId: id, ...rect }],
  }
  persist()
  stop()
}

function confirmEdit() {
  // After a failed save memory is newer than storage, so there is nothing to compare against.
  const stored = unsaved ? null : loadBoard()
  const outcome = confirmOutcome(working.value, doc.value, stored)
  if (outcome === 'unchanged') {
    refresh()
  } else if (outcome === 'conflict' && stored) {
    applyLoad(stored)
    placementNotice = 'Доска изменена в другой вкладке'
    emitNotice()
  } else {
    doc.value = working.value
    persist()
  }
  stop()
}

function confirm() {
  if (editing.value) confirmEdit()
  else confirmBuild()
}

function cancel() {
  // Picks up saves from other tabs whose storage events were ignored during the edit session.
  if (editing.value) refresh()
  stop()
}

function onKeydown(event: KeyboardEvent) {
  if (mode.value === 'view' || isFormControlTarget(event.target)) return
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

function onStorage(event: StorageEvent) {
  if (!editing.value && !unsaved && (event.key === BOARD_STORAGE_KEY || event.key === null)) applyLoad(loadBoard())
}

watch(mode, (next) => {
  if (next === 'build' && !activeRect.value) start()
  else if (next === 'edit') enterEdit()
})

onMounted(() => {
  applyLoad(loadBoard())
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('storage', onStorage)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('storage', onStorage)
})

// Replaced by room-sync in the next task of the plan (board on the API).
const saving = ref(false)
const loaded = ref(true)

defineExpose({ confirm, cancel, hasWidgets, saving, loaded })
</script>

<template>
  <div class="board">
    <div ref="gridBox" class="board__grid" :class="{ 'board__grid--building': mode === 'build' }">
      <template v-if="mode !== 'view'">
        <span v-for="cell in cells" :key="`${cell.x}-${cell.y}`" class="board__dot" :style="area(cell)" />
      </template>
      <div
        v-for="{ instance, placement } in placed"
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
          <WidgetHost class="board__content" :source="instance.source" :size="placement" :theme-id="themeId" />
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
    <p class="board__live" aria-live="polite">{{ liveLabel }}</p>
  </div>
</template>

<style scoped>
/* The padding lives here, not on the grid, so pointer math starts at the first cell. */
.board {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  height: 100%;
  padding: 1rem;
}

.board__grid {
  display: grid;
  grid-template: repeat(8, 4rem) / repeat(12, 4rem);
  gap: 0.75rem;
}

.board__dot {
  place-self: center;
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 50%;
  background: var(--ld-border-strong);
  pointer-events: none;
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
.board__remove:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
}

.board__remove:focus-visible {
  outline-offset: 0.125rem;
}

/* Widget content stays inert while widgets are edited, so a drag never reaches it. */
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

.board__remove {
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

.board__item:hover .board__remove,
.board__item:focus-within .board__remove {
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
