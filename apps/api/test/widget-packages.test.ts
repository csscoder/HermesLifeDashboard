import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { call, errorCode, installPackage, pair, testApp, uploadPackage, widgetPackage, type TestApp } from './helpers.ts'

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

function setMode(permission: string, mode: unknown, id = 'dev.test.hello') {
  return call(t.app, { method: 'PUT', url: `${PACKAGES}/${id}/grants/${permission}`, cookie, payload: { mode } })
}

const withNotifications = () => widgetPackage((p) => { p.manifest.permissions = ['state', 'notifications'] })

describe('installed versions', () => {
  it('stores the version, files, hash and grants', async () => {
    const pkg = widgetPackage()
    const inspection = await installPackage(t, cookie, pkg)
    const { format: _format, ...manifest } = pkg.manifest
    expect(await list()).toEqual([
      {
        id: 'dev.test.hello',
        title: 'Hello',
        author: 'test',
        versions: [{ version: '1.0.0', hash: inspection.hash, manifest, paths: { source: null, assets: null } }],
        grants: [{ permission: 'state', mode: 'allow' }],
      },
    ])
    const dir = join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0')
    expect(readFileSync(join(dir, 'index.js'), 'utf8')).toBe(pkg.files['index.js'])
    expect(JSON.parse(readFileSync(join(dir, 'widget.json'), 'utf8'))).toEqual(pkg.manifest)
  })

  it('lists the source and assets paths of a version', async () => {
    await installPackage(t, cookie, widgetPackage((p) => {
      p.files['assets/a.png'] = 'x'
      p.files['source/src/index.vue'] = '<template/>'
    }))
    const dir = join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0')
    expect((await list())[0].versions[0].paths).toEqual({ source: join(dir, 'source'), assets: join(dir, 'assets') })
  })

  it('treats a repeated install of the same content as a no-op', async () => {
    await installPackage(t, cookie)
    await installPackage(t, cookie)
    expect(count('widget_package_versions')).toEqual({ n: 1 })
  })

  it('rejects the same version with other content and keeps the stored one', async () => {
    const first = await installPackage(t, cookie)
    const { uploadId } = await uploadPackage(t, cookie, widgetPackage((p) => { p.files['index.js'] = 'export default { name: "x" }' }))
    const response = await call(t.app, { method: 'POST', url: `/api/v1/widget-uploads/${uploadId}/install`, cookie, payload: {} })
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('CONFLICT')
    expect((await list())[0].versions.map((v: { hash: string }) => v.hash)).toEqual([first.hash])
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
    // A new confirmable permission asks, also when the package is an update.
    expect(pkg.grants).toEqual([{ permission: 'notifications', mode: 'ask' }, { permission: 'state', mode: 'allow' }])
  })

  it('installs a package whose entry is main.js', async () => {
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.entry = 'main.js'
      p.files = { 'main.js': 'export default {}', 'style.css': '' }
    }))
    expect((await list())[0].versions[0].manifest.entry).toBe('main.js')
  })

  it('keeps the package after an API restart', async () => {
    await installPackage(t, cookie)
    const restarted = await testApp(t)
    try {
      const response = await call(restarted.app, { url: PACKAGES, cookie })
      expect(response.json().data.map((item: { id: string }) => item.id)).toEqual(['dev.test.hello'])
    } finally {
      await restarted.close()
    }
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
    expect(existsSync(join(t.dataDir, 'userwidgets', 'dev.test.hello'))).toBe(false)
  })

  it('answers 409 PACKAGE_IN_USE while a widget of the package is placed', async () => {
    await installPackage(t, cookie)
    const screen = {
      id: SEED_SCREEN_ID,
      rows: 12,
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

describe('grant modes', () => {
  it('installs a confirmable grant as ask and another as allow', async () => {
    await installPackage(t, cookie, withNotifications())
    expect((await list())[0].grants).toEqual([{ permission: 'notifications', mode: 'ask' }, { permission: 'state', mode: 'allow' }])
  })

  it('switches the mode of a confirmable grant and returns the grants', async () => {
    await installPackage(t, cookie, withNotifications())
    const allowed = await setMode('notifications', 'allow')
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json().data).toEqual([{ permission: 'notifications', mode: 'allow' }, { permission: 'state', mode: 'allow' }])
    expect((await setMode('notifications', 'ask')).json().data[0]).toEqual({ permission: 'notifications', mode: 'ask' })
    expect((await list())[0].grants[0]).toEqual({ permission: 'notifications', mode: 'ask' })
  })

  it('answers 404 for an unknown package or a permission the package does not hold', async () => {
    await installPackage(t, cookie)
    for (const response of [
      await setMode('notifications', 'allow', 'dev.test.none'),
      await setMode('notifications', 'allow'),
      await setMode('http', 'allow'),
    ]) {
      expect([response.statusCode, errorCode(response)]).toEqual([404, 'NOT_FOUND'])
    }
  })

  it('answers 400 for a held permission without a mode and for another mode, and changes nothing', async () => {
    await installPackage(t, cookie, withNotifications())
    for (const response of [
      await setMode('state', 'ask'),
      await setMode('notifications', 'never'),
      await setMode('notifications', undefined),
    ]) {
      expect([response.statusCode, errorCode(response)]).toEqual([400, 'VALIDATION_ERROR'])
    }
    expect((await list())[0].grants).toEqual([{ permission: 'notifications', mode: 'ask' }, { permission: 'state', mode: 'allow' }])
  })

  it('keeps the mode of an existing grant when the package is updated', async () => {
    await installPackage(t, cookie, widgetPackage((p) => { p.manifest.permissions = ['notifications'] }))
    expect((await setMode('notifications', 'allow')).statusCode).toBe(200)
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['notifications', 'state']
    }))
    expect((await list())[0].grants).toEqual([{ permission: 'notifications', mode: 'allow' }, { permission: 'state', mode: 'allow' }])
  })
})

describe('startup cleanup', () => {
  it('moves a version folder without a row to .orphaned on restart', async () => {
    await installPackage(t, cookie)
    t.db.prepare('DELETE FROM widget_packages').run()
    const restarted = await testApp(t)
    try {
      expect(readdirSync(join(t.dataDir, 'userwidgets', '.orphaned'))).toHaveLength(1)
      expect(existsSync(join(t.dataDir, 'userwidgets', 'dev.test.hello'))).toBe(false)
    } finally {
      await restarted.close()
    }
  })
})
