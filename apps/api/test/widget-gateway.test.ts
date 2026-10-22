import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import type { AddressInfo } from 'node:net'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { SEED_SPACE_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { needsConfirmation, RATE_LIMITS } from '../src/widget-gateway.ts'
import { createGatewayClient } from '../../ui/app/widgets/broker.ts'
import { api as uiApi } from '../../ui/app/api.ts'
import { call, DAY, errorCode, HOUR, installPackage, pair, T0, testApp, widgetPackage, type TestApp } from './helpers.ts'

const BOARD = `/api/v1/spaces/${SEED_SPACE_ID}/board`
const PKG_WIDGET = '00000000-0000-4000-8000-0000000000a1'
const BUILTIN_WIDGET = '00000000-0000-4000-8000-0000000000b1'
// JSON of 'x'.repeat(n) is n + 2 bytes.
const exactly64k = 'x'.repeat(65_534)

let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
  await installPackage(t, cookie)
  const screen = {
    id: SEED_SCREEN_ID,
    rows: 12,
    instances: [
      { id: PKG_WIDGET, source: { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }, configVersion: 1, config: {} },
      { id: BUILTIN_WIDGET, source: { kind: 'builtin', type: 'placeholder' }, configVersion: 1, config: {} },
    ],
    layout: [
      { instanceId: PKG_WIDGET, x: 0, y: 0, w: 3, h: 3 },
      { instanceId: BUILTIN_WIDGET, x: 4, y: 0, w: 2, h: 2 },
    ],
  }
  const saved = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: 1, screens: [screen] } })
  expect(saved.statusCode).toBe(200)
})

afterEach(async () => {
  await t.close()
})

function createSession(widgetId: unknown, sessionCookie = cookie) {
  return call(t.app, { method: 'POST', url: '/api/v1/widget-sessions', cookie: sessionCookie, payload: { widgetId } })
}

async function openSession(widgetId: string, app = t.app): Promise<string> {
  const response = await call(app, { method: 'POST', url: '/api/v1/widget-sessions', cookie, payload: { widgetId } })
  expect(response.statusCode).toBe(200)
  return response.json().data.widgetSession
}

// `sessionCookie: null` sends no dashboard cookie (undefined would pick the default).
function gateway(op: string, token: string | null, payload: unknown = {}, sessionCookie: string | null = cookie, app = t.app) {
  return call(app, {
    method: 'POST',
    url: `/api/v1/widget-gateway/${op}`,
    cookie: sessionCookie ?? undefined,
    payload,
    headers: token === null ? {} : { 'x-widget-session': token },
  })
}

function auditRows(): unknown[] {
  return t.db.prepare('SELECT widget_id, package_id, op, outcome FROM widget_audit ORDER BY rowid').all()
}

async function pairAgain(): Promise<string> {
  t.clock.now += 10_000
  expect((await call(t.app, { method: 'POST', url: '/api/v1/auth/pair-code', payload: {} })).statusCode).toBe(200)
  return pair(t)
}

describe('POST /widget-sessions', () => {
  it.each([
    { kind: 'package', packageId: 'dev.test.hello', version: '2.0.0' },
    { kind: 'package', packageId: 'dev.test.other', version: '1.0.0' },
    { kind: 'builtin', type: 'placeholder' },
  ])('rejects an expected source that no longer owns the UUID: %j', async (source) => {
    const response = await call(t.app, { method: 'POST', url: '/api/v1/widget-sessions', cookie, payload: { widgetId: PKG_WIDGET, source } })
    expect(response.statusCode).toBe(401)
    expect(errorCode(response)).toBe('SESSION_EXPIRED')
  })

  it('rejects malformed expected sources instead of treating them as omitted', async () => {
    const response = await call(t.app, { method: 'POST', url: '/api/v1/widget-sessions', cookie, payload: { widgetId: PKG_WIDGET, source: null } })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
  })

  it('does not let an old host renew onto the version saved by another tab', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const response = await call(t.app, { method: init?.method as 'POST' | 'DELETE', url: String(url), cookie,
        headers: init?.headers as Record<string, string>, payload: init?.body as string })
      return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } })
    })
    const onSessionLost = vi.fn()
    const client = createGatewayClient({ api: uiApi, widgetId: PKG_WIDGET,
      source: { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' },
      confirm: async () => 'approved', onNotify() {}, onSessionLost })
    try {
      expect(await client.start()).toBe(true)
      await installPackage(t, cookie, widgetPackage((pkg) => { pkg.manifest.version = '2.0.0' }))
      const board = (await call(t.app, { url: BOARD, cookie })).json().data
      board.screens[0].instances.find((instance: { id: string }) => instance.id === PKG_WIDGET).source.version = '2.0.0'
      expect((await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: board.revision, screens: board.screens } })).statusCode).toBe(200)
      await expect(client.call('state.set', { data: { oldCode: true }, expectedRevision: 0 })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
      expect(onSessionLost).toHaveBeenCalledOnce()
      expect(t.db.prepare('SELECT data FROM widget_state WHERE widget_id = ?').get(PKG_WIDGET)).toBeUndefined()
    } finally {
      await client.close()
      fetchMock.mockRestore()
    }
  })

  it('returns a random session with the package grants', async () => {
    const response = await createSession(PKG_WIDGET)
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ widgetSession: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), grants: ['state'] })
    expect((await createSession(PKG_WIDGET)).json().data.widgetSession).not.toBe(response.json().data.widgetSession)
  })

  it('takes built-in grants from builtin-widgets.ts', async () => {
    expect((await createSession(BUILTIN_WIDGET)).json().data.grants).toEqual([])
  })

  it.each([
    ['an unknown widget', () => '00000000-0000-4000-8000-0000000000ff'],
    ['an unknown built-in type', () => {
      t.db.prepare("UPDATE widgets SET source_type = 'nope' WHERE id = ?").run(BUILTIN_WIDGET)
      return BUILTIN_WIDGET
    }],
    ['a package version that is not installed', () => {
      t.db.prepare("UPDATE widgets SET source_version = '9.9.9' WHERE id = ?").run(PKG_WIDGET)
      return PKG_WIDGET
    }],
  ])('answers 404 for %s', async (_name, widgetId) => {
    const response = await createSession(widgetId())
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })

  it('answers 400 without a widgetId', async () => {
    expect((await createSession(undefined)).statusCode).toBe(400)
  })

  it('ends a session on DELETE by its owner only', async () => {
    const token = await openSession(PKG_WIDGET)
    const other = await pairAgain()
    await call(t.app, { method: 'DELETE', url: `/api/v1/widget-sessions/${token}`, cookie: other, payload: {} })
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    const ended = await call(t.app, { method: 'DELETE', url: `/api/v1/widget-sessions/${token}`, cookie, payload: {} })
    expect(ended.statusCode).toBe(200)
    expect(errorCode(await gateway('state.get', token))).toBe('SESSION_EXPIRED')
  })
})

