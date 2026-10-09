import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { needsConfirmation } from '../src/widget-gateway.ts'
import { call, DAY, errorCode, HOUR, installPackage, pair, T0, testApp, widgetPackage, type TestApp } from './helpers.ts'

const BOARD = `/api/v1/rooms/${SEED_ROOM_ID}/board`
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

  it('evicts the least recently used session beyond 200', async () => {
    const first = await openSession(PKG_WIDGET)
    const second = await openSession(PKG_WIDGET)
    expect((await gateway('state.get', first)).statusCode).toBe(200)
    for (let index = 0; index < 199; index++) await openSession(PKG_WIDGET)
    expect((await gateway('state.get', first)).statusCode).toBe(200)
    expect(errorCode(await gateway('state.get', second))).toBe('SESSION_EXPIRED')
  })

  it('answers 404 UNKNOWN_OP, 403 PERMISSION_DENIED and 400 INVALID_INPUT and audits each', async () => {
    const token = await openSession(PKG_WIDGET)
    const builtin = await openSession(BUILTIN_WIDGET)
    const unknown = await gateway('http.get', token)
    expect([unknown.statusCode, errorCode(unknown)]).toEqual([404, 'UNKNOWN_OP'])
    const denied = await gateway('notifications.send', token, { title: 'x', body: '' })
    expect([denied.statusCode, errorCode(denied)]).toEqual([403, 'PERMISSION_DENIED'])
    const builtinDenied = await gateway('state.get', builtin)
    expect([builtinDenied.statusCode, errorCode(builtinDenied)]).toEqual([403, 'PERMISSION_DENIED'])
    const invalid = await gateway('state.set', token, { data: 1 })
    expect([invalid.statusCode, errorCode(invalid)]).toEqual([400, 'INVALID_INPUT'])
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    expect(auditRows()).toEqual([
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'http.get', outcome: 'UNKNOWN_OP' },
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
    const restarted = await testApp(t.db)
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
    const restarted = await testApp(t.db)
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
