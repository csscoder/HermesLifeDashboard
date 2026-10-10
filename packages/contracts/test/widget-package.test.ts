import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  classifyPath,
  compareVersions,
  isPackageId,
  parseWidgetFolder,
  parseWidgetManifest,
  parseWidgetPackage,
  SERVED_TYPES,
  type WidgetPackage,
} from '../src/widget-package.ts'

const valid: WidgetPackage = {
  format: 1,
  manifest: {
    id: 'dev.alex.pomodoro',
    version: '1.2.0',
    title: 'Pomodoro',
    author: 'alex',
    sdk: 1,
    entry: 'index.js',
    styles: ['style.css'],
    sizing: { default: { w: 3, h: 3 }, min: { w: 2, h: 2 }, max: { w: 6, h: 6 } },
    permissions: ['state', 'notifications'],
  },
  files: { 'index.js': 'export default {}', 'style.css': '.a{}' },
}

// Tests mutate a deep copy freely; the parser receives it as unknown input.
function mutated(change: (doc: any) => void): unknown {
  const doc = structuredClone(valid)
  change(doc)
  return doc
}

describe('parseWidgetPackage', () => {
  it('accepts a valid package', () => {
    expect(parseWidgetPackage(structuredClone(valid))).toEqual({ ok: true, value: valid })
  })

  it('accepts an entry other than index.js', () => {
    const result = parseWidgetPackage(mutated((d) => {
      d.manifest.entry = 'main.js'
      d.files = { 'main.js': 'export default {}', 'style.css': '' }
    }))
    expect(result.ok).toBe(true)
  })

  it('accepts a package without styles or permissions', () => {
    const result = parseWidgetPackage(mutated((d) => {
      d.manifest.styles = []
      d.manifest.permissions = []
      delete d.files['style.css']
    }))
    expect(result.ok).toBe(true)
  })

  it('accepts sizing up to the 24x100 grid', () => {
    const raw = mutated((d) => { d.manifest.sizing.max = { w: 24, h: 100 } })
    expect(parseWidgetPackage(raw).ok).toBe(true)
  })

  it.each([
    ['null', null, /package must be an object/],
    ['an unknown top-level field', mutated((d) => { d.extra = 1 }), /unknown field "extra"/],
    ['format 2', mutated((d) => { d.format = 2 }), /format must be 1/],
    ['an unknown manifest field', mutated((d) => { d.manifest.configSchema = {} }), /manifest: unknown field "configSchema"/],
    ['an id with capitals', mutated((d) => { d.manifest.id = 'Dev.alex.x' }), /manifest\.id/],
    ['an id without a dot', mutated((d) => { d.manifest.id = 'pomodoro' }), /manifest\.id/],
    ['an id over 100 characters', mutated((d) => { d.manifest.id = `a.${'b'.repeat(99)}` }), /manifest\.id/],
    ['a two-part version', mutated((d) => { d.manifest.version = '1.2' }), /manifest\.version/],
    ['an empty title', mutated((d) => { d.manifest.title = '' }), /manifest\.title/],
    ['a 61-character title', mutated((d) => { d.manifest.title = 'x'.repeat(61) }), /manifest\.title/],
    ['a title with a control character', mutated((d) => { d.manifest.title = 'a\nb' }), /manifest\.title/],
    ['an empty author', mutated((d) => { d.manifest.author = '' }), /manifest\.author/],
    ['sdk 2', mutated((d) => { d.manifest.sdk = 2 }), /manifest\.sdk must be 1/],
    ['min above default', mutated((d) => { d.manifest.sizing.min.w = 4 }), /manifest\.sizing/],
    ['max wider than the grid', mutated((d) => { d.manifest.sizing.max.w = 25 }), /manifest\.sizing.*inside the 24x100 grid/],
    ['max taller than the grid', mutated((d) => { d.manifest.sizing.max.h = 101 }), /manifest\.sizing.*inside the 24x100 grid/],
    ['a fractional size', mutated((d) => { d.manifest.sizing.default.h = 2.5 }), /manifest\.sizing/],
    ['an unknown sizing field', mutated((d) => { d.manifest.sizing.step = 1 }), /manifest\.sizing/],
    ['an unknown permission', mutated((d) => { d.manifest.permissions = ['http'] }), /manifest\.permissions/],
    ['a duplicate permission', mutated((d) => { d.manifest.permissions = ['state', 'state'] }), /manifest\.permissions/],
    ['an uppercase file name', mutated((d) => { d.files['Index.js'] = '' }), /invalid name "Index\.js"/],
    ['a path in a file name', mutated((d) => { d.files['../x.js'] = '' }), /invalid name/],
    ['two dots in a file name', mutated((d) => { d.files['a..b.js'] = '' }), /invalid name/],
    ['an image file', mutated((d) => { d.files['logo.png'] = '' }), /"logo\.png" must be \.js or \.css/],
    ['21 files', mutated((d) => { for (let i = 0; i < 19; i++) d.files[`f${i}.js`] = '' }), /at most 20 files/],
    ['a non-string file', mutated((d) => { d.files['index.js'] = 1 }), /"index\.js" must be a string/],
    ['a missing entry file', mutated((d) => { d.manifest.entry = 'main.js' }), /manifest\.entry/],
    ['a CSS entry', mutated((d) => { d.manifest.entry = 'style.css' }), /manifest\.entry/],
    ['a missing style file', mutated((d) => { d.manifest.styles = ['theme.css'] }), /manifest\.styles/],
    ['a JS style', mutated((d) => { d.manifest.styles = ['index.js'] }), /manifest\.styles/],
    ['a package over 1 MB', mutated((d) => { d.files['index.js'] = 'x'.repeat(1_048_576) }), /larger than 1 MB/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseWidgetPackage(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})

describe('isPackageId', () => {
  it('accepts dotted lowercase ids only', () => {
    expect(isPackageId('dev.alex.pomodoro')).toBe(true)
    expect(isPackageId('dev.my-widget')).toBe(true)
    expect(isPackageId('dev')).toBe(false)
    expect(isPackageId(1)).toBe(false)
  })
})

describe('canonicalJson', () => {
  it('does not depend on key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { e: 3, f: 2 }] }, b: 1 }),
    )
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })
})

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
})