describe('gateway pipeline', () => {
  it('answers 401 UNAUTHORIZED without the dashboard cookie', async () => {
    const token = await openSession(PKG_WIDGET)
    const response = await gateway('state.get', token, {}, null)
    expect(response.statusCode).toBe(401)
    expect(errorCode(response)).toBe('UNAUTHORIZED')
  })

  it('answers 401 SESSION_EXPIRED for a missing, unknown or foreign widget session and audits none', async () => {
    const token = await openSession(PKG_WIDGET)
    const other = await pairAgain()
    for (const response of [
      await gateway('state.get', null),
      await gateway('state.get', 'nope'),
      await gateway('state.get', token, {}, other),
    ]) {
      expect(response.statusCode).toBe(401)
      expect(errorCode(response)).toBe('SESSION_EXPIRED')
    }
    expect(auditRows()).toEqual([])
  })

  it('expires an idle session after one hour and renews it on use', async () => {
    const token = await openSession(PKG_WIDGET)
    t.clock.now += HOUR - 1
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    t.clock.now += HOUR - 1
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    t.clock.now += HOUR
    expect(errorCode(await gateway('state.get', token))).toBe('SESSION_EXPIRED')
  })

  it.each([
    ['version', "UPDATE widgets SET source_version = '2.0.0' WHERE id = ?"],
    ['package', "UPDATE widgets SET source_type = 'dev.test.other' WHERE id = ?"],
    ['kind', "UPDATE widgets SET source_kind = 'builtin', source_type = 'placeholder', source_version = NULL WHERE id = ?"],
    ['removal', 'DELETE FROM widgets WHERE id = ?'],
  ])('expires a session before using cached metadata after widget %s changes', async (_name, sql) => {
    const token = await openSession(PKG_WIDGET)
    t.db.prepare(sql).run(PKG_WIDGET)
    const response = await gateway('state.set', token, { data: { leaked: true }, expectedRevision: 0 })
    expect(response.statusCode).toBe(401)
    expect(errorCode(response)).toBe('SESSION_EXPIRED')
    expect(t.db.prepare('SELECT data FROM widget_state WHERE widget_id = ?').get(PKG_WIDGET)).toBeUndefined()
    expect(auditRows()).toEqual([])
  })

  it('evicts the least recently used session beyond 200', async () => {
    const first = await openSession(PKG_WIDGET)
    const second = await openSession(PKG_WIDGET)
    expect((await gateway('state.get', first)).statusCode).toBe(200)
    for (let index = 0; index < 199; index++) await openSession(PKG_WIDGET)
    expect((await gateway('state.get', first)).statusCode).toBe(200)
    expect(errorCode(await gateway('state.get', second))).toBe('SESSION_EXPIRED')
  })

  it.each(['board', 'screen', 'space'])('keeps sessions expired after %s removal and recreation of the same UUID', async (removedBy) => {
    let board = (await call(t.app, { url: BOARD, cookie })).json().data
    const instance = board.screens[0].instances.find((item: { id: string }) => item.id === PKG_WIDGET)
    const placement = board.screens[0].layout.find((item: { instanceId: string }) => item.instanceId === PKG_WIDGET)
    const detach = (screen: { instances: { id: string }[]; layout: { instanceId: string }[] }) => {
      screen.instances = screen.instances.filter((item) => item.id !== PKG_WIDGET)
      screen.layout = screen.layout.filter((item) => item.instanceId !== PKG_WIDGET)
    }
    const save = async (value: typeof board) => {
      const response = await call(t.app, { method: 'PUT', url: `/api/v1/spaces/${value.spaceId}/board`, cookie,
        payload: { expectedRevision: value.revision, screens: value.screens } })
      expect(response.statusCode).toBe(200)
      return response.json().data
    }
    if (removedBy === 'screen') {
      const added = await call(t.app, { method: 'POST', url: `/api/v1/spaces/${SEED_SPACE_ID}/screens`, cookie, payload: { expectedRevision: board.revision } })
      expect(added.statusCode).toBe(200)
      board = added.json().data
      detach(board.screens[0])
      board.screens[1].instances.push(instance)
      board.screens[1].layout.push(placement)
      board = await save(board)
    } else if (removedBy === 'space') {
      const created = await call(t.app, { method: 'POST', url: '/api/v1/spaces', cookie, payload: {} })
      expect(created.statusCode).toBe(200)
      detach(board.screens[0])
      await save(board)
      board = (await call(t.app, { url: `/api/v1/spaces/${created.json().data.id}/board`, cookie })).json().data
      board.screens[0].instances.push(instance)
      board.screens[0].layout.push(placement)
      board = await save(board)
    }
    const token = await openSession(PKG_WIDGET)
    if (removedBy === 'board') {
      detach(board.screens[0])
      await save(board)
    } else {
      const url = removedBy === 'screen' ? `/api/v1/spaces/${board.spaceId}/screens/${board.screens[1].id}` : `/api/v1/spaces/${board.spaceId}`
      expect((await call(t.app, { method: 'DELETE', url, cookie, payload: { expectedRevision: board.revision } })).statusCode).toBe(200)
    }
    const recreated = (await call(t.app, { url: BOARD, cookie })).json().data
    recreated.screens[0].instances.push(instance)
    recreated.screens[0].layout.push(placement)
    await save(recreated)
    const old = await gateway('state.get', token)
    expect(old.statusCode).toBe(401)
    expect(errorCode(old)).toBe('SESSION_EXPIRED')
    expect((await gateway('state.get', await openSession(PKG_WIDGET))).statusCode).toBe(200)
  })

  it('answers 404 UNKNOWN_OP, 403 PERMISSION_DENIED and 400 INVALID_INPUT and audits each', async () => {
    const token = await openSession(PKG_WIDGET)
    const builtin = await openSession(BUILTIN_WIDGET)
    const unknown = await gateway('http.post', token)
    expect([unknown.statusCode, errorCode(unknown)]).toEqual([404, 'UNKNOWN_OP'])
    const denied = await gateway('notifications.send', token, { title: 'x', body: '' })
    expect([denied.statusCode, errorCode(denied)]).toEqual([403, 'PERMISSION_DENIED'])
    const builtinDenied = await gateway('state.get', builtin)
    expect([builtinDenied.statusCode, errorCode(builtinDenied)]).toEqual([403, 'PERMISSION_DENIED'])
    const invalid = await gateway('state.set', token, { data: 1 })
    expect([invalid.statusCode, errorCode(invalid)]).toEqual([400, 'INVALID_INPUT'])
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    expect(auditRows()).toEqual([
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'http.post', outcome: 'UNKNOWN_OP' },
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'notifications.send', outcome: 'PERMISSION_DENIED' },
      { widget_id: BUILTIN_WIDGET, package_id: null, op: 'state.get', outcome: 'PERMISSION_DENIED' },
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'state.set', outcome: 'INVALID_INPUT' },
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'state.get', outcome: 'ok' },
    ])
  })

  it('deletes audit rows older than 30 days at start', async () => {
    t.db.exec(`
      INSERT INTO widget_audit (at, widget_id, package_id, op, outcome) VALUES ('${new Date(T0 - 31 * DAY).toISOString()}', 'w', NULL, 'state.get', 'ok');
      INSERT INTO widget_audit (at, widget_id, package_id, op, outcome) VALUES ('${new Date(T0 - 29 * DAY).toISOString()}', 'w', NULL, 'state.set', 'ok');
    `)
    const restarted = await testApp(t)
    await restarted.close()
    expect(t.db.prepare('SELECT op FROM widget_audit').all()).toEqual([{ op: 'state.set' }])
  })
})

