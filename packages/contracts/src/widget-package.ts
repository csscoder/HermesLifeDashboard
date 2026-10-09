import { GRID, type Size, type WidgetSizing } from './grid.ts'
import { byteLength, fail, isRecord, unknownKey, type ParseResult } from './parse.ts'

export const WIDGET_PERMISSIONS = ['state', 'notifications'] as const
export type WidgetPermission = (typeof WIDGET_PERMISSIONS)[number]

// Spec 2026-10-09: `ask` confirms each call of an `optional` operation in a host dialog.
export type GrantMode = 'allow' | 'ask'

export interface Grant {
  permission: WidgetPermission
  mode: GrantMode
}

export const PACKAGE_LIMITS = { maxBytes: 1_048_576, maxFiles: 20, maxIdLength: 100, maxTextLength: 60 } as const

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

const TOP_KEYS = ['format', 'manifest', 'files']
const MANIFEST_KEYS = ['id', 'version', 'title', 'author', 'sdk', 'entry', 'styles', 'sizing', 'permissions']
const SIZING_KEYS = ['default', 'min', 'max']
const SIZE_KEYS = ['w', 'h']

export interface WidgetPackageManifest {
  id: string
  version: string
  title: string
  author: string
  sdk: 1
  entry: string
  styles: string[]
  sizing: WidgetSizing
  permissions: WidgetPermission[]
}

export interface WidgetPackage {
  format: 1
  manifest: WidgetPackageManifest
  files: Record<string, string>
}

/** `POST /widget-packages/inspect` and `POST /widget-packages` answer with this. */
export interface PackageInspection {
  manifest: WidgetPackageManifest
  hash: string
  installed: boolean
  // Manifest permissions the package does not hold yet.
  newPermissions: WidgetPermission[]
}

export interface InstalledPackageVersion {
  version: string
  hash: string
  manifest: WidgetPackageManifest
}

export interface InstalledPackage {
  id: string
  title: string
  author: string
  // Newest first.
  versions: InstalledPackageVersion[]
  grants: Grant[]
}

export function isPackageId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PACKAGE_LIMITS.maxIdLength && ID_PATTERN.test(value)
}

export function isPackageVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value)
}

function isPlainText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= PACKAGE_LIMITS.maxTextLength &&
    !CONTROL_CHARACTER.test(value)
  )
}

function parseSize(raw: unknown): Size | null {
  if (!isRecord(raw) || unknownKey(raw, SIZE_KEYS) !== undefined) return null
  const { w, h } = raw
  return Number.isInteger(w) && Number.isInteger(h) && (w as number) >= 1 && (h as number) >= 1
    ? { w: w as number, h: h as number }
    : null
}

function parseSizing(raw: unknown): WidgetSizing | null {
  if (!isRecord(raw) || unknownKey(raw, SIZING_KEYS) !== undefined) return null
  const preferred = parseSize(raw.default)
  const min = parseSize(raw.min)
  const max = parseSize(raw.max)
  if (!preferred || !min || !max) return null
  const ordered =
    min.w <= preferred.w && preferred.w <= max.w && min.h <= preferred.h && preferred.h <= max.h
  return ordered && max.w <= GRID.cols && max.h <= GRID.rows ? { default: preferred, min, max } : null
}

function parsePermissions(raw: unknown): WidgetPermission[] | null {
  if (!Array.isArray(raw)) return null
  const known: readonly unknown[] = WIDGET_PERMISSIONS
  if (!raw.every((item) => known.includes(item)) || new Set(raw).size !== raw.length) return null
  return [...raw] as WidgetPermission[]
}

function parseManifest(raw: unknown): ParseResult<WidgetPackageManifest> {
  if (!isRecord(raw)) return fail('manifest must be an object')
  const extra = unknownKey(raw, MANIFEST_KEYS)
  if (extra !== undefined) return fail(`manifest: unknown field "${extra}"`)
  if (!isPackageId(raw.id)) {
    return fail('manifest.id must match ^[a-z0-9]+(\\.[a-z0-9-]+)+$ and be at most 100 characters')
  }
  if (!isPackageVersion(raw.version)) return fail('manifest.version must be MAJOR.MINOR.PATCH')
  if (!isPlainText(raw.title)) return fail('manifest.title must be 1–60 characters of plain text')
  if (!isPlainText(raw.author)) return fail('manifest.author must be 1–60 characters of plain text')
  if (raw.sdk !== 1) return fail('manifest.sdk must be 1')
  if (typeof raw.entry !== 'string') return fail('manifest.entry must name a .js file in files')
  if (!Array.isArray(raw.styles) || !raw.styles.every((item) => typeof item === 'string')) {
    return fail('manifest.styles must name .css files in files')
  }
  const sizing = parseSizing(raw.sizing)
  if (!sizing) return fail('manifest.sizing must have integer sizes with min ≤ default ≤ max inside the 12x8 grid')
  const permissions = parsePermissions(raw.permissions)
  if (!permissions) return fail('manifest.permissions must be distinct items of: state, notifications')
  return {
    ok: true,
    value: {
      id: raw.id,
      version: raw.version,
      title: raw.title,
      author: raw.author,
      sdk: 1,
      entry: raw.entry,
      styles: [...(raw.styles as string[])],
      sizing,
      permissions,
    },
  }
}

// Single validation point for a package from outside the process: the API, the CLI and the UI file check.
export function parseWidgetPackage(raw: unknown): ParseResult<WidgetPackage> {
  if (!isRecord(raw)) return fail('package must be an object')
  const extra = unknownKey(raw, TOP_KEYS)
  if (extra !== undefined) return fail(`unknown field "${extra}"`)
  if (raw.format !== 1) return fail('format must be 1')
  const parsed = parseManifest(raw.manifest)
  if (!parsed.ok) return parsed
  const manifest = parsed.value
  if (!isRecord(raw.files)) return fail('files must be an object')
  const names = Object.keys(raw.files)
  if (names.length > PACKAGE_LIMITS.maxFiles) return fail(`files: at most ${PACKAGE_LIMITS.maxFiles} files`)
  const files: Record<string, string> = {}
  for (const name of names) {
    if (!FILE_NAME_PATTERN.test(name) || name.includes('..')) return fail(`files: invalid name "${name}"`)
    if (!name.endsWith('.js') && !name.endsWith('.css')) return fail(`files: "${name}" must be .js or .css`)
    const content = raw.files[name]
    if (typeof content !== 'string') return fail(`files: "${name}" must be a string`)
    files[name] = content
  }
  if (!manifest.entry.endsWith('.js') || !Object.hasOwn(files, manifest.entry)) {
    return fail('manifest.entry must name a .js file in files')
  }
  if (!manifest.styles.every((name) => name.endsWith('.css') && Object.hasOwn(files, name))) {
    return fail('manifest.styles must name .css files in files')
  }
  const value: WidgetPackage = { format: 1, manifest, files }
  if (byteLength(JSON.stringify(value)) > PACKAGE_LIMITS.maxBytes) return fail('package is larger than 1 MB')
  return { ok: true, value }
}

/** JSON with object keys sorted at every level: the input of the package hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/** Orders MAJOR.MINOR.PATCH versions numerically; negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = left[index]! - right[index]!
    if (difference !== 0) return difference
  }
  return 0
}
