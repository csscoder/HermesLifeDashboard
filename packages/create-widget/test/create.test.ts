import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
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
    const result = await createWidgetProject({ title: 'Мои суперчасы', parentDir })
    const project = join(parentDir, 'lifedashboard-moi-superchasy')
    expect(result).toEqual({ dir: project, slug: 'moi-superchasy' })
    expect(await files(project)).toEqual([
      '.agents/skills/lifedashboard-widget/SKILL.md', '.claude/skills/lifedashboard-widget/SKILL.md',
      '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'package.json', 'src/index.vue',
      'tsconfig.json', 'widget-env.d.ts', 'widget.json',
    ])
    expect(await json(join(project, 'package.json'))).toEqual({
      name: 'moi-superchasy', private: true, type: 'module',
      scripts: { check: 'ld-widget check', build: 'ld-widget build', dev: 'ld-widget dev' },
      devDependencies: {
        '@lifedashboard/widget-sdk': '0.1.0', vue: '3.5.43',
        typescript: '6.0.3', 'vue-tsc': '3.3.12',
      },
    })
    const manifest = await json(join(project, 'widget.json'))
    expect(manifest).toEqual({
      id: 'dev.local.moi-superchasy', version: '0.1.0', title: 'Мои суперчасы', author: 'Автор',
      sdk: 3, entry: 'index.js', styles: ['style.css'],
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
      'node_modules/@lifedashboard/widget-sdk/docs/index.md', 'widget.state', 'widget.http.get', 'widget.http.send',
      'network', 'WebM', 'Opus', 'assets/', 'var(--ld-', 'context.size', 'sizeClass', 'context.frame',
      'context.visible', '"frame": "frameless"', 'npx ld-widget dev', 'npx ld-widget check', 'npx ld-widget build',
      '.ld-widget/dev.log', 'dist/<id>-<version>/', 'Виджеты → Выбрать папку',
      'Keep `title` and `id`', 'default` size', 'height: 100%', 'compiled files', 'npx ld-widget shot',
    ]) expect(instructions).toContain(rule)
    expect(instructions).not.toContain('dist/types')
    expect(instructions).not.toMatch(/Hermes|MCP/)
    expect(instructions.trimEnd().split('\n').length).toBeLessThanOrEqual(60)
  })

  it('installs the widget skill as regular files for Claude Code and Codex', async () => {
    const { dir } = await createWidgetProject({ title: 'Clock', parentDir: await temporaryDirectory() })
    const expected = await readFile(join(packageDir, 'skill/lifedashboard-widget/SKILL.md'), 'utf8')
    for (const target of ['.claude', '.agents']) {
      const path = join(dir, target, 'skills/lifedashboard-widget/SKILL.md')
      const stat = await lstat(path)
      expect(stat.isSymbolicLink()).toBe(false)
      expect(stat.isFile()).toBe(true)
      expect(await readFile(path, 'utf8')).toBe(expected)
    }
  })

  it('ships a SKILL.md whose frontmatter names the skill and closes', async () => {
    const skill = await readFile(join(packageDir, 'skill/lifedashboard-widget/SKILL.md'), 'utf8')
    expect(skill.startsWith('---\nname: lifedashboard-widget\ndescription: ')).toBe(true)
    expect(skill.split('\n').indexOf('---', 1)).toBeGreaterThan(2)
  })

  it('keeps template tool versions aligned with the workspace', async () => {
    const template = await json(join(packageDir, 'template/package.json'))
    const sdk = await json(join(repoDir, 'packages/widget-sdk/package.json'))
    const ui = await json(join(repoDir, 'apps/ui/package.json'))
    expect(template.devDependencies.vue).toBe(sdk.devDependencies.vue)
    expect(template.devDependencies.typescript).toBe(sdk.devDependencies.typescript)
    expect(template.devDependencies['vue-tsc']).toBe(ui.devDependencies['vue-tsc'])
  })

  it('uses an explicit slug instead of deriving one from the title', async () => {
    const parentDir = await temporaryDirectory()
    const result = await createWidgetProject({ title: 'Мои суперчасы', slug: 'my-clock', parentDir })
    expect(result).toEqual({ dir: join(parentDir, 'lifedashboard-my-clock'), slug: 'my-clock' })
    const manifest = await json(join(result.dir, 'widget.json'))
    expect(manifest.id).toBe('dev.local.my-clock')
    expect(manifest.title).toBe('Мои суперчасы')
    expect((await json(join(result.dir, 'package.json'))).name).toBe('my-clock')
  })

  it.each(['a'.repeat(60), 'Clock "pro" \\ v2', 'Clock __SDK__ __SLUG__'])(
    'keeps title %j exactly in widget.json and passes the manifest parser', async (title) => {
      const parentDir = await temporaryDirectory()
      const { dir } = await createWidgetProject({ title, parentDir })
      const manifest = await json(join(dir, 'widget.json'))
      expect(manifest.title).toBe(title)
      expect(parseWidgetManifest({ format: 2, ...manifest }).ok).toBe(true)
    },
  )

  it.each(['', 'a'.repeat(61), 'bad\u0007title'])(
    'rejects invalid title %j without creating files', async (title) => {
      const parentDir = await temporaryDirectory()
      await expect(createWidgetProject({ title, parentDir })).rejects.toThrow(
        `Invalid title "${title}". Fix: use 1–60 characters without control characters.`,
      )
      expect(await readdir(parentDir)).toEqual([])
    },
  )

  it('rejects a title with no Latin name and no slug, without creating files', async () => {
    const parentDir = await temporaryDirectory()
    await expect(createWidgetProject({ title: '時計', parentDir })).rejects.toThrow(
      'Cannot derive a Latin name from "時計". Fix: give one with --slug, for example --slug my-clock.',
    )
    expect(await readdir(parentDir)).toEqual([])
  })

  it.each(['Clock', '1clock', 'a'.repeat(51)])(
    'rejects invalid slug %j without creating files', async (slug) => {
      const parentDir = await temporaryDirectory()
      await expect(createWidgetProject({ title: 'Clock', slug, parentDir })).rejects.toThrow(
        `Invalid slug "${slug}". Fix: use lowercase letters, digits and dashes, starting with a letter.`,
      )
      expect(await readdir(parentDir)).toEqual([])
    },
  )

  it('refuses a non-empty folder and preserves its contents', async () => {
    const parentDir = await temporaryDirectory()
    const project = join(parentDir, 'lifedashboard-clock')
    await mkdir(project)
    await writeFile(join(project, 'keep.txt'), 'keep')
    await expect(createWidgetProject({ title: 'Clock', parentDir })).rejects.toThrow(
      'Folder lifedashboard-clock already exists and is not empty. Fix: choose another title or --slug, or remove the folder.',
    )
    expect(await files(project)).toEqual(['keep.txt'])
    expect(await readFile(join(project, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('accepts an empty folder, a 50-character slug and a Unicode parent path', async () => {
    const parentDir = join(await temporaryDirectory(), 'Мои виджеты')
    const slug = `a${'0-'.repeat(24)}z`
    const folder = join(parentDir, `lifedashboard-${slug}`)
    await mkdir(folder, { recursive: true })
    const result = await createWidgetProject({ title: 'Clock', slug, parentDir, sdk: '0.2.0' })
    expect(result).toEqual({ dir: folder, slug })
    expect((await json(join(result.dir, 'package.json'))).devDependencies['@lifedashboard/widget-sdk'])
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

describe('packs and runs a standalone CLI', () => {
  const NPM_AGENT = 'npm/11.6.0 node/v24.21.0 darwin arm64'
  const PNPM_AGENT = 'pnpm/10.30.2 npm/? node/v24.21.0 darwin arm64'
  let packed = ''
  let cli = ''
  let sdkTarball = ''
  let stub = ''

  beforeAll(async () => {
    const work = await temporaryDirectory()
    run('pnpm', ['-C', packageDir, 'pack', '--pack-destination', work], repoDir)
    run('tar', ['-xzf', join(work, 'lifedashboard-create-widget-0.1.0.tgz'), '-C', work], repoDir)
    packed = join(work, 'package')
    cli = join(packed, 'dist/cli.js')
    run('pnpm', ['-C', join(repoDir, 'packages/widget-sdk'), 'pack', '--pack-destination', work], repoDir)
    sdkTarball = join(work, 'lifedashboard-widget-sdk-0.1.0.tgz')
    // Stub package managers record their working directory and arguments, then exit with $STUB_EXIT.
    stub = await temporaryDirectory()
    const script = ['#!/bin/sh', '{ pwd -P; printf \'%s\\n\' "$@"; } > "$STUB_LOG"', 'exit "$STUB_EXIT"', ''].join('\n')
    for (const name of ['npm', 'pnpm']) await writeFile(join(stub, name), script, { mode: 0o755 })
  }, 180_000)

  async function runCli(args: string[], userAgent = NPM_AGENT, exit = 0) {
    const cwd = await temporaryDirectory()
    const log = join(await temporaryDirectory(), 'stub.log')
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${stub}:${process.env.PATH}`,
        npm_config_user_agent: userAgent,
        STUB_LOG: log,
        STUB_EXIT: String(exit),
      },
    })
    expect(result.error).toBeUndefined()
    return { cwd, log, result }
  }

  it('packs the CLI with the expected manifest and bundle', async () => {
    const manifest = await json(join(packed, 'package.json'))
    expect(manifest.bin).toEqual({ 'create-widget': './dist/cli.js' })
    expect(manifest).not.toHaveProperty('private')
    expect(manifest.files).toEqual(['dist', 'template', 'skill'])
    const packedFiles = await files(packed)
    expect(packedFiles).toContain('dist/cli.js')
    expect(packedFiles).toContain('template/gitignore')
    expect(packedFiles).toContain('skill/lifedashboard-widget/SKILL.md')
    const source = await readFile(cli, 'utf8')
    expect(source).toMatch(/^#!\/usr\/bin\/env node\n/)
    expect(source).not.toMatch(/(?:from|import|require)\s*\(?\s*['"]@lifedashboard\/contracts/)
  })

  it.each([
    { manager: 'npm', userAgent: NPM_AGENT },
    { manager: 'pnpm', userAgent: PNPM_AGENT },
  ])('installs with $manager after scaffolding', async ({ userAgent }) => {
    const { cwd, log, result } = await runCli(['Мои часы', '--sdk', sdkTarball], userAgent)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe([
      'Created lifedashboard-moi-chasy/',
      '  title: Мои часы',
      '  id: dev.local.moi-chasy',
      '  package: moi-chasy',
      'Next: open lifedashboard-moi-chasy/ in Claude Code or Codex; the agent starts from AGENTS.md.',
      '',
    ].join('\n'))
    const project = join(cwd, 'lifedashboard-moi-chasy')
    expect(await readFile(log, 'utf8')).toBe(`${await realpath(project)}\ninstall\n`)
    expect(await files(project)).toHaveLength(10)
    expect((await json(join(project, 'package.json'))).devDependencies['@lifedashboard/widget-sdk'])
      .toBe(`file:${sdkTarball}`)
  })

  it.each([
    { manager: 'npm', userAgent: NPM_AGENT },
    { manager: 'pnpm', userAgent: PNPM_AGENT },
  ])('skips install with --no-install and prints the $manager hint', async ({ manager, userAgent }) => {
    const { log, result } = await runCli(['Clock', '--no-install'], userAgent)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe([
      'Created lifedashboard-clock/',
      '  title: Clock',
      '  id: dev.local.clock',
      '  package: clock',
      'Next: open lifedashboard-clock/ in Claude Code or Codex; the agent starts from AGENTS.md.',
      `Install dependencies first: cd lifedashboard-clock && ${manager} install`,
      '',
    ].join('\n'))
    expect(existsSync(log)).toBe(false)
  })

  it.each([
    { manager: 'npm', userAgent: NPM_AGENT },
    { manager: 'pnpm', userAgent: PNPM_AGENT },
  ])('reports a failed $manager install and keeps the project folder', async ({ manager, userAgent }) => {
    const { cwd, result } = await runCli(['Мои часы', '--sdk', sdkTarball], userAgent, 1)
    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      `Dependency install failed. Fix: run "cd lifedashboard-moi-chasy && ${manager} install".\n`,
    )
    expect(await files(join(cwd, 'lifedashboard-moi-chasy'))).toContain('widget.json')
  })

  it('requires a title when stdin is not a terminal', async () => {
    const { result } = await runCli([])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('Missing widget title. Fix: run create-widget "<title>" [--slug <slug>].\n')
  })

  it.each([['Clock', 'Extra'], ['Clock', '--bogus']])('rejects invalid arguments %j', async (...args) => {
    const { result } = await runCli([...args])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Invalid arguments. Fix: use create-widget [title] [--slug <slug>] [--sdk <version|path|tarball>] [--no-install].\n',
    )
  })
}, 180_000)