describe('state', () => {
  it('returns null at revision 0 before the first write', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('state.get', token)).json().data).toEqual({ data: null, revision: 0 })
  })

  it('writes with the expected revision and answers 409 CONFLICT to a stale one', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('state.set', token, { data: { n: 1 }, expectedRevision: 0 })).json().data).toEqual({ revision: 1 })
    const stale = await gateway('state.set', token, { data: { n: 2 }, expectedRevision: 0 })
    expect([stale.statusCode, errorCode(stale)]).toEqual([409, 'CONFLICT'])
    expect((await gateway('state.get', token)).json().data).toEqual({ data: { n: 1 }, revision: 1 })
  })

  it('stores exactly 64 KB and rejects one byte more', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('state.set', token, { data: exactly64k, expectedRevision: 0 })).statusCode).toBe(200)
    expect((await gateway('state.get', token)).json().data).toEqual({ data: exactly64k, revision: 1 })
    const tooBig = await gateway('state.set', token, { data: `${exactly64k}x`, expectedRevision: 1 })
    expect([tooBig.statusCode, errorCode(tooBig)]).toEqual([400, 'INVALID_INPUT'])
  })

  it('survives an API restart', async () => {
    await gateway('state.set', await openSession(PKG_WIDGET), { data: { n: 7 }, expectedRevision: 0 })
    const restarted = await testApp(t)
    try {
      const token = await openSession(PKG_WIDGET, restarted.app)
      expect((await gateway('state.get', token, {}, cookie, restarted.app)).json().data).toEqual({ data: { n: 7 }, revision: 1 })
    } finally {
      await restarted.close()
    }
  })

  it('limits state.set to 60 calls a minute per widget, also across a new session', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let revision = 0; revision < 60; revision++) {
      expect((await gateway('state.set', token, { data: revision, expectedRevision: revision })).statusCode).toBe(200)
    }
    const limited = await gateway('state.set', token, { data: 60, expectedRevision: 60 })
    expect([limited.statusCode, errorCode(limited)]).toEqual([429, 'RATE_LIMITED'])
    expect(errorCode(await gateway('state.set', await openSession(PKG_WIDGET), { data: 60, expectedRevision: 60 }))).toBe('RATE_LIMITED')
    t.clock.now += 60_000
    expect((await gateway('state.set', token, { data: 60, expectedRevision: 60 })).statusCode).toBe(200)
  })
})

