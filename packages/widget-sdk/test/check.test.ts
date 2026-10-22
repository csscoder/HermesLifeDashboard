import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { checkWidget } from '../src/check.ts'
import { packedSdk } from './packed.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(root, 'package.json'))
const uiRequire = createRequire(new URL('../../../apps/ui/package.json', import.meta.url))
const dirs: string[] = []
const deps = { typecheck: async () => [] }
const extracted = packedSdk()

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(tools = true): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'ld-widget-check-'))
  dirs.push(work)
  const dir = join(work, 'Мои виджеты', 'часы')
  await cp(join(root, 'test/fixtures/counter'), dir, { recursive: true })
  if (tools) {
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await symlink(dirname(require.resolve('typescript/package.json')), join(dir, 'node_modules/typescript'), 'dir')
    await symlink(dirname(uiRequire.resolve('vue-tsc/package.json')), join(dir, 'node_modules/vue-tsc'), 'dir')
  }
  return dir
}

async function integrationProject(): Promise<string> {
  const dir = await project()
  const modules = join(dir, 'node_modules')
  await symlink(dirname(require.resolve('vue/package.json')), join(modules, 'vue'), 'dir')
  await mkdir(join(modules, '@lifedashboard'))
  await cp(extracted, join(modules, '@lifedashboard/widget-sdk'), { recursive: true })
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true,
      skipLibCheck: true, lib: ['es2022', 'dom', 'dom.iterable'], types: [],
    },
    include: ['src', 'widget-env.d.ts'],
  }))
  return dir
}

async function component(dir: string, template: string): Promise<void> {
  const path = join(dir, 'src/index.vue')
  const source = await readFile(path, 'utf8')
  await writeFile(path, source.replace('<template>', `<template>\n  ${template}`))
}

it('checks a clean counter and writes the result', async () => {
  const dir = await project()
  const result = await checkWidget(dir, deps)
  expect(result).toEqual({ ok: true, problems: [] })
  expect(JSON.parse(await readFile(join(dir, '.ld-widget/check.json'), 'utf8'))).toEqual(result)
})

it('returns only a manifest problem before generating or scanning anything', async () => {
  const dir = await project()
  const manifest = JSON.parse(await readFile(join(dir, 'widget.json'), 'utf8'))
  delete manifest.title
  await writeFile(join(dir, 'widget.json'), JSON.stringify(manifest))
  const result = await checkWidget(dir, deps)
  expect(result.ok).toBe(false)
  expect(result.problems).toEqual([{ rule: 'manifest', message: expect.stringContaining('title') }])
  expect(JSON.parse(await readFile(join(dir, '.ld-widget/check.json'), 'utf8'))).toEqual(result)
})

it('reports a nonexistent project without creating any files', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ld-widget-missing-'))
  dirs.push(parent)
  const dir = join(parent, 'typo')
  expect(await checkWidget(dir, deps)).toEqual({ ok: false, problems: [{
    rule: 'manifest',
    message: `Project folder ${dir} does not exist. Fix: run check inside the widget project or pass its path.`,
  }] })
  expect(await readdir(parent)).toEqual([])
})

it('reports one actionable build problem for a missing src/index.vue', async () => {
  const dir = await project()
  await rm(join(dir, 'src/index.vue'))
  const result = await checkWidget(dir, deps)
  expect(result).toEqual({ ok: false, problems: [{
    rule: 'build',
    message: 'src/index.vue is missing: the widget entry must be src/index.vue. Fix: create src/index.vue (one Vue component) and import other files from it.',
  }] })
  expect(JSON.parse(await readFile(join(dir, '.ld-widget/check.json'), 'utf8'))).toEqual(result)
})

it('strips terminal control sequences from every final problem message', async () => {
  const dir = await project()
  const result = await checkWidget(dir, { typecheck: async () => [{
    rule: 'types', file: 'src/index.vue', line: 1, message: '\u001b[31mtype failure\u001b[0m',
  }] })
  expect(result).toEqual({ ok: false, problems: [{
    rule: 'types', file: 'src/index.vue', line: 1, message: 'type failure',
  }] })
  const saved = JSON.parse(await readFile(join(dir, '.ld-widget/check.json'), 'utf8'))
  expect(saved).toEqual(result)
  for (const problem of saved.problems) expect(problem.message).not.toContain('\u001b')
})

