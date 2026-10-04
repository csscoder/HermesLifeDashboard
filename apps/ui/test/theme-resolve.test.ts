import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_STORAGE_KEY, loadAppearance, saveAppearance } from '../app/theme/appearance'
import { BUILTIN_THEME_IDS, BUILTIN_THEMES, DEFAULT_THEME_ID, themeMeta } from '../app/theme/builtin'
import { resolveThemeId, themeClass } from '../app/theme/resolve'

describe('resolveThemeId', () => {
  const known = new Set(['builtin:glass', 'builtin:paper', 'builtin:obsidian'])

  it('returns the first set and known id (widget, room, workspace)', () => {
    expect(resolveThemeId(['builtin:obsidian', 'builtin:paper'], known)).toBe('builtin:obsidian')
    expect(resolveThemeId([null, 'builtin:paper'], known)).toBe('builtin:paper')
  })

  it('treats an unknown id as unset', () => {
    expect(resolveThemeId(['user:deleted', null, 'builtin:paper'], known)).toBe('builtin:paper')
  })

  it('falls back to the default theme', () => {
    expect(resolveThemeId([null, null], known)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemeId([], known)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemeId(['user:deleted'], known)).toBe(DEFAULT_THEME_ID)
  })
})

describe('themeClass', () => {
  it('maps builtin and user ids to class suffixes', () => {
    expect(themeClass('builtin:glass')).toBe('glass')
    expect(themeClass('user:3f2a-11')).toBe('u-3f2a-11')
  })

  it('throws for any other id', () => {
    expect(() => themeClass('glass')).toThrow(/Unknown theme id/)
  })

  it('never gives a built-in theme a user-namespace class', () => {
    for (const theme of BUILTIN_THEMES) expect(themeClass(theme.id).startsWith('u-')).toBe(false)
  })
})

describe('built-in theme metadata', () => {
  it('knows the default theme', () => {
    expect(BUILTIN_THEME_IDS.has(DEFAULT_THEME_ID)).toBe(true)
  })

  it('returns metadata by id and the default theme for an unknown id', () => {
    expect(themeMeta('builtin:paper')).toMatchObject({ mode: 'light', skin: 'paper' })
    expect(themeMeta('user:deleted').id).toBe(DEFAULT_THEME_ID)
  })
})

function memoryStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(APPEARANCE_STORAGE_KEY, initial)
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

describe('appearance storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns defaults when nothing is stored', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('round-trips a saved appearance', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(saveAppearance({ schemaVersion: 1, themeId: 'builtin:paper' })).toBe(true)
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: 'builtin:paper' })
  })

  it.each([
    ['malformed JSON', '{'],
    ['a wrong schemaVersion', '{"schemaVersion":2,"themeId":"builtin:paper"}'],
    ['a non-string themeId', '{"schemaVersion":1,"themeId":7}'],
    ['a missing themeId', '{"schemaVersion":1}'],
    ['an array', '[]'],
  ])('returns defaults for %s', (_, stored) => {
    vi.stubGlobal('localStorage', memoryStorage(stored))
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('drops unknown fields', () => {
    vi.stubGlobal('localStorage', memoryStorage('{"schemaVersion":1,"themeId":null,"extra":1}'))
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('returns defaults when getItem throws or storage is missing', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
    vi.stubGlobal('localStorage', undefined)
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('returns false when setItem throws', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(saveAppearance({ schemaVersion: 1, themeId: 'builtin:paper' })).toBe(false)
  })
})
