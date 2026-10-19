import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, relative, resolve, sep } from 'node:path'
import { promisify, stripVTControlCharacters } from 'node:util'
import type * as TS from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { SDK_TARGET_LEVEL } from '@lifedashboard/contracts/widget-gateway'
import { ASSET_TYPES, parseWidgetManifest } from '@lifedashboard/contracts/widget-package'
import { buildWidget } from './build.ts'
import { writeConfigDeclaration } from './config-declaration.ts'
import { scanSource } from './source-scan.ts'

export type CheckRule = 'manifest' | 'types' | 'sandbox-api' | 'network' | 'media' | 'build'
export interface Problem { rule: CheckRule; file?: string; line?: number; message: string }

type TemplateRoot = NonNullable<NonNullable<ReturnType<typeof parse>['descriptor']['template']>['ast']>
type TemplateElement = Extract<TemplateRoot['children'][number], { type: 1 }>

function scanMedia(file: string, ast: TemplateRoot): Problem[] {
  const problems: Problem[] = []
  const staticSrc = (node: TemplateElement) => node.props.find((prop) => prop.type === 6 && prop.name === 'src')
  function visit(node: TemplateRoot | TemplateRoot['children'][number]): void {
    if (node.type !== 0 && node.type !== 1) return
    if (node.type === 1 && (node.tag === 'video' || node.tag === 'audio')) {
      const own = staticSrc(node)
      const bound = node.props.some((prop) => prop.type === 7 && prop.name === 'bind'
        && prop.arg?.type === 4 && prop.arg.content === 'src')
      const sources = own ? [own] : bound ? [] : node.children
        .filter((child): child is TemplateElement => child.type === 1 && child.tag === 'source').map(staticSrc)
      const paths = sources.flatMap((prop) => {
        if (prop?.type !== 6 || !prop.value) return []
        try { return [new URL(prop.value.content, 'https://widget.invalid/').pathname] } catch { return [] }
      })
      const extensions = paths.map((path) => path.split('.').at(-1)!.toLowerCase())
        .filter((ext) => Object.hasOwn(ASSET_TYPES, ext))
      let message: string | undefined
      if (node.tag === 'video' && extensions.includes('mp4') && !extensions.includes('webm')) {
        const mp4 = paths.find((path) => /\.mp4$/i.test(path))!
        const base = basename(mp4).replace(/\.mp4$/i, '')
        message = `<video> has no WebM source. Fix: add assets/${base}.webm (VP9 + Opus) as the first <source> of this <video>.`
      } else if (node.tag === 'audio' && extensions.some((ext) => ['mp3', 'm4a', 'aac', 'wav', 'flac'].includes(ext))
        && !extensions.some((ext) => ['ogg', 'oga', 'opus', 'webm'].includes(ext))) {
        message = '<audio> has no Opus source. Fix: add an .ogg or .opus file (Opus) as the first <source> of this <audio>.'
      }
      if (message !== undefined) problems.push({ rule: 'media', file, line: node.loc.start.line, message })
    }
    for (const child of node.children) visit(child)
  }
  visit(ast)
  return problems
}

async function typecheck(root: string, executable: string): Promise<Problem[]> {
  try {
    await promisify(execFile)(process.execPath, [executable, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], { cwd: root })
    return []
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string }
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim() || failure.message
    const problems: Problem[] = []
    const other: string[] = []
    for (const line of output.split(/\r?\n/)) {
      const match = /^(.*?)\((\d+),(\d+)\): error TS\d+: (.*)$/.exec(line)
      if (match) {
        problems.push({ rule: 'types', file: relative(root, resolve(root, match[1]!)).split(sep).join('/'), line: Number(match[2]), message: match[4]! })
      } else if (line.trim()) other.push(line)
    }
    if (other.length) problems.push({ rule: 'types', message: other.join('\n').slice(0, 2000) })
    return problems
  }
}

export async function checkWidget(dir: string, deps: { typecheck?: (dir: string) => Promise<Problem[]> } = {}): Promise<{ ok: boolean; problems: Problem[] }> {
  const root = resolve(dir)
  const projectExists = existsSync(root)
  const problems: Problem[] = []
  async function finish() {
    const result = { ok: problems.length === 0, problems: problems.map((problem) => ({
      ...problem, message: stripVTControlCharacters(problem.message),
    })) }
    if (projectExists) {
      await mkdir(join(root, '.ld-widget'), { recursive: true })
      await writeFile(join(root, '.ld-widget/check.json'), `${JSON.stringify(result, null, 2)}\n`)
    }
    return result
  }
  if (!projectExists) {
    problems.push({ rule: 'manifest', message: `Project folder ${dir} does not exist. Fix: run check inside the widget project or pass its path.` })
    return finish()
  }
  let manifest: ReturnType<typeof parseWidgetManifest>
  try {
    const { format: _format, ...fields } = JSON.parse(await readFile(join(root, 'widget.json'), 'utf8')) as Record<string, unknown>
    manifest = parseWidgetManifest({ format: 2, ...fields, sdk: SDK_TARGET_LEVEL })
    if (!manifest.ok) throw new Error(manifest.error)
  } catch (error) {
    problems.push({ rule: 'manifest', message: error instanceof Error ? error.message : String(error) })
    return finish()
  }
  await writeConfigDeclaration(root)
  let ts: typeof TS | undefined
  let vueTsc: string | undefined
  try {
    const require = createRequire(join(root, 'package.json'))
    const typescript = require.resolve('typescript')
    vueTsc = require.resolve('vue-tsc/bin/vue-tsc.js')
    ts = require(typescript) as typeof TS
  } catch {
    problems.push({ rule: 'types', message: 'typescript and vue-tsc are missing from devDependencies. Fix: npm install -D typescript@6.0.3 vue-tsc@3.3.12' })
  }
  let entries: string[] = []
  try {
    entries = await readdir(join(root, 'src'), { recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const sources: { file: string; text: string; descriptor?: ReturnType<typeof parse>['descriptor'] }[] = []
  for (const path of entries.sort()) {
    if (!/\.(ts|tsx|js|mjs|vue)$/.test(path)) continue
    const file = join('src', path).split(sep).join('/')
    const text = await readFile(join(root, file), 'utf8')
    sources.push({ file, text, ...(file.endsWith('.vue') ? { descriptor: parse(text, { filename: file }).descriptor } : {}) })
  }
  if (ts) {
    for (const { file, text, descriptor } of sources) {
      if (descriptor) {
        for (const script of [descriptor.script, descriptor.scriptSetup]) {
          if (!script) continue
          const scanned = scanSource(script.lang === 'tsx' ? `${file}.tsx` : file, script.content, manifest.value.network ?? [], ts)
          problems.push(...scanned.map((problem) => ({ ...problem, file, line: problem.line! + script.loc.start.line - 1 })))
        }
      } else problems.push(...scanSource(file, text, manifest.value.network ?? [], ts))
    }
  }
  for (const { file, descriptor } of sources) {
    if (descriptor?.template?.ast) problems.push(...scanMedia(file, descriptor.template.ast))
  }
  if (ts && vueTsc) problems.push(...await (deps.typecheck ? deps.typecheck(root) : typecheck(root, vueTsc)))
  if (!existsSync(join(root, 'src/index.vue'))) {
    problems.push({ rule: 'build', message: 'src/index.vue is missing: the widget entry must be src/index.vue. Fix: create src/index.vue (one Vue component) and import other files from it.' })
  } else {
    try {
      await buildWidget(root, { quiet: true })
    } catch (error) {
      problems.push({ rule: 'build', message: error instanceof Error ? error.message : String(error) })
    }
  }
  return finish()
}
