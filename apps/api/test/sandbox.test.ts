import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sandboxDocument } from '../src/sandbox.ts'
import { call, HOST, installPackage, pair, testApp, widgetPackage, type TestApp } from './helpers.ts'

const BASE = `http://${HOST}`
const IMMUTABLE = 'public, max-age=31536000, immutable'

let t: TestApp
let cookie: string
let pkg: any
let hash: string

const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
  pkg = widgetPackage((p) => {
    p.manifest.entry = 'main.js'
    p.files = {
      'main.js': 'export default {}',
      'style.css': '.hello{}',
      'assets/clip.mp4': VIDEO,
      'assets/Big.MP4': VIDEO,
      'assets/evil.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'source/src/index.vue': '<template/>',
    }
  })
  hash = (await installPackage(t, cookie, pkg)).hash!
})

function versionPath(...parts: string[]) {
  return join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0', ...parts)
}

function addFile(path: string, content: string | Buffer) {
  mkdirSync(join(versionPath(path), '..'), { recursive: true })
  writeFileSync(versionPath(path), content)
}

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
    const pkgDir = `${BASE}/sandbox/packages/${hash}/`
    expect(response.body.startsWith(`<!doctype html>\n<html>\n<head>\n  <base href="${pkgDir}">\n  <meta charset="utf-8">\n`)).toBe(true)
    expect(response.body).toContain(`<script type="importmap">${importMap}</script>`)
    expect(response.body).toContain(`<link rel="stylesheet" href="${BASE}/sandbox/packages/${hash}/style.css">`)
    expect(response.body).toContain(`<script type="module" src="${BASE}/sandbox/runtime/sdk.js"></script>`)
    expect(response.body).toContain('<body><div id="app"></div></body>')
    const sha = createHash('sha256').update(importMap).digest('base64')
    expect(response.headers['content-security-policy']).toBe(
      [
        "default-src 'none'",
        `script-src ${BASE}/sandbox/runtime/ ${pkgDir} 'sha256-${sha}' 'wasm-unsafe-eval'`,
        `style-src ${pkgDir} 'unsafe-inline'`,
        `img-src ${pkgDir} data: blob:`,
        `media-src ${pkgDir} blob:`,
        `font-src ${pkgDir} data:`,
        `connect-src ${pkgDir} data: blob:`,
        'worker-src blob:',
        "frame-src 'none'",
        "object-src 'none'",
        `base-uri ${pkgDir}`,
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

describe('package files from disk', () => {
  beforeEach(() => {
    addFile(`${'a'.repeat(210)}.js`, 'export default 1')
  })

  const url = (path: string) => `/sandbox/packages/${hash}/${path}`

  it('serves an asset with its type, immutable cache, ranges and the sandbox CSP', async () => {
    const response = await call(t.app, { url: url('assets/clip.mp4'), origin: 'null' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('video/mp4')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.headers['content-length']).toBe('1000')
    expect(response.headers['cache-control']).toBe(IMMUTABLE)
    expect(response.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.rawPayload.equals(VIDEO)).toBe(true)
  })

  it('serves an upper-case extension with the lower-case type', async () => {
    expect((await call(t.app, { url: url('assets/Big.MP4') })).headers['content-type']).toBe('video/mp4')
  })

  it.each([
    ['bytes=0-99', 206, 'bytes 0-99/1000', 0, 100],
    ['bytes=900-', 206, 'bytes 900-999/1000', 900, 100],
    ['bytes=-10', 206, 'bytes 990-999/1000', 990, 10],
    ['bytes=990-5000', 206, 'bytes 990-999/1000', 990, 10],
  ])('answers %s with a partial response', async (range, status, contentRange, start, length) => {
    const response = await call(t.app, { url: url('assets/clip.mp4'), headers: { range } })
    expect(response.statusCode).toBe(status)
    expect(response.headers['content-range']).toBe(contentRange)
    expect(response.rawPayload.equals(VIDEO.subarray(start, start + length))).toBe(true)
  })

  it('answers 416 for an unsatisfiable range and 200 for a multi-range', async () => {
    const unsatisfiable = await call(t.app, { url: url('assets/clip.mp4'), headers: { range: 'bytes=1000-' } })
    expect(unsatisfiable.statusCode).toBe(416)
    expect(unsatisfiable.headers['content-range']).toBe('bytes */1000')
    expect((await call(t.app, { url: url('assets/clip.mp4'), headers: { range: 'bytes=0-1,5-6' } })).statusCode).toBe(200)
  })

  it('puts the sandbox CSP on an SVG so a direct visit runs no script', async () => {
    const response = await call(t.app, { url: url('assets/evil.svg') })
    expect(response.headers['content-type']).toBe('image/svg+xml')
    expect(response.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
  })

  it('serves a migrated v1 file name longer than 200 characters', async () => {
    expect((await call(t.app, { url: url(`${'a'.repeat(210)}.js`) })).statusCode).toBe(200)
  })

  it.each(['source/src/index.vue', 'widget.json', 'assets/missing.png', 'assets/..%2Fwidget.json', '..%2F..%2Fx.js', 'assets/x.exe'])(
    'answers 404 for %s',
    async (path) => {
      expect((await call(t.app, { url: url(path) })).statusCode).toBe(404)
    },
  )
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
