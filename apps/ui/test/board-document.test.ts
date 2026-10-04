import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOARD_STORAGE_KEY,
  emptyBoard,
  loadBoard,
  parseBoardDocument,
  saveBoard,
  type BoardDocument,
} from '../app/widgets/board-document'
import { findManifest } from '../app/widgets/catalog'

const valid: BoardDocument = {
  schemaVersion: 1,
  instances: [
    { id: 'a', source: { kind: 'builtin', type: 'placeholder' }, config: {} },
    { id: 'b', source: { kind: 'builtin', type: 'placeholder' }, config: {} },
  ],
  layout: [
    { instanceId: 'a', x: 0, y: 0, w: 4, h: 4 },
    { instanceId: 'b', x: 4, y: 0, w: 2, h: 2 },
  ],
}

// Tests mutate a deep copy freely; the parser receives it as unknown input.
function mutated(change: (doc: any) => void): unknown {
  const doc = structuredClone(valid)
  change(doc)
  return doc
}

describe('parseBoardDocument', () => {
  it('accepts a valid document', () => {
    expect(parseBoardDocument(structuredClone(valid))).toEqual({ ok: true, doc: valid })
  })

  it('accepts an unknown source.type', () => {
    const result = parseBoardDocument(mutated((d) => { d.instances[0].source.type = 'weather' }))
    expect(result.ok).toBe(true)
  })

  it('drops unknown fields', () => {
    const result = parseBoardDocument(mutated((d) => {
      d.extra = 1
      d.instances[0].extra = 1
      d.layout[0].extra = 1
    }))
    expect(result).toEqual({ ok: true, doc: valid })
  })

  it.each([
    ['null', null, /must be an object/],
    ['an array', [], /must be an object/],
    ['a wrong schemaVersion', mutated((d) => { d.schemaVersion = 2 }), /unsupported schemaVersion: 2/],
    ['non-array instances', mutated((d) => { d.instances = {} }), /must be arrays/],
    ['an empty id', mutated((d) => { d.instances[0].id = '' }), /id must be a non-empty string/],
    ['a duplicate id', mutated((d) => { d.instances[1].id = 'a' }), /duplicate id "a"/],
    ['a custom source', mutated((d) => { d.instances[0].source = { kind: 'custom' } }), /invalid source/],
    ['a missing config', mutated((d) => { delete d.instances[0].config }), /config must be an object/],
    ['a placement without an instance', mutated((d) => { d.layout[1].instanceId = 'zzz' }), /unknown instanceId "zzz"/],
    ['an instance without a placement', mutated((d) => { d.layout.pop() }), /instance "b" has no placement/],
    ['two placements of one instance', mutated((d) => { d.layout[1].instanceId = 'a' }), /placed twice/],
    ['an out-of-bounds placement', mutated((d) => { d.layout[1].x = 11 }), /inside the 12x8 grid/],
    ['a non-integer coordinate', mutated((d) => { d.layout[1].x = 1.5 }), /inside the 12x8 grid/],
    ['a string coordinate', mutated((d) => { d.layout[1].x = '4' }), /inside the 12x8 grid/],
    ['a zero width', mutated((d) => { d.layout[1].w = 0 }), /inside the 12x8 grid/],
    ['a zero height', mutated((d) => { d.layout[1].h = 0 }), /inside the 12x8 grid/],
    ['overlapping placements', mutated((d) => { d.layout[1] = { instanceId: 'b', x: 2, y: 2, w: 2, h: 2 } }), /overlaps/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseBoardDocument(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})

describe('loadBoard and saveBoard', () => {
  function memoryStorage(initial?: string) {
    const data = new Map<string, string>()
    if (initial !== undefined) data.set(BOARD_STORAGE_KEY, initial)
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an empty board when nothing is stored', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadBoard()).toEqual({ doc: emptyBoard() })
  })

  it('loads back exactly what was saved', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(saveBoard(valid)).toBe(true)
    expect(loadBoard()).toEqual({ doc: valid })
  })

  it('reports a storage error when getItem throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(loadBoard()).toMatchObject({ doc: emptyBoard(), error: { kind: 'storage' } })
  })

  it('reports a storage error when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadBoard()).toMatchObject({ doc: emptyBoard(), error: { kind: 'storage' } })
  })

  it('reports an invalid document for invalid JSON', () => {
    vi.stubGlobal('localStorage', memoryStorage('{'))
    expect(loadBoard()).toMatchObject({ doc: emptyBoard(), error: { kind: 'invalid-document' } })
  })

  it('reports an invalid document for JSON the parser rejects', () => {
    vi.stubGlobal('localStorage', memoryStorage('{"schemaVersion":2}'))
    expect(loadBoard()).toMatchObject({
      doc: emptyBoard(),
      error: { kind: 'invalid-document', message: expect.stringMatching(/unsupported schemaVersion/) },
    })
  })

  it('returns false when setItem throws', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(saveBoard(valid)).toBe(false)
  })
})

describe('catalog', () => {
  it('describes the placeholder and nothing else', () => {
    expect(findManifest('placeholder')?.sizing).toEqual({
      default: { w: 4, h: 4 },
      min: { w: 1, h: 1 },
      max: { w: 12, h: 8 },
    })
    expect(findManifest('toString')).toBeUndefined()
  })
})
