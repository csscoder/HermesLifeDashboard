import { DEFAULT_SHADOW, parseScreenBoard, type ScreenBoard, type WidgetAppearance } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { addInstance, focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setAppearance, setConfig, setPlacement, withRows } from '../app/board/edit-session'
import * as edits from '../app/board/edit-session'
import type { InstalledPackage } from '@lifedashboard/contracts/widget-package'

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

describe('setPackageVersion', () => {
  const packages: InstalledPackage[] = [{ id: 'dev.test.upgrade', title: 'Upgrade', author: 'test', grants: [], origins: [], versions: [{
    version: '2.0.0', hash: 'new-hash', paths: { source: null, assets: null }, manifest: {
      format: 2, id: 'dev.test.upgrade', version: '2.0.0', title: 'Upgrade', author: 'test', sdk: 3,
      entry: 'index.js', styles: [], permissions: [], sizing: { min: { w: 3, h: 3 }, default: { w: 4, h: 4 }, max: { w: 6, h: 6 } },
      settings: { type: 'object', properties: { title: { type: 'string', title: 'Title', default: 'New' }, count: { type: 'integer', title: 'Count', default: 2, minimum: 1 } } },
    },
  }] }]
  const original: ScreenBoard = { ...board, instances: [{ ...board.instances[0]!, source: { kind: 'package', packageId: 'dev.test.upgrade', version: '1.0.0' },
    configVersion: 7, config: { title: 'Saved', count: -1, removed: true, token: 'never retain' }, appearance: { themeId: 'builtin:paper', shadow: null } }],
    layout: [{ instanceId: A, x: 4, y: 0, w: 2, h: 2 }] }

  it('keeps instance identity and appearance, normalizes compatible config, and fits the new minimum without moving', () => {
    const before = structuredClone(original)
    const result = edits.setPackageVersion(original, A, '2.0.0', packages)
    expect(result).toEqual({ ok: true, value: { ...original,
      instances: [{ ...original.instances[0], source: { kind: 'package', packageId: 'dev.test.upgrade', version: '2.0.0' }, config: { title: 'Saved', count: 2 } }],
      layout: [{ instanceId: A, x: 4, y: 0, w: 3, h: 3 }],
    } })
    expect(original).toEqual(before)
  })

  it('rejects expansion into a neighbour instead of losing or moving widgets', () => {
    const occupied = { ...original, layout: [...original.layout, { instanceId: B, x: 6, y: 0, w: 2, h: 2 }], instances: [...original.instances, board.instances[1]!] }
    const before = structuredClone(occupied)
    expect(edits.setPackageVersion(occupied, A, '2.0.0', packages).ok).toBe(false)
    expect(occupied).toEqual(before)
  })

  it('rejects unknown versions and built-in widgets', () => {
    expect(edits.setPackageVersion(original, A, 'missing', packages).ok).toBe(false)
    expect(edits.setPackageVersion(board, A, '2.0.0', packages).ok).toBe(false)
  })
})

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

describe('withRows', () => {
  it('sets an integer in 4..100 and does not mutate its input', () => {
    const before = structuredClone(board)
    expect(withRows(board, 4)).toEqual({ ...board, rows: 4 })
    expect(withRows(board, 100)).toEqual({ ...board, rows: 100 })
    expect(board).toEqual(before)
  })

  it.each([Number.NaN, 4.5, 3, 101, 0, -12])('returns the same board for %s', (value) => {
    expect(withRows(board, value)).toBe(board)
  })

  it('makes a board with only changed rows differ', () => {
    expect(isSameBoard(withRows(board, 13), board)).toBe(false)
  })
})

describe('setConfig', () => {
  it('replaces only the target config and preserves configVersion, appearance and the input', () => {
    const original = setAppearance(board, A, { themeId: 'builtin:paper', shadow: null })
    original.instances[0] = { ...original.instances[0]!, configVersion: 3, config: { old: true } }
    const before = structuredClone(original)
    const config = { title: 'Updated', count: 3 }
    const next = setConfig(original, A, config)
    expect(next.instances[0]).toStrictEqual({ ...original.instances[0], config })
    expect(next.instances[0]!.config).toEqual(config)
    expect(next.instances[1]).toBe(original.instances[1])
    expect(next.instances[2]).toBe(original.instances[2])
    expect(next.layout).toBe(original.layout)
    expect(next.id).toBe(original.id)
    expect(next.rows).toBe(original.rows)
    expect(original).toEqual(before)
  })

  it('keeps an equal board for an unknown instance', () => {
    expect(setConfig(board, 'missing', { title: 'Updated' })).toEqual(board)
  })
})

