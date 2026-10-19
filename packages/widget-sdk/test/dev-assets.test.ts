import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REQUIRED_TOKENS } from '../../../apps/ui/app/theme/contract.ts'
import { extractCssBlock, extractThemeTokens, type DevTheme } from '../src/dev/themes.ts'
import { overflowReport } from '../src/dev/probe.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
const ui = (path: string) => readFile(join(root, '../../apps/ui', path), 'utf8')
const asset = (name: string) => readFile(join(root, 'dist/dev', name), 'utf8')

describe('theme and CSS extraction', () => {
  it('extracts trimmed --ld- declarations with the last declaration winning', () => {
    expect(extractThemeTokens(`/* --ld-ignored: red; */
      .a { --ld-bg: red; --other: ignored; --ld-gap:  0.75rem ; }
      .b { --ld-bg: oklch(0.2 0.02 280) }`)).toEqual({
      '--ld-bg': 'oklch(0.2 0.02 280)', '--ld-gap': '0.75rem',
    })
  })

  it('returns the exact top-level block including nested rules and ignores braces in comments and strings', () => {
    const block = '@layer ld.reset {\n  /* } */\n  * { content: "}"; box-sizing: border-box; }\n}'
    expect(extractCssBlock(`/* @layer ld.reset { wrong } */\n@layer ld.reset, ld.frame;\n${block}\n.x {}`, '@layer ld.reset')).toBe(block)
    expect(extractCssBlock('.sandbox__frame--waiting { visibility: hidden; }\n.sandbox__frame { border: 0; }', '.sandbox__frame'))
      .toBe('.sandbox__frame { border: 0; }')
  })

  it('throws for a missing top-level rule, including a rule only present inside another block', () => {
    expect(() => extractCssBlock('.outer { .sandbox { height: 100%; } }', '.sandbox')).toThrow('.sandbox')
    expect(() => extractCssBlock('.other {}', '.missing')).toThrow('.missing')
  })
})

describe('built dev assets', () => {
  it('ships built-in themes in production order with their metadata and all resolved required tokens', async () => {
    const { BUILTIN_THEMES } = await import(pathToFileURL(join(root, '../../apps/ui/app/theme/builtin.ts')).href)
    const themes: DevTheme[] = JSON.parse(await asset('themes.json'))
    expect(themes.map(({ id }) => id)).toEqual(['builtin:glass', 'builtin:obsidian', 'builtin:paper'])
    expect(themes.map(({ tokens: _tokens, ...meta }) => meta)).toEqual(BUILTIN_THEMES)
    for (const theme of themes) {
      for (const name of Object.keys(REQUIRED_TOKENS)) {
        expect(theme.tokens[`--ld-${name}`], `${theme.id}: --ld-${name}`).toBeTruthy()
      }
      for (const value of Object.values(theme.tokens)) expect(value).not.toContain('var(')
      expect(theme.tokens).toEqual(extractThemeTokens(await ui(`app/theme/styles/themes/${theme.id.slice('builtin:'.length)}.css`)))
    }
  })

  it('copies the SDK development Vue runtime byte for byte at the UI version', async () => {
    const runtime = await readFile(join(root, 'dist/dev/vue.js'))
    expect(runtime).toEqual(await readFile(require.resolve('vue/dist/vue.runtime.esm-browser.js')))
    const firstComment = runtime.toString('utf8').match(/^\/\*[\s\S]*?\*\//)?.[0]
    const uiPackage = JSON.parse(await ui('package.json'))
    expect(firstComment).toContain('v3.5.43')
    expect(uiPackage.dependencies.vue).toBe('3.5.43')
  })

  it('builds a standalone probe module without imports', async () => {
    const source = ts.createSourceFile('probe.js', await asset('probe.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const imports: ts.Node[] = []
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)
        || (ts.isExportDeclaration(node) && node.moduleSpecifier)
        || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) imports.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(imports).toEqual([])
    expect(source.statements.length).toBeGreaterThan(0)
  })

  it('copies production frame geometry verbatim in order without imports or extra sandbox rules', async () => {
    const layers = await ui('app/theme/styles/layers.css')
    const reset = layers.slice(layers.indexOf('@layer ld.reset {')).trimEnd()
    const order = layers.match(/^@layer[^;{]+;/m)![0]
    const sandboxStyle = (await ui('app/widgets/SandboxWidget.vue')).split('<style scoped>')[1]!.split('</style>')[0]!
    const sandbox = sandboxStyle.match(/^\.sandbox \{[^}]*\}/m)![0]
    const frame = sandboxStyle.match(/^\.sandbox__frame \{[^}]*\}/m)![0]
    const parts = [order, reset, await ui('app/theme/styles/frame.css')]
    for (const skin of ['bare', 'glass', 'paper', 'solid']) parts.push(await ui(`app/theme/styles/skins/${skin}.css`))
    parts.push(sandbox, frame)
    const css = await asset('frame.css')
    expect(css).toBe(parts.join('\n\n') + '\n')
    expect(css).not.toContain('@import')
    expect(css).not.toContain('.sandbox__frame--waiting')
  })
})

