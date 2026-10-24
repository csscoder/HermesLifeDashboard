import type { SpaceSummary } from '@lifedashboard/contracts/space'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_OPEN_STORAGE_KEY,
  loadLastOpen,
  resolveLastOpen,
  saveLastOpen,
  screenFor,
} from '../app/spaces/last-open'

const DEFAULTS = { schemaVersion: 1, spaceId: null, screens: {} }

function memoryStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(LAST_OPEN_STORAGE_KEY, initial)
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

function space(id: string): SpaceSummary {
  return { id, title: id, icon: '🏠', color: 'violet', themeId: null, position: 0, revision: 1 }
}

describe('last-open storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns defaults when nothing is stored', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadLastOpen()).toEqual(DEFAULTS)
  })

  it('round-trips a saved value', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const value = { schemaVersion: 1 as const, spaceId: 'sp1', screens: { sp1: 's2' } }
    expect(saveLastOpen(value)).toBe(true)
    expect(loadLastOpen()).toEqual(value)
  })

  it.each([
    ['malformed JSON', '{'],
    ['a wrong schemaVersion', '{"schemaVersion":2,"spaceId":null,"screens":{}}'],
    ['a non-string spaceId', '{"schemaVersion":1,"spaceId":7,"screens":{}}'],
    ['a missing spaceId', '{"schemaVersion":1,"screens":{}}'],
    ['screens as an array', '{"schemaVersion":1,"spaceId":null,"screens":[]}'],
    ['screens as null', '{"schemaVersion":1,"spaceId":null,"screens":null}'],
    ['an array', '[]'],
  ])('returns defaults for %s', (_, stored) => {
    vi.stubGlobal('localStorage', memoryStorage(stored))
    expect(loadLastOpen()).toEqual(DEFAULTS)
  })

  it('drops non-string screen values and unknown fields', () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage(
        '{"schemaVersion":1,"spaceId":"sp1","screens":{"sp1":"s2","sp2":3},"extra":1}',
      ),
    )
    expect(loadLastOpen()).toEqual({ schemaVersion: 1, spaceId: 'sp1', screens: { sp1: 's2' } })
  })

  it('returns defaults when getItem throws or storage is missing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
    })
    expect(loadLastOpen()).toEqual(DEFAULTS)
    vi.stubGlobal('localStorage', undefined)
    expect(loadLastOpen()).toEqual(DEFAULTS)
  })

  it('returns false when setItem throws', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(saveLastOpen(DEFAULTS)).toBe(false)
  })
})

describe('resolveLastOpen', () => {
  it('keeps the stored space when it is listed', () => {
    const stored = { schemaVersion: 1 as const, spaceId: 'b', screens: {} }
    expect(resolveLastOpen(stored, [space('a'), space('b')])).toBe('b')
  })

  it('falls back to the first space when the stored one was deleted', () => {
    const stored = { schemaVersion: 1 as const, spaceId: 'gone', screens: {} }
    expect(resolveLastOpen(stored, [space('a'), space('b')])).toBe('a')
  })

  it('falls back to the first space when nothing is stored', () => {
    expect(resolveLastOpen(DEFAULTS, [space('a')])).toBe('a')
  })

  it('returns null when there are no spaces', () => {
    const stored = { schemaVersion: 1 as const, spaceId: 'a', screens: {} }
    expect(resolveLastOpen(stored, [])).toBeNull()
  })
})

describe('screenFor', () => {
  const stored = { schemaVersion: 1 as const, spaceId: 'sp1', screens: { sp1: 's2' } }

  it('keeps the stored screen when it is present', () => {
    expect(screenFor(stored, 'sp1', ['s1', 's2'])).toBe('s2')
  })

  it('falls back to the first screen when the stored one is stale', () => {
    expect(screenFor(stored, 'sp1', ['s1', 's3'])).toBe('s1')
  })

  it('falls back to the first screen when nothing is stored for the space', () => {
    expect(screenFor(stored, 'sp9', ['s1', 's2'])).toBe('s1')
  })

  it('returns null when the space has no screens', () => {
    expect(screenFor(stored, 'sp1', [])).toBeNull()
  })
})
