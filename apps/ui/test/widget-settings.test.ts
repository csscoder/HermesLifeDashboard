import { BARE_THEME_ID, DEFAULT_SHADOW } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { panelPosition, styleValue, withShadow, withStyle } from '../app/board/widget-settings'

const UNKNOWN = 'user:00000000-0000-4000-8000-00000000000a'

describe('styleValue', () => {
  it.each([
    ['no appearance', undefined, ''],
    ['an inherited theme', { themeId: null, shadow: DEFAULT_SHADOW }, ''],
    ['a built-in theme', { themeId: 'builtin:paper', shadow: null }, 'builtin:paper'],
    ['bare', { themeId: BARE_THEME_ID, shadow: null }, BARE_THEME_ID],
    ['an unknown user theme', { themeId: UNKNOWN, shadow: null }, ''],
    ['an unknown built-in theme', { themeId: 'builtin:deleted', shadow: null }, ''],
  ] as const)('%s → %j', (_name, appearance, expected) => {
    expect(styleValue(appearance)).toBe(expected)
  })
})

describe('withStyle', () => {
  it('sets the theme and keeps the shadow', () => {
    expect(withStyle({ themeId: null, shadow: DEFAULT_SHADOW }, BARE_THEME_ID)).toEqual({ themeId: BARE_THEME_ID, shadow: DEFAULT_SHADOW })
  })

  it('maps «Как у доски» to null', () => {
    expect(withStyle({ themeId: 'builtin:paper', shadow: null }, '')).toEqual({ themeId: null, shadow: null })
    expect(withStyle(undefined, '')).toEqual({ themeId: null, shadow: null })
  })
})

describe('withShadow', () => {
  it('keeps a stored unknown theme id while the shadow changes', () => {
    const on = withShadow({ themeId: UNKNOWN, shadow: null }, DEFAULT_SHADOW)
    expect(on).toEqual({ themeId: UNKNOWN, shadow: DEFAULT_SHADOW })
    expect(withShadow(on, null)).toEqual({ themeId: UNKNOWN, shadow: null })
  })

  it('starts from an inherited theme without an appearance', () => {
    expect(withShadow(undefined, DEFAULT_SHADOW)).toEqual({ themeId: null, shadow: DEFAULT_SHADOW })
  })
})

describe('panelPosition', () => {
  const size = { width: 240, height: 300 }
  const viewport = { width: 1280, height: 800 }

  it('places the panel right of the widget, top-aligned', () => {
    expect(panelPosition({ left: 100, top: 50, right: 124 }, size, viewport)).toEqual({ left: 132, top: 50 })
  })

  it('flips left of the widget near the right edge', () => {
    expect(panelPosition({ left: 1200, top: 50, right: 1224 }, size, viewport)).toEqual({ left: 952, top: 50 })
  })

  it('keeps the panel inside the bottom edge', () => {
    expect(panelPosition({ left: 100, top: 700, right: 124 }, size, viewport)).toEqual({ left: 132, top: 492 })
  })

  it('pins a panel larger than the viewport to the margin', () => {
    expect(panelPosition({ left: 100, top: 50, right: 124 }, size, { width: 200, height: 200 })).toEqual({ left: 8, top: 8 })
  })
})