describe('overflowReport', () => {
  it('reports overflow beyond one pixel on either axis using the exact message', () => {
    expect(overflowReport({ w: 102, h: 80 }, { w: 100, h: 80 }, null))
      .toBe('content is 102×80 px in a 100×80 px frame')
    expect(overflowReport({ w: 100, h: 82 }, { w: 100, h: 80 }, null))
      .toBe('content is 100×82 px in a 100×80 px frame')
  })

  it('allows a one-pixel difference and content smaller than the frame', () => {
    expect(overflowReport({ w: 101, h: 81 }, { w: 100, h: 80 }, null)).toBeNull()
    expect(overflowReport({ w: 99, h: 79 }, { w: 100, h: 80 }, null)).toBeNull()
  })

  it('suppresses the last size and reports changed content or viewport sizes', () => {
    const last = overflowReport({ w: 102, h: 80 }, { w: 100, h: 80 }, null)!
    expect(overflowReport({ w: 102, h: 80 }, { w: 100, h: 80 }, last)).toBeNull()
    expect(overflowReport({ w: 103, h: 80 }, { w: 100, h: 80 }, last)).not.toBeNull()
    expect(overflowReport({ w: 102, h: 80 }, { w: 99, h: 80 }, last)).not.toBeNull()
  })
})

describe('probe runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('forwards CSP events and measures on resize and every 500 ms with size deduplication', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const rootElement = { scrollWidth: 102, scrollHeight: 80 }
    const parent = { postMessage: vi.fn() }
    const frame = { innerWidth: 100, innerHeight: 80, parent }
    const document = new EventTarget()
    Object.assign(document, { documentElement: rootElement })
    let resize!: () => void
    const observe = vi.fn()
    vi.stubGlobal('window', frame)
    vi.stubGlobal('document', document)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe = observe
    })
    await import('../src/dev/probe.ts')
    expect(observe).toHaveBeenCalledWith(rootElement)
    const csp = new Event('securitypolicyviolation')
    Object.assign(csp, { violatedDirective: 'connect-src', blockedURI: 'https://blocked.example' })
    document.dispatchEvent(csp)
    expect(parent.postMessage).toHaveBeenLastCalledWith({
      t: 'ld:dev', kind: 'csp', message: 'connect-src blocked https://blocked.example',
    }, '*')
    resize()
    expect(parent.postMessage).toHaveBeenLastCalledWith({
      t: 'ld:dev', kind: 'overflow', message: 'content is 102×80 px in a 100×80 px frame',
    }, '*')
    parent.postMessage.mockClear()
    vi.advanceTimersByTime(500)
    expect(parent.postMessage).not.toHaveBeenCalled()
    rootElement.scrollWidth = 110
    vi.advanceTimersByTime(499)
    expect(parent.postMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({
      t: 'ld:dev', kind: 'overflow', message: 'content is 110×80 px in a 100×80 px frame',
    }, '*')
  })
})
