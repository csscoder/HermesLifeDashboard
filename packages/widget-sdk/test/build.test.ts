import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseWidgetPackage } from '@lifedashboard/contracts/widget-package'
import { buildWidget } from '../src/build.ts'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const dirs: string[] = []

// Each build runs on a copy, so dist/ never lands in the fixtures.
async function copyOf(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ld-widget-test-'))
  dirs.push(dir)
  await cp(join(fixtures, name), dir, { recursive: true })
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('buildWidget', () => {
  it('builds an SFC with scoped CSS into a valid package', async () => {
    const dir = await copyOf('counter')
    const target = await buildWidget(dir)
    expect(target).toBe(join(dir, 'dist', 'dev.test.counter-1.0.0.ldwidget.json'))
    const pkg = JSON.parse(await readFile(target, 'utf8'))
    expect(parseWidgetPackage(pkg).ok).toBe(true)
    expect(Object.keys(pkg.files).sort()).toEqual(['index.js', 'style.css'])
    expect(pkg.files['index.js']).toMatch(/from\s*["']vue["']/)
    expect(pkg.files['index.js']).toMatch(/from\s*["']@lifedashboard\/widget-sdk["']/)
    expect(pkg.files['style.css']).toMatch(/\[data-v-[0-9a-f]+\]/)
  }, 30_000)

  it('builds a package without CSS', async () => {
    const dir = await copyOf('plain')
    const pkg = JSON.parse(await readFile(await buildWidget(dir), 'utf8'))
    expect(Object.keys(pkg.files)).toEqual(['index.js'])
    expect(pkg.manifest.styles).toEqual([])
  }, 30_000)

  it('rejects a manifest the package format does not allow', async () => {
    const dir = await copyOf('counter')
    const manifest = JSON.parse(await readFile(join(dir, 'widget.json'), 'utf8'))
    await writeFile(join(dir, 'widget.json'), JSON.stringify({ ...manifest, permissions: ['http'] }))
    await expect(buildWidget(dir)).rejects.toThrow(/Invalid widget package: manifest\.permissions/)
  }, 30_000)
})
