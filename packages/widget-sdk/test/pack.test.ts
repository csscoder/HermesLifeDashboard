import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { renderConfigDeclaration } from '../src/config-declaration.ts'
import { packedSdk } from './packed.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
let work: string
let extracted: string
let pkg: Record<string, any>
let files: string[]

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'ld-widget-consumer-'))
  extracted = packedSdk()
  pkg = JSON.parse(await readFile(join(extracted, 'package.json'), 'utf8'))
  const entries = await readdir(extracted, { recursive: true, withFileTypes: true })
  files = entries.filter((entry) => entry.isFile())
    .map((entry) => relative(extracted, join(entry.parentPath, entry.name)).split(sep).join('/'))
}, 180_000)

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true })
})

it('packs the compiled public package without workspace references or sources', async () => {
  expect(pkg.private).toBeUndefined()
  expect(pkg.version).toBe('0.1.0')
  expect(pkg.exports['.']).toEqual({ types: './dist/types/widget-sdk/src/index.d.ts', default: './dist/index.js' })
  expect(pkg.exports['./package.json']).toBe('./package.json')
  expect(pkg.types).toBe('./dist/types/widget-sdk/src/index.d.ts')
  expect(pkg.bin).toEqual({ 'ld-widget': './dist/cli.js' })
  expect(pkg.peerDependencies).toEqual({ vue: '^3.5.0' })
  expect(pkg.dependencies).toEqual({ vite: '8.3.2', '@vitejs/plugin-vue': '6.0.9' })
  expect(JSON.stringify(pkg)).not.toContain('workspace:')
  expect(files).toContain('dist/sandbox.js')
  expect(files).toContain('dist/index.js')
  expect(files).toContain('dist/cli.js')
  for (const file of ['themes.json', 'vue.js', 'probe.js', 'frame.css']) {
    expect(files).toContain(`dist/dev/${file}`)
  }
  expect(files).toContain('dist/shell/index.html')
  expect(files).toContain('dist/shell/frame.css')
  expect(await readFile(join(extracted, 'dist/shell/frame.css')))
    .toEqual(await readFile(join(extracted, 'dist/dev/frame.css')))
  expect(files).toContain('dist/types/widget-sdk/src/index.d.ts')
  expect(files.some((file) => file.startsWith('src/') || file.startsWith('test/'))).toBe(false)
  expect((await readFile(join(extracted, 'dist/cli.js'), 'utf8')).split('\n')[0]).toBe('#!/usr/bin/env node')
})

it('packs the generated docs and not their source', () => {
  for (const page of ['index', 'api', 'runtime', 'errors', 'design', 'settings', 'recipes', 'workflow']) {
    expect(files).toContain(`docs/${page}.md`)
  }
  expect(files.some((file) => file.startsWith('docs-src/'))).toBe(false)
})

it('typechecks and builds a consumer outside the workspace using only the tarball', async () => {
  const consumer = join(work, 'consumer')
  const modules = join(consumer, 'node_modules')
  await mkdir(join(modules, '@lifedashboard'), { recursive: true })
  await cp(extracted, join(modules, '@lifedashboard/widget-sdk'), { recursive: true })
  for (const name of ['vue', 'vite', '@vitejs/plugin-vue', 'typescript']) {
    const target = join(modules, name)
    await mkdir(dirname(target), { recursive: true })
    await symlink(dirname(require.resolve(`${name}/package.json`)), target, 'dir')
  }
  await mkdir(join(consumer, 'src'))
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true, module: 'esnext', moduleResolution: 'bundler', noEmit: true, skipLibCheck: false, types: [],
    },
    include: ['src', 'widget-env.d.ts'],
  }))
  await writeFile(join(consumer, 'widget-env.d.ts'), renderConfigDeclaration({
    type: 'object',
    properties: {
      city: { type: 'string', title: 'City', default: '' },
      mode: { type: 'string', title: 'Mode', enum: ['a', 'b'], default: 'a' },
      apiKey: { type: 'secret', title: 'API key', bind: { origin: 'https://api.example.com', header: 'X-API-Key' } },
    },
  }))
  await writeFile(join(consumer, 'src/main.ts'), `import type { Widget } from '@lifedashboard/widget-sdk'
declare const widget: Widget
const city: string = widget.context.config.city
const key: boolean = widget.context.config.apiKey
const mode: 'a' | 'b' = widget.context.config.mode
// @ts-expect-error unknown setting
void widget.context.config.missing
// @ts-expect-error the host owns nested context fields
widget.context.size.w = 10
// @ts-expect-error the host owns theme tokens
widget.context.theme.tokens['--ld-bg'] = 'red'
// @ts-expect-error the host owns generated config fields
widget.context.config.city = 'London'
const out = await widget.http.get('https://api.example.com/x')
const status: number = out.status
export { city, key, mode, status }
`)
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
  const checked = spawnSync(process.execPath, [tsc, '-p', consumer], {
    cwd: consumer, encoding: 'utf8', timeout: 60_000,
  })
  expect(checked.error).toBeUndefined()
  expect(checked.status, checked.stdout + checked.stderr).toBe(0)
  expect(checked.stdout).toBe('')
  expect(checked.stderr).toBe('')

  const fixture = join(consumer, 'counter')
  await cp(join(root, 'test/fixtures/counter'), fixture, { recursive: true })
  const built = spawnSync(process.execPath, [join(modules, '@lifedashboard/widget-sdk/dist/cli.js'), 'build', fixture], {
    cwd: consumer, encoding: 'utf8', timeout: 60_000,
  })
  expect(built.error).toBeUndefined()
  expect(built.status, built.stdout + built.stderr).toBe(0)
  expect(built.stderr).toBe('')
  expect(built.stdout).toBe(`Built ${join(fixture, 'dist/dev.test.counter-1.0.0')}\nsource/: 3 files\n  src/index.vue\n  widget-env.d.ts\n  widget.json\n`)
  expect(existsSync(join(fixture, 'dist/dev.test.counter-1.0.0/index.js'))).toBe(true)
}, 180_000)
