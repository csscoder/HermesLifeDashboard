import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import type { SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import type { DevTheme } from '../src/dev/themes.ts'
import {
  createFrameSession, describeShell, frameSizePx, parseShellState, secretsChanged,
  serializeShellState, shellContext, type ShellState,
} from '../src/dev/shell-state.ts'

const counter = JSON.parse(readFileSync(new URL('./fixtures/counter/widget.json', import.meta.url), 'utf8')) as WidgetPackageManifest
const themeIds = ['builtin:glass', 'builtin:paper']
const state: ShellState = { w: 4, h: 3, theme: 'builtin:glass', frame: 'framed', confirm: 'allow' }
const theme: DevTheme = { id: themeIds[0]!, name: 'Glass', mode: 'dark', skin: 'glass', tokens: { '--ld-widget-padding': '1rem' } }

it('clamps dimensions and defaults invalid choices', () => {
  expect(parseShellState('?w=99&h=0&theme=nope&frame=x&confirm=y', counter, themeIds)).toEqual({ ...state, h: 1 })
  expect(parseShellState('', counter, themeIds)).toEqual({ ...state, w: 2, h: 2 })
  for (const value of ['abc', '', 'Infinity', '2.5']) {
    expect(parseShellState(`?w=${value}&h=${value}`, counter, themeIds)).toEqual({ ...state, w: 2, h: 2 })
  }
})

it('serializes every control in order and round-trips valid state', () => {
  expect(serializeShellState(state)).toBe('?w=4&h=3&theme=builtin%3Aglass&frame=framed&confirm=allow')
  const changed: ShellState = { w: 1, h: 4, theme: 'builtin:paper', frame: 'frameless', confirm: 'decline' }
  expect(parseShellState(serializeShellState(changed), counter, themeIds)).toEqual(changed)
  expect(describeShell(state)).toBe('w=4 h=3 theme=builtin:glass frame=framed')
})

it('sizes the outer frame using cell size and the current root-font gap', () => {
  expect(frameSizePx({ ...state, w: 3, h: 2 }, 40, 8)).toEqual({ width: 136, height: 88 })
  expect(frameSizePx({ ...state, w: 3, h: 2 }, 40, 10)).toEqual({ width: 140, height: 90 })
  expect(frameSizePx({ ...state, w: 1, h: 1 }, 40, 10)).toEqual({ width: 40, height: 40 })
})

it('builds production context and normalizes config without exposing secret values', () => {
  const settings: SettingsSchema = {
    type: 'object', properties: {
      city: { type: 'string', title: 'City', default: 'Moscow' },
      count: { type: 'integer', title: 'Count', default: 3, minimum: 1 },
      apiKey: { type: 'secret', title: 'API key', bind: { origin: 'https://example.com', header: 'X-Key' } },
    },
  }
  const context = (keys: string[]) => shellContext(
    { ...state, w: 2, frame: 'frameless' }, theme, settings,
    { city: 'Perm', count: 0, apiKey: 'never expose this', unknown: true }, new Set(keys),
    { locale: 'ru-RU', rootFontSize: 20 },
  )
  expect(context([])).toEqual({
    size: { w: 2, h: 3 }, sizeClass: 's', frame: 'frameless',
    theme: { id: theme.id, scheme: 'dark', tokens: theme.tokens },
    config: { city: 'Perm', count: 3, apiKey: false }, locale: 'ru-RU', rootFontSize: 20, visible: true,
  })
  expect(context(['apiKey']).config.apiKey).toBe(true)
  expect(context([]).config.apiKey).toBe(false)
  expect(shellContext(state, theme, undefined, { stale: 1 }, new Set(), { locale: 'en', rootFontSize: 16 }).config).toEqual({})
})

it('opens on hello without a load event and replaces the session after a reload', () => {
  const first = { close: vi.fn() }
  const second = { close: vi.fn() }
  const open = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
  const session = createFrameSession(open)
  session.hello() // The first hello arrives before any load event.
  expect(open).toHaveBeenCalledTimes(1)
  expect(first.close).not.toHaveBeenCalled()
  session.hello() // A Vite reload sends another hello; no load handler is required.
  expect(open).toHaveBeenCalledTimes(2)
  expect(first.close).toHaveBeenCalledOnce()
  expect(second.close).not.toHaveBeenCalled()
  expect(open.mock.invocationCallOrder[1]).toBeGreaterThan(first.close.mock.invocationCallOrder[0]!)
  session.dispose()
  session.dispose()
  expect(second.close).toHaveBeenCalledOnce()
})

it('detects secret changes, including removed and added keys regardless of order', () => {
  expect(secretsChanged({ apiKey: false }, { apiKey: true })).toBe(true)
  expect(secretsChanged({ apiKey: false }, { apiKey: false })).toBe(false)
  expect(secretsChanged({ a: true, b: false }, { b: false, a: true })).toBe(false)
  expect(secretsChanged({ apiKey: false }, {})).toBe(true)
  expect(secretsChanged({}, { apiKey: false })).toBe(true)
})
