import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, relative, resolve, sep } from 'node:path'
import { promisify, stripVTControlCharacters } from 'node:util'
import type * as TS from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { SDK_TARGET_LEVEL } from '@lifedashboard/contracts/widget-gateway'
import { ASSET_TYPES, classifyPath, parseWidgetManifest } from '@lifedashboard/contracts/widget-package'
import { buildWidget } from './build.ts'
import { writeConfigDeclaration } from './config-declaration.ts'
import { scanSource } from './source-scan.ts'

export type CheckRule = 'manifest' | 'types' | 'sandbox-api' | 'network' | 'media' | 'assets' | 'build'
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

async function scanAssets(root: string, file: string, text: string, descriptor: ReturnType<typeof parse>['descriptor'] | undefined, ts: typeof TS | undefined): Promise<Problem[]> {
  const references: { url: string; line: number; css: boolean }[] = []
  function cssUrls(css: string, line: number, sourceRelative: boolean): void {
    // Consume comments and strings first, so displayed text such as content: "url(...)" is not a request.
    const urls = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\burl\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi
    for (const match of css.matchAll(urls)) {
      const url = match[1] ?? match[2] ?? match[3]
      if (url !== undefined && !/^(?:var|v-bind)\(/.test(url.trim())) references.push({
        url: url.trim(), line: line + css.slice(0, match.index).split('\n').length - 1, css: sourceRelative,
      })
    }
  }
  function literal(expression: string): string | undefined {
    if (!ts) return undefined
    const parsed = ts.createSourceFile('asset.ts', expression, ts.ScriptTarget.Latest, true)
    const statement = parsed.statements[0]
    if (!statement || !ts.isExpressionStatement(statement)) return undefined
    let value = statement.expression
    while (ts.isParenthesizedExpression(value)) value = value.expression
    return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined
  }
  function visit(node: TemplateRoot | TemplateRoot['children'][number]): void {
    if (node.type !== 0 && node.type !== 1) return
    if (node.type === 1) {
      for (const prop of node.props) {
        const name = prop.type === 6 ? prop.name : prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.isStatic ? prop.arg.content : undefined
        const url = prop.type === 6 ? prop.value?.content : prop.exp?.type === 4 ? literal(prop.exp.content) : undefined
        if (url === undefined) continue
        if (name === 'style') cssUrls(url, prop.loc.start.line, false)
        else if ((name === 'src' && ['img', 'input', 'video', 'audio', 'source', 'track'].includes(node.tag))
          || (name === 'poster' && node.tag === 'video')
          || (['href', 'xlink:href'].includes(name ?? '') && ['image', 'use'].includes(node.tag))) {
          references.push({ url, line: prop.loc.start.line, css: false })
        } else if (name === 'srcset' && ['img', 'source'].includes(node.tag)) {
          for (const match of url.matchAll(/([^\s]+)(?:\s+[^,]*)?(?:,|$)/g)) references.push({
            url: match[1]!.replace(/,+$/, ''), line: prop.loc.start.line, css: false,
          })
        }
      }
    }
    for (const child of node.children) visit(child)
  }
  if (descriptor?.template?.ast) visit(descriptor.template.ast)
  for (const style of descriptor?.styles ?? []) {
    if (!style.lang || style.lang === 'css') cssUrls(style.content, style.loc.start.line, true)
  }
  if (file.endsWith('.css')) cssUrls(text, 1, true)
  const problems: Problem[] = []
  const isFile = async (path: string) => (await stat(path).catch(() => null))?.isFile() === true
  for (const { url, line, css } of references) {
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue
    let path: string | undefined
    let sourcePath: string | undefined
    try {
      const runtime = new URL(url, 'https://widget.invalid/package/')
      if (!url.startsWith('/') && runtime.pathname.startsWith('/package/')) path = decodeURIComponent(runtime.pathname.slice('/package/'.length))
      if (css) sourcePath = decodeURIComponent(new URL(url, `https://widget.invalid/${file}`).pathname.slice(1))
    } catch { /* An invalid URL cannot identify a local asset. */ }
    // Vite resolves CSS imports relative to the source file; unresolved CSS URLs keep the package document's base.
    if (sourcePath && await isFile(join(root, sourcePath))) continue
    if (path && classifyPath(path) === 'asset' && await isFile(join(root, path))) continue
    problems.push({ rule: 'assets', file, line,
      message: `Local asset "${url}" cannot be loaded from the installed package. Fix: put the file in assets/ and reference its package-relative URL (assets/…).`,
    })
  }
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
    if (!/\.(ts|tsx|js|mjs|vue|css)$/.test(path)) continue
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
      } else if (!file.endsWith('.css')) problems.push(...scanSource(file, text, manifest.value.network ?? [], ts))
    }
  }
  for (const { file, text, descriptor } of sources) {
    if (descriptor?.template?.ast) problems.push(...scanMedia(file, descriptor.template.ast))
    problems.push(...await scanAssets(root, file, text, descriptor, ts))
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