it('saves build diagnostics without ANSI escape codes', async () => {
  const dir = await project()
  const path = join(dir, 'src/index.vue')
  await writeFile(path, (await readFile(path, 'utf8')).replace("import { ref } from 'vue'", "import { ref } from 'vue'\nimport './missing.ts'"))
  const result = await checkWidget(dir, deps)
  expect(result.ok).toBe(false)
  expect(result.problems).toEqual([{ rule: 'build', message: expect.stringContaining('missing.ts') }])
  const saved = JSON.parse(await readFile(join(dir, '.ld-widget/check.json'), 'utf8'))
  expect(saved).toEqual(result)
  for (const problem of saved.problems) expect(problem.message).not.toContain('\u001b')
})

it('adds the Vue script block offset to source lines', async () => {
  const dir = await project()
  await writeFile(join(dir, 'src/extra.vue'), '<script lang="ts">\n// script line 2\nlocalStorage.getItem("a")\n</script>\n<template><div /></template>')
  expect((await checkWidget(dir, deps)).problems).toEqual([
    { rule: 'sandbox-api', file: 'src/extra.vue', line: 3, message: expect.stringContaining('widget.state.get/set') },
  ])
})

it.each(['ts', 'tsx', 'js', 'mjs'])('scans nested .%s sources', async (extension) => {
  const dir = await project()
  await mkdir(join(dir, 'src/nested'))
  await writeFile(join(dir, `src/nested/main.${extension}`), 'sessionStorage.clear()')
  expect((await checkWidget(dir, deps)).problems).toEqual([
    { rule: 'sandbox-api', file: `src/nested/main.${extension}`, line: 1, message: expect.stringContaining('widget.state.get/set') },
  ])
})

it('reports a failed build as a build problem', async () => {
  const dir = await project()
  await writeFile(join(dir, 'src/clip.mp4'), Buffer.from([1, 2, 3]))
  const path = join(dir, 'src/index.vue')
  await writeFile(path, (await readFile(path, 'utf8')).replace("import { ref } from 'vue'", "import { ref } from 'vue'\nimport clip from './clip.mp4'\nvoid clip"))
  const result = await checkWidget(dir, deps)
  expect(result.ok).toBe(false)
  expect(result.problems).toEqual([{ rule: 'build', message: expect.stringContaining('reference media by URL: assets/clip.mp4') }])
})

it('retains non-diagnostic typecheck failures as raw text', async () => {
  const dir = await project()
  expect((await checkWidget(dir)).problems).toEqual([
    { rule: 'types', message: "error TS5058: The specified path does not exist: 'tsconfig.json'." },
  ])
}, 60_000)

it.each([
  ['<video src="assets/bg.mp4" />', '<video> has no WebM source. Fix: add assets/bg.webm (VP9 + Opus) as the first <source> of this <video>.'],
  ['<audio src="assets/a.mp3" />', '<audio> has no Opus source. Fix: add an .ogg or .opus file (Opus) as the first <source> of this <audio>.'],
  ['<video src="assets/bg.mp4"><source src="assets/bg.webm"></video>', '<video> has no WebM source. Fix: add assets/bg.webm (VP9 + Opus) as the first <source> of this <video>.'],
  ['<audio src="assets/a.mp3"><source src="assets/a.ogg"></audio>', '<audio> has no Opus source. Fix: add an .ogg or .opus file (Opus) as the first <source> of this <audio>.'],
])('checks the media actually played by %s', async (template, message) => {
  const dir = await project()
  await mkdir(join(dir, 'assets'))
  for (const file of ['bg.mp4', 'bg.webm', 'a.mp3', 'a.ogg']) await writeFile(join(dir, 'assets', file), 'media fixture')
  await component(dir, template)
  expect((await checkWidget(dir, deps)).problems).toEqual([{ rule: 'media', file: 'src/index.vue', line: 10, message }])
})