describe('notifications', () => {
  beforeEach(async () => {
    // Grants belong to the package: a new version that asks for more extends them.
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'notifications']
    }))
    // These tests cover the call itself; describe('confirmation') covers the «ask» mode a new grant gets.
    t.db.prepare("UPDATE widget_grants SET mode = 'allow'").run()
  })

  it('accepts the text limits and rejects text outside them', async () => {
    const token = await openSession(PKG_WIDGET)
    const sent = await gateway('notifications.send', token, { title: 'x'.repeat(80), body: 'y'.repeat(300) })
    expect(sent.json().data).toEqual({ ok: true })
    for (const input of [{ title: '', body: '' }, { title: 'x'.repeat(81), body: '' }, { title: 'x', body: 'y'.repeat(301) }]) {
      expect(errorCode(await gateway('notifications.send', token, input))).toBe('INVALID_INPUT')
    }
  })

  it('allows 10 an hour per widget, also across a new session', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let index = 0; index < 10; index++) {
      expect((await gateway('notifications.send', token, { title: 'x', body: '' })).statusCode).toBe(200)
    }
    expect(errorCode(await gateway('notifications.send', token, { title: 'x', body: '' }))).toBe('RATE_LIMITED')
    const fresh = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('notifications.send', fresh, { title: 'x', body: '' }))).toBe('RATE_LIMITED')
    // Controller-ruled test repair: renew the session inside the window, then cross the hour boundary.
    t.clock.now += HOUR - 1
    expect((await gateway('state.get', fresh)).statusCode).toBe(200)
    t.clock.now += 1
    expect((await gateway('notifications.send', fresh, { title: 'x', body: '' })).statusCode).toBe(200)
  })
})

describe('needsConfirmation', () => {
  // Hermes Tasks writes through http.send; 60/min is its write budget under the 10 s refresh.
  it('keeps http.send at 60 per minute', () => {
    expect(RATE_LIMITS['http.send']).toEqual({ max: 60, windowMs: 60_000 })
  })

  it.each([
    ['never', 'ask', false],
    ['never', 'allow', false],
    ['never', null, false],
    ['optional', 'ask', true],
    ['optional', 'allow', false],
    // A built-in widget (mode null) counts as allow.
    ['optional', null, false],
    ['always', 'ask', true],
    ['always', 'allow', true],
    ['always', null, true],
  ] as const)('%s with mode %s → %s', (policy, mode, expected) => {
    expect(needsConfirmation(policy, mode)).toBe(expected)
  })
})

