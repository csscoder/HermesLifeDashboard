import { describe, expect, it } from 'vitest'
import {
  confirmOutcome,
  focusAfterRemoval,
  isSameBoard,
  readingOrder,
  removeInstance,
  setPlacement,
} from '../app/board/edit-session'
import { emptyBoard, parseBoardDocument, type BoardDocument } from '../app/widgets/board-document'

const placeholder = { kind: 'builtin', type: 'placeholder' } as const

// Layout order differs from reading order on purpose: b (0,0), a (4,0), c (0,3).
const board: BoardDocument = {
  schemaVersion: 1,
  instances: [
    { id: 'a', source: { ...placeholder }, config: {} },
    { id: 'b', source: { ...placeholder }, config: {} },
    { id: 'c', source: { ...placeholder }, config: {} },
  ],
  layout: [
    { instanceId: 'a', x: 4, y: 0, w: 2, h: 2 },
    { instanceId: 'b', x: 0, y: 0, w: 2, h: 2 },
    { instanceId: 'c', x: 0, y: 3, w: 1, h: 1 },
  ],
}

describe('setPlacement', () => {
  it('changes only the target placement and does not mutate its input', () => {
    const before = structuredClone(board)
    const next = setPlacement(board, 'a', { x: 6, y: 1, w: 3, h: 2 })
    expect(next.layout).toEqual([{ instanceId: 'a', x: 6, y: 1, w: 3, h: 2 }, board.layout[1], board.layout[2]])
    expect(next.instances).toBe(board.instances)
    expect(board).toEqual(before)
  })

  it('copies only the rect fields of the given rect', () => {
    const next = setPlacement(board, 'a', { ...board.layout[1]!, x: 6 })
    expect(next.layout[0]).toEqual({ instanceId: 'a', x: 6, y: 0, w: 2, h: 2 })
  })
})

describe('removeInstance', () => {
  it('removes the instance with its placement and keeps the document valid', () => {
    const before = structuredClone(board)
    const next = removeInstance(board, 'b')
    expect(next.instances.map((item) => item.id)).toEqual(['a', 'c'])
    expect(next.layout.map((item) => item.instanceId)).toEqual(['a', 'c'])
    expect(parseBoardDocument(next)).toEqual({ ok: true, doc: next })
    expect(board).toEqual(before)
  })

  it('returns an equal document for an unknown id', () => {
    expect(removeInstance(board, 'zzz')).toEqual(board)
  })
})

describe('isSameBoard', () => {
  it('is true for equal documents', () => {
    expect(isSameBoard(board, structuredClone(board))).toBe(true)
  })

  it('is false when the layout differs', () => {
    expect(isSameBoard(board, setPlacement(board, 'c', { x: 1, y: 3, w: 1, h: 1 }))).toBe(false)
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
    expect(readingOrder(board.layout).map((item) => item.instanceId)).toEqual(['b', 'a', 'c'])
    expect(board.layout).toEqual(before)
  })
})

describe('focusAfterRemoval', () => {
  it('picks the next widget in reading order', () => {
    expect(focusAfterRemoval(board.layout, 'b')).toBe('a')
  })

  it('picks the previous widget when the last one is removed', () => {
    expect(focusAfterRemoval(board.layout, 'c')).toBe('a')
  })

  it('returns null for the only widget and for an unknown id', () => {
    expect(focusAfterRemoval([board.layout[0]!], 'a')).toBeNull()
    expect(focusAfterRemoval(board.layout, 'zzz')).toBeNull()
  })
})

describe('confirmOutcome', () => {
  const moved = setPlacement(board, 'c', { x: 1, y: 3, w: 1, h: 1 })
  const otherTab = removeInstance(board, 'a')

  it('is unchanged when the working copy equals the session start, whatever storage holds', () => {
    expect(confirmOutcome(structuredClone(board), board, { doc: otherTab })).toBe('unchanged')
  })

  it('saves when storage still holds the session start', () => {
    expect(confirmOutcome(moved, board, { doc: structuredClone(board) })).toBe('save')
  })

  it('reports a conflict when another tab saved since the session started', () => {
    expect(confirmOutcome(moved, board, { doc: otherTab })).toBe('conflict')
  })

  it('a failed storage read never blocks the save', () => {
    const failed = { doc: emptyBoard(), error: { kind: 'storage', message: 'denied' } } as const
    const corrupt = { doc: emptyBoard(), error: { kind: 'invalid-document', message: 'bad json' } } as const
    expect(confirmOutcome(moved, board, failed)).toBe('save')
    expect(confirmOutcome(moved, board, corrupt)).toBe('save')
  })

  it('saves without a check when memory is newer than storage (stored is null)', () => {
    expect(confirmOutcome(moved, board, null)).toBe('save')
  })
})
