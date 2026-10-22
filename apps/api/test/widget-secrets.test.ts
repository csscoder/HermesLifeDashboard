import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScreenBoard } from '@lifedashboard/contracts/board'
import { SEED_SPACE_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { call, errorCode, installPackage, pair, T0, testApp, widgetPackage, type TestApp } from './helpers.ts'

const BOARD = `/api/v1/spaces/${SEED_SPACE_ID}/board`
const WIDGET = '00000000-0000-4000-8000-0000000000a1'
const OTHER_WIDGET = '00000000-0000-4000-8000-0000000000a2'
const BUILTIN = '00000000-0000-4000-8000-0000000000b1'
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff'
const VALUE = '0123456789abcdef'
const MESSAGE = 'The secret must be at least 16 characters without control characters or surrounding spaces'
const screen: ScreenBoard = {
  id: SEED_SCREEN_ID,
  rows: 12,
  instances: [WIDGET, OTHER_WIDGET].map((id) => ({
    id, source: { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }, configVersion: 1, config: {},
  })),
  layout: [
    { instanceId: WIDGET, x: 0, y: 0, w: 3, h: 3 },
    { instanceId: OTHER_WIDGET, x: 4, y: 0, w: 3, h: 3 },
  ],
}
screen.instances.push({ id: BUILTIN, source: { kind: 'builtin', type: 'placeholder' }, configVersion: 1, config: {} })
screen.layout.push({ instanceId: BUILTIN, x: 8, y: 0, w: 2, h: 2 })

let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
  await installPackage(t, cookie, widgetPackage((pkg) => {
    pkg.manifest.sdk = 2
    pkg.manifest.permissions = ['state', 'network']
    pkg.manifest.network = ['https://api.example.com']
    pkg.manifest.settings = {
      type: 'object',
      properties: {
        apiKey: { type: 'secret', title: 'API key', bind: { origin: 'https://api.example.com', header: 'Authorization', prefix: 'Bearer ' } },
        queryKey: { type: 'secret', title: 'Query key', bind: { origin: 'https://api.example.com', query: 'apikey' } },
        label: { type: 'string', title: 'Label', default: '' },
      },
    }
  }))
  expect((await save(1, screen)).statusCode).toBe(200)
})

afterEach(async () => { await t.close() })

function secrets(method: 'GET' | 'PUT' | 'DELETE', widgetId = WIDGET, key = 'apiKey', payload?: unknown, session: string | undefined = cookie) {
  return call(t.app, {
    method, url: `/api/v1/widgets/${widgetId}/secrets${method === 'GET' ? '' : `/${key}`}`,
    cookie: session,
    contentType: method === 'GET' ? undefined : 'application/json',
    payload: method === 'DELETE' ? {} : payload === null ? 'null' : payload,
  })
}

function save(expectedRevision: number, saved: ScreenBoard) {
  return call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision, screens: [saved] } })
}

async function put(value = VALUE, widgetId = WIDGET) {
  const response = await secrets('PUT', widgetId, 'apiKey', { value })
  expect(response.statusCode).toBe(200)
  expect(response.json().data).toEqual({ apiKey: true, queryKey: false })
  expect(response.body).not.toContain(value)
  return response
}

