import { describe, expect, it } from 'vitest'
import type { Grant, InstalledPackage, WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import {
  describeSource,
  findBuiltinWidget,
  initialModes,
  installedPackages,
  loadPackages,
  pickerEntries,
  readPackageFile,
  relaxedPermissions,
  savedMode,
} from '../app/widgets/catalog'

function manifest(version: string, title: string): WidgetPackageManifest {
  return {
    id: 'dev.a.clock',
    version,
    title,
    author: 'a',
    sdk: 1,
    entry: 'index.js',
    styles: [],
    sizing: { default: { w: 2, h: 2 }, min: { w: 1, h: 1 }, max: { w: 3, h: 3 } },
    permissions: [],
  }
}

// The API lists versions newest first.
const clock: InstalledPackage = {
  id: 'dev.a.clock',
  title: 'Часы',
  author: 'a',
  versions: [
    { version: '2.0.0', hash: 'h2', manifest: manifest('2.0.0', 'Часы 2') },
    { version: '1.0.0', hash: 'h1', manifest: manifest('1.0.0', 'Часы') },
  ],
  grants: [],
}

describe('catalog', () => {
  it('re-exports the built-in manifests from contracts', () => {
    expect(findBuiltinWidget('placeholder')?.sizing).toEqual({ default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 24, h: 100 } })
    expect(findBuiltinWidget('toString')).toBeUndefined()
  })

  it('describes built-in sources and the exact package version of a placed widget', () => {
    expect(describeSource({ kind: 'builtin', type: 'placeholder' }, [])).toEqual({
      title: 'Заглушка',
      sizing: findBuiltinWidget('placeholder')!.sizing,
      hash: null,
    })
    expect(describeSource({ kind: 'package', packageId: 'dev.a.clock', version: '1.0.0' }, [clock])).toEqual({
      title: 'Часы',
      sizing: clock.versions[1]!.manifest.sizing,
      hash: 'h1',
    })
    expect(describeSource({ kind: 'package', packageId: 'dev.a.clock', version: '3.0.0' }, [clock])).toBeNull()
    expect(describeSource({ kind: 'builtin', type: 'nope' }, [])).toBeNull()
  })

  it('offers built-ins and the newest version of each package', () => {
    expect(pickerEntries([clock])).toEqual([
      { key: 'builtin:placeholder', title: 'Заглушка', source: { kind: 'builtin', type: 'placeholder' } },
      { key: 'package:dev.a.clock', title: 'Часы 2', source: { kind: 'package', packageId: 'dev.a.clock', version: '2.0.0' } },
    ])
  })

  it('loads installed packages and keeps the last list on failure', async () => {
    expect(await loadPackages({ widgetPackages: async () => ({ ok: true, data: [clock] }) })).toBe(true)
    expect(installedPackages.value).toEqual([clock])
    expect(await loadPackages({ widgetPackages: async () => ({ ok: false, kind: 'unavailable' }) })).toBe(false)
    expect(installedPackages.value).toEqual([clock])
  })
})

describe('readPackageFile', () => {
  it('rejects a file over 1 MB without reading it', async () => {
    expect(await readPackageFile(new Blob(['x'.repeat(1_048_577)]))).toEqual({ ok: false, message: 'Файл больше 1 МБ' })
  })

  it('rejects text that is not JSON', async () => {
    expect(await readPackageFile(new Blob(['<html>']))).toEqual({ ok: false, message: 'Это не пакет виджета' })
  })

  it('returns the parsed body; the API validates the rest', async () => {
    expect(await readPackageFile(new Blob(['{"format":1}']))).toEqual({ ok: true, body: { format: 1 } })
  })
})

describe('grant modes on the install screen', () => {
  it('starts new confirmable permissions as ask and offers no mode for others', () => {
    expect(initialModes(['state', 'notifications'])).toEqual({ notifications: 'ask' })
    expect(initialModes(['state'])).toEqual({})
  })

  it('sends a PUT only for a new confirmable permission switched to allow', () => {
    expect(relaxedPermissions(['state', 'notifications'], { notifications: 'allow' })).toEqual(['notifications'])
    expect(relaxedPermissions(['notifications'], { notifications: 'ask' })).toEqual([])
    // A held grant is not new: the install screen never touches it, whatever the modes say.
    expect(relaxedPermissions([], { notifications: 'allow' })).toEqual([])
    expect(relaxedPermissions(['state'], { state: 'allow' })).toEqual([])
  })

  it('shows the saved mode of a held confirmable grant only', () => {
    const grants: Grant[] = [{ permission: 'notifications', mode: 'allow' }, { permission: 'state', mode: 'allow' }]
    expect(savedMode(grants, 'notifications')).toBe('allow')
    expect(savedMode(grants, 'state')).toBeNull()
    expect(savedMode([], 'notifications')).toBeNull()
  })
})
