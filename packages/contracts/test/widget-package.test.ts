import { describe, expect, it } from 'vitest'
import { isPlainText, PLAIN_TEXT_MAX } from '../src/parse.ts'
import {
  canonicalJson,
  classifyPath,
  compareVersions,
  isNetworkOrigin,
  isPackageId,
  PACKAGE_LIMITS,
  parseWidgetFolder,
  parseWidgetManifest,
  SERVED_TYPES,
  type WidgetPackageManifest,
} from '../src/widget-package.ts'

const valid: { manifest: WidgetPackageManifest } = {
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
}

// Tests mutate a deep copy freely; the parser receives it as unknown input.
function mutatedManifest(change: (manifest: any) => void): unknown {
  const manifest = { format: 2, ...structuredClone(valid.manifest) }
  change(manifest)
  return manifest
}

describe('manifest field rules', () => {
  it('accepts an entry other than index.js, no styles and no permissions', () => {
    const result = parseWidgetManifest(mutatedManifest((m) => {
      m.entry = 'main.js'
      m.styles = []
      m.permissions = []
    }))
    expect(result.ok).toBe(true)
  })

  it('accepts sizing up to the 24x100 grid', () => {
    expect(parseWidgetManifest(mutatedManifest((m) => { m.sizing.max = { w: 24, h: 100 } })).ok).toBe(true)
  })

  it('accepts sdk 1 and 2', () => {
    for (const sdk of [2, 1]) {
      const result = parseWidgetManifest(mutatedManifest((m) => { m.sdk = sdk }))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.sdk).toBe(sdk)
    }
  })

  it('accepts sdk 4', () => {
    expect(parseWidgetManifest(mutatedManifest((m) => { m.sdk = 4 })).ok).toBe(true)
  })

  it('rejects a newer sdk level with an update hint', () => {
    const result = parseWidgetManifest(mutatedManifest((m) => { m.sdk = 5 }))
    expect(result).toEqual({ ok: false, error: 'manifest.sdk 5 needs a newer LifeDashboard (this one supports 1–4)' })
  })

  it('checks sdk before unknown fields', () => {
    const result = parseWidgetManifest(mutatedManifest((m) => { m.sdk = 5; m.future = 1 }))
    expect(result).toEqual({ ok: false, error: 'manifest.sdk 5 needs a newer LifeDashboard (this one supports 1–4)' })
  })

  it('accepts frame at sdk 3 and keeps it', () => {
    for (const frame of ['frameless', 'framed']) {
      const result = parseWidgetManifest(mutatedManifest((m) => { m.sdk = 3; m.frame = frame }))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.frame).toBe(frame)
    }
  })

  it('omits frame when absent', () => {
    const result = parseWidgetManifest(mutatedManifest((m) => { m.sdk = 3 }))
    expect(result.ok).toBe(true)
    if (result.ok) expect('frame' in result.value).toBe(false)
  })

  it('rejects frame below sdk 3', () => {
    expect(parseWidgetManifest(mutatedManifest((m) => { m.sdk = 2; m.frame = 'frameless' }))).toEqual({
      ok: false, error: 'manifest.frame needs sdk 3',
    })
  })

  it.each(['none', true])('rejects an invalid frame %s at sdk 3', (frame) => {
    expect(parseWidgetManifest(mutatedManifest((m) => { m.sdk = 3; m.frame = frame }))).toEqual({
      ok: false, error: 'manifest.frame must be "framed" or "frameless"',
    })
  })

  it('rejects a non-integer sdk', () => {
    expect(parseWidgetManifest(mutatedManifest((m) => { m.sdk = '2' }))).toMatchObject({
      ok: false, error: 'manifest.sdk must be an integer level',
    })
  })

  it.each([0, -1, 1.5, 2.5, null, undefined, true, NaN, Infinity, -Infinity])('rejects unsupported sdk %s', (sdk) => {
    expect(parseWidgetManifest(mutatedManifest((m) => { m.sdk = sdk }))).toEqual({
      ok: false, error: 'manifest.sdk must be an integer level',
    })
  })

  it.each([
    ['null', null, /manifest must be an object/],
    ['an unknown manifest field', mutatedManifest((m) => { m.configSchema = {} }), /manifest: unknown field "configSchema"/],
    ['an id with capitals', mutatedManifest((m) => { m.id = 'Dev.alex.x' }), /manifest\.id/],
    ['an id without a dot', mutatedManifest((m) => { m.id = 'pomodoro' }), /manifest\.id/],
    ['an id over 100 characters', mutatedManifest((m) => { m.id = `a.${'b'.repeat(99)}` }), /manifest\.id/],
    ['a two-part version', mutatedManifest((m) => { m.version = '1.2' }), /manifest\.version/],
    ['an empty title', mutatedManifest((m) => { m.title = '' }), /manifest\.title/],
    ['a 61-character title', mutatedManifest((m) => { m.title = 'x'.repeat(61) }), /manifest\.title/],
    ['a title with a control character', mutatedManifest((m) => { m.title = 'a\nb' }), /manifest\.title/],
    ['an empty author', mutatedManifest((m) => { m.author = '' }), /manifest\.author/],
    ['min above default', mutatedManifest((m) => { m.sizing.min.w = 4 }), /manifest\.sizing/],
    ['max wider than the grid', mutatedManifest((m) => { m.sizing.max.w = 25 }), /manifest\.sizing.*inside the 24x100 grid/],
    ['max taller than the grid', mutatedManifest((m) => { m.sizing.max.h = 101 }), /manifest\.sizing.*inside the 24x100 grid/],
    ['a fractional size', mutatedManifest((m) => { m.sizing.default.h = 2.5 }), /manifest\.sizing/],
    ['an unknown sizing field', mutatedManifest((m) => { m.sizing.step = 1 }), /manifest\.sizing/],
    ['an unknown permission', mutatedManifest((m) => { m.permissions = ['http'] }), /manifest\.permissions/],
    ['a duplicate permission', mutatedManifest((m) => { m.permissions = ['state', 'state'] }), /manifest\.permissions/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseWidgetManifest(raw)
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

describe('manifest settings', () => {
  const settings = { type: 'object', properties: { city: { type: 'string', title: 'Город', default: 'Москва' } } }

  it('requires sdk 2 when settings is present', () => {
    expect(parseWidgetManifest({ ...manifestV2, settings })).toEqual({ ok: false, error: 'manifest.settings needs sdk 2' })
    expect(parseWidgetManifest({ ...manifestV2, settings: null })).toEqual({ ok: false, error: 'manifest.settings needs sdk 2' })
  })

  it('includes parsed settings on sdk 2 manifests', () => {
    expect(parseWidgetManifest({ ...manifestV2, sdk: 2, settings })).toEqual({
      ok: true, value: { ...valid.manifest, sdk: 2, settings },
    })
  })

  it('leaves absent settings out and preserves canonical JSON for both sdk levels', () => {
    for (const sdk of [1, 2]) {
      const result = parseWidgetManifest({ ...manifestV2, sdk })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Object.hasOwn(result.value, 'settings')).toBe(false)
        expect(canonicalJson(result.value)).toBe(canonicalJson({ ...valid.manifest, sdk }))
      }
    }
  })

  it('passes manifest.network to secret binding validation', () => {
    const secretSettings = { type: 'object', properties: { key: { type: 'secret', title: 'Key', bind: { origin: 'https://a.example', query: 'apikey' } } } }
    const raw = { ...manifestV2, sdk: 2, settings: secretSettings, permissions: ['network'], network: ['https://a.example'] }
    expect(parseWidgetManifest(raw)).toMatchObject({ ok: true, value: { settings: secretSettings } })
    expect(parseWidgetManifest({ ...raw, network: ['https://b.example'] })).toEqual({
      ok: false, error: 'settings.key.bind.origin must be one of manifest.network',
    })
    expect(parseWidgetManifest({ ...raw, network: undefined, permissions: [] })).toEqual({
      ok: false, error: 'settings.key.bind.origin must be one of manifest.network',
    })
  })

  it('propagates settings validation failures', () => {
    expect(parseWidgetManifest({ ...manifestV2, sdk: 2, settings: { type: 'object', properties: { n: { type: 'integer', title: 'N', default: 50, minimum: 1, maximum: 10 } } } })).toEqual({
      ok: false, error: 'settings.n.default must satisfy its own type and constraints',
    })
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

describe('manifest network', () => {
  function withNetwork(network: unknown, permissions: string[] = ['state', 'network']): unknown {
    return mutatedManifest((manifest) => {
      manifest.permissions = permissions
      manifest.network = network
    })
  }

  it('keeps approved-format origins with the network permission', () => {
    const result = parseWidgetManifest(withNetwork(['http://127.0.0.1:8787', 'https://api.example.com']))
    expect(result.ok && result.value.network).toEqual(['http://127.0.0.1:8787', 'https://api.example.com'])
  })

  it('leaves network out of a manifest that has none', () => {
    const result = parseWidgetManifest(mutatedManifest(() => {}))
    expect(result.ok && 'network' in result.value).toBe(false)
  })

  it.each([
    ['a path', ['http://127.0.0.1:8787/api']],
    ['a trailing slash', ['http://127.0.0.1:8787/']],
    ['a query', ['http://127.0.0.1:8787?a=1']],
    ['a fragment', ['http://127.0.0.1:8787#f']],
    ['an upper-case scheme', ['HTTP://127.0.0.1:8787']],
    ['a default port', ['https://example.com:443']],
    ['credentials', ['http://u:p@127.0.0.1:8787']],
    ['a wildcard', ['http://*.example.com']],
    ['another scheme', ['ftp://example.com']],
    ['duplicates', ['http://a.example', 'http://a.example']],
    ['an empty list', []],
    ['17 origins', Array.from({ length: 17 }, (_, index) => `http://h${index}.example`)],
    ['a number', [8787]],
    ['a string instead of a list', 'http://127.0.0.1:8787'],
  ])('rejects %s', (_name, network) => {
    const result = parseWidgetManifest(withNetwork(network))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/manifest\.network must be/)
  })

  it('requires network and the network permission together', () => {
    for (const raw of [withNetwork(['http://127.0.0.1:8787'], ['state']), withNetwork(undefined, ['network'])]) {
      const result = parseWidgetManifest(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/network permission/)
    }
  })

  it('isNetworkOrigin accepts only normalized origins', () => {
    expect(isNetworkOrigin('http://127.0.0.1:8787')).toBe(true)
    expect(isNetworkOrigin('http://localhost')).toBe(true)
    expect(isNetworkOrigin('http://localhost:80')).toBe(false)
    expect(isNetworkOrigin('http://127.0.0.1:8787@evil.example')).toBe(false)
    expect(isNetworkOrigin(null)).toBe(false)
  })
})

describe('plain-text limit', () => {
  it('takes PACKAGE_LIMITS.maxTextLength from PLAIN_TEXT_MAX, the limit isPlainText enforces', () => {
    expect(PLAIN_TEXT_MAX).toBe(60)
    expect(PACKAGE_LIMITS.maxTextLength).toBe(PLAIN_TEXT_MAX)
    expect(isPlainText('x'.repeat(PLAIN_TEXT_MAX))).toBe(true)
    expect(isPlainText('x'.repeat(PLAIN_TEXT_MAX + 1))).toBe(false)
  })
})
