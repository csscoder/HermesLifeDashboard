import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sandboxDocument } from '@lifedashboard/contracts/sandbox-document'
import { MODAL_LIMITS } from '@lifedashboard/contracts/widget-modal'
import { GRID_COLS, ROWS } from '@lifedashboard/contracts/grid'
import { REDACTED, SECRET_MIN_LENGTH } from '@lifedashboard/contracts/widget-secrets'
import {
  BRIDGE_LIMITS,
  CONFIRMATION_TTL_MS,
  GATEWAY_OPS,
  HTTP_LIMITS,
  HTTP_SEND_METHODS,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  RATE_LIMITS,
  SDK_LEVELS,
  SDK_TARGET_LEVEL,
  STATE_MAX_BYTES,
  WIDGET_ERROR_CODES,
} from '@lifedashboard/contracts/widget-gateway'
import { NETWORK_ORIGINS_MAX, PACKAGE_LIMITS, WIDGET_PERMISSIONS } from '@lifedashboard/contracts/widget-package'
import { SETTINGS_LIMITS } from '@lifedashboard/contracts/widget-settings'
import { extractThemeTokens } from '../src/dev/themes.ts'

// Generates docs/ from docs-src/. Numbers and lists come only from the platform constants named below.
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = join(packageDir, 'docs-src')
const outputDir = join(packageDir, 'docs')
const themesDir = join(packageDir, '../../apps/ui/app/theme/styles/themes')
// Imported by URL, as in build.ts, so the UI source stays out of this package's type check.
const { BUILTIN_THEMES } = await import(pathToFileURL(join(packageDir, '../../apps/ui/app/theme/builtin.ts')).href) as {
  BUILTIN_THEMES: readonly { id: string; mode: string }[]
}
export { BUILTIN_THEMES }

const code = (value: string): string => `\`${value}\``

