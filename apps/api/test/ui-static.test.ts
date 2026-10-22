import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { call, errorCode, pair, testApp, type TestApp } from './helpers.ts'

const INDEX = '<!doctype html><title>LifeDashboard</title>'
const IMMUTABLE = 'public, max-age=31536000, immutable'

let root: string
let t: TestApp

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ld-ui-'))
  const uiDir = join(root, 'public')
  mkdirSync(join(uiDir, '_nuxt'), { recursive: true })
  writeFileSync(join(uiDir, 'index.html'), INDEX)
  writeFileSync(join(uiDir, '_nuxt', 'entry.abc123.js'), 'console.log(1)')
  writeFileSync(join(uiDir, 'favicon.ico'), 'ico')
  writeFileSync(join(root, 'secret.txt'), 'secret')
  t = await testApp(undefined, { uiDir })
})

afterEach(async () => {
  await t.close()
  rmSync(root, { recursive: true, force: true })
})

describe('static UI', () => {
  it('serves index.html at / without caching', async () => {
    const response = await call(t.app, { url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.body).toBe(INDEX)
  })

  it('serves a hashed asset as immutable JavaScript', async () => {
    const response = await call(t.app, { url: '/_nuxt/entry.abc123.js' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(response.headers['cache-control']).toBe(IMMUTABLE)
    expect(response.body).toBe('console.log(1)')
  })

  it('serves favicon.ico with its type', async () => {
    const response = await call(t.app, { url: '/favicon.ico' })
    expect([response.statusCode, response.headers['content-type']]).toEqual([200, 'image/x-icon'])
  })

  it('falls back to index.html for an extensionless SPA path', async () => {
    const response = await call(t.app, { url: '/spaces/main/screen' })
    expect([response.statusCode, response.body]).toEqual([200, INDEX])
  })

  it('answers 404 for a missing file with an extension', async () => {
    const response = await call(t.app, { url: '/_nuxt/old.js' })
    expect([response.statusCode, errorCode(response)]).toEqual([404, 'NOT_FOUND'])
  })

  it.each(['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/_nuxt/..%2f..%2fsecret.txt'])(
    'never serves a file outside the UI directory: %s',
    async (url) => {
      const response = await call(t.app, { url })
      expect(response.statusCode).toBe(404)
      expect(response.body).not.toContain('secret')
    },
  )

  it('does not shadow API, sandbox or health routes', async () => {
    const unauthorized = await call(t.app, { url: '/api/v1/probe' })
    expect([unauthorized.statusCode, errorCode(unauthorized)]).toEqual([401, 'UNAUTHORIZED'])
    const cookie = await pair(t)
    const unknownApi = await call(t.app, { url: '/api/v1/probe', cookie })
    expect([unknownApi.statusCode, errorCode(unknownApi)]).toEqual([404, 'NOT_FOUND'])
    const unknownSandbox = await call(t.app, { url: '/sandbox/unknown' })
    expect([unknownSandbox.statusCode, errorCode(unknownSandbox)]).toEqual([404, 'NOT_FOUND'])
    expect((await call(t.app, { url: '/health' })).json()).toEqual({ status: 'ok' })
  })

  it('rejects a foreign Host', async () => {
    const response = await call(t.app, { url: '/', host: 'evil.test:3001' })
    expect([response.statusCode, errorCode(response)]).toEqual([403, 'FORBIDDEN'])
  })
})

describe('without uiDir', () => {
  it('does not serve the UI', async () => {
    const plain = await testApp()
    try {
      const response = await call(plain.app, { url: '/' })
      expect([response.statusCode, errorCode(response)]).toEqual([404, 'NOT_FOUND'])
    } finally {
      await plain.close()
    }
  })
})
