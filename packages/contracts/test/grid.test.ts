import { describe, expect, it } from 'vitest'
import {
  findFreeRect,
  isFree,
  moveTo,
  resizeTo,
  type Rect,
} from '../src/grid.ts'

const limits = { min: { w: 1, h: 1 }, max: { w: 12, h: 8 } }
const block: Rect = { x: 4, y: 0, w: 4, h: 4 }

describe('isFree', () => {
  it('accepts a rect inside an empty grid', () => {
    expect(isFree({ x: 0, y: 0, w: 12, h: 8 }, [])).toBe(true)
  })

  it('rejects a rect leaving the grid', () => {
    expect(isFree({ x: 9, y: 0, w: 4, h: 1 }, [])).toBe(false)
    expect(isFree({ x: 0, y: 5, w: 1, h: 4 }, [])).toBe(false)
    expect(isFree({ x: -1, y: 0, w: 1, h: 1 }, [])).toBe(false)
    expect(isFree({ x: 0, y: 0, w: 0, h: 1 }, [])).toBe(false)
  })

  it('rejects an overlap', () => {
    expect(isFree({ x: 6, y: 2, w: 4, h: 4 }, [block])).toBe(false)
  })

  it('accepts a rect touching an edge of another', () => {
    expect(isFree({ x: 0, y: 0, w: 4, h: 4 }, [block])).toBe(true)
    expect(isFree({ x: 4, y: 4, w: 4, h: 4 }, [block])).toBe(true)
  })
})

describe('findFreeRect', () => {
  it('returns the top-left corner on an empty grid', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [])).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })

  it('scans rows top-down, columns left-right, skipping occupied cells', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 10, h: 4 }])).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('returns null when the size does not fit', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 12, h: 5 }])).toBeNull()
  })

  it('finds the last free 1x1 cell', () => {
    const others: Rect[] = [
      { x: 0, y: 0, w: 12, h: 7 },
      { x: 0, y: 7, w: 11, h: 1 },
    ]
    expect(findFreeRect({ w: 1, h: 1 }, others)).toEqual({ x: 11, y: 7, w: 1, h: 1 })
  })
})

describe('moveTo', () => {
  const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }

  it('moves to a free target', () => {
    expect(moveTo(rect, 0, 4, [block])).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('returns the unchanged rect for an out-of-bounds target', () => {
    expect(moveTo(rect, 9, 0, [])).toBe(rect)
    expect(moveTo(rect, -1, 0, [])).toBe(rect)
  })

  it('returns the unchanged rect for an occupied target', () => {
    expect(moveTo(rect, 1, 0, [block])).toBe(rect)
  })
})

describe('resizeTo', () => {
  it('grows into free cells', () => {
    expect(resizeTo({ x: 0, y: 0, w: 2, h: 2 }, 3, 3, limits, [])).toEqual({ x: 0, y: 0, w: 3, h: 3 })
  })

  it('respects min and max', () => {
    const rect: Rect = { x: 0, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 0, 2, limits, [])).toBe(rect)
    expect(resizeTo(rect, 3, 2, { min: { w: 1, h: 1 }, max: { w: 2, h: 2 } }, [])).toBe(rect)
  })

  it('does not leave the grid', () => {
    const rect: Rect = { x: 10, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 3, 2, limits, [])).toBe(rect)
  })

  it('does not enter occupied cells', () => {
    const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }
    expect(resizeTo(rect, 5, 4, limits, [block])).toBe(rect)
  })
})
