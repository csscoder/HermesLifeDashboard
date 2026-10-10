import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, errorCode, folderFiles, installPackage, pair, putFile, testApp, uploadPackage, widgetPackage, type TestApp } from './helpers.ts'

// Holds the next `versionHash` open so a test can act while install is in progress.
const gate = vi.hoisted(() => {
  const state: { onEnter: (() => void) | null; released: Promise<void> | null } = { onEnter: null, released: null }
  return {
    state,
    hold() {
      let release!: () => void
      state.released = new Promise<void>((resolve) => { release = resolve })
      const entered = new Promise<void>((resolve) => { state.onEnter = resolve })
      return { entered, release }
    },
  }
})

vi.mock('../src/userwidgets.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/userwidgets.ts')>()
  return {
    ...actual,
    async versionHash(dir: string) {
      const { onEnter, released } = gate.state
      if (onEnter && released) {
        gate.state.onEnter = null
        gate.state.released = null
        onEnter()
        await released
      }
      return actual.versionHash(dir)
    },
  }
})

const UPLOADS = '/api/v1/widget-uploads'
let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
})

afterEach(async () => {
  await t.close()
})

const staging = () => join(t.dataDir, 'userwidgets', '.staging')
const versionPath = (...parts: string[]) => join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0', ...parts)

function create(manifest: unknown, files: { path: string; size: number }[]) {
  return call(t.app, { method: 'POST', url: UPLOADS, cookie, payload: { manifest, files } })
}

function listOf(pkg = widgetPackage()) {
  return Object.entries(folderFiles(pkg)).map(([path, body]) => ({ path, size: Buffer.byteLength(body) }))
}

function install(uploadId: string) {
  return call(t.app, { method: 'POST', url: `${UPLOADS}/${uploadId}/install`, cookie, payload: {} })
}

describe('POST /widget-uploads', () => {
  it('requires a session', async () => {
    const response = await call(t.app, { method: 'POST', url: UPLOADS, payload: { manifest: widgetPackage().manifest, files: [] } })
    expect(response.statusCode).toBe(401)
  })

  it('answers an upload id and an inspection without a hash', async () => {
    const pkg = widgetPackage()
    const response = await create(pkg.manifest, listOf(pkg))
    expect(response.statusCode).toBe(200)
    const { uploadId, inspection } = response.json().data
    expect(uploadId).toMatch(/^[0-9a-f]{32}$/)
    const { format: _format, ...manifest } = pkg.manifest
    expect(inspection).toEqual({ manifest, hash: null, installed: false, newPermissions: ['state'], sizes: { code: 25, assets: 0, source: 0 } })
    expect(existsSync(join(staging(), uploadId))).toBe(true)
  })

  it.each([
    ['a ../ path', (f: any[]) => f.push({ path: '../x.js', size: 1 }), /not an allowed path/],
    ['code over 10 MB', (f: any[]) => { f[1].size = 10_485_760 }, /larger than 10 MB/],
  ])('rejects %s with 400', async (_name, change, message) => {
    const files = listOf()
    change(files)
    const response = await create(widgetPackage().manifest, files)
    expect([response.statusCode, errorCode(response)]).toEqual([400, 'VALIDATION_ERROR'])
    expect(response.json().error.message).toMatch(message)
  })

  it('keeps at most three sessions and deletes the oldest staging folder', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push((await create(widgetPackage().manifest, listOf())).json().data.uploadId)
    expect(readdirSync(staging()).sort()).toEqual(ids.slice(1).sort())
    expect(errorCode(await putFile(t, cookie, ids[0]!, 'index.js', 'export default {}'))).toBe('NOT_FOUND')
  })

  it('expires a session idle for 30 minutes', async () => {
    const { uploadId } = (await create(widgetPackage().manifest, listOf())).json().data
    t.clock.now += 30 * 60_000 + 1
    expect(errorCode(await putFile(t, cookie, uploadId, 'index.js', 'export default {}'))).toBe('NOT_FOUND')
    expect(existsSync(join(staging(), uploadId))).toBe(false)
  })
})

