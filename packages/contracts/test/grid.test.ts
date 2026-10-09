import { describe, expect, it } from 'vitest'
import {
  findFreeRect,
  GRID_COLS,
  gridRows,
  isFree,
  moveTo,
  occupiedRows,
  resizeTo,
  ROWS,
  type Rect,
} from '../src/grid.ts'

const limits = { min: { w: 1, h: 1 }, max: { w: GRID_COLS, h: ROWS.max } }
const block: Rect = { x: 4, y: 0, w: 4, h: 4 }

describe('grid constants', () => {
  it('has 24 columns and 4..100 rows, 12 by default', () => {
    expect(GRID_COLS).toBe(24)
    expect(ROWS).toEqual({ min: 4, max: 100, default: 12 })
  })
})

describe('occupiedRows and gridRows', () => {
  it('uses the configured rows for an empty layout', () => {
    expect(occupiedRows([])).toBe(0)
    expect(gridRows(10, [])).toBe(10)
  })

  it('extends the grid down to the lowest widget below the configured rows', () => {
    const layout: Rect[] = [block, { x: 20, y: 26, w: 4, h: 4 }]
    expect(occupiedRows(layout)).toBe(30)
    expect(gridRows(10, layout)).toBe(30)
    expect(gridRows(40, layout)).toBe(40)
  })
})

describe('isFree', () => {
  it('accepts a rect inside the limit', () => {
    expect(isFree({ x: 0, y: 0, w: 24, h: 8 }, [], 8)).toBe(true)
  })

  it('rejects a rect leaving the columns, the limit or the hard bound', () => {
    expect(isFree({ x: 21, y: 0, w: 4, h: 1 }, [], 8)).toBe(false)
    expect(isFree({ x: 0, y: 5, w: 1, h: 4 }, [], 8)).toBe(false)
    expect(isFree({ x: 0, y: 97, w: 1, h: 4 }, [], 200)).toBe(false)
    expect(isFree({ x: -1, y: 0, w: 1, h: 1 }, [], 8)).toBe(false)
    expect(isFree({ x: 0, y: 0, w: 0, h: 1 }, [], 8)).toBe(false)
  })

  it('rejects an overlap and accepts touching edges', () => {
    expect(isFree({ x: 6, y: 2, w: 4, h: 4 }, [block], 8)).toBe(false)
    expect(isFree({ x: 0, y: 0, w: 4, h: 4 }, [block], 8)).toBe(true)
    expect(isFree({ x: 4, y: 4, w: 4, h: 4 }, [block], 8)).toBe(true)
  })
})

describe('findFreeRect', () => {
  it('returns the top-left corner on an empty grid', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [], 8)).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })

  it('scans rows top-down, columns left-right, skipping occupied cells', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 22, h: 4 }], 8)).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('never places into the red zone, even when rows below are empty', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 24, h: 5 }], 8)).toBeNull()
    expect(findFreeRect({ w: 1, h: 1 }, [{ x: 0, y: 0, w: 24, h: 8 }], 8)).toBeNull()
  })

  it('returns null for a size taller than the configured rows', () => {
    expect(findFreeRect({ w: 2, h: 14 }, [], 12)).toBeNull()
  })

  it('finds the last free 1x1 cell', () => {
    const others: Rect[] = [
      { x: 0, y: 0, w: 24, h: 7 },
      { x: 0, y: 7, w: 23, h: 1 },
    ]
    expect(findFreeRect({ w: 1, h: 1 }, others, 8)).toEqual({ x: 23, y: 7, w: 1, h: 1 })
  })
})

describe('moveTo in the green zone', () => {
  const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }

  it('moves to a free target', () => {
    expect(moveTo(rect, 0, 4, [block], 8)).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('stops at the configured rows', () => {
    expect(moveTo(rect, 0, 5, [], 8)).toBe(rect)
  })

  it('returns the unchanged rect outside the columns or on an occupied target', () => {
    expect(moveTo(rect, 21, 0, [], 8)).toBe(rect)
    expect(moveTo(rect, -1, 0, [], 8)).toBe(rect)
    expect(moveTo(rect, 1, 0, [block], 8)).toBe(rect)
  })
})

describe('resizeTo in the green zone', () => {
  it('grows into free cells', () => {
    expect(resizeTo({ x: 0, y: 0, w: 2, h: 2 }, 3, 3, limits, [], 8)).toEqual({ x: 0, y: 0, w: 3, h: 3 })
  })

  it('respects min and max', () => {
    const rect: Rect = { x: 0, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 0, 2, limits, [], 8)).toBe(rect)
    expect(resizeTo(rect, 3, 2, { min: { w: 1, h: 1 }, max: { w: 2, h: 2 } }, [], 8)).toBe(rect)
  })

  it('stays inside the columns and the configured rows', () => {
    const right: Rect = { x: 22, y: 0, w: 2, h: 2 }
    expect(resizeTo(right, 3, 2, limits, [], 8)).toBe(right)
    const rect: Rect = { x: 0, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 2, 9, limits, [], 8)).toBe(rect)
  })

  it('does not enter occupied cells', () => {
    const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }
    expect(resizeTo(rect, 5, 4, limits, [block], 8)).toBe(rect)
  })
})

describe('the red zone (rows = 10, a widget on rows 26..29)', () => {
  const red: Rect = { x: 20, y: 26, w: 4, h: 4 }

  it('moves up and sideways', () => {
    expect(moveTo(red, 20, 20, [], 10)).toEqual({ x: 20, y: 20, w: 4, h: 4 })
    expect(moveTo(red, 10, 26, [], 10)).toEqual({ x: 10, y: 26, w: 4, h: 4 })
  })

  it('never moves down', () => {
    expect(moveTo(red, 20, 27, [], 10)).toBe(red)
  })

  it('moves the limit up with the widget, down to the configured rows', () => {
    const raised = moveTo(red, 20, 20, [], 10)
    expect(moveTo(raised, 20, 22, [], 10)).toBe(raised)
    const green = moveTo(raised, 20, 0, [], 10)
    expect(moveTo(green, 20, 7, [], 10)).toBe(green)
    expect(moveTo(green, 20, 6, [], 10)).toEqual({ x: 20, y: 6, w: 4, h: 4 })
  })

  it('shrinks and widens but never grows down', () => {
    const wide: Rect = { x: 0, y: 26, w: 4, h: 4 }
    expect(resizeTo(wide, 3, 3, limits, [], 10)).toEqual({ x: 0, y: 26, w: 3, h: 3 })
    expect(resizeTo(wide, 5, 4, limits, [], 10)).toEqual({ x: 0, y: 26, w: 5, h: 4 })
    expect(resizeTo(wide, 4, 5, limits, [], 10)).toBe(wide)
  })

  it('is still blocked by other widgets', () => {
    expect(moveTo(red, 20, 0, [{ x: 18, y: 0, w: 4, h: 4 }], 10)).toBe(red)
  })
})