describe('setAppearance', () => {
  const look: WidgetAppearance = { themeId: 'builtin:paper', shadow: null }

  it('sets the appearance last on the target only and does not mutate its input', () => {
    const before = structuredClone(board)
    const next = setAppearance(board, A, look)
    expect(next.instances[0]).toStrictEqual({ ...board.instances[0], appearance: look })
    expect(Object.keys(next.instances[0]!).at(-1)).toBe('appearance')
    expect(next.instances[1]).toBe(board.instances[1])
    expect(next.layout).toBe(board.layout)
    expect(board).toEqual(before)
  })

  it('replaces an appearance and stores it in canonical key order', () => {
    const scrambled = { shadow: { opacity: 0.5, color: '#000000', blur: 16, y: 8, x: 0 }, themeId: null } as WidgetAppearance
    const next = setAppearance(setAppearance(board, A, look), A, scrambled)
    expect(JSON.stringify(next.instances[0]!.appearance)).toBe(JSON.stringify({ themeId: null, shadow: DEFAULT_SHADOW }))
  })

  it.each([
    ['null («Сбросить»)', null],
    ['undefined', undefined],
    ['both fields null', { themeId: null, shadow: null }],
  ])('removes the key for %s, so the board is unchanged again', (_name, value) => {
    const next = setAppearance(setAppearance(board, A, look), A, value)
    expect(next.instances[0]).not.toHaveProperty('appearance')
    expect(isSameBoard(next, board)).toBe(true)
  })

  it('matches what the parser reads back', () => {
    const next = setAppearance(board, A, { themeId: null, shadow: DEFAULT_SHADOW })
    const parsed = parseScreenBoard(JSON.parse(JSON.stringify(next)))
    expect(parsed.ok && isSameBoard(parsed.value, next)).toBe(true)
  })
})

describe('addInstance', () => {
  const NEW = '00000000-0000-4000-8000-00000000000d'
  const source = { kind: 'package', packageId: 'dev.a.clock', version: '1.0.0' } as const
  const rect = { x: 2, y: 4, w: 2, h: 2 }

  it('places a frameless widget last with the bare theme and no shadow, without mutating its input', () => {
    const before = structuredClone(board)
    const next = addInstance(board, NEW, source, rect, 'frameless')
    expect(next.instances.at(-1)).toStrictEqual({ id: NEW, source, configVersion: 1, config: {}, appearance: { themeId: 'builtin:bare', shadow: null } })
    expect(next.layout.at(-1)).toStrictEqual({ instanceId: NEW, ...rect })
    expect(next.instances.slice(0, 3)).toEqual(board.instances)
    expect(parseScreenBoard(JSON.parse(JSON.stringify(next)))).toEqual({ ok: true, value: next })
    expect(board).toEqual(before)
  })

  it.each([['framed' as const], [undefined]])('adds no appearance key for frame %s', (frame) => {
    const next = addInstance(board, NEW, source, rect, frame)
    expect(next.instances.at(-1)).not.toHaveProperty('appearance')
    expect(next.instances.at(-1)).toStrictEqual({ id: NEW, source, configVersion: 1, config: {} })
    expect(next.layout.at(-1)).toStrictEqual({ instanceId: NEW, ...rect })
  })
})


describe('screen theme draft', () => {
  it('changes the screen theme without mutating the saved board or widget overrides', () => {
    const source = { ...board, instances: board.instances.map((instance, index) => index === 0 ? { ...instance, appearance: { themeId: 'builtin:glass', shadow: null } } : instance) }
    const next = edits.withTheme(source, 'builtin:paper')
    expect(next.themeId).toBe('builtin:paper')
    expect(source).not.toHaveProperty('themeId')
    expect(next.instances[0]!.appearance?.themeId).toBe('builtin:glass')
    expect(isSameBoard(source, next)).toBe(false)
    expect(parseScreenBoard(next)).toEqual({ ok: true, value: next })
  })

  it('clears an override canonically and preserves the theme through ordinary edits', () => {
    const themed = edits.withTheme(board, 'builtin:paper')
    expect(withRows(themed, 16).themeId).toBe('builtin:paper')
    expect(setConfig(themed, A, { title: 'Keep theme' }).themeId).toBe('builtin:paper')
    expect(isSameBoard(edits.withTheme(themed, null), board)).toBe(true)
    const parsed = parseScreenBoard(themed)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(JSON.stringify(parsed.value)).toBe(JSON.stringify(themed))
  })
})


describe('screen background draft', () => {
  const background = { mediaId: '00000000-0000-4000-8000-0000000000aa', kind: 'video' as const, opacity: 0.7, dim: 0.35,
    pattern: { shape: 'circles' as const, color: '#112233', opacity: 0.25, scale: 1 } }
  it('previews without mutating the saved screen and keeps canonical theme/background order', () => {
    const saved = edits.withTheme(board, 'builtin:paper')
    const next = edits.withBackground(saved, background)
    expect(next.background).toEqual(background)
    expect(saved).not.toHaveProperty('background')
    expect(isSameBoard(next, saved)).toBe(false)
    const parsed = parseScreenBoard(next)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(JSON.stringify(parsed.value)).toBe(JSON.stringify(next))
    expect(edits.withTheme(next, 'builtin:glass').background).toEqual(background)
    expect(withRows(next, 16).background).toEqual(background)
    expect(setConfig(next, A, { title: 'Keep video' }).background).toEqual(background)
  })
  it('removes a draft background canonically without losing widgets or the theme', () => {
    const saved = edits.withTheme(board, 'builtin:paper')
    const next = edits.withBackground(saved, background)
    expect(isSameBoard(edits.withBackground(next, null), saved)).toBe(true)
    expect(next.instances).toEqual(saved.instances)
  })
})
