<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import {
  BOARD_STORAGE_KEY,
  emptyBoard,
  loadBoard,
  saveBoard,
  type BoardDocument,
  type WidgetSource,
} from '../widgets/board-document'
import { placeholderManifest } from '../widgets/catalog'
import { GRID, findFreeRect, isFree, moveTo, resizeTo, type Rect } from '../widgets/grid'
import WidgetHost from '../widgets/WidgetHost.vue'

const building = defineModel<boolean>('building', { required: true })
const emit = defineEmits<{ notice: [message: string | null] }>()

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

const doc = ref<BoardDocument>(emptyBoard())
const draft = ref<Rect | null>(null)
// Template ref keys must differ from setup bindings: ref="draft" would overwrite the draft rect.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')
let drag: { mode: 'move' | 'resize'; grabX: number; grabY: number } | null = null
// True after a failed save: the in-memory document is then newer than storage and must not be replaced.
let unsaved = false

const placed = computed(() =>
  doc.value.layout.flatMap((placement) => {
    const instance = doc.value.instances.find((item) => item.id === placement.instanceId)
    return instance ? [{ instance, placement }] : []
  }),
)

const draftLabel = computed(() => {
  const rect = draft.value
  return rect ? `Виджет ${rect.w}×${rect.h}, колонка ${rect.x + 1}, ряд ${rect.y + 1}` : ''
})

function area(rect: Rect) {
  return { gridColumn: `${rect.x + 1} / span ${rect.w}`, gridRow: `${rect.y + 1} / span ${rect.h}` }
}

function applyLoad(result: ReturnType<typeof loadBoard>) {
  doc.value = result.doc
  if (result.error?.kind === 'storage') emit('notice', 'Хранилище недоступно')
  else if (result.error) console.warn(`Board document ignored: ${result.error.message}`)
}

function persist() {
  unsaved = !saveBoard(doc.value)
  emit('notice', unsaved ? 'Не удалось сохранить доску' : null)
}

function start() {
  emit('notice', null)
  const others = doc.value.layout
  const rect = findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others)
  if (!rect) {
    emit('notice', 'Нет свободного места')
    building.value = false
    return
  }
  draft.value = rect
  void nextTick(() => draftEl.value?.focus())
}

function stop() {
  draft.value = null
  drag = null
  building.value = false
}

// Applies changes to the latest stored document so another tab's saved widgets are kept.
// Sequential changes only: simultaneous writes from two tabs are not atomic.
function refresh() {
  const result = loadBoard()
  if (!unsaved && !result.error) doc.value = result.doc
}

function confirm() {
  const rect = draft.value
  if (!rect) return
  refresh()
  // Another tab may have taken the place since the draft was positioned.
  if (!isFree(rect, doc.value.layout)) {
    emit('notice', 'Место занято, переместите виджет')
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

function remove(id: string) {
  refresh()
  doc.value = {
    schemaVersion: 1,
    instances: doc.value.instances.filter((item) => item.id !== id),
    layout: doc.value.layout.filter((item) => item.instanceId !== id),
  }
  persist()
}

// Cell under the pointer; the grid has no padding or border, so its box starts at the first cell.
function pointerCell(event: PointerEvent) {
  const el = gridEl.value
  if (!el) return null
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const colGap = parseFloat(style.columnGap)
  const rowGap = parseFloat(style.rowGap)
  const cellW = (box.width - colGap * (GRID.cols - 1)) / GRID.cols
  const cellH = (box.height - rowGap * (GRID.rows - 1)) / GRID.rows
  return {
    x: Math.floor((event.clientX - box.left) / (cellW + colGap)),
    y: Math.floor((event.clientY - box.top) / (cellH + rowGap)),
  }
}

function onPointerDown(event: PointerEvent, mode: 'move' | 'resize') {
  const rect = draft.value
  const cell = pointerCell(event)
  if (!rect || !cell || event.button !== 0) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { mode, grabX: cell.x - rect.x, grabY: cell.y - rect.y }
}

function onPointerMove(event: PointerEvent) {
  const rect = draft.value
  const cell = pointerCell(event)
  if (!drag || !rect || !cell) return
  draft.value =
    drag.mode === 'move'
      ? moveTo(rect, cell.x - drag.grabX, cell.y - drag.grabY, doc.value.layout)
      : resizeTo(rect, cell.x - rect.x + 1, cell.y - rect.y + 1, sizing, doc.value.layout)
}

function onPointerUp() {
  drag = null
}

function onKeydown(event: KeyboardEvent) {
  const rect = draft.value
  if (!rect) return
  const step = arrows[event.key]
  if (step) {
    event.preventDefault()
    const [dx, dy] = step
    draft.value = event.shiftKey
      ? resizeTo(rect, rect.w + dx, rect.h + dy, sizing, doc.value.layout)
      : moveTo(rect, rect.x + dx, rect.y + dy, doc.value.layout)
  } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
    // A focused header button handles Enter itself (Готово confirms, Отмена cancels).
    event.preventDefault()
    confirm()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    stop()
  }
}

function onStorage(event: StorageEvent) {
  if (!unsaved && (event.key === BOARD_STORAGE_KEY || event.key === null)) applyLoad(loadBoard())
}

watch(building, (on) => {
  if (on && !draft.value) start()
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

defineExpose({ confirm, cancel: stop })
</script>

<template>
  <div class="board">
    <div ref="gridBox" class="board__grid" :class="{ 'board__grid--building': draft }">
      <template v-if="draft">
        <span v-for="cell in cells" :key="`${cell.x}-${cell.y}`" class="board__dot" :style="area(cell)" />
      </template>
      <div v-for="{ instance, placement } in placed" :key="instance.id" class="board__item" :style="area(placement)">
        <WidgetHost :source="instance.source" :size="placement" />
        <button
          v-if="!draft"
          type="button"
          class="board__remove"
          :aria-label="`Удалить виджет ${placement.w}×${placement.h}`"
          @click="remove(instance.id)"
        >
          ×
        </button>
      </div>
      <div
        v-if="draft"
        ref="draftBox"
        class="board__item board__draft"
        role="group"
        tabindex="0"
        :aria-label="draftLabel"
        :style="area(draft)"
        @pointerdown="onPointerDown($event, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <WidgetHost :source="draftSource" :size="draft" />
        <span class="board__resize" aria-hidden="true" @pointerdown.stop="onPointerDown($event, 'resize')" />
      </div>
    </div>
    <p class="board__live" aria-live="polite">{{ draftLabel }}</p>
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
  background: rgb(255 255 255 / 0.35);
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

.board__draft {
  z-index: 1;
  cursor: grab;
  touch-action: none;
  outline-offset: 0.25rem;
}

.board__draft:active {
  cursor: grabbing;
}

.board__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1rem;
  height: 1rem;
  border-right: 0.1875rem solid #fff;
  border-bottom: 0.1875rem solid #fff;
  border-bottom-right-radius: 1rem;
  cursor: nwse-resize;
}

.board__remove {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  border: none;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  font: inherit;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}

.board__item:hover .board__remove,
.board__remove:focus-visible {
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
