import { parseScreenBoard, type ScreenBoard } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setPlacement } from '../app/board/edit-session'

const placeholder = { kind: 'builtin', type: 'placeholder' } as const
const SCREEN = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

// Layout order differs from reading order on purpose: B (0,0), A (4,0), C (0,3).
const board: ScreenBoard = {
  id: SCREEN,
  rows: 12,
  instances: [
    { id: A, source: { ...placeholder }, configVersion: 1, config: {} },
    { id: B, source: { ...placeholder }, configVersion: 1, config: {} },
    { id: C, source: { ...placeholder }, configVersion: 1, config: {} },
  ],
  layout: [
    { instanceId: A, x: 4, y: 0, w: 2, h: 2 },
    { instanceId: B, x: 0, y: 0, w: 2, h: 2 },
    { instanceId: C, x: 0, y: 3, w: 1, h: 1 },
  ],
}

describe('setPlacement', () => {
  it('changes only the target placement and does not mutate its input', () => {
    const before = structuredClone(board)
    const next = setPlacement(board, A, { x: 6, y: 1, w: 3, h: 2 })
    expect(next.layout).toEqual([{ instanceId: A, x: 6, y: 1, w: 3, h: 2 }, board.layout[1], board.layout[2]])
    expect(next.instances).toBe(board.instances)
    expect(next.id).toBe(SCREEN)
    expect(board).toEqual(before)
  })

  it('copies only the rect fields of the given rect', () => {
    const next = setPlacement(board, A, { ...board.layout[1]!, x: 6 })
    expect(next.layout[0]).toEqual({ instanceId: A, x: 6, y: 0, w: 2, h: 2 })
  })
})

describe('removeInstance', () => {
  it('removes the instance with its placement and keeps the screen valid', () => {
    const before = structuredClone(board)
    const next = removeInstance(board, B)
    expect(next.instances.map((item) => item.id)).toEqual([A, C])
    expect(next.layout.map((item) => item.instanceId)).toEqual([A, C])
    expect(parseScreenBoard(next)).toEqual({ ok: true, value: next })
    expect(board).toEqual(before)
  })

  it('returns an equal screen for an unknown id', () => {
    expect(removeInstance(board, 'zzz')).toEqual(board)
  })
})

describe('isSameBoard', () => {
  it('is true for equal screens', () => {
    expect(isSameBoard(board, structuredClone(board))).toBe(true)
  })

  it('is false when the layout differs', () => {
    expect(isSameBoard(board, setPlacement(board, C, { x: 1, y: 3, w: 1, h: 1 }))).toBe(false)
  })

  it('is false when the instances differ', () => {
    const changed = structuredClone(board)
    changed.instances[0]!.config = { title: 'x' }
    expect(isSameBoard(board, changed)).toBe(false)
  })
})

describe('readingOrder', () => {
  it('sorts placements by row, then column, without mutating the input', () => {
    const before = structuredClone(board.layout)
    expect(readingOrder(board.layout).map((item) => item.instanceId)).toEqual([B, A, C])
    expect(board.layout).toEqual(before)
  })
})

describe('focusAfterRemoval', () => {
  it('picks the next widget in reading order', () => {
    expect(focusAfterRemoval(board.layout, B)).toBe(A)
  })

  it('picks the previous widget when the last one is removed', () => {
    expect(focusAfterRemoval(board.layout, C)).toBe(A)
  })

  it('returns null for the only widget and for an unknown id', () => {
    expect(focusAfterRemoval([board.layout[0]!], A)).toBeNull()
    expect(focusAfterRemoval(board.layout, 'zzz')).toBeNull()
  })
})
