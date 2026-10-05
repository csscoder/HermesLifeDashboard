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
import { GRID, findFreeRect, isFree, type Rect } from '../widgets/grid'
import WidgetHost from '../widgets/WidgetHost.vue'
import { isFormControlTarget } from './keyboard'
import { useActiveRect } from './use-active-rect'

const building = defineModel<boolean>('building', { required: true })
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

const doc = ref<BoardDocument>(emptyBoard())
// Template ref keys must differ from setup bindings: ref="draft" would overwrite the draft rect.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')
const {
  rect: draft,
  moving,
  cardStyle,
  activate,
  deactivate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  step,
} = useActiveRect({ gridEl, others: () => doc.value.layout, sizing: () => sizing })
// True after a failed save: the in-memory document is then newer than storage and must not be replaced.
let unsaved = false
let persistenceNotice: string | null = null
let placementNotice: string | null = null

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

function start() {
  placementNotice = null
  emitNotice()
  const others = doc.value.layout
  const rect = findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others)
  if (!rect) {
    placementNotice = 'Нет свободного места'
    emitNotice()
    building.value = false
    return
  }
  activate(rect)
  void nextTick(() => draftEl.value?.focus())
}

function stop() {
  deactivate()
  building.value = false
}

// Applies changes to the latest stored document so another tab's saved widgets are kept.
// Sequential changes only: simultaneous writes from two tabs are not atomic.
function refresh() {
  const result = loadBoard()
  if (!unsaved && !result.error) applyLoad(result)
}

function confirm() {
  const rect = draft.value
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

function remove(id: string) {
  refresh()
  doc.value = {
    schemaVersion: 1,
    instances: doc.value.instances.filter((item) => item.id !== id),
    layout: doc.value.layout.filter((item) => item.instanceId !== id),
  }
  persist()
}

function onKeydown(event: KeyboardEvent) {
  if (!draft.value || isFormControlTarget(event.target)) return
  const arrow = arrows[event.key]
  if (arrow) {
    event.preventDefault()
    step(arrow[0], arrow[1], event.shiftKey)
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
        <WidgetHost :source="instance.source" :size="placement" :theme-id="themeId" />
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
        :class="{ 'board__draft--moving': moving }"
        role="group"
        tabindex="0"
        :aria-label="draftLabel"
        :style="area(draft)"
        @pointerdown="onPointerDown($event, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="board__card" :style="cardStyle">
          <WidgetHost :source="draftSource" :size="draft" :theme-id="themeId" />
          <span class="board__resize" aria-hidden="true" @pointerdown.stop="onPointerDown($event, 'resize')" />
        </div>
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

.board__draft {
  z-index: 1;
  cursor: grab;
  touch-action: none;
  outline-offset: 0.25rem;
}

.board__draft:active {
  cursor: grabbing;
}

.board__draft:focus-visible,
.board__remove:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
}

.board__remove:focus-visible {
  outline-offset: 0.125rem;
}

/* Landing slot shown while the card floats under the pointer. */
.board__draft--moving::before {
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
