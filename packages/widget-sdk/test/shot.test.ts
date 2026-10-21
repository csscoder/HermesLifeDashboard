import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findBrowser, shotCombos, shotFileName, takeShots } from '../src/shot.ts'

const sizing = { default: { w: 4, h: 3 }, min: { w: 2, h: 2 }, max: { w: 6, h: 6 } }
const themes = ['builtin:glass', 'builtin:paper']

describe('shotCombos', () => {
  it('defaults to min, default and max size in every theme, framed and frameless', () => {
    const combos = shotCombos(sizing, themes, {})
    expect(combos).toHaveLength(3 * 2 * 2)
    expect(combos[0]).toEqual({ w: 2, h: 2, theme: 'builtin:glass', frame: 'framed' })
    expect(combos.map((combo) => `${combo.w}x${combo.h}`)).toEqual(expect.arrayContaining(['2x2', '4x3', '6x6']))
  })

  it('drops duplicate sizes when min, default or max are equal', () => {
    const square = { default: { w: 2, h: 2 }, min: { w: 2, h: 2 }, max: { w: 2, h: 2 } }
    expect(shotCombos(square, ['builtin:paper'], { frames: ['framed'] })).toEqual([{ w: 2, h: 2, theme: 'builtin:paper', frame: 'framed' }])
  })

  it('uses the sizes, themes and frames it is given', () => {
    expect(shotCombos(sizing, themes, { sizes: [{ w: 5, h: 2 }], themes: ['builtin:paper'], frames: ['frameless'] }))
      .toEqual([{ w: 5, h: 2, theme: 'builtin:paper', frame: 'frameless' }])
  })

  it('rejects a size outside the manifest range and an unknown theme with a fix', () => {
    expect(() => shotCombos(sizing, themes, { sizes: [{ w: 7, h: 2 }] }))
      .toThrow('Size 7x2 is outside widget.json sizing 2x2…6x6.')
    expect(() => shotCombos(sizing, themes, { themes: ['builtin:nope'] }))
      .toThrow('Unknown theme builtin:nope. Fix: use one of builtin:glass, builtin:paper.')
  })
})

it('names a shot after its size, theme and frame', () => {
  expect(shotFileName({ w: 4, h: 3, theme: 'builtin:paper', frame: 'frameless' })).toBe('4x3-paper-frameless.png')
})

describe('findBrowser', () => {
  it('prefers LD_BROWSER, then the first installed browser for the platform', () => {
    const exists = (path: string) => path.includes('Chromium')
    expect(findBrowser('darwin', exists, { LD_BROWSER: '/opt/chrome' })).toBe('/opt/chrome')
    expect(findBrowser('darwin', exists, {})).toBe('/Applications/Chromium.app/Contents/MacOS/Chromium')
    expect(findBrowser('linux', () => false, {})).toBeUndefined()
  })
})

const browser = findBrowser()
const counter = fileURLToPath(new URL('./fixtures/counter/', import.meta.url))
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

it.skipIf(browser === undefined)('captures the rendered widget area into .ld-widget/shots', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const dir = await mkdtemp(join(tmpdir(), 'ld-widget-shot-'))
  dirs.push(dir)
  await cp(counter, dir, { recursive: true })
  const results = await takeShots(dir, { sizes: [{ w: 2, h: 2 }], themes: ['builtin:paper'], frames: ['framed'], wait: 0 })
  expect(results).toEqual([{ file: join(dir, '.ld-widget/shots/2x2-paper-framed.png'), rendered: true }])
  const png = await readFile(results[0]!.file)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  expect(width).toBe(height)
  expect(width).toBeGreaterThan(50)
  expect(width).toBeLessThan(300)
}, 60_000)
