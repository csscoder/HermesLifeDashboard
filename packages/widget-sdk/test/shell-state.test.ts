import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import type { PlainSetting, SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import type { DevTheme } from '../src/dev/themes.ts'
import {
  appendLogEntry, LOG_ENTRY_LIMIT, LOG_MESSAGE_LIMIT, createFrameSession, describeShell, frameSizePx, parseShellState, secretsChanged,
  serializeShellState, shellContext, themeClass, type ShellState,
} from '../src/dev/shell-state.ts'

const counter = JSON.parse(readFileSync(new URL('./fixtures/counter/widget.json', import.meta.url), 'utf8')) as WidgetPackageManifest
const themeIds = ['builtin:glass', 'builtin:paper']
const state: ShellState = { w: 4, h: 3, theme: 'builtin:glass', frame: 'framed', confirm: 'allow' }
const theme: DevTheme = { id: themeIds[0]!, name: 'Glass', mode: 'dark', skin: 'glass', tokens: { '--ld-widget-padding': '1rem' } }

it('matches production theme classes for every built-in theme, a user theme, and invalid formats', async () => {
  const [{ themeClass: productionThemeClass }, { BUILTIN_THEME_IDS }] = await Promise.all([
    import(new URL('../../../apps/ui/app/theme/resolve.ts', import.meta.url).href),
    import(new URL('../../../apps/ui/app/theme/builtin.ts', import.meta.url).href),
  ])
  for (const id of [...BUILTIN_THEME_IDS, 'user:12345678-1234-4234-8234-123456789abc']) {
    expect(themeClass(id)).toBe(productionThemeClass(id))
  }
  const unknown = 'unknown:theme'
  expect(() => productionThemeClass(unknown)).toThrow(`Unknown theme id format: ${unknown}`)
  expect(() => themeClass(unknown)).toThrow(`Unknown theme id format: ${unknown}`)
})

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

it('uses the production settings-form helpers from contracts', async () => {
  const [shared, production] = await Promise.all([
    import('@lifedashboard/contracts/widget-settings'),
    import(new URL('../../../apps/ui/app/board/config-form.ts', import.meta.url).href),
  ])
  expect(production.controlFor).toBe(shared.controlFor)
  expect(production.parseFieldInput).toBe(shared.parseFieldInput)
  expect(production.plainConfig).toBe(shared.plainConfig)
  const schema: SettingsSchema = { type: 'object', properties: {
    title: { type: 'string', title: 'Title', default: '' },
    mode: { type: 'string', title: 'Mode', default: 'a', enum: ['a', 'b'] },
    count: { type: 'integer', title: 'Count', default: 1, minimum: 0, maximum: 9 },
    on: { type: 'boolean', title: 'On', default: false },
    key: { type: 'secret', title: 'Key', bind: { origin: 'https://service.example', header: 'Authorization' } },
  } }
  const controls = Object.values(schema.properties).map(shared.controlFor)
  expect(controls).toEqual(['text', 'select', 'number', 'checkbox', 'secret'])
  const plain = schema.properties.count as PlainSetting
  expect([['3'], [' '], ['10'], ['x']].map(([raw]) => shared.parseFieldInput(plain, raw!)))
    .toEqual([{ ok: true, value: 3 }, { ok: false }, { ok: false }, { ok: false }])
  expect(shared.parseFieldInput(schema.properties.on as PlainSetting, true)).toEqual({ ok: true, value: true })
  expect(shared.plainConfig(schema, { title: 't', key: 's', unknown: 1, count: 2 })).toEqual({ title: 't', count: 2 })
})

it('keeps the newest log entries and truncates long messages with an ellipsis', () => {
  let entries: { id: number; message: string }[] = []
  for (let id = 1; id <= LOG_ENTRY_LIMIT + 5; id++) entries = appendLogEntry(entries, { id, message: `m${id}` })
  expect(entries).toHaveLength(LOG_ENTRY_LIMIT)
  expect(entries[0]!.id).toBe(6)
  expect(entries.at(-1)!.id).toBe(LOG_ENTRY_LIMIT + 5)
  const exact = 'x'.repeat(LOG_MESSAGE_LIMIT)
  expect(appendLogEntry([], { id: 1, message: exact })[0]!.message).toBe(exact)
  const cut = appendLogEntry([], { id: 1, message: 'y'.repeat(100_000) })[0]!.message
  expect(cut).toHaveLength(LOG_MESSAGE_LIMIT)
  expect(cut.endsWith('…')).toBe(true)
})
