import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRIDGE_LIMITS, GATEWAY_OPS, HTTP_LIMITS, STATE_MAX_BYTES, WIDGET_ERROR_CODES } from '@lifedashboard/contracts/widget-gateway'
import { BUILTIN_THEMES, checkDocs, docValues, freshDocs, renderDocs, themeTokenNames } from '../scripts/docs.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const PAGES = ['index', 'api', 'runtime', 'errors', 'design', 'settings', 'recipes', 'workflow'].map((name) => `${name}.md`)
const DOC_KEYS = [
  'SDK_TARGET_LEVEL', 'SDK_LEVELS', 'PERMISSIONS', 'GATEWAY_OPS', 'RATE_LIMITS', 'STATE_MAX_BYTES',
  'NOTIFICATION_TITLE_MAX', 'NOTIFICATION_BODY_MAX', 'HTTP_URL_LENGTH', 'HTTP_HEADER_VALUE_LENGTH',
  'HTTP_BODY_BYTES', 'HTTP_RESPONSE_BYTES', 'HTTP_TIMEOUT_MS', 'HTTP_ANSWER_BYTES', 'HTTP_SEND_METHODS',
  'NETWORK_ORIGINS_MAX', 'BRIDGE_MAX_MESSAGE_BYTES', 'BRIDGE_REQUEST_TIMEOUT_MS', 'BRIDGE_CONFIRM_TIMEOUT_MS',
  'BRIDGE_MAX_IN_FLIGHT', 'CONFIRMATION_TTL_MS', 'CODE_BYTES', 'VUE_RANGE', 'TITLE_MAX', 'SETTINGS_PROPERTIES',
  'SETTINGS_DESCRIPTION_LENGTH', 'SETTINGS_ENUM_ITEMS', 'SETTINGS_MAX_LENGTH', 'SECRET_MIN_LENGTH', 'REDACTED',
  'GRID_COLS', 'ROWS_MAX', 'ERROR_CODES', 'THEME_TOKENS', 'THEME_IDS', 'CSP',
].sort()

async function readPages(dir: string): Promise<Map<string, string>> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(dir, name), 'utf8')] as const)))
}

describe('renderDocs', () => {
  it('replaces every placeholder with its value', () => {
    expect(renderDocs(new Map([['a.md', 'x {{A}} y {{B}} {{A}}']]), { A: '1', B: '2' }))
      .toEqual(new Map([['a.md', 'x 1 y 2 1']]))
  })

  it('throws for a placeholder without a value', () => {
    expect(() => renderDocs(new Map([['a.md', 'x {{A}} {{C}}']]), { A: '1' }))
      .toThrow('Unknown docs placeholder {{C}} in a.md')
  })

  it('throws for a value that no page uses', () => {
    expect(() => renderDocs(new Map([['a.md', '{{A}}']]), { A: '1', B: '2' }))
      .toThrow('Docs value B is not used by any page')
  })
})