describe('confirmation', () => {
  const note = { title: 'Hi', body: 'there' }

  beforeEach(async () => {
    // A new confirmable grant installs as «ask».
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'notifications']
    }))
  })

  function send(token: string, confirmationId?: string, payload: unknown = note) {
    return call(t.app, {
      method: 'POST',
      url: '/api/v1/widget-gateway/notifications.send',
      cookie,
      payload,
      headers: confirmationId === undefined ? { 'x-widget-session': token } : { 'x-widget-session': token, 'x-widget-confirmation': confirmationId },
    })
  }

  async function issue(token: string): Promise<string> {
    const response = await send(token)
    expect([response.statusCode, errorCode(response)]).toEqual([428, 'CONFIRMATION_REQUIRED'])
    const id: string = response.json().error.confirmationId
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    return id
  }

  function decline(token: string, id: string) {
    return call(t.app, { method: 'DELETE', url: `/api/v1/widget-gateway/confirmations/${id}`, cookie, payload: {}, headers: { 'x-widget-session': token } })
  }

  function setMode(mode: string) {
    return call(t.app, { method: 'PUT', url: '/api/v1/widget-packages/dev.test.hello/grants/notifications', cookie, payload: { mode } })
  }

  function outcomes(): string[] {
    return (auditRows() as { outcome: string }[]).map((row) => row.outcome)
  }

  it('runs an asked call once with its confirmation and audits issue, use and reuse', async () => {
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    expect((await send(token, id)).json().data).toEqual({ ok: true })
    const reused = await send(token, id)
    expect([reused.statusCode, errorCode(reused)]).toEqual([409, 'CONFIRMATION_INVALID'])
    expect(reused.json().error.confirmationId).toBeUndefined()
    expect(auditRows()).toEqual(
      ['CONFIRMATION_REQUIRED', 'ok', 'CONFIRMATION_INVALID'].map((outcome) => ({
        widget_id: PKG_WIDGET,
        package_id: 'dev.test.hello',
        op: 'notifications.send',
        outcome,
      })),
    )
  })

  it('expires the old session and confirmation after a saved package version switch', async () => {
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    const board = (await call(t.app, { url: BOARD, cookie })).json().data
    board.screens[0].instances.find((instance: { id: string }) => instance.id === PKG_WIDGET).source.version = '1.1.0'
    const saved = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: board.revision, screens: board.screens } })
    expect(saved.statusCode).toBe(200)
    const approved = await send(token, id)
    expect(approved.statusCode).toBe(401)
    expect(errorCode(approved)).toBe('SESSION_EXPIRED')
    expect(outcomes()).toEqual(['CONFIRMATION_REQUIRED'])
    const current = await openSession(PKG_WIDGET)
    const reused = await send(current, id)
    expect([reused.statusCode, errorCode(reused)]).toEqual([409, 'CONFIRMATION_INVALID'])
  })

  it('invalidates unused sessions and confirmations across a version roundtrip', async () => {
    const unused = await openSession(PKG_WIDGET)
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    for (const version of ['1.1.0', '1.0.0']) {
      const board = (await call(t.app, { url: BOARD, cookie })).json().data
      board.screens[0].instances.find((instance: { id: string }) => instance.id === PKG_WIDGET).source.version = version
      expect((await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: board.revision, screens: board.screens } })).statusCode).toBe(200)
    }
    const read = await gateway('state.get', unused)
    expect(read.statusCode).toBe(401)
    expect(errorCode(read)).toBe('SESSION_EXPIRED')
    const approved = await send(token, id)
    expect(approved.statusCode).toBe(401)
    expect(errorCode(approved)).toBe('SESSION_EXPIRED')
    expect(outcomes()).toEqual(['CONFIRMATION_REQUIRED'])
  })

  it.each(['ordinary', 'conflict', 'invalid sizing'])('preserves confirmation sessions after an %s board save', async (change) => {
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    const board = (await call(t.app, { url: BOARD, cookie })).json().data
    const instance = board.screens[0].instances.find((item: { id: string }) => item.id === PKG_WIDGET)
    let expectedStatus = 200
    if (change === 'ordinary') {
      instance.config = { title: 'Changed' }
      board.screens[0].layout[0].y = 1
    } else {
      instance.source.version = '1.1.0'
      if (change === 'conflict') { board.revision -= 1; expectedStatus = 409 }
      else { board.screens[0].layout[0].w = 7; board.screens[0].layout[1].x = 10; expectedStatus = 400 }
    }
    const saved = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: board.revision, screens: board.screens } })
    expect(saved.statusCode).toBe(expectedStatus)
    expect((await send(token, id)).statusCode).toBe(200)
  })

  it('spends an approved id even when the mode flipped to allow mid-dialog', async () => {
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    expect((await setMode('allow')).statusCode).toBe(200)
    expect((await send(token, id)).json().data).toEqual({ ok: true })
    expect((await setMode('ask')).statusCode).toBe(200)
    await issue(token)
  })

  it('reads the grant mode on every call of a live session', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await setMode('allow')).statusCode).toBe(200)
    expect((await send(token)).json().data).toEqual({ ok: true })
    expect((await setMode('ask')).statusCode).toBe(200)
    await issue(token)
  })

  it('binds a confirmation to its input and its widget session', async () => {
    const token = await openSession(PKG_WIDGET)
    const other = await openSession(PKG_WIDGET)
    const id = await issue(token)
    for (const response of [await send(token, id, { title: 'Hi', body: 'other' }), await send(other, id)]) {
      expect([response.statusCode, errorCode(response)]).toEqual([409, 'CONFIRMATION_INVALID'])
    }
    // The same input with its keys in another order is the same call.
    expect((await send(token, id, { body: 'there', title: 'Hi' })).statusCode).toBe(200)
  })

  it('expires a confirmation after CONFIRMATION_TTL_MS and frees the slot', async () => {
    const token = await openSession(PKG_WIDGET)
    const first = await issue(token)
    t.clock.now += 120_000 - 1
    expect((await send(token, first)).statusCode).toBe(200)
    const second = await issue(token)
    t.clock.now += 120_000
    expect(errorCode(await send(token, second))).toBe('CONFIRMATION_INVALID')
    await issue(token)
  })

  it('keeps one pending confirmation per session; a decline audits it and frees the slot', async () => {
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    const second = await send(token)
    expect([second.statusCode, errorCode(second)]).toEqual([429, 'RATE_LIMITED'])
    expect(second.json().error.message).toBe('A confirmation is already pending')
    // Another session of the same widget has its own slot.
    await issue(await openSession(PKG_WIDGET))
    expect((await decline(token, 'nope')).statusCode).toBe(200)
    expect((await decline(token, id)).statusCode).toBe(200)
    expect(errorCode(await send(token, id))).toBe('CONFIRMATION_INVALID')
    await issue(token)
    expect(outcomes()).toEqual([
      'CONFIRMATION_REQUIRED',
      'RATE_LIMITED',
      'CONFIRMATION_REQUIRED',
      'DECLINED',
      'CONFIRMATION_INVALID',
      'CONFIRMATION_REQUIRED',
    ])
  })

  it('spends the rate limit once per confirmed call', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let index = 0; index < 10; index++) {
      expect((await send(token, await issue(token))).statusCode).toBe(200)
    }
    expect(errorCode(await send(token))).toBe('RATE_LIMITED')
  })
})

