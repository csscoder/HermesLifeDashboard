import { GRID_COLS, ROWS, type Size, type WidgetSizing } from './grid.ts'
import { fail, isPlainText, isRecord, unknownKey, type ParseResult } from './parse.ts'
import { SDK_LEVELS, type SdkLevel } from './widget-gateway.ts'
import { parseSettingsSchema, type SettingsSchema } from './widget-settings.ts'

export const WIDGET_PERMISSIONS = ['state', 'notifications', 'network'] as const
export type WidgetPermission = (typeof WIDGET_PERMISSIONS)[number]

// Spec 2026-10-09: `ask` confirms each call of an `optional` operation in a host dialog.
export type GrantMode = 'allow' | 'ask'

export interface Grant {
  permission: WidgetPermission
  mode: GrantMode
}

export const PACKAGE_LIMITS = {
  codeBytes: 10_485_760,
  manifestBytes: 65_536,
  maxFiles: 2000,
  maxPathLength: 200,
  maxIdLength: 100,
  maxTextLength: 60,
} as const

export const NETWORK_ORIGINS_MAX = 16

export const CODE_TYPES: Readonly<Record<string, string>> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
}

export const ASSET_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  riv: 'application/octet-stream',
  lottie: 'application/zip',
  ktx2: 'image/ktx2',
  hdr: 'application/octet-stream',
}

/** Content-Type of every file the sandbox may load, by lower-case extension. */
export const SERVED_TYPES: Readonly<Record<string, string>> = { ...CODE_TYPES, ...ASSET_TYPES }

export type FileClass = 'manifest' | 'code' | 'asset' | 'source'

export interface FolderFile {
  path: string
  size: number
}

export interface FolderSizes {
  code: number
  assets: number
  source: number
}

export interface WidgetFolder {
  manifest: WidgetPackageManifest
  files: FolderFile[]
  sizes: FolderSizes
}

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

const MANIFEST_KEYS = ['id', 'version', 'title', 'author', 'sdk', 'entry', 'styles', 'sizing', 'permissions', 'network', 'settings']
const SIZING_KEYS = ['default', 'min', 'max']
const SIZE_KEYS = ['w', 'h']

export interface WidgetPackageManifest {
  id: string
  version: string
  title: string
  author: string
  sdk: SdkLevel
  entry: string
  styles: string[]
  sizing: WidgetSizing
  permissions: WidgetPermission[]
  // Spec 2026-10-11: exact origins for http.get/http.send. Optional: stored manifests of older
  // versions are read back without re-validation and lack it; absent means no origins.
  network?: string[]
  settings?: SettingsSchema
}

/** `POST /widget-uploads` (hash null) and `POST /widget-uploads/:id/install` answer with this. */
export interface PackageInspection {
  manifest: WidgetPackageManifest
  hash: string | null
  installed: boolean
  // Manifest permissions the package does not hold yet.
  newPermissions: WidgetPermission[]
  // Manifest network origins the package does not hold yet (spec 2026-10-11).
  newOrigins: string[]
  sizes: FolderSizes
}

export interface UploadCreated {
  uploadId: string
  inspection: PackageInspection
}

export interface InstalledPackageVersion {
  version: string
  hash: string
  manifest: WidgetPackageManifest
  // Absolute paths for restoring the project; null when the folder is absent.
  paths: { source: string | null; assets: string | null }
}

export interface InstalledPackage {
  id: string
  title: string
  author: string
  // Newest first.
  versions: InstalledPackageVersion[]
  grants: Grant[]
  // Network origins the user approved for the package.
  origins: string[]
}

export function isPackageId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PACKAGE_LIMITS.maxIdLength && ID_PATTERN.test(value)
}

export function isPackageVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value)
}

/** `scheme://host[:port]` exactly as `URL#origin` prints it: no path, credentials, default port or wildcard. */
export function isNetworkOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname.includes('*') && url.origin === value
}

