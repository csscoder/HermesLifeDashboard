export const GRID_COLS = 24
/** Rows a screen may configure; `max` is also the hard bound of every placement. */
export const ROWS = { min: 4, max: 100, default: 12 } as const

export interface Size {
  w: number
  h: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export interface SizeLimits {
  min: Size
  max: Size
}

/** A widget type's size contract in cells (base design §7.4). */
export interface WidgetSizing extends SizeLimits {
  default: Size
}

/** The hard bound: 24 columns × ROWS.max rows. The configured rows are checked by the rules below. */
export function inBounds(rect: Rect): boolean {
  return (
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= GRID_COLS &&
    rect.y + rect.h <= ROWS.max
  )
}

/** Bottom edge of the lowest placement, 0 for an empty layout. */
export function occupiedRows(layout: readonly Rect[]): number {
  return layout.reduce((rows, rect) => Math.max(rows, rect.y + rect.h), 0)
}

/** Rows the board renders: the configured rows, or more when a widget lies below them. */
export function gridRows(rows: number, layout: readonly Rect[]): number {
  return Math.max(rows, occupiedRows(layout))
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Inside the hard bound, not ending below `limit` rows, and clear of `others`. */
export function isFree(rect: Rect, others: readonly Rect[], limit: number): boolean {
  return inBounds(rect) && rect.y + rect.h <= limit && others.every((other) => !overlaps(rect, other))
}

// A step may not end below the configured rows or, for a widget in the red zone, below its own
// bottom edge: such a widget can only be brought out of the red zone (spec «Grid rules»).
function limitFor(rect: Rect, rows: number): number {
  return Math.max(rows, rect.y + rect.h)
}

export function findFreeRect(size: Size, others: readonly Rect[], rows: number): Rect | null {
  for (let y = 0; y + size.h <= rows; y++) {
    for (let x = 0; x + size.w <= GRID_COLS; x++) {
      const candidate = { x, y, w: size.w, h: size.h }
      if (isFree(candidate, others, rows)) return candidate
    }
  }
  return null
}

export function moveTo(rect: Rect, x: number, y: number, others: readonly Rect[], rows: number): Rect {
  const next = { ...rect, x, y }
  return isFree(next, others, limitFor(rect, rows)) ? next : rect
}

export function resizeTo(
  rect: Rect,
  w: number,
  h: number,
  limits: SizeLimits,
  others: readonly Rect[],
  rows: number,
): Rect {
  if (w < limits.min.w || w > limits.max.w || h < limits.min.h || h > limits.max.h) return rect
  const next = { ...rect, w, h }
  return isFree(next, others, limitFor(rect, rows)) ? next : rect
}
