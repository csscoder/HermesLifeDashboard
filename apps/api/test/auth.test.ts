import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY, HOUR, ORIGIN, T0, call, errorCode, pair, sessionCookie, testApp, type TestApp } from './helpers.ts'

// Queued values make pairing codes deterministic; an empty queue uses the real generator.
const nextCodes = vi.hoisted(() => [] as number[])
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomInt: (min: number, max: number) => nextCodes.shift() ?? actual.randomInt(min, max) }
})

// Any authenticated /api path: unknown routes answer 404 after the session check, 401 before it.
const PROBE = '/api/v1/probe'
const PAIR = '/api/v1/auth/pair'
const PAIR_CODE = '/api/v1/auth/pair-code'

let t: TestApp

beforeEach(async () => {
  t = await testApp()
})

afterEach(async () => {
  await t.close()
  nextCodes.length = 0
})

function storedExpiry(cookie: string): string {
  const hash = createHash('sha256').update(cookie.split('=')[1]!).digest('hex')
  return (t.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash) as { expires_at: string }).expires_at
}

describe('request checks', () => {
  it('rejects a foreign Host', async () => {
    const response = await call(t.app, { url: PROBE, host: 'evil.test:3001' })
    expect(response.statusCode).toBe(403)
    expect(errorCode(response)).toBe('FORBIDDEN')
  })

  it('accepts localhost with the API port as Host', async () => {
    const response = await call(t.app, { url: PROBE, host: 'localhost:3001' })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a foreign Origin on GET', async () => {
    const response = await call(t.app, { url: PROBE, origin: 'http://evil.test' })
    expect(response.statusCode).toBe(403)
  })

  it('rejects a mutation without Origin', async () => {
    const response = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] }, origin: null })
    expect(response.statusCode).toBe(403)
  })

  it('rejects a mutation without a JSON content type', async () => {
    const response = await call(t.app, {
      method: 'POST',
      url: PAIR,
      payload: `code=${t.codes[0]}`,
      contentType: 'application/x-www-form-urlencoded',
    })
    expect(response.statusCode).toBe(403)
  })

  it('leaves /health public', async () => {
    const response = await call(t.app, { url: '/health', host: 'evil.test' })
    expect(response.statusCode).toBe(200)
  })

  it('answers 401 without a session', async () => {
    const response = await call(t.app, { url: PROBE })
    expect(response.statusCode).toBe(401)
    expect(errorCode(response)).toBe('UNAUTHORIZED')
  })
})

describe('pairing', () => {
  it('prints a 6-digit code on start', () => {
    expect(t.codes).toHaveLength(1)
    expect(t.codes[0]).toMatch(/^\d{6}$/)
  })

  it('sets the session cookie for the right code and accepts it afterwards', async () => {
    const response = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toBeNull()
    expect(response.headers['set-cookie']).toMatch(
      /^ld_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/api; Max-Age=2592000$/,
    )
    const cookie = sessionCookie(response)!
    expect((await call(t.app, { url: PROBE, cookie })).statusCode).toBe(404)
  })

  it('keeps leading zeros and accepts the code with surrounding spaces', async () => {
    nextCodes.push(123)
    const fresh = await testApp()
    expect(fresh.codes).toEqual(['000123'])
    const response = await call(fresh.app, { method: 'POST', url: PAIR, payload: { code: ' 000123 ' } })
    expect(response.statusCode).toBe(200)
    await fresh.close()
  })

  it('accepts a code only once', async () => {
    await pair(t)
    const again = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })
    expect(again.statusCode).toBe(401)
  })

  it('rejects an expired code', async () => {
    t.clock.now += 10 * 60_000
    const response = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })
    expect(response.statusCode).toBe(401)
  })

  it('burns the code on the fifth wrong attempt', async () => {
    const wrong = t.codes[0] === '000000' ? '000001' : '000000'
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: wrong } })).statusCode).toBe(401)
    }
    expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })).statusCode).toBe(401)
  })

  it('issues a new code that replaces the old one, at most once per 10 seconds', async () => {
    nextCodes.push(111111, 222222)
    const first = await call(t.app, { method: 'POST', url: PAIR_CODE, payload: {} })
    expect(first.statusCode).toBe(200)
    expect(first.body).not.toContain('111111')
    expect(t.codes.slice(1)).toEqual(['111111'])

    const tooSoon = await call(t.app, { method: 'POST', url: PAIR_CODE, payload: {} })
    expect(tooSoon.statusCode).toBe(429)
    expect(tooSoon.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true })

    t.clock.now += 10_000
    expect((await call(t.app, { method: 'POST', url: PAIR_CODE, payload: {} })).statusCode).toBe(200)
    expect(t.codes.slice(1)).toEqual(['111111', '222222'])

    expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: '111111' } })).statusCode).toBe(401)
    expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: '222222' } })).statusCode).toBe(200)
  })
})

describe('sessions', () => {
  it('does not renew within a day of the last renewal', async () => {
    const cookie = await pair(t)
    t.clock.now += 12 * HOUR
    const response = await call(t.app, { url: PROBE, cookie })
    expect(response.statusCode).toBe(404)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(storedExpiry(cookie)).toBe(new Date(T0 + 30 * DAY).toISOString())
  })

  it('renews exactly one day after pairing, and the session then lasts 29 more days', async () => {
    const cookie = await pair(t)
    t.clock.now += DAY
    const renewed = await call(t.app, { url: PROBE, cookie })
    expect(renewed.statusCode).toBe(404)
    expect(sessionCookie(renewed)).toBe(cookie)
    expect(renewed.headers['set-cookie']).toMatch(/Max-Age=2592000$/)

    t.clock.now += 29 * DAY
    expect((await call(t.app, { url: PROBE, cookie })).statusCode).toBe(404)
  })

  it('keeps a session used at +12 h and +29 d 23 h', async () => {
    const cookie = await pair(t)
    t.clock.now += 12 * HOUR
    await call(t.app, { url: PROBE, cookie })
    t.clock.now += 29 * DAY + 11 * HOUR
    const response = await call(t.app, { url: PROBE, cookie })
    expect(response.statusCode).toBe(404)
    expect(sessionCookie(response)).toBe(cookie)
  })

  it('expires a session used at +12 h when the next request comes at +30 d 1 h', async () => {
    const cookie = await pair(t)
    t.clock.now += 12 * HOUR
    await call(t.app, { url: PROBE, cookie })
    t.clock.now += 29 * DAY + 13 * HOUR
    const response = await call(t.app, { url: PROBE, cookie })
    expect(response.statusCode).toBe(401)
    expect(t.db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it('expires exactly 30 days after the last renewal', async () => {
    const cookie = await pair(t)
    t.clock.now += 30 * DAY
    expect((await call(t.app, { url: PROBE, cookie })).statusCode).toBe(401)
  })

  it('rejects an unknown token', async () => {
    const response = await call(t.app, { url: PROBE, cookie: 'ld_session=unknown' })
    expect(response.statusCode).toBe(401)
  })

  it('survives a rebuilt app on the same database', async () => {
    const cookie = await pair(t)
    const restarted = await testApp(t)
    expect((await call(restarted.app, { url: PROBE, cookie })).statusCode).toBe(404)
    await restarted.close()
  })

  it('uses only the configured Origin', async () => {
    const cookie = await pair(t)
    expect((await call(t.app, { url: PROBE, cookie, origin: ORIGIN })).statusCode).toBe(404)
  })
})