describe('docValues', () => {
  it('provides exactly the documented keys, each a non-empty string', async () => {
    const values = await docValues(await themeTokenNames())
    expect(Object.keys(values).sort()).toEqual(DOC_KEYS)
    for (const value of Object.values(values)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('takes numbers from the platform constants', async () => {
    const values = await docValues(await themeTokenNames())
    expect(values.STATE_MAX_BYTES).toBe(String(STATE_MAX_BYTES))
    expect(values.HTTP_ANSWER_BYTES).toBe(String(HTTP_LIMITS.answerBytes))
    expect(values.BRIDGE_CONFIRM_TIMEOUT_MS).toBe(String(BRIDGE_LIMITS.confirmTimeoutMs))
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { peerDependencies: { vue: string } }
    expect(values.VUE_RANGE).toBe('^3.5.0')
    expect(values.VUE_RANGE).toBe(pkg.peerDependencies.vue)
  })
})

describe('freshDocs and the committed docs', () => {
  it('renders every page without leftover placeholders', async () => {
    const pages = await freshDocs()
    expect([...pages.keys()]).toEqual([...PAGES].sort())
    for (const content of pages.values()) expect(content).not.toContain('{{')
  })

  it('matches the committed docs/ directory exactly (run pnpm -C packages/widget-sdk docs to fix)', async () => {
    expect(await readPages(join(root, 'docs'))).toEqual(await freshDocs())
    await expect(checkDocs()).resolves.toBeUndefined()
  })

  it('fails the stale check when a committed page differs from a fresh render', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ld-docs-'))
    try {
      await cp(join(root, 'docs'), dir, { recursive: true })
      await writeFile(join(dir, 'index.md'), 'edited\n')
      await expect(checkDocs(dir)).rejects.toThrow('Docs are stale. Fix: run pnpm -C packages/widget-sdk docs.')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('page content', () => {
  it('errors.md has one heading per WidgetErrorCode and no other code headings', async () => {
    const errors = (await freshDocs()).get('errors.md')!
    const headings = errors.match(/^### .+$/gm) ?? []
    expect(headings).toEqual(WIDGET_ERROR_CODES.map((code) => `### ${code}`))
  })

  it('api.md names every gateway operation, the API members, and every context field', async () => {
    const api = (await freshDocs()).get('api.md')!
    for (const op of Object.keys(GATEWAY_OPS)) expect(api).toContain(op)
    for (const name of [
      'useWidget', 'widget.state.get', 'widget.state.set', 'widget.notify', 'widget.http.get', 'widget.http.send', 'widget.call',
      'size', 'sizeClass', 'frame', 'theme', 'rootFontSize', 'config', 'locale', 'visible',
    ]) {
      expect(api).toContain(name)
    }
    expect(api).toContain('dist/types/widget-sdk/src/index.d.ts')
  })

  it('index.md links every other page', async () => {
    const index = (await freshDocs()).get('index.md')!
    for (const page of PAGES.filter((name) => name !== 'index.md')) expect(index).toContain(`(${page})`)
  })

  it('settings.md says a plain setting must declare default and a secret setting has none', async () => {
    const settings = (await freshDocs()).get('settings.md')!
    expect(settings).toContain('must declare `default`')
    expect(settings).toContain('A `secret` setting has no `default`')
  })

  it('workflow.md gives the dev shell URL parameters and every built-in theme id', async () => {
    const workflow = (await freshDocs()).get('workflow.md')!
    for (const param of ['`w`', '`h`', '`theme`', '`frame`', '`confirm`']) expect(workflow).toContain(param)
    for (const theme of BUILTIN_THEMES) expect(workflow).toContain(`\`${theme.id}\``)
    expect(workflow).toContain('?w=4&h=3&theme=builtin:paper&frame=frameless')
  })

  it('design.md and the clock recipe size square content from the smaller side', async () => {
    const docs = await freshDocs()
    expect(docs.get('design.md')).toContain('sizes from the smaller side of the widget')
    for (const page of ['design.md', 'recipes.md']) expect(docs.get(page)).toContain('width: min(100cqw, 100cqh)')
  })

  it('workflow.md tells agents without a browser to look at ld-widget shot images', async () => {
    const workflow = (await freshDocs()).get('workflow.md')!
    for (const text of ['npx ld-widget shot', '--size', '--theme', '--frame', '--wait', '.ld-widget/shots/', 'LD_BROWSER']) expect(workflow).toContain(text)
    expect(workflow).not.toContain('--virtual-time-budget')
    expect(workflow).toContain('the layout was not checked visually')
    expect(workflow).toContain('outside the sandbox')
  })

  it('design.md says the root fills the widget and the default size shows the essential content', async () => {
    const design = (await freshDocs()).get('design.md')!
    expect(design).toContain('`#app` fill the widget rectangle')
    expect(design).toContain('At the `default` size the essential content is visible without scrolling')
  })

  it('no page names the platform, its agents or its sources', async () => {
    for (const content of (await freshDocs()).values()) {
      for (const word of ['Hermes', 'MCP', 'apps/', 'packages/contracts']) expect(content).not.toContain(word)
    }
  })
})
