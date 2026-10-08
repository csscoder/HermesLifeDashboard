import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sandboxDocument } from '../src/sandbox.ts'
import { call, HOST, installPackage, pair, testApp, widgetPackage, type TestApp } from './helpers.ts'

const BASE = `http://${HOST}`
const IMMUTABLE = 'public, max-age=31536000, immutable'

let t: TestApp
let cookie: string
let pkg: any
let hash: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
  pkg = widgetPackage((p) => {
    p.manifest.entry = 'main.js'
    p.files = { 'main.js': 'export default {}', 'style.css': '.hello{}' }
  })
  hash = (await installPackage(t, cookie, pkg)).hash
})

afterEach(async () => {
  await t.close()
})

describe('GET /sandbox/packages/:hash/', () => {
  it('serves the document with the import map, stylesheet, bootstrap and CSP', async () => {
    const response = await call(t.app, { url: `/sandbox/packages/${hash}/` })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    const importMap = JSON.stringify({
      imports: {
        vue: `${BASE}/sandbox/runtime/vue.js`,
        '@lifedashboard/widget-sdk': `${BASE}/sandbox/runtime/sdk.js`,
        '@lifedashboard/widget-entry': `${BASE}/sandbox/packages/${hash}/main.js`,
      },
    })
    expect(response.body).toContain(`<script type="importmap">${importMap}</script>`)
    expect(response.body).toContain(`<link rel="stylesheet" href="${BASE}/sandbox/packages/${hash}/style.css">`)
    expect(response.body).toContain(`<script type="module" src="${BASE}/sandbox/runtime/sdk.js"></script>`)
    expect(response.body).toContain('<body><div id="app"></div></body>')
    const sha = createHash('sha256').update(importMap).digest('base64')
    expect(response.headers['content-security-policy']).toBe(
      [
        "default-src 'none'",
        `script-src ${BASE}/sandbox/runtime/ ${BASE}/sandbox/packages/${hash}/ 'sha256-${sha}'`,
        `style-src ${BASE}/sandbox/packages/${hash}/ 'unsafe-inline'`,
        'img-src data:',
        "connect-src 'none'",
        "font-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    )
    expect(response.headers['access-control-allow-origin']).toBe('*')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cache-control']).toBe(IMMUTABLE)
  })

  it('contains no instance or user data', async () => {
    const response = await call(t.app, { url: `/sandbox/packages/${hash}/` })
    expect(response.body).toBe(sandboxDocument(BASE, hash, pkg.manifest).html)
    expect(response.body).not.toContain(cookie.split('=')[1]!)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('has no stylesheet link for a package without styles', async () => {
    const plain = widgetPackage((p) => {
      p.manifest.id = 'dev.test.plain'
      p.manifest.styles = []
      p.files = { 'index.js': 'export default {}' }
    })
    const { hash: plainHash } = await installPackage(t, cookie, plain)
    const response = await call(t.app, { url: `/sandbox/packages/${plainHash}/` })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('<link')
  })

  it('accepts Origin: null and rejects a foreign origin or host', async () => {
    const url = `/sandbox/packages/${hash}/`
    expect((await call(t.app, { url, origin: 'null' })).statusCode).toBe(200)
    const foreign = await call(t.app, { url, origin: 'http://evil.test' })
    expect(foreign.statusCode).toBe(403)
    expect(foreign.headers['access-control-allow-origin']).toBe('*')
    expect((await call(t.app, { url, host: 'evil.test:3001' })).statusCode).toBe(403)
  })

  it('answers 404 for an unknown or malformed hash', async () => {
    expect((await call(t.app, { url: `/sandbox/packages/${'f'.repeat(64)}/` })).statusCode).toBe(404)
    expect((await call(t.app, { url: '/sandbox/packages/abc/' })).statusCode).toBe(404)
  })
})

describe('GET /sandbox/packages/:hash/:file', () => {
  it('serves package files with their content type', async () => {
    const script = await call(t.app, { url: `/sandbox/packages/${hash}/main.js`, origin: 'null' })
    expect(script.statusCode).toBe(200)
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(script.headers['cache-control']).toBe(IMMUTABLE)
    expect(script.headers['access-control-allow-origin']).toBe('*')
    expect(script.body).toBe('export default {}')
    const style = await call(t.app, { url: `/sandbox/packages/${hash}/style.css` })
    expect(style.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(style.body).toBe('.hello{}')
  })

  it('answers 404 for a file outside the package', async () => {
    expect((await call(t.app, { url: `/sandbox/packages/${hash}/other.js` })).statusCode).toBe(404)
    expect((await call(t.app, { url: `/sandbox/packages/${hash}/toString` })).statusCode).toBe(404)
  })
})

describe('GET /sandbox/runtime/:file', () => {
  it('serves the Vue runtime from the API dependency', async () => {
    const response = await call(t.app, { url: '/sandbox/runtime/vue.js', origin: 'null' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.body).toContain('createApp')
  })

  it('answers 404 for an unknown runtime file', async () => {
    expect((await call(t.app, { url: '/sandbox/runtime/evil.js' })).statusCode).toBe(404)
    expect((await call(t.app, { url: '/sandbox/runtime/constructor' })).statusCode).toBe(404)
  })
})