const manifestV2 = { format: 2, ...valid.manifest }
const folderFiles = [
  { path: 'widget.json', size: 300 },
  { path: 'index.js', size: 1000 },
  { path: 'style.css', size: 50 },
]

function folder(change?: (files: { path: string; size: number }[], manifest: any) => void) {
  const files = structuredClone(folderFiles)
  const manifest = structuredClone(manifestV2)
  change?.(files, manifest)
  return parseWidgetFolder(manifest, files)
}

describe('parseWidgetManifest', () => {
  it('accepts a v2 manifest and returns it without format', () => {
    expect(parseWidgetManifest(structuredClone(manifestV2))).toEqual({ ok: true, value: valid.manifest })
  })

  it.each([
    ['no format', valid.manifest, /format must be 2/],
    ['format 1', { ...manifestV2, format: 1 }, /format must be 2/],
    ['an unknown field', { ...manifestV2, files: {} }, /manifest: unknown field "files"/],
    ['a bad id', { ...manifestV2, id: 'x' }, /manifest\.id/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseWidgetManifest(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})

describe('classifyPath', () => {
  it.each([
    ['widget.json', 'manifest'],
    ['index.js', 'code'],
    ['chunk-a1b2.mjs', 'code'],
    ['style.css', 'code'],
    ['rive.wasm', 'code'],
    ['assets/bg.mp4', 'asset'],
    ['assets/Clip.MP4', 'asset'],
    ['assets/models/ship.glb', 'asset'],
    ['assets/data.json', 'asset'],
    ['source/src/index.vue', 'source'],
    ['source/.npmrc', 'source'],
    ['source/My_File.TS', 'source'],
  ])('%s is %s', (path, fileClass) => {
    expect(classifyPath(path)).toBe(fileClass)
  })

  it.each([
    'README.md',
    'Widget.json',
    'lib/index.js',
    'assets/run.js',
    'assets/.hidden.png',
    '.env',
    'assets/../index.js',
    'assets/./a.png',
    'source',
    'source/a b.ts',
    'source/../x',
    'assets//a.png',
    '/index.js',
    '',
  ])('rejects %s', (path) => {
    expect(classifyPath(path)).toBeNull()
  })

  it('applies the length limit unless serving passes Infinity', () => {
    const long = `${'a'.repeat(198)}.js`
    expect(classifyPath(long)).toBeNull()
    expect(classifyPath(long, Infinity)).toBe('code')
  })
})

describe('SERVED_TYPES', () => {
  it('maps code and asset extensions', () => {
    expect(SERVED_TYPES.js).toBe('text/javascript; charset=utf-8')
    expect(SERVED_TYPES.wasm).toBe('application/wasm')
    expect(SERVED_TYPES.mp4).toBe('video/mp4')
    expect(SERVED_TYPES.woff2).toBe('font/woff2')
  })
})

describe('parseWidgetFolder', () => {
  it('accepts a folder and sums sizes per class', () => {
    const result = folder((files) => {
      files.push({ path: 'assets/bg.mp4', size: 50_000_000 }, { path: 'source/src/index.vue', size: 700 })
    })
    expect(result).toEqual({
      ok: true,
      value: {
        manifest: valid.manifest,
        files: [...folderFiles, { path: 'assets/bg.mp4', size: 50_000_000 }, { path: 'source/src/index.vue', size: 700 }],
        sizes: { code: 1050, assets: 50_000_000, source: 700 },
      },
    })
  })

  it('accepts exactly 10 MB of code and a zero-byte file', () => {
    expect(folder((files) => {
      files[1]!.size = 10_485_760 - 50
      files.push({ path: 'source/.gitkeep', size: 0 })
    }).ok).toBe(true)
  })

  it.each([
    ['a missing widget.json', (f: any[]) => { f.splice(0, 1) }, /widget\.json is required/],
    ['code over 10 MB', (f: any[]) => { f[1].size = 10_485_760 }, /code .* larger than 10 MB/],
    ['a widget.json over 64 KB', (f: any[]) => { f[0].size = 65_537 }, /widget\.json must be at most 64 KB/],
    ['2001 files', (f: any[]) => { for (let i = 0; i < 1998; i++) f.push({ path: `source/f${i}`, size: 1 }) }, /at most 2000 files/],
    ['a forbidden path', (f: any[]) => { f.push({ path: 'assets/x.exe', size: 1 }) }, /"assets\/x\.exe" is not an allowed path/],
    ['a negative size', (f: any[]) => { f[1].size = -1 }, /"index\.js" has an invalid size/],
    ['a fractional size', (f: any[]) => { f[1].size = 1.5 }, /"index\.js" has an invalid size/],
    ['an extra item field', (f: any[]) => { f[1].hash = 'x' }, /each item is \{ path, size \}/],
    ['a duplicate path', (f: any[]) => { f.push({ path: 'index.js', size: 1 }) }, /"index\.js" collides/],
    ['paths differing in case', (f: any[]) => { f.push({ path: 'assets/a.png', size: 1 }, { path: 'assets/A.PNG', size: 1 }) }, /"assets\/A\.PNG" collides/],
    ['a file and a directory', (f: any[]) => { f.push({ path: 'assets/a.mp4', size: 1 }, { path: 'assets/A.MP4/x.png', size: 1 }) }, /"assets\/A\.MP4\/x\.png" collides/],
    ['a directory then a file', (f: any[]) => { f.push({ path: 'assets/a/x.png', size: 1 }, { path: 'assets/A', size: 1 }) }, /"assets\/A" is not an allowed path|collides/],
    ['a missing entry', (f: any[], m: any) => { m.entry = 'main.js' }, /manifest\.entry/],
    ['a CSS entry', (f: any[], m: any) => { m.entry = 'style.css' }, /manifest\.entry/],
    ['a missing style', (f: any[], m: any) => { m.styles = ['theme.css'] }, /manifest\.styles/],
    ['files that are not a list', null, /files must be a list/],
  ])('rejects %s', (_name, change, message) => {
    const result = change === null ? parseWidgetFolder(structuredClone(manifestV2), {}) : folder(change as any)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})