describe('per-instance widget secrets', () => {
  it('reports unset keys, stores a 16-character secret, and returns only booleans', async () => {
    const unset = await secrets('GET')
    expect(unset.statusCode).toBe(200)
    expect(unset.json().data).toEqual({ apiKey: false, queryKey: false })
    await put()
    const response = await secrets('GET')
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ apiKey: true, queryKey: false })
    expect(response.body).not.toContain(VALUE)
    expect(t.db.prepare('SELECT value, updated_at FROM widget_secrets WHERE widget_id = ? AND key = ?').get(WIDGET, 'apiKey'))
      .toEqual({ value: VALUE, updated_at: '2026-10-05T10:00:00.000Z' })
    expect(t.db.prepare('SELECT * FROM widget_audit').all()).toEqual([])
    expect((await call(t.app, { url: BOARD, cookie })).body).not.toContain(VALUE)
  })

  it('replaces a secret with the injected timestamp and keeps instances isolated', async () => {
    await put()
    t.clock.now = T0 + 1000
    await put('replacement-value-123')
    expect(t.db.prepare('SELECT value, updated_at FROM widget_secrets WHERE widget_id = ?').all(WIDGET))
      .toEqual([{ value: 'replacement-value-123', updated_at: '2026-10-05T10:00:01.000Z' }])
    expect((await secrets('GET', OTHER_WIDGET)).json().data).toEqual({ apiKey: false, queryKey: false })
    await put('another-instance-key', OTHER_WIDGET)
    const { secretValues } = await import('../src/widget-secrets.ts')
    expect(secretValues(t.db, WIDGET)).toEqual(new Map([['apiKey', 'replacement-value-123']]))
    expect(secretValues(t.db, OTHER_WIDGET)).toEqual(new Map([['apiKey', 'another-instance-key']]))
    expect(secretValues(t.db, UNKNOWN)).toEqual(new Map())
  })

  it.each([
    ['10 characters', { value: '0123456789' }],
    ['15 characters', { value: '0123456789abcde' }],
    ['empty string', { value: '' }],
    ['missing value', {}],
    ['number', { value: 1234567890123456 }],
    ['boolean', { value: true }],
    ['null', { value: null }],
    ['array', { value: [VALUE] }],
    ['null body', null],
  ])('rejects %s without replacing an existing secret', async (_name, payload) => {
    await put()
    const response = await secrets('PUT', WIDGET, 'apiKey', payload)
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(response.json().error.message).toBe(MESSAGE)
    expect(t.db.prepare('SELECT value FROM widget_secrets WHERE widget_id = ?').get(WIDGET)).toEqual({ value: VALUE })
  })

  it.each(['apiKey', 'queryKey'])('rejects surrounding whitespace for %s without replacing its value', async (key) => {
    expect((await secrets('PUT', WIDGET, key, { value: VALUE })).statusCode).toBe(200)
    for (const whitespace of [' ', '\t', '\n', '\u00a0', '\u2003', '\ufeff']) {
      for (const value of [whitespace + VALUE, VALUE + whitespace]) {
        const response = await secrets('PUT', WIDGET, key, { value })
        expect(response.statusCode).toBe(400)
        expect(response.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: MESSAGE })
        expect(response.body).not.toContain(VALUE)
        expect(t.db.prepare('SELECT value FROM widget_secrets WHERE widget_id = ? AND key = ?').get(WIDGET, key))
          .toEqual({ value: VALUE })
      }
    }
  })

  it.each(['\u0100', 'ключ', '🔑'])('rejects non-Latin-1 header secrets containing %s', async (suffix) => {
    await put()
    const response = await secrets('PUT', WIDGET, 'apiKey', { value: VALUE + suffix })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toMatchObject({
      code: 'VALIDATION_ERROR', message: 'A header secret may contain only Latin-1 characters',
    })
    expect(t.db.prepare('SELECT value FROM widget_secrets WHERE widget_id = ?').get(WIDGET)).toEqual({ value: VALUE })
  })

  it('accepts Latin-1 header secrets and Unicode query secrets without trimming internal spaces', async () => {
    await put('abc défghijklmnÿop')
    const value = 'ключ abcdefghijklmnop 🔑'
    const response = await secrets('PUT', WIDGET, 'queryKey', { value })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ apiKey: true, queryKey: true })
    expect(t.db.prepare('SELECT value FROM widget_secrets WHERE widget_id = ? AND key = ?').get(WIDGET, 'queryKey'))
      .toEqual({ value })
  })

  it.each(['\ud800', '\udc00'])('rejects an unpaired surrogate %j without replacing a query secret', async (surrogate) => {
    expect((await secrets('PUT', WIDGET, 'queryKey', { value: VALUE })).statusCode).toBe(200)
    const response = await secrets('PUT', WIDGET, 'queryKey', { value: VALUE + surrogate })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: MESSAGE })
    expect(response.body).not.toContain(VALUE)
    expect(t.db.prepare('SELECT value FROM widget_secrets WHERE widget_id = ? AND key = ?').get(WIDGET, 'queryKey'))
      .toEqual({ value: VALUE })
  })

  it('rejects every ASCII control character including DEL', async () => {
    for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
      const value = VALUE + String.fromCharCode(code)
      const response = await secrets('PUT', WIDGET, 'apiKey', { value })
      expect(response.statusCode).toBe(400)
      expect(errorCode(response)).toBe('VALIDATION_ERROR')
      expect(response.json().error.message).toBe(MESSAGE)
      expect(response.body).not.toContain(VALUE)
    }
    expect(t.db.prepare('SELECT count(*) AS n FROM widget_secrets').get()).toEqual({ n: 0 })
  })

  it.each(['GET', 'PUT', 'DELETE'] as const)('%s rejects an unknown widget with the existing error', async (method) => {
    const response = await secrets(method, UNKNOWN, 'apiKey', method === 'PUT' ? { value: VALUE } : undefined)
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
    expect(response.json().error.message).toBe('Widget not found')
  })

  it.each(['PUT', 'DELETE'] as const)('%s rejects a plain setting and an undeclared key', async (method) => {
    for (const key of ['label', 'unknown', 'toString']) {
      const response = await secrets(method, WIDGET, key, method === 'PUT' ? { value: VALUE } : undefined)
      expect(response.statusCode).toBe(404)
      expect(errorCode(response)).toBe('NOT_FOUND')
    }
    expect(t.db.prepare('SELECT count(*) AS n FROM widget_secrets').get()).toEqual({ n: 0 })
  })

  it('returns no keys for a built-in or an sdk 1 widget and rejects writes', async () => {
    await installPackage(t, cookie, widgetPackage((pkg) => { pkg.manifest.id = 'dev.test.legacy' }))
    t.db.prepare('UPDATE widgets SET source_type = ? WHERE id = ?').run('dev.test.legacy', OTHER_WIDGET)
    for (const id of [BUILTIN, OTHER_WIDGET]) {
      const response = await secrets('GET', id)
      expect(response.statusCode).toBe(200)
      expect(response.json().data).toEqual({})
      expect((await secrets('PUT', id, 'apiKey', { value: VALUE })).statusCode).toBe(404)
      expect((await secrets('DELETE', id)).statusCode).toBe(404)
    }
  })

  it.each(['GET', 'PUT', 'DELETE'] as const)('%s requires the dashboard session', async (method) => {
    const response = await secrets(method, WIDGET, 'apiKey', method === 'PUT' ? { value: VALUE } : undefined, '')
    expect(response.statusCode).toBe(401)
    expect(errorCode(response)).toBe('UNAUTHORIZED')
  })

  it('keeps the secret when a saved board keeps the stable instance id', async () => {
    await put()
    const response = await save(2, { ...screen, layout: screen.layout.map((item) => ({ ...item, y: 1 })) })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain(VALUE)
    expect((await secrets('GET')).json().data).toEqual({ apiKey: true, queryKey: false })
    expect(t.db.prepare('SELECT value FROM widget_secrets WHERE widget_id = ?').get(WIDGET)).toEqual({ value: VALUE })
  })

  it('deletes secrets when a saved board removes the instance', async () => {
    await put()
    expect((await save(2, { ...screen, instances: [], layout: [] })).statusCode).toBe(200)
    expect(t.db.prepare('SELECT count(*) AS n FROM widget_secrets').get()).toEqual({ n: 0 })
  })

  it('keeps secrets for surviving instances when another instance is removed', async () => {
    await put()
    await put('another-instance-key', OTHER_WIDGET)
    expect((await save(2, {
      ...screen,
      instances: screen.instances.filter((item) => item.id !== WIDGET),
      layout: screen.layout.filter((item) => item.instanceId !== WIDGET),
    })).statusCode).toBe(200)
    expect(t.db.prepare('SELECT widget_id, value FROM widget_secrets').all())
      .toEqual([{ widget_id: OTHER_WIDGET, value: 'another-instance-key' }])
    expect((await secrets('GET', OTHER_WIDGET)).json().data).toEqual({ apiKey: true, queryKey: false })
  })

  it('leaves secrets intact after a rejected board save', async () => {
    await put()
    expect((await save(1, { ...screen, instances: [], layout: [] })).statusCode).toBe(409)
    expect((await secrets('GET')).json().data).toEqual({ apiKey: true, queryKey: false })
  })

  it('deletes only the requested instance secret and reports false on repeated DELETE', async () => {
    await put()
    await put('another-instance-key', OTHER_WIDGET)
    for (let i = 0; i < 2; i++) {
      const response = await secrets('DELETE')
      expect(response.statusCode).toBe(200)
      expect(response.json().data).toEqual({ apiKey: false, queryKey: false })
      expect(response.body).not.toContain(VALUE)
    }
    expect((await secrets('GET')).json().data).toEqual({ apiKey: false, queryKey: false })
    expect((await secrets('GET', OTHER_WIDGET)).json().data).toEqual({ apiKey: true, queryKey: false })
    expect(t.db.prepare('SELECT widget_id FROM widget_secrets').all()).toEqual([{ widget_id: OTHER_WIDGET }])
  })
})