function table(header: string[], rows: string[][]): string {
  return [header, header.map(() => '---'), ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n')
}

/** Sorted union of the token names that the built-in theme stylesheets define. */
export async function themeTokenNames(): Promise<string[]> {
  const names = new Set<string>()
  const files = (await readdir(themesDir)).filter((file) => file.endsWith('.css')).sort()
  for (const file of files) {
    for (const name of Object.keys(extractThemeTokens(await readFile(join(themesDir, file), 'utf8')))) names.add(name)
  }
  return [...names].sort()
}

export async function docValues(themeTokens: readonly string[]): Promise<Record<string, string>> {
  const { csp } = await sandboxDocument({ runtime: '<runtime>/', packageDir: '<widget>/', entry: '<widget>/index.js' }, [])
  const directives = csp.split('; ').map((directive) => directive.replace(/'sha256-[^']+'/, "'sha256-<import map hash>'"))
  const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as { peerDependencies: Record<string, string> }
  return {
    MODAL_LIMITS: table(['Limit', 'Value'], Object.entries(MODAL_LIMITS).map(([key, value]) => [code(key), String(value)])),
    SDK_TARGET_LEVEL: String(SDK_TARGET_LEVEL),
    SDK_LEVELS: SDK_LEVELS.join(', '),
    PERMISSIONS: WIDGET_PERMISSIONS.map(code).join(', '),
    GATEWAY_OPS: table(
      ['Operation', 'Permission', 'Confirmation policy'],
      Object.entries(GATEWAY_OPS).map(([op, spec]) => [code(op), code(spec.permission), code(spec.confirm)]),
    ),
    RATE_LIMITS: table(
      ['Operation', 'Max calls', 'Window (ms)'],
      Object.entries(RATE_LIMITS).map(([op, limit]) => [code(op), String(limit.max), String(limit.windowMs)]),
    ),
    STATE_MAX_BYTES: String(STATE_MAX_BYTES),
    NOTIFICATION_TITLE_MAX: String(NOTIFICATION_TITLE_MAX),
    NOTIFICATION_BODY_MAX: String(NOTIFICATION_BODY_MAX),
    HTTP_URL_LENGTH: String(HTTP_LIMITS.urlLength),
    HTTP_HEADER_VALUE_LENGTH: String(HTTP_LIMITS.headerValueLength),
    HTTP_BODY_BYTES: String(HTTP_LIMITS.bodyBytes),
    HTTP_RESPONSE_BYTES: String(HTTP_LIMITS.responseBytes),
    HTTP_TIMEOUT_MS: String(HTTP_LIMITS.timeoutMs),
    HTTP_ANSWER_BYTES: String(HTTP_LIMITS.answerBytes),
    HTTP_SEND_METHODS: HTTP_SEND_METHODS.map(code).join(', '),
    NETWORK_ORIGINS_MAX: String(NETWORK_ORIGINS_MAX),
    BRIDGE_MAX_MESSAGE_BYTES: String(BRIDGE_LIMITS.maxMessageBytes),
    BRIDGE_REQUEST_TIMEOUT_MS: String(BRIDGE_LIMITS.requestTimeoutMs),
    BRIDGE_CONFIRM_TIMEOUT_MS: String(BRIDGE_LIMITS.confirmTimeoutMs),
    BRIDGE_MAX_IN_FLIGHT: String(BRIDGE_LIMITS.maxInFlight),
    CONFIRMATION_TTL_MS: String(CONFIRMATION_TTL_MS),
    CODE_BYTES: String(PACKAGE_LIMITS.codeBytes),
    VUE_RANGE: pkg.peerDependencies.vue!,
    TITLE_MAX: String(PACKAGE_LIMITS.maxTextLength),
    SETTINGS_PROPERTIES: String(SETTINGS_LIMITS.properties),
    SETTINGS_DESCRIPTION_LENGTH: String(SETTINGS_LIMITS.descriptionLength),
    SETTINGS_ENUM_ITEMS: String(SETTINGS_LIMITS.enumItems),
    SETTINGS_MAX_LENGTH: String(SETTINGS_LIMITS.maxLength),
    SECRET_MIN_LENGTH: String(SECRET_MIN_LENGTH),
    REDACTED: code(REDACTED),
    GRID_COLS: String(GRID_COLS),
    ROWS_MAX: String(ROWS.max),
    ERROR_CODES: WIDGET_ERROR_CODES.map(code).join(', '),
    THEME_TOKENS: themeTokens.map((name) => `- ${code(name)}`).join('\n'),
    THEME_IDS: BUILTIN_THEMES.map((theme) => `- ${code(theme.id)}: ${theme.mode}`).join('\n'),
    CSP: directives.join('\n'),
  }
}

/** Replaces each `{{KEY}}` in every page. Throws for a placeholder without a value and for a value no page uses. */
export function renderDocs(pages: ReadonlyMap<string, string>, values: Readonly<Record<string, string>>): Map<string, string> {
  const used = new Set<string>()
  const rendered = new Map<string, string>()
  for (const [page, content] of pages) {
    rendered.set(page, content.replace(/\{\{([^{}]*)\}\}/g, (_match, key: string) => {
      if (!Object.hasOwn(values, key)) throw new Error(`Unknown docs placeholder {{${key}}} in ${page}`)
      used.add(key)
      return values[key]!
    }))
  }
  for (const key of Object.keys(values)) {
    if (!used.has(key)) throw new Error(`Docs value ${key} is not used by any page`)
  }
  return rendered
}

async function readPages(dir: string): Promise<Map<string, string>> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(dir, name), 'utf8')] as const)))
}

export async function freshDocs(): Promise<Map<string, string>> {
  return renderDocs(await readPages(sourceDir), await docValues(await themeTokenNames()))
}

/** Throws when the rendered pages in `dir` differ from a fresh render. The build runs it before packing. */
export async function checkDocs(dir: string = outputDir): Promise<void> {
  const committed = await readPages(dir).catch(() => new Map<string, string>())
  const fresh = await freshDocs()
  const same = committed.size === fresh.size && [...fresh].every(([name, content]) => committed.get(name) === content)
  if (!same) throw new Error('Docs are stale. Fix: run pnpm -C packages/widget-sdk docs.')
}

async function writeDocs(): Promise<void> {
  const pages = await freshDocs()
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  for (const [name, content] of pages) await writeFile(join(outputDir, name), content)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await writeDocs()
}