it.each([
  '<video><source src="assets/clip.webm"><source src="assets/clip-h264.mp4"></video>',
  '<audio><source src="assets/a.opus"><source src="assets/a.mp3"></audio>',
  '<video :src="\'assets/bg.mp4\'" />',
  '<video :src="\'assets/bg.mp4\'"><source src="assets/bg.mp4"></video>',
])('accepts compatible or bound media: %s', async (template) => {
  const dir = await project()
  await mkdir(join(dir, 'assets'))
  for (const file of ['clip.webm', 'clip-h264.mp4', 'a.opus', 'a.mp3', 'bg.mp4']) await writeFile(join(dir, 'assets', file), 'media fixture')
  await component(dir, template)
  expect(await checkWidget(dir, deps)).toEqual({ ok: true, problems: [] })
})

it.each([
  '<img src="assets/missing.png" />',
  '<video src="assets/missing.webm" />',
  '<video><source src="assets/missing.webm" /></video>',
  '<video poster="assets/missing.png" />',
  '<img :src="\'assets/missing.png\'" />',
  '<svg><image href="assets/missing.svg#icon" /></svg>',
  '<img srcset="assets/missing.png 1x, assets/other.png 2x" />',
])('reports missing static template assets in %s', async (template) => {
  const dir = await project()
  await component(dir, template)
  const result = await checkWidget(dir, deps)
  expect(result.ok).toBe(false)
  expect(result.problems).toContainEqual(expect.objectContaining({
    rule: 'assets', file: 'src/index.vue', line: 10, message: expect.stringContaining('assets/missing.'),
  }))
})

it('resolves template asset URLs from the package root, not the Vue source directory', async () => {
  const dir = await project()
  await writeFile(join(dir, 'src/icon.png'), 'source-only image')
  await component(dir, '<img src="./icon.png" /><img src="/assets/icon.png" />')
  const result = await checkWidget(dir, deps)
  expect(result.problems).toEqual([
    expect.objectContaining({ rule: 'assets', file: 'src/index.vue', line: 10, message: expect.stringContaining('./icon.png') }),
    expect.objectContaining({ rule: 'assets', file: 'src/index.vue', line: 10, message: expect.stringContaining('/assets/icon.png') }),
  ])
})

it('rejects root-absolute template URLs even when their suffix names an existing packaged asset', async () => {
  const dir = await project()
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets/icon.png'), 'image')
  await component(dir, '<img src="/package/assets/icon.png" />')
  expect((await checkWidget(dir, deps)).problems).toEqual([expect.objectContaining({
    rule: 'assets', file: 'src/index.vue', line: 10, message: expect.stringContaining('/package/assets/icon.png'),
  })])
})

it('accepts existing assets, inline URLs, fragments and imported Vue bindings', async () => {
  const dir = await project()
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets/icon.png'), 'image')
  const path = join(dir, 'src/index.vue')
  const source = (await readFile(path, 'utf8')).replace("import { ref } from 'vue'", "import { ref } from 'vue'\nimport icon from '../assets/icon.png'")
  await writeFile(path, source)
  await component(dir, '<img src="./assets/icon.png?size=2#preview" /><img :src="icon" /><img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" /><img src="blob:example" /><svg><use href="#icon" /></svg>')
  expect(await checkWidget(dir, deps)).toEqual({ ok: true, problems: [] })
})

it('reports missing CSS URLs with the source file and line', async () => {
  const dir = await project()
  const path = join(dir, 'src/index.vue')
  await writeFile(path, (await readFile(path, 'utf8')).replace('  color:', '  background: url("assets/missing.png");\n  color:'))
  expect((await checkWidget(dir, deps)).problems).toEqual([expect.objectContaining({
    rule: 'assets', file: 'src/index.vue', line: 15, message: expect.stringContaining('assets/missing.png'),
  })])
})

it('checks standalone CSS while preserving source-relative imports and runtime asset URLs', async () => {
  const dir = await project()
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets/icon.png'), 'image')
  await writeFile(join(dir, 'src/extra.css'), '.a { background: url(../assets/icon.png) }\n.b { background: url(assets/icon.png?x=1#preview) }\n.c { background: url(assets/missing.png) }')
  const path = join(dir, 'src/index.vue')
  await writeFile(path, (await readFile(path, 'utf8')).replace("import { ref } from 'vue'", "import { ref } from 'vue'\nimport './extra.css'"))
  expect((await checkWidget(dir, deps)).problems).toEqual([expect.objectContaining({
    rule: 'assets', file: 'src/extra.css', line: 3, message: expect.stringContaining('assets/missing.png'),
  })])
})