describe('http', () => {
  let server: Server
  let origin = ''
  let handle: (request: IncomingMessage, response: ServerResponse) => void
  const seen: { method: string; url: string; body: string }[] = []
  const send = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"x"}' }

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      request.on('end', () => {
        seen.push({ method: request.method!, url: request.url!, body })
        handle(request, response)
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(async () => {
    seen.length = 0
    handle = (_request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    // Version 1.1.0 asks for network; the placed widget moves to it, 1.0.0 stays installed.
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'network']
      p.manifest.network = [origin]
    }))
    t.db.prepare("UPDATE widgets SET source_version = '1.1.0' WHERE id = ?").run(PKG_WIDGET)
  })

  function confirmed(token: string, id: string, payload: unknown) {
    return call(t.app, {
      method: 'POST',
      url: '/api/v1/widget-gateway/http.send',
      cookie,
      payload,
      headers: { 'x-widget-session': token, 'x-widget-confirmation': id },
    })
  }

  it('proxies a GET to an approved origin and audits status, method and origin only', async () => {
    const token = await openSession(PKG_WIDGET)
    const response = await gateway('http.get', token, { url: `${origin}/api/v1/tasks?due=today`, headers: { accept: 'application/json' } })
    expect(response.json().data).toEqual({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/v1/tasks?due=today' })
    expect(auditRows().at(-1)).toEqual({ widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'http.get', outcome: `200 GET ${origin}` })
  })

  it('denies an unlisted origin and rejects credentials in the URL before any request', async () => {
    const token = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: 'http://evil.example/' }))).toBe('PERMISSION_DENIED')
    expect(errorCode(await gateway('http.get', token, { url: `${origin}@evil.example/` }))).toBe('INVALID_INPUT')
    expect(seen).toHaveLength(0)
  })

  it('denies an origin the user has not approved', async () => {
    t.db.prepare('DELETE FROM widget_network_origins').run()
    const token = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: `${origin}/` }))).toBe('PERMISSION_DENIED')
  })

  it('gives an older version without network no origins, although the package holds the grant', async () => {
    t.db.prepare("UPDATE widgets SET source_version = '1.0.0' WHERE id = ?").run(PKG_WIDGET)
    const token = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: `${origin}/` }))).toBe('PERMISSION_DENIED')
  })

  it('asks before http.send in ask mode and sends once after the confirmation', async () => {
    const token = await openSession(PKG_WIDGET)
    const input = { url: `${origin}/api/v1/tasks`, ...send }
    const asked = await gateway('http.send', token, input)
    expect([asked.statusCode, errorCode(asked)]).toEqual([428, 'CONFIRMATION_REQUIRED'])
    expect(seen).toHaveLength(0)
    const sent = await confirmed(token, asked.json().error.confirmationId, input)
    expect(sent.json().data.status).toBe(200)
    expect(seen).toEqual([{ method: 'POST', url: '/api/v1/tasks', body: '{"title":"x"}' }])
  })

  it('sends without asking in allow mode', async () => {
    t.db.prepare("UPDATE widget_grants SET mode = 'allow' WHERE permission = 'network'").run()
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('http.send', token, { url: `${origin}/api/v1/tasks`, ...send })).json().data.status).toBe(200)
  })

  it('answers 502 UPSTREAM_ERROR for a dropped connection and audits it', async () => {
    handle = (request) => request.socket.destroy()
    const token = await openSession(PKG_WIDGET)
    const response = await gateway('http.get', token, { url: `${origin}/` })
    expect([response.statusCode, errorCode(response), response.json().error.message]).toEqual([502, 'UPSTREAM_ERROR', 'The service is unreachable'])
    expect(auditRows().at(-1)).toMatchObject({ op: 'http.get', outcome: `UPSTREAM_ERROR GET ${origin}` })
  })

  it('keeps the http.get count across a new session', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let index = 0; index < 120; index++) expect((await gateway('http.get', token, { url: `${origin}/` })).statusCode).toBe(200)
    const fresh = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', fresh, { url: `${origin}/` }))).toBe('RATE_LIMITED')
  })

  it('denies http to a built-in widget', async () => {
    const token = await openSession(BUILTIN_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: `${origin}/` }))).toBe('PERMISSION_DENIED')
  })
})