describe('PUT /widget-uploads/:id/files/*', () => {
  async function session() {
    return (await create(widgetPackage().manifest, listOf())).json().data.uploadId as string
  }

  it('requires application/octet-stream; JSON is refused here and octet-stream elsewhere', async () => {
    const uploadId = await session()
    const json = await call(t.app, { method: 'PUT', url: `${UPLOADS}/${uploadId}/files/index.js`, cookie, payload: { a: 1 } })
    expect([json.statusCode, errorCode(json)]).toEqual([403, 'FORBIDDEN'])
    const elsewhere = await call(t.app, { method: 'POST', url: UPLOADS, cookie, contentType: 'application/octet-stream', payload: 'x' })
    expect([elsewhere.statusCode, errorCode(elsewhere)]).toEqual([403, 'FORBIDDEN'])
  })

  it('stores a declared file and overwrites it on a repeat', async () => {
    const uploadId = await session()
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default 1')).statusCode).toBe(400)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default {}')).statusCode).toBe(200)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default {}')).statusCode).toBe(200)
    expect(readFileSync(join(staging(), uploadId, 'index.js'), 'utf8')).toBe('export default {}')
  })

  it('stores a zero-byte file', async () => {
    const pkg = widgetPackage((p) => { p.files['style.css'] = '' })
    const { uploadId } = await uploadPackage(t, cookie, pkg)
    expect(readFileSync(join(staging(), uploadId, 'style.css'), 'utf8')).toBe('')
  })

  it('rejects an undeclared path and a body larger than declared, deleting the partial file', async () => {
    const uploadId = await session()
    expect(errorCode(await putFile(t, cookie, uploadId, 'other.js', 'x'))).toBe('VALIDATION_ERROR')
    const big = await putFile(t, cookie, uploadId, 'index.js', 'x'.repeat(5000))
    expect([big.statusCode, errorCode(big)]).toEqual([400, 'VALIDATION_ERROR'])
    expect(existsSync(join(staging(), uploadId, 'index.js'))).toBe(false)
  })

  it('keeps the session and the other files after a failed PUT', async () => {
    const uploadId = await session()
    expect((await putFile(t, cookie, uploadId, 'style.css', '.hello{}')).statusCode).toBe(200)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'short')).statusCode).toBe(400)
    expect(existsSync(join(staging(), uploadId, 'style.css'))).toBe(true)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default {}')).statusCode).toBe(200)
  })

  it('answers NOT_FOUND after an API restart', async () => {
    const uploadId = await session()
    const restarted = await testApp(t)
    try {
      expect(errorCode(await putFile(restarted, cookie, uploadId, 'index.js', 'export default {}'))).toBe('NOT_FOUND')
      expect(existsSync(join(staging(), uploadId))).toBe(false)
    } finally {
      await restarted.close()
    }
  })
})

describe('POST /widget-uploads/:id/install', () => {
  it('moves the folder into userwidgets, writes rows and ends the session', async () => {
    const inspection = await installPackage(t, cookie, widgetPackage((p) => {
      p.files['assets/bg.mp4'] = Buffer.from([1, 2, 3])
      p.files['source/src/index.vue'] = '<template/>'
    }))
    expect(inspection).toMatchObject({ installed: true, newPermissions: [], sizes: { code: 25, assets: 3, source: 11 } })
    expect(inspection.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(versionPath('assets', 'bg.mp4'))).toEqual(Buffer.from([1, 2, 3]))
    expect(readdirSync(staging())).toEqual([])
    expect(t.db.prepare('SELECT hash FROM widget_package_versions').get()).toEqual({ hash: inspection.hash })
  })

  it('treats the same folder installed twice as installed and keeps one version', async () => {
    const first = await installPackage(t, cookie)
    const second = await installPackage(t, cookie)
    expect(second).toMatchObject({ installed: true, hash: first.hash })
    expect(t.db.prepare('SELECT count(*) AS n FROM widget_package_versions').get()).toEqual({ n: 1 })
    expect(readdirSync(staging())).toEqual([])
  })

  it('answers CONFLICT for the same version with other content', async () => {
    await installPackage(t, cookie)
    const { uploadId } = await uploadPackage(t, cookie, widgetPackage((p) => { p.files['index.js'] = 'export default {x:1}' }))
    const response = await install(uploadId)
    expect([response.statusCode, errorCode(response)]).toEqual([409, 'CONFLICT'])
    expect(readFileSync(versionPath('index.js'), 'utf8')).toBe('export default {}')
  })

  it('rejects a missing file and ends the session', async () => {
    const pkg = widgetPackage()
    const { uploadId } = (await create(pkg.manifest, listOf(pkg))).json().data
    await putFile(t, cookie, uploadId, 'widget.json', JSON.stringify(pkg.manifest))
    await putFile(t, cookie, uploadId, 'index.js', 'export default {}')
    const response = await install(uploadId)
    expect([response.statusCode, errorCode(response)]).toEqual([400, 'VALIDATION_ERROR'])
    expect(response.json().error.message).toMatch(/"style\.css" is missing/)
    expect(existsSync(join(staging(), uploadId))).toBe(false)
  })

  it('rejects a widget.json that differs from the declared manifest', async () => {
    const pkg = widgetPackage()
    const other = JSON.stringify({ ...pkg.manifest, title: 'Other' })
    const { uploadId } = (await create(pkg.manifest, listOf(pkg).map((f) => (f.path === 'widget.json' ? { ...f, size: Buffer.byteLength(other) } : f)))).json().data
    await putFile(t, cookie, uploadId, 'widget.json', other)
    await putFile(t, cookie, uploadId, 'index.js', 'export default {}')
    await putFile(t, cookie, uploadId, 'style.css', '.hello{}')
    const response = await install(uploadId)
    expect(response.json().error.message).toMatch(/widget\.json differs/)
  })

  it('moves an existing folder without a row to .orphaned before installing', async () => {
    const { uploadId } = await uploadPackage(t, cookie)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(versionPath('source'), { recursive: true })
    writeFileSync(versionPath('source', 'old.txt'), 'old')
    expect((await install(uploadId)).statusCode).toBe(200)
    expect(readdirSync(join(t.dataDir, 'userwidgets', '.orphaned'))).toHaveLength(1)
  })
})

