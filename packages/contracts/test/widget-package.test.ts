import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  compareVersions,
  isPackageId,
  parseWidgetPackage,
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
