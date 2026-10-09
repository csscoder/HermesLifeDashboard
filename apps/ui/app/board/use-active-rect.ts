import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { GRID_COLS, moveTo, resizeTo, type Rect, type SizeLimits } from '@lifedashboard/contracts/grid'
import { useDraftMotion } from './draft-motion'

export interface ActiveRectOptions {
  gridEl: Readonly<Ref<HTMLElement | null>>
  others: () => readonly Rect[]
  // null disables resize: a widget type without a manifest keeps its size.
  sizing: () => SizeLimits | null
  // Configured rows of the shown screen: the limit of moves and resizes (grid.ts).
  rows: () => number
  // Rows the grid renders, for the vertical pitch.
  gridRows: () => number
}

type Drag = { mode: 'move'; pointerX: number; pointerY: number; cardX: number; cardY: number } | { mode: 'resize' }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * One active rectangle on the board grid: the builder draft or the widget being edited. The card
 * moves freely in px from its visible pose; `rect` is the snapped landing slot. Bounds, collisions,
 * the red zone and sizing limits stay in grid.ts.
 */
export function useActiveRect({ gridEl, others, sizing, rows, gridRows }: ActiveRectOptions) {
  const rect = ref<Rect | null>(null)
  const moving = ref(false)
  // Any pointer operation, move or resize: the board holds its rendered rows meanwhile.
  const dragging = ref(false)
  // Cell + gap pitch in px, read from the grid on activation, when a drag begins and on resize.
  const metrics = ref({ pitchX: 0, pitchY: 0, colGap: 0, rowGap: 0 })
  const motion = useDraftMotion({ x: 0, y: 0 })
  let drag: Drag | null = null

  const cardStyle = computed((): Record<string, string> => {
    const current = rect.value
    if (!current) return {}
    const { pitchX, pitchY, colGap, rowGap } = metrics.value
    const p = motion.pose.value
    // The card is positioned relative to its slot, so the offset is the pose minus the slot origin.
    return {
      width: `${current.w * pitchX - colGap}px`,
      height: `${current.h * pitchY - rowGap}px`,
      transform:
        `translate3d(${p.x - current.x * pitchX}px, ${p.y - current.y * pitchY}px, 0) rotate(${p.rotate}deg) ` +
        `skew(${p.skewX}deg, ${p.skewY}deg) scale(${p.scaleX}, ${p.scaleY})`,
    }
  })

  // The grid has no padding or border, so its box starts at the first cell.
  function readMetrics() {
    const el = gridEl.value
    if (!el) return null
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const colGap = parseFloat(style.columnGap)
    const rowGap = parseFloat(style.rowGap)
    const lines = gridRows()
    metrics.value = {
      pitchX: (box.width - colGap * (GRID_COLS - 1)) / GRID_COLS + colGap,
      pitchY: (box.height - rowGap * (lines - 1)) / lines + rowGap,
      colGap,
      rowGap,
    }
    return box
  }

  function slotPx(target: Rect) {
    return { x: target.x * metrics.value.pitchX, y: target.y * metrics.value.pitchY }
  }

  function settle() {
    if (rect.value) motion.moveTo(slotPx(rect.value), false)
  }

  function resized(current: Rect, w: number, h: number): Rect {
    const limits = sizing()
    return limits ? resizeTo(current, w, h, limits, others(), rows()) : current
  }

  // Window resizes and scale changes resize the grid: the card follows the new cell size. A drag in
  // progress keeps its pose; the next pointermove uses the new pitch.
  const observer = new ResizeObserver(() => {
    if (!readMetrics()) return
    if (rect.value && !drag) motion.reset(slotPx(rect.value))
  })
  watch(
    gridEl,
    (el, _previous, onCleanup) => {
      if (!el) return
      observer.observe(el)
      onCleanup(() => observer.unobserve(el))
    },
    { immediate: true },
  )
  onScopeDispose(() => observer.disconnect())

  /** Call only when the active widget changes: it places the card on the slot without animation. */
  function activate(next: Rect) {
    // A drag still held on the previous rect must not move the new one.
    drag = null
    moving.value = false
    dragging.value = false
    rect.value = { x: next.x, y: next.y, w: next.w, h: next.h }
    readMetrics()
    motion.reset(slotPx(next))
  }

  function deactivate() {
    rect.value = null
    drag = null
    moving.value = false
    dragging.value = false
  }

  function onPointerDown(event: PointerEvent, mode: 'move' | 'resize') {
    if (!rect.value || event.button !== 0 || !readMetrics()) return
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    dragging.value = true
    if (mode === 'resize') {
      drag = { mode }
      return
    }
    // Grabbing a settling card starts from its visible pose, so it does not jump.
    const { x, y } = motion.pose.value
    drag = { mode, pointerX: event.clientX, pointerY: event.clientY, cardX: x, cardY: y }
    moving.value = true
    motion.moveTo({ x, y }, true)
  }

  function onPointerMove(event: PointerEvent) {
    const current = rect.value
    if (!drag || !current) return
    const { pitchX, pitchY } = metrics.value
    if (drag.mode === 'resize') {
      const box = gridEl.value?.getBoundingClientRect()
      if (!box) return
      const cellX = Math.floor((event.clientX - box.left) / pitchX)
      const cellY = Math.floor((event.clientY - box.top) / pitchY)
      rect.value = resized(current, cellX - current.x + 1, cellY - current.y + 1)
      return
    }
    // The free card never floats below the limit of the red-zone rule (grid.ts).
    const limit = Math.max(rows(), current.y + current.h)
    const free = {
      x: clamp(drag.cardX + event.clientX - drag.pointerX, 0, (GRID_COLS - current.w) * pitchX),
      y: clamp(drag.cardY + event.clientY - drag.pointerY, 0, (limit - current.h) * pitchY),
    }
    motion.moveTo(free, true)
    // The slot snaps to the nearest cell; an occupied candidate keeps the last valid slot.
    rect.value = moveTo(current, Math.round(free.x / pitchX), Math.round(free.y / pitchY), others(), rows())
  }

  function onPointerUp() {
    if (drag?.mode === 'move') settle()
    drag = null
    moving.value = false
    dragging.value = false
  }

  function step(dx: number, dy: number, resize: boolean) {
    const current = rect.value
    if (!current) return
    if (resize) {
      rect.value = resized(current, current.w + dx, current.h + dy)
    } else {
      rect.value = moveTo(current, current.x + dx, current.y + dy, others(), rows())
      settle()
    }
  }

  return { rect, moving, dragging, cardStyle, activate, deactivate, onPointerDown, onPointerMove, onPointerUp, step }
}
