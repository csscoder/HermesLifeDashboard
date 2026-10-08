import { describe, expect, it } from 'vitest'
import { isUuid, parseScreenBoard, type ScreenBoard } from '../src/board.ts'

const SCREEN = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const placeholder = { kind: 'builtin', type: 'placeholder' } as const

const valid: ScreenBoard = {
  id: SCREEN,
  instances: [
    { id: A, source: { ...placeholder }, configVersion: 1, config: {} },
    { id: B, source: { ...placeholder }, configVersion: 1, config: { title: 'x', nested: { n: 1 } } },
  ],
  layout: [
    { instanceId: A, x: 0, y: 0, w: 4, h: 4 },
    { instanceId: B, x: 4, y: 0, w: 2, h: 2 },
  ],
}

// Tests mutate a deep copy freely; the parser receives it as unknown input.
function mutated(change: (doc: any) => void): unknown {
  const doc = structuredClone(valid)
  change(doc)
  return doc
}

describe('isUuid', () => {
  it('accepts UUIDs in any case and rejects other values', () => {
    expect(isUuid(A)).toBe(true)
    expect(isUuid(A.toUpperCase())).toBe(true)
    expect(isUuid('a')).toBe(false)
    expect(isUuid(`${A}0`)).toBe(false)
    expect(isUuid(1)).toBe(false)
  })
})

describe('parseScreenBoard', () => {
  it('accepts a valid screen', () => {
    expect(parseScreenBoard(structuredClone(valid))).toEqual({ ok: true, value: valid })
  })

  it('accepts an unknown source.type', () => {
    expect(parseScreenBoard(mutated((d) => { d.instances[0].source.type = 'weather' })).ok).toBe(true)
  })

  it('accepts a package source', () => {
    const source = { kind: 'package', packageId: 'dev.alex.pomodoro', version: '1.2.0' }
    const result = parseScreenBoard(mutated((d) => { d.instances[0].source = { ...source, extra: 1 } }))
    expect(result.ok && result.value.instances[0]!.source).toEqual(source)
  })

  it('drops unknown fields', () => {
    const result = parseScreenBoard(mutated((d) => {
      d.extra = 1
      d.instances[0].extra = 1
      d.layout[0].extra = 1
    }))
    expect(result).toEqual({ ok: true, value: valid })
  })

  it.each([
    ['null', null, /must be an object/],
    ['an array', [], /must be an object/],
    ['a non-UUID screen id', mutated((d) => { d.id = 'main' }), /screen id must be a UUID/],
    ['non-array instances', mutated((d) => { d.instances = {} }), /must be arrays/],
    ['a non-UUID instance id', mutated((d) => { d.instances[0].id = 'a' }), /id must be a UUID/],
    ['a duplicate id', mutated((d) => { d.instances[1].id = A }), /duplicate id/],
    ['a custom source', mutated((d) => { d.instances[0].source = { kind: 'custom' } }), /invalid source/],
    ['a package source with a bad id', mutated((d) => { d.instances[0].source = { kind: 'package', packageId: 'X', version: '1.0.0' } }), /invalid source/],
    ['a package source with a bad version', mutated((d) => { d.instances[0].source = { kind: 'package', packageId: 'dev.a', version: 'latest' } }), /invalid source/],
    ['a missing configVersion', mutated((d) => { delete d.instances[0].configVersion }), /configVersion must be a positive integer/],
    ['a zero configVersion', mutated((d) => { d.instances[0].configVersion = 0 }), /configVersion must be a positive integer/],
    ['a fractional configVersion', mutated((d) => { d.instances[0].configVersion = 1.5 }), /configVersion must be a positive integer/],
    ['a missing config', mutated((d) => { delete d.instances[0].config }), /config must be an object/],
    ['a placement without an instance', mutated((d) => { d.layout[1].instanceId = 'zzz' }), /unknown instanceId "zzz"/],
    ['an instance without a placement', mutated((d) => { d.layout.pop() }), /has no placement/],
    ['two placements of one instance', mutated((d) => { d.layout[1].instanceId = A }), /placed twice/],
    ['an out-of-bounds placement', mutated((d) => { d.layout[1].x = 11 }), /inside the 12x8 grid/],
    ['a non-integer coordinate', mutated((d) => { d.layout[1].x = 1.5 }), /inside the 12x8 grid/],
    ['a string coordinate', mutated((d) => { d.layout[1].x = '4' }), /inside the 12x8 grid/],
    ['a zero width', mutated((d) => { d.layout[1].w = 0 }), /inside the 12x8 grid/],
    ['overlapping placements', mutated((d) => { d.layout[1] = { instanceId: B, x: 2, y: 2, w: 2, h: 2 } }), /overlaps/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseScreenBoard(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})