function parseNetwork(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > NETWORK_ORIGINS_MAX) return null
  if (!raw.every(isNetworkOrigin) || new Set(raw).size !== raw.length) return null
  return [...raw]
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
  return ordered && max.w <= GRID_COLS && max.h <= ROWS.max ? { default: preferred, min, max } : null
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
  const sdk = raw.sdk
  if (typeof sdk !== 'number' || !Number.isInteger(sdk)) return fail('manifest.sdk must be an integer level')
  if (!(SDK_LEVELS as readonly number[]).includes(sdk)) {
    if (sdk > SDK_LEVELS.at(-1)!) {
      return fail(`manifest.sdk ${sdk} needs a newer LifeDashboard (this one supports ${SDK_LEVELS[0]}–${SDK_LEVELS.at(-1)})`)
    }
    return fail('manifest.sdk must be an integer level')
  }
  if (Object.hasOwn(raw, 'settings') && sdk === 1) return fail('manifest.settings needs sdk 2')
  if (typeof raw.entry !== 'string') return fail('manifest.entry must name a .js file in files')
  if (!Array.isArray(raw.styles) || !raw.styles.every((item) => typeof item === 'string')) {
    return fail('manifest.styles must name .css files in files')
  }
  const sizing = parseSizing(raw.sizing)
  if (!sizing) {
    return fail(`manifest.sizing must have integer sizes with min ≤ default ≤ max inside the ${GRID_COLS}x${ROWS.max} grid`)
  }
  const permissions = parsePermissions(raw.permissions)
  if (!permissions) return fail(`manifest.permissions must be distinct items of: ${WIDGET_PERMISSIONS.join(', ')}`)
  let network: string[] | undefined
  if (raw.network !== undefined) {
    const parsed = parseNetwork(raw.network)
    if (!parsed) {
      return fail(
        `manifest.network must be 1–${NETWORK_ORIGINS_MAX} distinct origins such as http://127.0.0.1:8787 (scheme, host and port only)`,
      )
    }
    network = parsed
  }
  if (permissions.includes('network') !== (network !== undefined)) {
    return fail('manifest.network and the network permission must be declared together')
  }
  let settings: SettingsSchema | undefined
  if (Object.hasOwn(raw, 'settings')) {
    const parsed = parseSettingsSchema(raw.settings, network ?? [])
    if (!parsed.ok) return parsed
    settings = parsed.value
  }
  return {
    ok: true,
    value: {
      id: raw.id,
      version: raw.version,
      title: raw.title,
      author: raw.author,
      sdk: sdk as SdkLevel,
      entry: raw.entry,
      styles: [...(raw.styles as string[])],
      sizing,
      permissions,
      // Left out when absent, so a manifest without network keeps its canonical JSON and package hash.
      ...(network === undefined ? {} : { network }),
      ...(settings === undefined ? {} : { settings }),
    },
  }
}

export function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * The class of a package path, or null when the path breaks the path rules or has no place in a
 * package. Serving passes `Infinity`: migrated v1 file names have no length limit.
 */
export function classifyPath(path: string, maxLength: number = PACKAGE_LIMITS.maxPathLength): FileClass | null {
  if (path.length === 0 || path.length > maxLength) return null
  const segments = path.split('/')
  const inSource = segments[0] === 'source' && segments.length > 1
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment) || segment === '.' || segment === '..') return null
    if (!inSource && segment.startsWith('.')) return null
  }
  if (inSource) return 'source'
  if (segments.length === 1) {
    if (path === 'widget.json') return 'manifest'
    return Object.hasOwn(CODE_TYPES, fileExtension(path)) ? 'code' : null
  }
  if (segments[0] === 'assets') return Object.hasOwn(ASSET_TYPES, fileExtension(path)) ? 'asset' : null
  return null
}

/** `widget.json` of a v2 folder: the v1 manifest plus `"format": 2`, which is not kept. */
export function parseWidgetManifest(raw: unknown): ParseResult<WidgetPackageManifest> {
  if (!isRecord(raw)) return fail('manifest must be an object')
  if (raw.format !== 2) return fail('manifest.format must be 2')
  const { format: _format, ...fields } = raw
  return parseManifest(fields)
}

// Single validation point for a folder from outside the process: the CLI, the UI and the API.
export function parseWidgetFolder(rawManifest: unknown, rawFiles: unknown): ParseResult<WidgetFolder> {
  const parsed = parseWidgetManifest(rawManifest)
  if (!parsed.ok) return parsed
  const manifest = parsed.value
  if (!Array.isArray(rawFiles)) return fail('files must be a list')
  if (rawFiles.length > PACKAGE_LIMITS.maxFiles) return fail(`files: at most ${PACKAGE_LIMITS.maxFiles} files`)
  const files: FolderFile[] = []
  const sizes: FolderSizes = { code: 0, assets: 0, source: 0 }
  const code = new Set<string>()
  // Lower case: one file on a case-insensitive disk.
  const taken = new Set<string>()
  const directories = new Set<string>()
  for (const item of rawFiles) {
    if (!isRecord(item) || unknownKey(item, ['path', 'size']) !== undefined || typeof item.path !== 'string') {
      return fail('files: each item is { path, size }')
    }
    const { path, size } = item
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return fail(`files: "${path}" has an invalid size`)
    const fileClass = classifyPath(path)
    if (fileClass === null) return fail(`files: "${path}" is not an allowed path`)
    const folded = path.toLowerCase()
    const parts = folded.split('/')
    const prefixes = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
    if (taken.has(folded) || directories.has(folded) || prefixes.some((prefix) => taken.has(prefix))) {
      return fail(`files: "${path}" collides with another path when letter case is ignored`)
    }
    taken.add(folded)
    for (const prefix of prefixes) directories.add(prefix)
    if (fileClass === 'manifest' && size > PACKAGE_LIMITS.manifestBytes) return fail('widget.json must be at most 64 KB')
    if (fileClass === 'code') {
      sizes.code += size
      code.add(path)
    } else if (fileClass === 'asset') sizes.assets += size
    else if (fileClass === 'source') sizes.source += size
    files.push({ path, size })
  }
  if (!taken.has('widget.json')) return fail('widget.json is required')
  if (sizes.code > PACKAGE_LIMITS.codeBytes) return fail('code (.js, .mjs, .css, .wasm) is larger than 10 MB')
  if (!/\.m?js$/.test(manifest.entry) || !code.has(manifest.entry)) return fail('manifest.entry must name a .js file in the folder root')
  if (!manifest.styles.every((name) => name.endsWith('.css') && code.has(name))) {
    return fail('manifest.styles must name .css files in the folder root')
  }
  return { ok: true, value: { manifest, files, sizes } }
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
