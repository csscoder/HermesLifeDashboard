import { describe, expect, it } from 'vitest'
import type { Grant, InstalledPackage, WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import {
  describeSource,
  filesFromEntry,
  filesFromInput,
  findBuiltinWidget,
  formatBytes,
  initialModes,
  installedPackages,
  loadPackages,
  pickerEntries,
  readFolder,
  relaxedPermissions,
  savedMode,
  uploadFiles,
  type PickedFile,
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
    { version: '2.0.0', hash: 'h2', manifest: manifest('2.0.0', 'Часы 2'), paths: { source: null, assets: null } },
    { version: '1.0.0', hash: 'h1', manifest: manifest('1.0.0', 'Часы'), paths: { source: null, assets: null } },
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
      { key: 'builtin:clock-analog-1', title: 'Часы: лес', source: { kind: 'builtin', type: 'clock-analog-1' } },
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

const MANIFEST = { format: 2, id: 'dev.a.clock', version: '1.0.0', title: 'Clock', author: 'a', sdk: 1, entry: 'index.js', styles: [], sizing: { default: { w: 2, h: 2 }, min: { w: 1, h: 1 }, max: { w: 4, h: 4 } }, permissions: [] }

function picked(path: string, body: string): PickedFile {
  return { path, file: new Blob([body]) }
}

describe('filesFromInput', () => {
  it('strips the picked folder name from webkitRelativePath', () => {
    const file = Object.assign(new File(['x'], 'index.js'), { webkitRelativePath: 'clock-1.0.0/index.js' })
    const nested = Object.assign(new File(['y'], 'a.png'), { webkitRelativePath: 'clock-1.0.0/assets/a.png' })
    expect(filesFromInput([file, nested]).map((item) => item.path)).toEqual(['index.js', 'assets/a.png'])
  })
})

describe('filesFromEntry', () => {
  function fileEntry(name: string, body: string) {
    return { isFile: true, isDirectory: false, name, file: (ok: (file: File) => void) => ok(new File([body], name)) }
  }
  function dirEntry(name: string, children: unknown[]) {
    return {
      isFile: false,
      isDirectory: true,
      name,
      // readEntries returns batches until an empty one.
      createReader: () => {
        const batches = [children.slice(0, 1), children.slice(1), []]
        return { readEntries: (ok: (entries: unknown[]) => void) => ok(batches.shift() ?? []) }
      },
    }
  }

  it('walks a dropped directory with batched reads', async () => {
    const root = dirEntry('clock', [fileEntry('widget.json', '{}'), dirEntry('assets', [fileEntry('a.png', 'x')]), fileEntry('index.js', '')])
    const files = await filesFromEntry(root as unknown as FileSystemDirectoryEntry)
    expect(files.map((item) => item.path).sort()).toEqual(['assets/a.png', 'index.js', 'widget.json'])
  })
})

describe('readFolder', () => {
  it('needs widget.json at the root', async () => {
    expect(await readFolder([picked('clock-1.0.0/widget.json', '{}')])).toEqual({ ok: false, message: 'В папке нет widget.json' })
  })

  it('rejects a widget.json that is not JSON', async () => {
    expect(await readFolder([picked('widget.json', '<html>')])).toEqual({ ok: false, message: 'widget.json не является JSON' })
  })

  it('reports the folder validation error', async () => {
    const result = await readFolder([picked('widget.json', JSON.stringify(MANIFEST)), picked('index.js', ''), picked('notes.txt', 'x')])
    expect(result).toEqual({ ok: false, message: 'Папка отклонена: files: "notes.txt" is not an allowed path' })
  })

  it('returns the manifest and the file list', async () => {
    const result = await readFolder([picked('widget.json', JSON.stringify(MANIFEST)), picked('index.js', 'abc')])
    expect(result).toEqual({
      ok: true,
      manifest: MANIFEST,
      files: [{ path: 'widget.json', size: JSON.stringify(MANIFEST).length }, { path: 'index.js', size: 3 }],
    })
  })
})

describe('uploadFiles', () => {
  it('sends at most three files at once and reports each sent file', async () => {
    let active = 0
    let peak = 0
    const sent: string[] = []
    const client = {
      uploadFile: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return { ok: true as const, data: null }
      },
    }
    const files = ['a', 'b', 'c', 'd', 'e'].map((name) => picked(name, name))
    expect(await uploadFiles(client, 'u1', files, new AbortController().signal, (file) => sent.push(file.path))).toEqual({ ok: true })
    expect(peak).toBe(3)
    expect(sent.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('stops at the first failure and names the file', async () => {
    const client = {
      uploadFile: async (_id: string, path: string) =>
        path === 'b' ? { ok: false as const, kind: 'invalid' as const, code: 'NOT_FOUND', message: 'Upload not found or expired' } : { ok: true as const, data: null },
    }
    const result = await uploadFiles(client, 'u1', [picked('a', ''), picked('b', ''), picked('c', '')], new AbortController().signal, () => {})
    expect(result).toEqual({ ok: false, path: 'b', failure: { kind: 'invalid', code: 'NOT_FOUND', message: 'Upload not found or expired' } })
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 КБ'],
    [1, '1 КБ'],
    [1536, '2 КБ'],
    [1_048_576, '1.0 МБ'],
    [52_428_800, '50.0 МБ'],
  ])('%d → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
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