describe('secrets', () => {
  const VALUE = '0123456789abcdef'
  const QUERY_VALUE = 'fedcba9876543210'
  const OTHER_VALUE = `${VALUE}-other-origin`
  let origin = 'http://127.0.0.1:12345'
  let otherOrigin = 'https://other.example.com'

  beforeEach(async () => {
    await installSecrets()
    t.db.prepare("UPDATE widget_grants SET mode = 'allow' WHERE permission = 'network'").run()
    t.db.prepare("UPDATE widgets SET source_version = '1.1.0' WHERE id = ?").run(PKG_WIDGET)
  })

  afterEach(() => vi.restoreAllMocks())

  async function installSecrets(properties: SettingsSchema['properties'] = {
    apiKey: { type: 'secret', title: 'Ключ', bind: { origin, header: 'Authorization', prefix: 'Bearer ' } },
    queryKey: { type: 'secret', title: 'Query key', bind: { origin, query: 'apikey' } },
    otherKey: { type: 'secret', title: 'Other key', bind: { origin: otherOrigin, header: 'X-Other-Key' } },
  }) {
    await installPackage(t, cookie, widgetPackage((pkg) => {
      pkg.manifest.version = '1.1.0'
      pkg.manifest.sdk = 2
      pkg.manifest.permissions = ['state', 'network']
      pkg.manifest.network = [origin, otherOrigin]
      pkg.manifest.settings = { type: 'object', properties }
    }))
  }

  async function put(key: string, value: string) {
    const response = await call(t.app, {
      method: 'PUT', url: `/api/v1/widgets/${PKG_WIDGET}/secrets/${key}`, cookie, payload: { value },
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain(value)
  }

  function request(op: 'http.get' | 'http.send', token: string, url = `${origin}/echo`) {
    return gateway(op, token, op === 'http.get'
      ? { url, headers: { accept: 'application/json' } }
      : { url, method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'payload' })
  }

  describe('validation before upstream requests', () => {
    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected upstream request'))
    })

    it.each(['http.get', 'http.send'] as const)('denies an unapproved origin before checking missing secrets for %s', async (op) => {
      t.db.prepare('DELETE FROM widget_network_origins').run()
      const response = await request(op, await openSession(PKG_WIDGET))
      expect([response.statusCode, errorCode(response), response.json().error.message])
        .toEqual([403, 'PERMISSION_DENIED', 'The widget may not reach this origin'])
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each(['http.get', 'http.send'] as const)('rejects %s with the setting title when its secret is missing', async (op) => {
      const response = await request(op, await openSession(PKG_WIDGET))
      expect([response.statusCode, errorCode(response), response.json().error.message])
        .toEqual([502, 'UPSTREAM_ERROR', 'Secret «Ключ» is not set'])
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each(['http.get', 'http.send'] as const)('rejects a query collision for %s without sending a request', async (op) => {
      await put('apiKey', VALUE)
      await put('queryKey', QUERY_VALUE)
      const response = await request(op, await openSession(PKG_WIDGET), `${origin}/echo?apikey=x`)
      expect([response.statusCode, errorCode(response), response.json().error.message])
        .toEqual([400, 'INVALID_INPUT', 'The URL already contains the secret parameter "apikey"'])
      expect(fetch).not.toHaveBeenCalled()
      expect(JSON.stringify(auditRows())).not.toContain(VALUE)
      expect(JSON.stringify(auditRows())).not.toContain(QUERY_VALUE)
    })

    it('checks every missing value before attempting an earlier query injection', async () => {
      // Preserve manifest order: the query binding precedes the missing header binding.
      const row = t.db.prepare('SELECT manifest FROM widget_package_versions WHERE package_id = ? AND version = ?')
        .get('dev.test.hello', '1.1.0') as { manifest: string }
      const manifest = JSON.parse(row.manifest)
      manifest.settings.properties = {
        queryKey: manifest.settings.properties.queryKey,
        apiKey: manifest.settings.properties.apiKey,
      }
      t.db.prepare('UPDATE widget_package_versions SET manifest = ? WHERE package_id = ? AND version = ?')
        .run(JSON.stringify(manifest), 'dev.test.hello', '1.1.0')
      await put('queryKey', QUERY_VALUE)
      const response = await request('http.get', await openSession(PKG_WIDGET), `${origin}/echo?apikey=x`)
      expect([response.statusCode, errorCode(response), response.json().error.message])
        .toEqual([502, 'UPSTREAM_ERROR', 'Secret «Ключ» is not set'])
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('responses without a listener', () => {
    it('redacts the injected encodeURIComponent query secret in an echoed request URL', async () => {
      const queryValue = 'ab+cd/ef=gh ijklmnop'
      const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(String(url), {
        status: 400, headers: { 'content-type': 'text/plain' },
      }))
      await put('apiKey', VALUE)
      await put('queryKey', queryValue)
      const response = await request('http.get', await openSession(PKG_WIDGET))
      expect(upstream).toHaveBeenCalledWith(`${origin}/echo?apikey=ab%2Bcd%2Fef%3Dgh%20ijklmnop`, expect.anything())
      expect(response.statusCode).toBe(200)
      expect(response.json().data).toEqual({
        status: 400, contentType: 'text/plain', body: `${origin}/echo?apikey=[REDACTED]`,
      })
    })

    it.each(['http.get', 'http.send'] as const)('injects and redacts %s with current values and preserves upstream status', async (op) => {
      const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        `${OTHER_VALUE}|${VALUE}|${QUERY_VALUE}|${OTHER_VALUE}|${VALUE}`,
        { status: 409, headers: { 'content-type': `text/plain; token=${OTHER_VALUE}; key=${VALUE}` } },
      ))
      const token = await openSession(PKG_WIDGET)
      await put('apiKey', VALUE)
      await put('queryKey', QUERY_VALUE)
      await put('otherKey', OTHER_VALUE)
      const response = await request(op, token, `${origin.replace('http:', 'HTTP:')}/echo`)
      expect(response.statusCode).toBe(200)
      expect(response.json().data).toEqual({
        status: 409,
        contentType: 'text/plain; token=[REDACTED]; key=[REDACTED]',
        body: '[REDACTED]|[REDACTED]|[REDACTED]|[REDACTED]|[REDACTED]',
      })
      expect(upstream).toHaveBeenCalledOnce()
      const [url, init] = upstream.mock.calls[0]!
      expect(new URL(String(url)).searchParams.get('apikey')).toBe(QUERY_VALUE)
      expect(init).toMatchObject({
        method: op === 'http.get' ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${VALUE}`, ...(op === 'http.get' ? { accept: 'application/json' } : { 'content-type': 'text/plain' }) },
        ...(op === 'http.send' ? { body: 'payload' } : {}),
      })
      expect(init!.headers).not.toHaveProperty('x-other-key')
      expect(JSON.stringify(auditRows())).not.toContain(VALUE)
      expect(JSON.stringify(auditRows())).not.toContain(QUERY_VALUE)
      expect(JSON.stringify(auditRows())).not.toContain(OTHER_VALUE)
    })

    it('ignores missing bindings on another origin and preserves a null contentType', async () => {
      const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
      await put('otherKey', OTHER_VALUE)
      const response = await request('http.get', await openSession(PKG_WIDGET), `${otherOrigin}/echo`)
      expect(response.statusCode).toBe(200)
      expect(response.json().data).toEqual({ status: 204, contentType: null, body: '' })
      expect(upstream).toHaveBeenCalledWith(`${otherOrigin}/echo`, expect.objectContaining({
        headers: { accept: 'application/json', 'x-other-key': OTHER_VALUE },
      }))
    })
  })

  describe('echo server', () => {
    const servers: Server[] = []
    const seen: { url: string; headers: IncomingMessage['headers']; method: string; body: string }[] = []
    let handle: (request: IncomingMessage, response: ServerResponse) => void

    beforeAll(async () => {
      async function listen(): Promise<string> {
        const server = createServer((request, response) => {
          let body = ''
          request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
          request.on('end', () => {
            seen.push({ url: request.url!, headers: request.headers, method: request.method!, body })
            handle(request, response)
          })
        })
        servers.push(server)
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', resolve)
        })
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      }
      origin = await listen()
      otherOrigin = await listen()
    })

    afterAll(async () => {
      for (const server of servers) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })

    beforeEach(() => {
      seen.length = 0
      handle = (request, response) => response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ headers: request.headers, url: request.url }))
    })

    it.each(['http.get', 'http.send'] as const)('injects header and query secrets for %s and redacts every echoed occurrence', async (op) => {
      const token = await openSession(PKG_WIDGET)
      // Setting values after opening a session must take effect on its first call.
      await put('apiKey', VALUE)
      await put('queryKey', QUERY_VALUE)
      const response = await request(op, token)
      expect(response.statusCode).toBe(200)
      expect(seen).toHaveLength(1)
      expect(seen[0]!.headers.authorization).toBe(`Bearer ${VALUE}`)
      expect(new URL(seen[0]!.url, origin).searchParams.get('apikey')).toBe(QUERY_VALUE)
      if (op === 'http.get') expect(seen[0]!.headers.accept).toBe('application/json')
      if (op === 'http.send') expect(seen[0]).toMatchObject({ method: 'POST', body: 'payload', headers: { 'content-type': 'text/plain' } })
      expect(response.json().data).toEqual({
        status: 200,
        contentType: 'application/json',
        body: expect.stringContaining('Bearer [REDACTED]'),
      })
      expect(JSON.parse(response.json().data.body).url).toBe('/echo?apikey=[REDACTED]')
      expect(response.body).not.toContain(VALUE)
      expect(response.body).not.toContain(QUERY_VALUE)
      expect(JSON.stringify(auditRows())).not.toContain(VALUE)
      expect(JSON.stringify(auditRows())).not.toContain(QUERY_VALUE)
    })

    it('sends no request when a bound secret is missing', async () => {
      const response = await request('http.get', await openSession(PKG_WIDGET))
      expect([response.statusCode, errorCode(response), response.json().error.message])
        .toEqual([502, 'UPSTREAM_ERROR', 'Secret «Ключ» is not set'])
      expect(seen).toHaveLength(0)
    })

    it('sends no bound secret to another approved origin', async () => {
      // The second origin has no binding; missing secrets on the first must not block it.
      const row = t.db.prepare('SELECT manifest FROM widget_package_versions WHERE package_id = ? AND version = ?')
        .get('dev.test.hello', '1.1.0') as { manifest: string }
      const manifest = JSON.parse(row.manifest)
      delete manifest.settings.properties.otherKey
      t.db.prepare('UPDATE widget_package_versions SET manifest = ? WHERE package_id = ? AND version = ?')
        .run(JSON.stringify(manifest), 'dev.test.hello', '1.1.0')
      await put('apiKey', VALUE)
      const response = await request('http.get', await openSession(PKG_WIDGET), `${otherOrigin}/echo`)
      expect(response.statusCode).toBe(200)
      expect(seen).toHaveLength(1)
      expect(seen[0]!.headers.authorization).toBeUndefined()
      expect(seen[0]!.headers['x-other-key']).toBeUndefined()
      expect(seen[0]!.url).toBe('/echo')
    })

    it('redacts all instance values longest first in the body and contentType, preserving status', async () => {
      await put('apiKey', VALUE)
      await put('queryKey', QUERY_VALUE)
      await put('otherKey', OTHER_VALUE)
      handle = (_request, response) => response.writeHead(409, { 'content-type': `text/plain; token=${OTHER_VALUE}; key=${VALUE}` })
        .end(`${OTHER_VALUE}|${VALUE}|${QUERY_VALUE}|${OTHER_VALUE}|${VALUE}`)
      const response = await request('http.get', await openSession(PKG_WIDGET))
      expect(response.statusCode).toBe(200)
      expect(response.json().data).toEqual({
        status: 409,
        contentType: 'text/plain; token=[REDACTED]; key=[REDACTED]',
        body: '[REDACTED]|[REDACTED]|[REDACTED]|[REDACTED]|[REDACTED]',
      })
    })

    it('keeps a null contentType and reads replacements and deletion on the same session', async () => {
      const token = await openSession(PKG_WIDGET)
      await put('apiKey', VALUE)
      await put('queryKey', QUERY_VALUE)
      handle = (_request, response) => response.writeHead(204).end()
      expect((await request('http.get', token)).json().data).toEqual({ status: 204, contentType: null, body: '' })
      await put('apiKey', OTHER_VALUE)
      expect((await request('http.get', token)).statusCode).toBe(200)
      expect(seen[1]!.headers.authorization).toBe(`Bearer ${OTHER_VALUE}`)
      expect((await call(t.app, { method: 'DELETE', url: `/api/v1/widgets/${PKG_WIDGET}/secrets/apiKey`, cookie, payload: {} })).statusCode).toBe(200)
      const missing = await request('http.get', token)
      expect([missing.statusCode, errorCode(missing)]).toEqual([502, 'UPSTREAM_ERROR'])
      expect(seen).toHaveLength(2)
    })

    it.each(['http.get', 'http.send'] as const)('still rejects widget-supplied authorization headers for %s', async (op) => {
      const token = await openSession(PKG_WIDGET)
      const response = await gateway(op, token, { url: `${origin}/echo`, headers: { authorization: 'Bearer forged' }, ...(op === 'http.send' ? { method: 'POST' } : {}) })
      expect([response.statusCode, errorCode(response)]).toEqual([400, 'INVALID_INPUT'])
      expect(seen).toHaveLength(0)
    })
  })
})
