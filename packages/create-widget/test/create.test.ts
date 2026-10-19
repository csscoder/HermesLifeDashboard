import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseWidgetManifest } from '@lifedashboard/contracts/widget-package'
import { renderConfigDeclaration } from '../../widget-sdk/src/config-declaration.ts'
import { createWidgetProject, sdkSpecifier } from '../src/create.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const repoDir = fileURLToPath(new URL('../../..', import.meta.url))
const temporaryDirectory = () => mkdtemp(join(tmpdir(), 'ld-create-widget-'))
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? (await files(join(dir, entry.name))).map((path) => `${entry.name}/${path}`)
    : [entry.name]))
  return paths.flat().sort()
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return result
}

describe('createWidgetProject', () => {
  it('creates exactly the project files, with the specified manifest and dependencies', async () => {
    const parentDir = await temporaryDirectory()
    const project = await createWidgetProject({ name: 'clock', parentDir })
    expect(project).toBe(join(parentDir, 'clock'))
    expect(await files(project)).toEqual([
      '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'package.json', 'src/index.vue',
      'tsconfig.json', 'widget-env.d.ts', 'widget.json',
    ])
    expect(await json(join(project, 'package.json'))).toEqual({
      name: 'clock', private: true, type: 'module',
      scripts: { check: 'ld-widget check', build: 'ld-widget build' },
      devDependencies: {
        '@lifedashboard/widget-sdk': '0.1.0', vue: '3.5.43',
        typescript: '6.0.3', 'vue-tsc': '3.3.12',
      },
    })
    const manifest = await json(join(project, 'widget.json'))
    expect(manifest).toEqual({
      id: 'dev.local.clock', version: '0.1.0', title: 'clock', author: 'Автор',
      sdk: 2, entry: 'index.js', styles: ['style.css'],
      sizing: { default: { w: 4, h: 4 }, min: { w: 2, h: 2 }, max: { w: 12, h: 12 } },
      permissions: [],
    })
    expect(parseWidgetManifest({ format: 2, ...manifest }).ok).toBe(true)
    expect(await readFile(join(project, 'widget-env.d.ts'), 'utf8'))
      .toBe(renderConfigDeclaration(undefined))
    expect(await readFile(join(project, '.gitignore'), 'utf8'))
      .toBe('node_modules/\ndist/\n.ld-widget/\n.env*\n')
    expect(await readFile(join(project, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n')
    expect(await json(join(project, 'tsconfig.json'))).toEqual({
      compilerOptions: {
        target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true,
        noEmit: true, skipLibCheck: true, lib: ['es2022', 'dom', 'dom.iterable'], types: [],
      },
      include: ['src', 'widget-env.d.ts'],
    })
    const component = await readFile(join(project, 'src/index.vue'), 'utf8')
    expect(component).toContain('useWidget()')
    expect(component).toContain('context.sizeClass')
    expect(component).toContain('<style scoped>')
    expect(component).toContain('var(--ld-')
    const instructions = await readFile(join(project, 'AGENTS.md'), 'utf8')
    for (const rule of [
      'node_modules/@lifedashboard/widget-sdk/dist/types', 'widget.state', 'network',
      'WebM/Opus', 'assets/', 'npx ld-widget check', 'npx ld-widget build',
      'dist/<id>-<version>/', 'Виджеты → Выбрать папку',
    ]) expect(instructions).toContain(rule)
  })

  it('keeps template tool versions aligned with the workspace', async () => {
    const template = await json(join(packageDir, 'template/package.json'))
    const sdk = await json(join(repoDir, 'packages/widget-sdk/package.json'))
    const ui = await json(join(repoDir, 'apps/ui/package.json'))
    expect(template.devDependencies.vue).toBe(sdk.devDependencies.vue)
    expect(template.devDependencies.typescript).toBe(sdk.devDependencies.typescript)
    expect(template.devDependencies['vue-tsc']).toBe(ui.devDependencies['vue-tsc'])
  })

  it.each(['', 'Clock', '1clock', 'my_clock', '../clock', 'a/b', 'a'.repeat(51)])(
    'rejects invalid name %j without creating files', async (name) => {
      const parentDir = await temporaryDirectory()
      await expect(createWidgetProject({ name, parentDir })).rejects.toThrow(
        `Invalid name "${name}". Fix: use lowercase letters, digits and dashes, starting with a letter.`,
      )
      expect(await readdir(parentDir)).toEqual([])
    },
  )

  it('refuses a non-empty folder and preserves its contents', async () => {
    const parentDir = await temporaryDirectory()
    const project = join(parentDir, 'clock')
    await mkdir(project)
    await writeFile(join(project, 'keep.txt'), 'keep')
    await expect(createWidgetProject({ name: 'clock', parentDir })).rejects.toThrow(
      'Folder clock already exists and is not empty. Fix: choose another name or remove the folder.',
    )
    expect(await files(project)).toEqual(['keep.txt'])
    expect(await readFile(join(project, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('accepts an empty folder, a 50-character name and a Unicode parent path', async () => {
    const parentDir = join(await temporaryDirectory(), 'Мои виджеты')
    const name = `a${'0-'.repeat(24)}z`
    await mkdir(join(parentDir, name), { recursive: true })
    const project = await createWidgetProject({ name, parentDir, sdk: '0.2.0' })
    expect(project).toBe(join(parentDir, name))
    expect((await json(join(project, 'package.json'))).devDependencies['@lifedashboard/widget-sdk'])
      .toBe('0.2.0')
  })
})

describe('sdkSpecifier', () => {
  it('defaults to the own version and preserves registry specifiers', () => {
    expect(sdkSpecifier(undefined, '0.1.0', '/a')).toBe('0.1.0')
    expect(sdkSpecifier('0.2.0', '0.1.0', '/a')).toBe('0.2.0')
  })

  it('resolves tarballs to absolute file specifiers, even before they exist', () => {
    expect(sdkSpecifier('./x.tgz', '0.1.0', '/a')).toBe('file:/a/x.tgz')
    expect(sdkSpecifier('/a/x.tgz', '0.1.0', '/b')).toBe('file:/a/x.tgz')
  })

  it('resolves existing paths relative to cwd', async () => {
    const cwd = await temporaryDirectory()
    await mkdir(join(cwd, 'local-sdk'))
    expect(sdkSpecifier('./local-sdk', '0.1.0', cwd)).toBe(`file:${join(cwd, 'local-sdk')}`)
  })
})

it('packs a standalone CLI and scaffolds with a packed SDK without installing', async () => {
  const work = await temporaryDirectory()
  run('pnpm', ['-C', packageDir, 'pack', '--pack-destination', work], repoDir)
  const tarball = join(work, 'lifedashboard-create-widget-0.1.0.tgz')
  run('tar', ['-xzf', tarball, '-C', work], repoDir)
  const packed = join(work, 'package')
  const manifest = await json(join(packed, 'package.json'))
  expect(manifest.bin).toEqual({ 'create-widget': './dist/cli.js' })
  expect(manifest).not.toHaveProperty('private')
  expect(manifest.files).toEqual(['dist', 'template'])
  const packedFiles = await files(packed)
  expect(packedFiles).toContain('dist/cli.js')
  expect(packedFiles).toContain('template/gitignore')
  expect(await readFile(join(packed, 'dist/cli.js'), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/)
  run('pnpm', ['-C', join(repoDir, 'packages/widget-sdk'), 'pack', '--pack-destination', work], repoDir)
  const sdkTarball = join(work, 'lifedashboard-widget-sdk-0.1.0.tgz')
  const result = run(process.execPath, [join(packed, 'dist/cli.js'), 'demo', '--sdk', sdkTarball], work)
  expect(result.stderr).toBe('')
  expect(result.stdout).toBe([
    'Created demo/', 'Next:', '  cd demo', '  npm install', '  npx ld-widget check',
    'Read AGENTS.md before writing code.', '',
  ].join('\n'))
  const project = join(work, 'demo')
  expect((await json(join(project, 'package.json'))).devDependencies['@lifedashboard/widget-sdk'])
    .toBe(`file:${sdkTarball}`)
  expect(await files(project)).toHaveLength(8)
  const invalid = spawnSync(process.execPath, [join(packed, 'dist/cli.js'), 'BadName'], {
    cwd: work, encoding: 'utf8',
  })
  expect(invalid.status).toBe(1)
  expect(invalid.stdout).toBe('')
  expect(invalid.stderr).toBe('Invalid name "BadName". Fix: use lowercase letters, digits and dashes, starting with a letter.\n')
}, 180_000)