it('ignores CSS comments, displayed url text and inline resources', async () => {
  const dir = await project()
  await writeFile(join(dir, 'src/extra.css'), '/* url(assets/missing.png) */\n.a { content: "url(assets/missing.png)"; background: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); mask: url(#icon) }')
  expect(await checkWidget(dir, deps)).toEqual({ ok: true, problems: [] })
})

it('reports exactly one actionable problem when the tools are missing', async () => {
  const dir = await project(false)
  // pnpm's Vitest launcher injects NODE_PATH; exclude those workspace fallback tools.
  const checked = spawnSync(process.execPath, [join(root, 'src/cli.ts'), 'check', '.'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_PATH: '' },
  })
  expect(checked.error).toBeUndefined()
  expect(checked.status, checked.stdout + checked.stderr).toBe(1)
  expect(checked.stderr).toBe('')
  const message = 'typescript and vue-tsc are missing from devDependencies. Fix: npm install -D typescript@6.0.3 vue-tsc@3.3.12'
  expect(checked.stdout).toBe(`✗ [types] ${message}\ncheck: 1 problems\n`)
  expect(JSON.parse(await readFile(join(dir, '.ld-widget/check.json'), 'utf8'))).toEqual({ ok: false, problems: [{
    rule: 'types',
    message,
  }] })
}, 60_000)

it('reports a real vue-tsc error with file and line even when tsconfig enables pretty output', async () => {
  const dir = await integrationProject()
  const tsconfigPath = join(dir, 'tsconfig.json')
  const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'))
  tsconfig.compilerOptions.pretty = true
  await writeFile(tsconfigPath, JSON.stringify(tsconfig))
  const path = join(dir, 'src/index.vue')
  await writeFile(path, (await readFile(path, 'utf8')).replace('const count = ref(0)', "const count = ref(0)\nconst n: number = 'x'"))
  const result = await checkWidget(dir)
  expect(result.ok).toBe(false)
  expect(result.problems).toEqual([{
    rule: 'types', file: 'src/index.vue', line: 7, message: "Type 'string' is not assignable to type 'number'.",
  }])
  const saved = JSON.parse(await readFile(join(dir, '.ld-widget/check.json'), 'utf8'))
  expect(saved).toEqual(result)
  for (const problem of saved.problems) expect(problem.message).not.toContain('\u001b')
}, 60_000)

it('keeps Vite build failure logging off CLI stderr', async () => {
  const dir = await integrationProject()
  const path = join(dir, 'src/index.vue')
  await writeFile(path, (await readFile(path, 'utf8')).replace("import { ref } from 'vue'", "import { ref } from 'vue'\nimport './missing.ts'"))
  const checked = spawnSync(process.execPath, [join(root, 'src/cli.ts'), 'check', '.'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000,
  })
  expect(checked.error).toBeUndefined()
  expect(checked.status).toBe(1)
  expect(checked.stdout).toContain('✗ [build] ')
  expect.soft(checked.stderr).toBe('')
  expect.soft(checked.stdout).not.toContain('\u001b')
}, 60_000)

it('checks a relative CLI directory in a path with spaces and Cyrillic', async () => {
  const dir = await integrationProject()
  const checked = spawnSync(process.execPath, [join(root, 'src/cli.ts'), 'check', '.'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000,
  })
  expect(checked.error).toBeUndefined()
  expect(checked.status, checked.stdout + checked.stderr).toBe(0)
  expect(checked.stdout).toBe('check: OK\n')
  expect(checked.stderr).toBe('')
}, 60_000)

it('prints the rule, project-relative file and line for a CLI problem', async () => {
  const dir = await integrationProject()
  const path = join(dir, 'src/index.vue')
  await writeFile(path, (await readFile(path, 'utf8')).replace('const count = ref(0)', 'const count = ref(0)\nlocalStorage.clear()'))
  const checked = spawnSync(process.execPath, [join(root, 'src/cli.ts'), 'check', '.'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000,
  })
  expect(checked.error).toBeUndefined()
  expect(checked.status, checked.stdout + checked.stderr).toBe(1)
  expect(checked.stdout).toBe('✗ [sandbox-api] src/index.vue:7 "localStorage" does not work in the widget sandbox (no storage). Fix: use widget.state.get/set.\ncheck: 1 problems\n')
  expect(checked.stderr).toBe('')
}, 60_000)
