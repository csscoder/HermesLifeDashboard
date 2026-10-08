import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { packageHash } from '../src/widget-packages.ts'
import { call, errorCode, installPackage, pair, testApp, widgetPackage, type TestApp } from './helpers.ts'

const PACKAGES = '/api/v1/widget-packages'
const BOARD = `/api/v1/rooms/${SEED_ROOM_ID}/board`
const W = '00000000-0000-4000-8000-0000000000c1'

let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
})

afterEach(async () => {
  await t.close()
})

function inspect(payload: unknown) {
  return call(t.app, { method: 'POST', url: `${PACKAGES}/inspect`, cookie, payload })
}

function remove(id: string) {
  return call(t.app, { method: 'DELETE', url: `${PACKAGES}/${id}`, cookie, payload: {} })
}

async function list(): Promise<any[]> {
  const response = await call(t.app, { url: PACKAGES, cookie })
  expect(response.statusCode).toBe(200)
  return response.json().data
}

function count(table: string): unknown {
  return t.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()
}

describe('packageHash', () => {
  it('is a sha256 hex digest that ignores key order', () => {
    const pkg = widgetPackage()
    const reordered = { ...pkg, files: { 'style.css': pkg.files['style.css'], 'index.js': pkg.files['index.js'] } }
    expect(packageHash(pkg)).toMatch(/^[0-9a-f]{64}$/)
    expect(packageHash(reordered)).toBe(packageHash(pkg))
    expect(packageHash(widgetPackage((p) => { p.files['index.js'] = 'x' }))).not.toBe(packageHash(pkg))
  })
})

describe('POST /widget-packages/inspect', () => {
  it('summarizes a new package and writes nothing', async () => {
    const pkg = widgetPackage()
    const response = await inspect(pkg)
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ manifest: pkg.manifest, hash: packageHash(pkg), installed: false, newPermissions: ['state'] })
    expect(count('widget_packages')).toEqual({ n: 0 })
    expect(count('widget_grants')).toEqual({ n: 0 })
  })

  it('reports an installed version and only the permissions the package lacks', async () => {
    await installPackage(t, cookie)
    expect((await inspect(widgetPackage())).json().data).toMatchObject({ installed: true, newPermissions: [] })
    const next = widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'notifications']
    })
    expect((await inspect(next)).json().data).toMatchObject({ installed: false, newPermissions: ['notifications'] })
  })

  it('answers 400 with the validation message', async () => {
    const response = await inspect(widgetPackage((p) => { p.manifest.permissions = ['http'] }))
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(response.json().error.message).toMatch(/manifest\.permissions/)
  })

  it('answers 409 CONFLICT for an installed version with other content', async () => {
    await installPackage(t, cookie)
    const response = await inspect(widgetPackage((p) => { p.files['index.js'] = 'export default { name: "x" }' }))
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('CONFLICT')
  })
})

describe('POST /widget-packages', () => {
  it('stores the version, files, hash and grants', async () => {
    const pkg = widgetPackage()
    expect(await installPackage(t, cookie, pkg)).toEqual({ manifest: pkg.manifest, hash: packageHash(pkg), installed: true, newPermissions: [] })
    expect(await list()).toEqual([
      {
        id: 'dev.test.hello',
        title: 'Hello',
        author: 'test',
        versions: [{ version: '1.0.0', hash: packageHash(pkg), manifest: pkg.manifest }],
        grants: ['state'],
      },
    ])
    expect(t.db.prepare('SELECT files FROM widget_package_versions').get()).toEqual({ files: JSON.stringify(pkg.files) })
  })

  it('treats a repeated install of the same content as a no-op', async () => {
    await installPackage(t, cookie)
    await installPackage(t, cookie)
    expect(count('widget_package_versions')).toEqual({ n: 1 })
  })

  it('rejects the same version with other content and keeps the stored one', async () => {
    const first = widgetPackage()
    await installPackage(t, cookie, first)
    const response = await call(t.app, {
      method: 'POST',
      url: PACKAGES,
      cookie,
      payload: widgetPackage((p) => { p.files['index.js'] = 'export default { name: "x" }' }),
    })
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('CONFLICT')
    expect((await list())[0].versions).toEqual([{ version: '1.0.0', hash: packageHash(first), manifest: first.manifest }])
  })

  it('lists versions newest first and adds new permissions to the package grants', async () => {
    await installPackage(t, cookie)
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.10.0'
      p.manifest.permissions = ['notifications']
    }))
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.9.0'
    }))
    const [pkg] = await list()
    expect(pkg.versions.map((item: { version: string }) => item.version)).toEqual(['1.10.0', '1.9.0', '1.0.0'])
    expect(pkg.grants).toEqual(['notifications', 'state'])
  })

  it('installs a package whose entry is main.js', async () => {
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.entry = 'main.js'
      p.files = { 'main.js': 'export default {}', 'style.css': '' }
    }))
    expect((await list())[0].versions[0].manifest.entry).toBe('main.js')
  })

  it('rejects a body over 1 MB and stores nothing', async () => {
    const response = await call(t.app, {
      method: 'POST',
      url: PACKAGES,
      cookie,
      payload: widgetPackage((p) => { p.files['index.js'] = 'x'.repeat(1_100_000) }),
    })
    expect(response.statusCode).toBe(400)
    expect(await list()).toEqual([])
  })

  it('keeps the package after an API restart', async () => {
    await installPackage(t, cookie)
    const restarted = await testApp(t.db)
    try {
      const response = await call(restarted.app, { url: PACKAGES, cookie })
      expect(response.json().data.map((item: { id: string }) => item.id)).toEqual(['dev.test.hello'])
    } finally {
      await restarted.close()
    }
  })

  it('requires a session', async () => {
    const response = await call(t.app, { method: 'POST', url: PACKAGES, payload: widgetPackage() })
    expect(response.statusCode).toBe(401)
  })
})

describe('DELETE /widget-packages/:id', () => {
  it('deletes an unplaced package with its versions and grants', async () => {
    await installPackage(t, cookie)
    const response = await remove('dev.test.hello')
    expect(response.statusCode).toBe(200)
    expect(await list()).toEqual([])
    expect(count('widget_package_versions')).toEqual({ n: 0 })
    expect(count('widget_grants')).toEqual({ n: 0 })
  })

  it('answers 409 PACKAGE_IN_USE while a widget of the package is placed', async () => {
    await installPackage(t, cookie)
    const screen = {
      id: SEED_SCREEN_ID,
      instances: [{ id: W, source: { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }, configVersion: 1, config: {} }],
      layout: [{ instanceId: W, x: 0, y: 0, w: 3, h: 3 }],
    }
    const saved = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: 1, screens: [screen] } })
    expect(saved.statusCode).toBe(200)
    const response = await remove('dev.test.hello')
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('PACKAGE_IN_USE')
    expect(await list()).toHaveLength(1)
  })

  it('answers 404 for an unknown package', async () => {
    expect((await remove('dev.test.none')).statusCode).toBe(404)
  })
})
