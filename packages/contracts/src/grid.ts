export const GRID = { cols: 12, rows: 8 } as const

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

export function inBounds(rect: Rect): boolean {
  return (
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= GRID.cols &&
    rect.y + rect.h <= GRID.rows
  )
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function isFree(rect: Rect, others: readonly Rect[]): boolean {
  return inBounds(rect) && others.every((other) => !overlaps(rect, other))
}

export function findFreeRect(size: Size, others: readonly Rect[]): Rect | null {
  for (let y = 0; y + size.h <= GRID.rows; y++) {
    for (let x = 0; x + size.w <= GRID.cols; x++) {
      const candidate = { x, y, w: size.w, h: size.h }
      if (isFree(candidate, others)) return candidate
    }
  }
  return null
}

export function moveTo(rect: Rect, x: number, y: number, others: readonly Rect[]): Rect {
  const next = { ...rect, x, y }
  return isFree(next, others) ? next : rect
}

export function resizeTo(rect: Rect, w: number, h: number, limits: SizeLimits, others: readonly Rect[]): Rect {
  if (w < limits.min.w || w > limits.max.w || h < limits.min.h || h > limits.max.h) return rect
  const next = { ...rect, w, h }
  return isFree(next, others) ? next : rect
}