describe('busy session', () => {
  it('rejects a PUT that arrives while install hashes the files', async () => {
    const { uploadId } = await uploadPackage(t, cookie)
    const hold = gate.hold()
    const installing = install(uploadId)
    await hold.entered
    const put = await putFile(t, cookie, uploadId, 'index.js', 'export default {}')
    expect([put.statusCode, errorCode(put)]).toEqual([409, 'CONFLICT'])
    hold.release()
    expect((await installing).statusCode).toBe(200)
  })
})

describe('a PUT in flight', () => {
  it('keeps the session from install, DELETE, eviction and expiry until the body ends', async () => {
    const pkg = widgetPackage()
    const { uploadId } = (await create(pkg.manifest, listOf(pkg))).json().data
    for (const path of ['widget.json', 'style.css']) await putFile(t, cookie, uploadId, path, folderFiles(pkg)[path]!)
    const body = new PassThrough()
    body.write('export ')
    const putting = call(t.app, { method: 'PUT', url: `${UPLOADS}/${uploadId}/files/index.js`, cookie, contentType: 'application/octet-stream', payload: body as any })
    // The file exists once the handler has counted the write and opened the stream.
    for (let i = 0; i < 200 && !existsSync(join(staging(), uploadId, 'index.js')); i++) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(existsSync(join(staging(), uploadId, 'index.js'))).toBe(true)

    const early = await install(uploadId)
    expect([early.statusCode, errorCode(early)]).toEqual([409, 'CONFLICT'])
    await call(t.app, { method: 'DELETE', url: `${UPLOADS}/${uploadId}`, cookie, payload: {} })
    t.clock.now += 30 * 60_000 + 1
    // A new session sweeps expired ones and evicts the oldest at the limit; neither may take this one.
    for (let i = 0; i < 4; i++) await create(pkg.manifest, listOf(pkg))
    expect(existsSync(join(staging(), uploadId))).toBe(true)

    body.end('default {}')
    expect((await putting).statusCode).toBe(200)
    expect((await install(uploadId)).statusCode).toBe(200)
    expect(readFileSync(versionPath('index.js'), 'utf8')).toBe('export default {}')
  })
})

describe('DELETE /widget-uploads/:id', () => {
  it('ends the session and deletes its staging folder', async () => {
    const { uploadId } = await uploadPackage(t, cookie)
    expect((await call(t.app, { method: 'DELETE', url: `${UPLOADS}/${uploadId}`, cookie, payload: {} })).statusCode).toBe(200)
    expect(existsSync(join(staging(), uploadId))).toBe(false)
    expect(errorCode(await install(uploadId))).toBe('NOT_FOUND')
  })
})
