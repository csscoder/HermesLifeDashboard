import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWidget, keepInSource } from '../src/build.ts'

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

async function filesOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1).split('\\').join('/')).sort()
}

describe('buildWidget', () => {
  it('builds a folder with code, a v2 widget.json and the sources', async () => {
    const dir = await copyOf('counter')
    const target = await buildWidget(dir)
    expect(target).toBe(join(dir, 'dist', 'dev.test.counter-1.0.0'))
    expect(await filesOf(target)).toEqual(['index.js', 'source/src/index.vue', 'source/widget-env.d.ts', 'source/widget.json', 'style.css', 'widget.json'])
    expect(JSON.parse(await readFile(join(target, 'widget.json'), 'utf8')).format).toBe(2)
    expect(await readFile(join(target, 'index.js'), 'utf8')).toMatch(/from\s*["']@lifedashboard\/widget-sdk["']/)
  }, 30_000)

  it('builds sdk 1 sources at sdk 3 without changing the copied source manifest', async () => {
    const dir = await copyOf('counter')
    const source = await readFile(join(dir, 'widget.json'), 'utf8')
    const manifest = JSON.parse(source)
    expect(manifest.sdk).toBe(1)
    const target = await buildWidget(dir)
    expect(JSON.parse(await readFile(join(target, 'widget.json'), 'utf8'))).toEqual({ ...manifest, format: 2, sdk: 3 })
    expect(await readFile(join(target, 'source', 'widget.json'), 'utf8')).toBe(source)
    expect(await readFile(join(dir, 'widget.json'), 'utf8')).toBe(source)
  }, 30_000)

  it('emits a chunk for a dynamic import', async () => {
    const files = await filesOf(await buildWidget(await copyOf('lazy')))
    expect(files.filter((file) => /^[^/]+\.js$/.test(file)).length).toBeGreaterThan(1)
  }, 30_000)

  it('copies assets verbatim and keeps them out of source/', async () => {
    const dir = await copyOf('counter')
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'bg.mp4'), Buffer.from([1, 2, 3]))
    const target = await buildWidget(dir)
    expect(await readFile(join(target, 'assets', 'bg.mp4'))).toEqual(Buffer.from([1, 2, 3]))
    expect(existsSync(join(target, 'source', 'assets'))).toBe(false)
  }, 30_000)

  it('keeps src="assets/..." in a template as a URL instead of importing it', async () => {
    const dir = await copyOf('counter')
    const vue = await readFile(join(dir, 'src', 'index.vue'), 'utf8')
    await writeFile(join(dir, 'src', 'index.vue'), vue.replace('<template>', '<template>\n  <video src="assets/bg.mp4" />'))
    expect(await readFile(join(await buildWidget(dir), 'index.js'), 'utf8')).toContain('assets/bg.mp4')
  }, 30_000)

  it('keeps ./assets image URLs relative to the installed package root', async () => {
    const dir = await copyOf('counter')
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets/icon.png'), 'image')
    const path = join(dir, 'src/index.vue')
    await writeFile(path, (await readFile(path, 'utf8')).replace('<template>', '<template>\n  <img src="./assets/icon.png" />'))
    const built = buildWidget(dir, { quiet: true })
    await expect(built).resolves.toBe(join(dir, 'dist/dev.test.counter-1.0.0'))
    const target = await built
    const code = await readFile(join(target, 'index.js'), 'utf8')
    expect(code).toContain('./assets/icon.png')
    expect(code).not.toMatch(/file:\/\/|node:|data:image/)
    expect(await readFile(join(target, 'assets/icon.png'), 'utf8')).toBe('image')
  }, 30_000)

  it('copies only allow-listed files into source/', async () => {
    const dir = await copyOf('counter')
    const files: [string, string][] = [['.env', 'SECRET=1'], ['.env.local', 'SECRET=2'], ['.git/HEAD', 'x'], ['.DS_Store', 'x'], ['node_modules/x/index.js', 'x'], ['src/node_modules/y.js', 'x'], ['dist/old.txt', 'x'], ['.npmrc', 'x'], ['src/.data.json', '{}']]
    for (const [path, body] of files) {
      await mkdir(join(dir, path, '..'), { recursive: true })
      await writeFile(join(dir, path), body)
    }
    const source = (await filesOf(await buildWidget(dir))).filter((file) => file.startsWith('source/'))
    expect(source).toEqual(['source/src/index.vue', 'source/widget-env.d.ts', 'source/widget.json'])
  }, 30_000)

  it('does not inline secrets from .env.local into built code', async () => {
    const dir = await copyOf('counter')
    await writeFile(join(dir, '.env.local'), 'VITE_SECRET=sk-live-123456789\n')
    const entry = join(dir, 'src/index.vue')
    const source = await readFile(entry, 'utf8')
    await writeFile(entry, source.replace('const count = ref(0)', 'const count = ref(0)\nconst secret = (import.meta as any).env.VITE_SECRET')
      .replace('{{ count }}', '{{ secret }} · {{ count }}'))
    const target = await buildWidget(dir)
    expect(await readFile(join(target, 'index.js'), 'utf8')).not.toContain('sk-live-123456789')
  }, 30_000)

  it('keeps extra source files but drops project notes and secrets from source/', async () => {
    const dir = await copyOf('counter')
    const files: [string, string][] = [['.npmrc', 'x'], ['notes.md', 'notes'], ['src/.env', 'SECRET=1'], ['src/extra.ts', 'export {}']]
    for (const [path, body] of files) {
      await writeFile(join(dir, path), body)
    }
    const source = (await filesOf(await buildWidget(dir))).filter((file) => file.startsWith('source/'))
    expect(source).toEqual(['source/src/extra.ts', 'source/src/index.vue', 'source/widget-env.d.ts', 'source/widget.json'])
  }, 30_000)

  it('omits source/ with source: false', async () => {
    const target = await buildWidget(await copyOf('counter'), { source: false })
    expect(existsSync(join(target, 'source'))).toBe(false)
  }, 30_000)

  it('builds a folder without CSS', async () => {
    const target = await buildWidget(await copyOf('plain'))
    expect(existsSync(join(target, 'style.css'))).toBe(false)
    expect(JSON.parse(await readFile(join(target, 'widget.json'), 'utf8')).styles).toEqual([])
  }, 30_000)

  it.each([
    ['any video', 'clip.mp4', 10],
    ['a large image', 'big.png', 102_401],
  ])('fails when code imports %s', async (_name, file, size) => {
    const dir = await copyOf('counter')
    await writeFile(join(dir, 'src', file), Buffer.alloc(size))
    const vue = await readFile(join(dir, 'src', 'index.vue'), 'utf8')
    await writeFile(join(dir, 'src', 'index.vue'), vue.replace("import { ref } from 'vue'", `import { ref } from 'vue'\nimport media from './${file}'\nvoid media`))
    await expect(buildWidget(dir)).rejects.toThrow(new RegExp(`reference media by URL: assets/${file.replace('.', '\\.')}`))
  }, 30_000)

  it('names a source file whose name breaks the path rules', async () => {
    const dir = await copyOf('counter')
    await writeFile(join(dir, 'src', 'my file.ts'), 'export {}')
    await expect(buildWidget(dir)).rejects.toThrow(/"source\/src\/my file\.ts" is not an allowed path/)
  }, 30_000)

  it('rejects a manifest the package format does not allow', async () => {
    const dir = await copyOf('counter')
    const manifest = JSON.parse(await readFile(join(dir, 'widget.json'), 'utf8'))
    await writeFile(join(dir, 'widget.json'), JSON.stringify({ ...manifest, permissions: ['http'] }))
    await expect(buildWidget(dir)).rejects.toThrow(/Invalid widget package: manifest\.permissions/)
  }, 30_000)

  it('rebuilds the same code from the restored source/ and assets/', async () => {
    const dir = await copyOf('counter')
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'a.png'), 'x')
    const first = await buildWidget(dir)
    const restored = await mkdtemp(join(tmpdir(), 'ld-widget-restored-'))
    dirs.push(restored)
    await cp(join(first, 'source'), restored, { recursive: true })
    await cp(join(first, 'assets'), join(restored, 'assets'), { recursive: true })
    const second = await buildWidget(restored)
    for (const file of ['index.js', 'style.css']) {
      expect(await readFile(join(second, file), 'utf8')).toBe(await readFile(join(first, file), 'utf8'))
    }
  }, 60_000)

  it('builds the same files and file names from different absolute directories', async () => {
    const outputs: Record<string, string>[] = []
    for (const depth of ['a', 'b/deeper']) {
      const base = await mkdtemp(join(tmpdir(), 'ld-widget-det-'))
      dirs.push(base)
      const dir = join(base, depth, 'lazy')
      await mkdir(dir, { recursive: true })
      await cp(join(fixtures, 'lazy'), dir, { recursive: true })
      const target = await buildWidget(dir, { source: false })
      outputs.push(Object.fromEntries(await Promise.all((await filesOf(target)).map(async (file) => [file, await readFile(join(target, file), 'utf8')] as const))))
    }
    expect(outputs[1]).toEqual(outputs[0])
    expect(Object.keys(outputs[0]!).filter((file) => file.startsWith('chunk-'))).toHaveLength(1)
  }, 60_000)

  it.each(['src/link', 'assets/link'])('fails on a symlink at %s', async (path) => {
    const dir = await copyOf('counter')
    await mkdir(join(dir, 'assets'), { recursive: true })
    await symlink(tmpdir(), join(dir, path))
    await expect(buildWidget(dir)).rejects.toThrow(new RegExp(`symlinks are not allowed: ${path}`))
  }, 30_000)

  it('ignores a symlinked node_modules', async () => {
    const dir = await copyOf('counter')
    await symlink(tmpdir(), join(dir, 'node_modules'))
    const source = (await filesOf(await buildWidget(dir))).filter((file) => file.startsWith('source/'))
    expect(source).toEqual(['source/src/index.vue', 'source/widget-env.d.ts', 'source/widget.json'])
  }, 30_000)
})

describe('keepInSource', () => {
  it.each([
    ['', true], ['widget.json', true], ['package.json', true], ['package-lock.json', true], ['pnpm-lock.yaml', true],
    ['yarn.lock', true], ['tsconfig.json', true], ['tsconfig.app.json', true], ['AGENTS.md', true], ['CLAUDE.md', true],
    ['README.md', true], ['README', true], ['widget-env.d.ts', true], ['src', true], ['src/index.vue', true],
    [join('src', 'deep', 'a.ts'), true], ['test', true], [join('test', 'a.test.ts'), true],
    ['.npmrc', false], ['.env', false], ['.env.local', false], ['.gitignore', false], ['.ld-widget', false],
    ['node_modules', false], ['dist', false], ['assets', false], ['notes.md', false], ['secrets.json', false],
    ['scripts', false], ['vite.config.ts', false], [join('src', '.secret'), false], [join('src', '.hidden', 'a.ts'), false],
    [join('test', '.env'), false], [join('src', '.DS_Store'), false], [join('src', 'node_modules'), false],
    [join('test', 'node_modules', 'x.js'), false],
  ])('keepInSource(%j) is %s', (path, kept) => expect(keepInSource(path)).toBe(kept))
})
