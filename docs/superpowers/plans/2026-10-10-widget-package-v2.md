# Widget Package v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widgets install as folders (code ≤ 10 MB, unlimited media, bundled sources) uploaded through the UI into `<dataDir>/userwidgets/<id>/<version>/`, served to the sandbox from disk with Range support and a wider CSP; v1 packages migrate.

**Architecture:** `packages/contracts` gains the v2 manifest and folder validation (`classifyPath`, `parseWidgetFolder`), shared by CLI, UI and API. The API stores versions on disk (`apps/api/src/userwidgets.ts`), migrates v1 rows with a function migration, accepts uploads through in-memory upload sessions (`apps/api/src/widget-uploads.ts`) and serves code and assets from disk. `ld-widget build` emits a folder with `assets/` and `source/`; the UI picks or drops a folder, reviews it, uploads files three at a time and installs.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Node.js 24 (`node:sqlite`, `node:fs`, `node:stream/promises`), Fastify 5, Vite 8 + `@vitejs/plugin-vue`, Vue 3.5 / Nuxt 4 (`ssr: false`), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-10-widget-package-v2-design.md`

## Global Constraints

- Branch: `feat/widget-package-v2` (current). Never commit to `main`.
- Commits: conventional `type(scope): subject`, one or two lines, **no attribution trailers** (the user's CLAUDE.md overrides the harness reminder).
- No new dependencies (runtime or test). No `@fastify/multipart`, no zip library, no `@vue/test-utils`/`happy-dom`: Vue logic is tested in Node as today.
- Limits, verbatim: code (`.js .mjs .css .wasm` in the root) ≤ `10_485_760` bytes total; `widget.json` ≤ `65_536` bytes; ≤ `2000` files; path ≤ `200` characters at upload; media and `source/` unlimited.
- Path rules: segments `[A-Za-z0-9._-]+`, never `.` or `..`, separator `/`; dot-prefixed segments only inside `source/`; case-insensitive collisions of paths and of a file with a directory prefix are rejected.
- Asset extensions (`assets/**`): `png jpg jpeg webp avif gif svg mp4 webm mp3 ogg oga opus wav m4a aac flac woff2 woff ttf otf json glb gltf bin riv lottie ktx2 hdr`.
- Version hash: `sha256` over lines `<path>\0<sha256 hex of file>\n` for every file, sorted by path.
- Storage: `<dataDir>/userwidgets/<id>/<version>/`, staging `userwidgets/.staging/<uploadId>/`, orphans `userwidgets/.orphaned/<id>-<version>-<epoch ms>/`. Only an explicit package delete removes a version folder.
- Upload sessions: in memory, at most 3, idle expiry 30 minutes, busy during install.
- The upload `PUT` requires `Content-Type: application/octet-stream`; every other mutating `/api/` request still requires `application/json`.
- Document CSP, verbatim (spec «Document CSP»): `default-src 'none'`; `script-src <runtime> <package> 'sha256-<import map>' 'wasm-unsafe-eval'`; `style-src <package> 'unsafe-inline'`; `img-src <package> data: blob:`; `media-src <package> blob:`; `font-src <package> data:`; `connect-src <package> data: blob:`; `worker-src blob:`; `frame-src 'none'`; `object-src 'none'`; `base-uri <package>`; `form-action 'none'`. The document starts `<head>` with `<base href="<package>">`.
- Package file responses carry `Content-Security-Policy: sandbox; default-src 'none'`.
- `ld-widget build` excludes from `source/`: `node_modules/` (any depth), top-level `dist/` and `assets/`, `.git/`, `.DS_Store`, names starting with `.env`. Importing any audio/video file, or another media file larger than `102_400` bytes, fails the build with `reference media by URL: assets/<name>`.
- UI copy (Russian, verbatim): «Установить», «Выбрать папку», «Отмена», «Повторить», «Исходники», «Медиа», «Исходники не включены», «Копировать», «Эта версия уже установлена», «В папке нет widget.json», «Перетащите папку виджета», «Код», «Размер файлов».
- Browser work uses Orca's built-in browser through `orca-cli` only (project rule).
- Run each task's package tests; Task 5 and Task 8 run `pnpm typecheck` and `pnpm test` at the root.

## Review Focus

1. The user picks the parent `dist/` instead of `dist/<id>-<version>/`: `widget.json` is not at the root; the UI must say «В папке нет widget.json», not upload anything (Task 7 test).
2. Zero-byte files (empty `style.css`, `source/.gitkeep`): the octet-stream `PUT` with an empty body must store an empty file, not fail (Task 5 test).
3. Installing the same folder twice: the second install answers `installed: true`, keeps one version and leaves no staging folder (Task 5 test).
4. The API restarts during an upload: the next `PUT` answers `NOT_FOUND`; the UI stops, names the file and offers to start over (Task 5 and Task 7 tests).
5. Media with upper-case extensions (`Clip.MP4`): accepted at upload and served as `video/mp4` (Task 1 and Task 4 tests).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/contracts/src/widget-package.ts` | Modify: v2 limits, `SERVED_TYPES`, `classifyPath`, `parseWidgetManifest`, `parseWidgetFolder`, `FolderSizes`, `UploadCreated`, `paths`; later remove v1 `parseWidgetPackage` |
| `apps/api/src/userwidgets.ts` | Create: folder layout, `listFiles`, `versionHash`, `moveToOrphaned`, `cleanUserwidgets`, `writeV1Version`, `resolveInside` |
| `apps/api/src/migrations.ts` | Modify: `Migration` type, migration 6 (v1 files to disk, drop `files`) |
| `apps/api/src/db.ts` | Modify: `openDatabase(file, context, migrations)` runs function migrations |
| `apps/api/src/server.ts`, `apps/api/src/app.ts` | Modify: pass `dataDir` |
| `apps/api/src/widget-packages.ts` | Modify: storage on disk, startup cleanup, `insertVersion`, `paths`, delete removes folder; later drop v1 routes |
| `apps/api/src/widget-uploads.ts` | Create: upload sessions and routes |
| `apps/api/src/auth.ts` | Modify: octet-stream exception for the upload `PUT` |
| `apps/api/src/sandbox.ts` | Modify: files from disk, wildcard route, Range, CSP, `<base>` |
| `packages/widget-sdk/src/build.ts`, `cli.ts` | Modify: folder output, chunks, assets, sources, media guard, `--no-source` |
| `apps/ui/app/api.ts` | Modify: upload calls, raw `Blob` body, signal instead of timeout |
| `apps/ui/app/widgets/catalog.ts` | Modify: `filesFromInput`, `filesFromEntry`, `readFolder`, `uploadFiles`, `formatBytes`; remove `readPackageFile` |
| `apps/ui/app/widgets/PackagesDialog.vue` | Modify: folder install flow, progress, retry, paths, delete warning |
| `examples/widgets/hello`, `examples/widgets/hostile` | Modify: background video, new probes, evil SVG |
| `README.md` | Modify: Widget SDK section |

---

### Task 1: Contracts — v2 manifest and folder validation

**Files:**
- Modify: `packages/contracts/src/widget-package.ts`
- Test: `packages/contracts/test/widget-package.test.ts`

**Interfaces:**
- Produces:
  - `PACKAGE_LIMITS = { maxBytes, codeBytes, manifestBytes, maxFiles, maxPathLength, maxIdLength, maxTextLength }` (`maxBytes` is v1-only and leaves in Task 8)
  - `CODE_TYPES`, `ASSET_TYPES`, `SERVED_TYPES: Readonly<Record<string, string>>`
  - `type FileClass = 'manifest' | 'code' | 'asset' | 'source'`
  - `fileExtension(path: string): string` (lower case, `''` when none)
  - `classifyPath(path: string, maxLength?: number): FileClass | null`
  - `interface FolderFile { path: string; size: number }`, `interface FolderSizes { code: number; assets: number; source: number }`, `interface WidgetFolder { manifest: WidgetPackageManifest; files: FolderFile[]; sizes: FolderSizes }`
  - `parseWidgetManifest(raw: unknown): ParseResult<WidgetPackageManifest>`
  - `parseWidgetFolder(manifest: unknown, files: unknown): ParseResult<WidgetFolder>`

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/test/widget-package.test.ts` (add the new names to the import from `../src/widget-package.ts`: `classifyPath, parseWidgetFolder, parseWidgetManifest, SERVED_TYPES`):

```ts
const manifestV2 = { format: 2, ...valid.manifest }
const folderFiles = [
  { path: 'widget.json', size: 300 },
  { path: 'index.js', size: 1000 },
  { path: 'style.css', size: 50 },
]

function folder(change?: (files: { path: string; size: number }[], manifest: any) => void) {
  const files = structuredClone(folderFiles)
  const manifest = structuredClone(manifestV2)
  change?.(files, manifest)
  return parseWidgetFolder(manifest, files)
}

describe('parseWidgetManifest', () => {
  it('accepts a v2 manifest and returns it without format', () => {
    expect(parseWidgetManifest(structuredClone(manifestV2))).toEqual({ ok: true, value: valid.manifest })
  })

  it.each([
    ['no format', valid.manifest, /format must be 2/],
    ['format 1', { ...manifestV2, format: 1 }, /format must be 2/],
    ['an unknown field', { ...manifestV2, files: {} }, /manifest: unknown field "files"/],
    ['a bad id', { ...manifestV2, id: 'x' }, /manifest\.id/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseWidgetManifest(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})

describe('classifyPath', () => {
  it.each([
    ['widget.json', 'manifest'],
    ['index.js', 'code'],
    ['chunk-a1b2.mjs', 'code'],
    ['style.css', 'code'],
    ['rive.wasm', 'code'],
    ['assets/bg.mp4', 'asset'],
    ['assets/Clip.MP4', 'asset'],
    ['assets/models/ship.glb', 'asset'],
    ['assets/data.json', 'asset'],
    ['source/src/index.vue', 'source'],
    ['source/.npmrc', 'source'],
    ['source/My_File.TS', 'source'],
  ])('%s is %s', (path, fileClass) => {
    expect(classifyPath(path)).toBe(fileClass)
  })

  it.each([
    'README.md',
    'Widget.json',
    'lib/index.js',
    'assets/run.js',
    'assets/.hidden.png',
    '.env',
    'assets/../index.js',
    'assets/./a.png',
    'source',
    'source/a b.ts',
    'source/../x',
    'assets//a.png',
    '/index.js',
    '',
  ])('rejects %s', (path) => {
    expect(classifyPath(path)).toBeNull()
  })

  it('applies the length limit unless serving passes Infinity', () => {
    const long = `${'a'.repeat(198)}.js`
    expect(classifyPath(long)).toBeNull()
    expect(classifyPath(long, Infinity)).toBe('code')
  })
})

describe('SERVED_TYPES', () => {
  it('maps code and asset extensions', () => {
    expect(SERVED_TYPES.js).toBe('text/javascript; charset=utf-8')
    expect(SERVED_TYPES.wasm).toBe('application/wasm')
    expect(SERVED_TYPES.mp4).toBe('video/mp4')
    expect(SERVED_TYPES.woff2).toBe('font/woff2')
  })
})

describe('parseWidgetFolder', () => {
  it('accepts a folder and sums sizes per class', () => {
    const result = folder((files) => {
      files.push({ path: 'assets/bg.mp4', size: 50_000_000 }, { path: 'source/src/index.vue', size: 700 })
    })
    expect(result).toEqual({
      ok: true,
      value: {
        manifest: valid.manifest,
        files: [...folderFiles, { path: 'assets/bg.mp4', size: 50_000_000 }, { path: 'source/src/index.vue', size: 700 }],
        sizes: { code: 1050, assets: 50_000_000, source: 700 },
      },
    })
  })

  it('accepts exactly 10 MB of code and a zero-byte file', () => {
    expect(folder((files) => {
      files[1]!.size = 10_485_760 - 50
      files.push({ path: 'source/.gitkeep', size: 0 })
    }).ok).toBe(true)
  })

  it.each([
    ['a missing widget.json', (f: any[]) => { f.splice(0, 1) }, /widget\.json is required/],
    ['code over 10 MB', (f: any[]) => { f[1].size = 10_485_760 }, /code .* larger than 10 MB/],
    ['a widget.json over 64 KB', (f: any[]) => { f[0].size = 65_537 }, /widget\.json must be at most 64 KB/],
    ['2001 files', (f: any[]) => { for (let i = 0; i < 1998; i++) f.push({ path: `source/f${i}`, size: 1 }) }, /at most 2000 files/],
    ['a forbidden path', (f: any[]) => { f.push({ path: 'assets/x.exe', size: 1 }) }, /"assets\/x\.exe" is not an allowed path/],
    ['a negative size', (f: any[]) => { f[1].size = -1 }, /"index\.js" has an invalid size/],
    ['a fractional size', (f: any[]) => { f[1].size = 1.5 }, /"index\.js" has an invalid size/],
    ['an extra item field', (f: any[]) => { f[1].hash = 'x' }, /each item is \{ path, size \}/],
    ['a duplicate path', (f: any[]) => { f.push({ path: 'index.js', size: 1 }) }, /"index\.js" collides/],
    ['paths differing in case', (f: any[]) => { f.push({ path: 'assets/a.png', size: 1 }, { path: 'assets/A.PNG', size: 1 }) }, /"assets\/A\.PNG" collides/],
    ['a file and a directory', (f: any[]) => { f.push({ path: 'assets/a.mp4', size: 1 }, { path: 'assets/A.MP4/x.png', size: 1 }) }, /"assets\/A\.MP4\/x\.png" collides/],
    ['a directory then a file', (f: any[]) => { f.push({ path: 'assets/a/x.png', size: 1 }, { path: 'assets/A', size: 1 }) }, /"assets\/A" is not an allowed path|collides/],
    ['a missing entry', (f: any[], m: any) => { m.entry = 'main.js' }, /manifest\.entry/],
    ['a CSS entry', (f: any[], m: any) => { m.entry = 'style.css' }, /manifest\.entry/],
    ['a missing style', (f: any[], m: any) => { m.styles = ['theme.css'] }, /manifest\.styles/],
    ['files that are not a list', null, /files must be a list/],
  ])('rejects %s', (_name, change, message) => {
    const result = change === null ? parseWidgetFolder(structuredClone(manifestV2), {}) : folder(change as any)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})
```

Also edit the existing v1 case `['21 files', …]`: it must still expect `/at most 20 files/` (v1 keeps its own limit in Step 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/contracts test`
Expected: FAIL — `classifyPath`, `parseWidgetFolder`, `parseWidgetManifest`, `SERVED_TYPES` are not exported.

- [ ] **Step 3: Implement**

In `packages/contracts/src/widget-package.ts`:

1. Replace `PACKAGE_LIMITS` and keep the v1 file limit local:

```ts
export const PACKAGE_LIMITS = {
  // v1 `.ldwidget.json` body limit; leaves with the v1 format.
  maxBytes: 1_048_576,
  codeBytes: 10_485_760,
  manifestBytes: 65_536,
  maxFiles: 2000,
  maxPathLength: 200,
  maxIdLength: 100,
  maxTextLength: 60,
} as const

const V1_MAX_FILES = 20
```

In `parseWidgetPackage` replace `PACKAGE_LIMITS.maxFiles` with `V1_MAX_FILES` (both occurrences in that function).

2. Add after the existing constants:

```ts
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
```

Note: `'assets/A'` in the «a directory then a file» case is rejected by `classifyPath` (no extension), which the test accepts.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/contracts test && pnpm -C packages/contracts typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/widget-package.ts packages/contracts/test/widget-package.test.ts
git commit -m "feat(contracts): widget package v2 manifest and folder validation"
```

---

### Task 2: API storage module `userwidgets.ts`

**Files:**
- Create: `apps/api/src/userwidgets.ts`
- Test: `apps/api/test/userwidgets.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `STAGING = '.staging'`, `ORPHANED = '.orphaned'`
  - `userwidgetsDir(dataDir: string): string`
  - `versionDir(root: string, id: string, version: string): string`
  - `stagingDir(root: string, uploadId: string): string`
  - `listFiles(dir: string): string[]` (sorted `/`-separated relative paths of regular files)
  - `versionHash(dir: string): Promise<string>`
  - `moveToOrphaned(root: string, id: string, version: string, now: Date): string`
  - `cleanUserwidgets(root: string, installed: ReadonlySet<string>, now: Date): void` (`installed` holds `"<id>/<version>"`)
  - `writeV1Version(dir: string, manifest: object, files: Record<string, string>): void`
  - `resolveInside(dir: string, path: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/userwidgets.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanUserwidgets,
  listFiles,
  moveToOrphaned,
  resolveInside,
  stagingDir,
  versionDir,
  versionHash,
  writeV1Version,
} from '../src/userwidgets.ts'

let root: string
const NOW = new Date('2026-10-10T12:00:00.000Z')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ld-userwidgets-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function put(path: string, content: string) {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), content)
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('listFiles', () => {
  it('lists regular files recursively, sorted, with / separators', () => {
    put('v/widget.json', '{}')
    put('v/assets/b.png', 'b')
    put('v/assets/a/x.png', 'x')
    put('v/index.js', '')
    expect(listFiles(join(root, 'v'))).toEqual(['assets/a/x.png', 'assets/b.png', 'index.js', 'widget.json'])
  })
})

describe('versionHash', () => {
  it('hashes sorted path and content digests', async () => {
    put('v/index.js', 'a')
    put('v/assets/x.png', 'b')
    const expected = createHash('sha256').update(`assets/x.png\0${sha('b')}\nindex.js\0${sha('a')}\n`).digest('hex')
    expect(await versionHash(join(root, 'v'))).toBe(expected)
  })

  it('changes with content and with a path', async () => {
    put('v/index.js', 'a')
    const first = await versionHash(join(root, 'v'))
    writeFileSync(join(root, 'v/index.js'), 'b')
    expect(await versionHash(join(root, 'v'))).not.toBe(first)
  })
})

describe('moveToOrphaned', () => {
  it('moves a version folder under .orphaned with id, version and time', () => {
    put('dev.a.b/1.0.0/index.js', 'x')
    const target = moveToOrphaned(root, 'dev.a.b', '1.0.0', NOW)
    expect(target).toBe(join(root, '.orphaned', `dev.a.b-1.0.0-${NOW.getTime()}`))
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe('x')
    expect(existsSync(versionDir(root, 'dev.a.b', '1.0.0'))).toBe(false)
  })
})

describe('cleanUserwidgets', () => {
  it('deletes staging, moves orphan versions and keeps installed ones', () => {
    put(`.staging/u1/index.js`, 'x')
    put('dev.a.b/1.0.0/index.js', 'kept')
    put('dev.a.b/2.0.0/source/src/index.vue', 'orphan')
    put('dev.c.d/1.0.0/index.js', 'orphan')
    cleanUserwidgets(root, new Set(['dev.a.b/1.0.0']), NOW)
    expect(existsSync(stagingDir(root, 'u1'))).toBe(false)
    expect(readFileSync(join(root, 'dev.a.b/1.0.0/index.js'), 'utf8')).toBe('kept')
    expect(readdirSync(join(root, '.orphaned')).sort()).toEqual([`dev.a.b-2.0.0-${NOW.getTime()}`, `dev.c.d-1.0.0-${NOW.getTime()}`])
    expect(existsSync(join(root, 'dev.c.d'))).toBe(false)
  })

  it('does nothing when the root does not exist', () => {
    expect(() => cleanUserwidgets(join(root, 'missing'), new Set(), NOW)).not.toThrow()
  })
})

describe('writeV1Version', () => {
  it('writes the files and a format 2 widget.json and never overwrites', () => {
    const dir = join(root, 'dev.a.b/1.0.0')
    writeV1Version(dir, { id: 'dev.a.b' }, { 'index.js': 'export default {}' })
    expect(readFileSync(join(dir, 'index.js'), 'utf8')).toBe('export default {}')
    expect(JSON.parse(readFileSync(join(dir, 'widget.json'), 'utf8'))).toEqual({ format: 2, id: 'dev.a.b' })
    expect(() => writeV1Version(dir, { id: 'dev.a.b' }, { 'index.js': 'x' })).toThrow(/EEXIST/)
  })
})

describe('resolveInside', () => {
  it('resolves a path inside the folder and refuses one outside', () => {
    expect(resolveInside(join(root, 'v'), 'assets/a.png')).toBe(join(root, 'v', 'assets', 'a.png'))
    expect(resolveInside(join(root, 'v'), '../x')).toBeNull()
    expect(resolveInside(join(root, 'v'), '')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/userwidgets.test.ts`
Expected: FAIL — `Cannot find module '../src/userwidgets.ts'`.

- [ ] **Step 3: Implement**

Create `apps/api/src/userwidgets.ts`:

```ts
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

// Spec «Data»: installed versions live on disk; SQLite keeps metadata only.
export const STAGING = '.staging'
export const ORPHANED = '.orphaned'

export function userwidgetsDir(dataDir: string): string {
  return join(dataDir, 'userwidgets')
}

export function versionDir(root: string, id: string, version: string): string {
  return join(root, id, version)
}

export function stagingDir(root: string, uploadId: string): string {
  return join(root, STAGING, uploadId)
}

/** Regular files under `dir` as sorted '/'-separated relative paths. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/** Spec «Version hash»: sha256 over `<path>\0<sha256 of the file>\n`, sorted by path. */
export async function versionHash(dir: string): Promise<string> {
  const outer = createHash('sha256')
  for (const path of listFiles(dir)) {
    const inner = createHash('sha256')
    for await (const chunk of createReadStream(join(dir, path))) inner.update(chunk as Buffer)
    outer.update(`${path}\0${inner.digest('hex')}\n`)
  }
  return outer.digest('hex')
}

/** A version folder without a database row is moved aside, never deleted: it may hold the only sources. */
export function moveToOrphaned(root: string, id: string, version: string, now: Date): string {
  const target = join(root, ORPHANED, `${id}-${version}-${now.getTime()}`)
  mkdirSync(join(root, ORPHANED), { recursive: true })
  renameSync(versionDir(root, id, version), target)
  return target
}

/** Startup: uploads that were never installed go; version folders without a row move to `.orphaned/`. */
export function cleanUserwidgets(root: string, installed: ReadonlySet<string>, now: Date): void {
  rmSync(join(root, STAGING), { recursive: true, force: true })
  if (!existsSync(root)) return
  for (const pkg of readdirSync(root, { withFileTypes: true })) {
    if (!pkg.isDirectory() || pkg.name.startsWith('.')) continue
    for (const version of readdirSync(join(root, pkg.name), { withFileTypes: true })) {
      if (version.isDirectory() && !installed.has(`${pkg.name}/${version.name}`)) moveToOrphaned(root, pkg.name, version.name, now)
    }
    if (readdirSync(join(root, pkg.name)).length === 0) rmSync(join(root, pkg.name), { recursive: true })
  }
}

/** A v1 package as a v2 version folder. `wx`: an existing file is an error, never overwritten. */
export function writeV1Version(dir: string, manifest: object, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, { flag: 'wx' })
  writeFileSync(join(dir, 'widget.json'), `${JSON.stringify({ format: 2, ...manifest }, null, 2)}\n`, { flag: 'wx' })
}

/** The absolute path of `path` when it stays inside `dir`, otherwise null. */
export function resolveInside(dir: string, path: string): string | null {
  const full = resolve(dir, path)
  return full.startsWith(`${resolve(dir)}${sep}`) ? full : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/userwidgets.test.ts && pnpm -C apps/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/userwidgets.ts apps/api/test/userwidgets.test.ts
git commit -m "feat(api): userwidgets folder storage helpers"
```

---

### Task 3: Versions on disk — function migrations, migration 6, disk-backed install and sandbox

**Files:**
- Modify: `apps/api/src/migrations.ts`, `apps/api/src/db.ts`, `apps/api/src/server.ts`, `apps/api/src/app.ts`, `apps/api/src/widget-packages.ts`, `apps/api/src/sandbox.ts`
- Modify tests: `apps/api/test/helpers.ts`, `apps/api/test/db.test.ts`, `apps/api/test/widget-packages.test.ts`, `apps/api/test/auth.test.ts`, `apps/api/test/widget-gateway.test.ts`

**Interfaces:**
- Consumes: Task 1 `classifyPath`; Task 2 `userwidgetsDir`, `versionDir`, `moveToOrphaned`, `cleanUserwidgets`, `writeV1Version`.
- Produces:
  - `export interface MigrationContext { dataDir: string }`, `export type Migration = string | ((db: DatabaseSync, context: MigrationContext) => void)`
  - `openDatabase(file: string, context: MigrationContext, migrations?: readonly Migration[]): Promise<DatabaseSync>`
  - `AppDeps.config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir'>`
  - `WidgetPackagesDeps` gains `dataDir: string`; `SandboxDeps.config` gains `dataDir`
  - `installedVersions(db: DatabaseSync): Set<string>` exported from `widget-packages.ts`
  - Test helpers: `TestApp.dataDir: string`; `testApp(base?: Pick<TestApp, 'db' | 'dataDir'>)`

- [ ] **Step 1: Write the failing migration test**

In `apps/api/test/db.test.ts`:

1. Every `openDatabase(file, X)` and `openDatabase(':memory:')` call gains the context as the second argument: `openDatabase(file, ctx(), X)` / `openDatabase(':memory:', ctx())`, with this helper after `let file: string`:

```ts
const ctx = () => ({ dataDir: dir })
```

2. Update the expected table list in «creates the schema…» (unchanged names) and add:

```ts
describe('migration 6: package files to disk', () => {
  const MANIFEST = { id: 'dev.test.hello', version: '1.0.0', title: 'Hello', author: 'test', sdk: 1, entry: 'index.js', styles: ['style.css'], sizing: { default: { w: 3, h: 3 }, min: { w: 2, h: 2 }, max: { w: 6, h: 6 } }, permissions: ['state'] }
  const HASH = 'a'.repeat(64)

  async function v5WithPackage(): Promise<void> {
    const v5 = await openDatabase(file, ctx(), MIGRATIONS.slice(0, 5))
    v5.prepare("INSERT INTO widget_packages (id, title, author, created_at) VALUES ('dev.test.hello', 'Hello', 'test', 'x')").run()
    v5.prepare('INSERT INTO widget_package_versions (package_id, version, hash, manifest, files, installed_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'dev.test.hello', '1.0.0', HASH, JSON.stringify(MANIFEST), JSON.stringify({ 'index.js': 'export default {}', 'style.css': '.a{}' }), 'x',
    )
    v5.close()
  }

  const versionPath = (...parts: string[]) => join(dir, 'userwidgets', 'dev.test.hello', '1.0.0', ...parts)

  it('writes files and a v2 widget.json, keeps the hash and drops files', async () => {
    await v5WithPackage()
    const db = await openDatabase(file, ctx())
    expect(userVersion(db)).toBe(6)
    expect(readFileSync(versionPath('index.js'), 'utf8')).toBe('export default {}')
    expect(readFileSync(versionPath('style.css'), 'utf8')).toBe('.a{}')
    expect(JSON.parse(readFileSync(versionPath('widget.json'), 'utf8'))).toEqual({ format: 2, ...MANIFEST })
    expect(db.prepare('SELECT hash, manifest FROM widget_package_versions').get()).toEqual({ hash: HASH, manifest: JSON.stringify(MANIFEST) })
    const columns = db.prepare('PRAGMA table_info(widget_package_versions)').all().map((row: any) => row.name)
    expect(columns).toEqual(['package_id', 'version', 'hash', 'manifest', 'installed_at'])
    db.close()
  })

  it('moves an existing version folder to .orphaned instead of overwriting it', async () => {
    await v5WithPackage()
    mkdirSync(versionPath('source'), { recursive: true })
    writeFileSync(versionPath('source', 'keep.txt'), 'v2 sources')
    const db = await openDatabase(file, ctx())
    const [orphan] = readdirSync(join(dir, 'userwidgets', '.orphaned'))
    expect(readFileSync(join(dir, 'userwidgets', '.orphaned', orphan!, 'source', 'keep.txt'), 'utf8')).toBe('v2 sources')
    expect(existsSync(versionPath('source'))).toBe(false)
    db.close()
  })

  it('rolls back and keeps files when a write fails, naming the package', async () => {
    await v5WithPackage()
    mkdirSync(join(dir, 'userwidgets'), { recursive: true })
    // A regular file where the package folder must go: mkdir fails.
    writeFileSync(join(dir, 'userwidgets', 'dev.test.hello'), 'x')
    await expect(openDatabase(file, ctx())).rejects.toThrow(/dev\.test\.hello@1\.0\.0/)
    const raw = new DatabaseSync(file)
    expect(userVersion(raw)).toBe(5)
    expect(raw.prepare('SELECT files FROM widget_package_versions').get()).toBeDefined()
    raw.close()
  })
})
```

Add to the imports: `mkdirSync, readdirSync, readFileSync, writeFileSync` from `node:fs`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/db.test.ts`
Expected: FAIL — migration 6 does not exist (`userVersion` is 5) and `openDatabase` ignores the context.

- [ ] **Step 3: Implement function migrations and migration 6**

`apps/api/src/migrations.ts` — add at the top and change the array type:

```ts
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { moveToOrphaned, userwidgetsDir, versionDir, writeV1Version } from './userwidgets.ts'

export interface MigrationContext {
  dataDir: string
}

// A function migration runs inside the same transaction as SQL ones; its file writes are not rolled back.
export type Migration = string | ((db: DatabaseSync, context: MigrationContext) => void)
```

Change `export const MIGRATIONS: readonly string[] = [` to `export const MIGRATIONS: readonly Migration[] = [` and append after the appearance migration:

```ts
  // Spec 2026-10-10-widget-package-v2 «Migration v1 → v2».
  movePackageFilesToDisk,
```

Then define it **above** `MIGRATIONS`:

```ts
function movePackageFilesToDisk(db: DatabaseSync, { dataDir }: MigrationContext): void {
  const root = userwidgetsDir(dataDir)
  const now = new Date()
  const rows = db.prepare('SELECT package_id, version, manifest, files FROM widget_package_versions').all() as unknown as {
    package_id: string
    version: string
    manifest: string
    files: string
  }[]
  for (const row of rows) {
    try {
      // A folder already there (a v2 install before an older database came back, or a failed attempt) is kept aside.
      if (existsSync(versionDir(root, row.package_id, row.version))) moveToOrphaned(root, row.package_id, row.version, now)
      writeV1Version(versionDir(root, row.package_id, row.version), JSON.parse(row.manifest) as object, JSON.parse(row.files) as Record<string, string>)
    } catch (error) {
      throw new Error(`Cannot move widget package ${row.package_id}@${row.version} to disk: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  db.exec(`
CREATE TABLE widget_package_versions_new (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version)
);
INSERT INTO widget_package_versions_new (package_id, version, hash, manifest, installed_at)
SELECT package_id, version, hash, manifest, installed_at FROM widget_package_versions;
DROP TABLE widget_package_versions;
ALTER TABLE widget_package_versions_new RENAME TO widget_package_versions;
`)
}
```

`apps/api/src/db.ts`:

```ts
import { MIGRATIONS, type Migration, type MigrationContext } from './migrations.ts'
...
export async function openDatabase(file: string, context: MigrationContext, migrations: readonly Migration[] = MIGRATIONS): Promise<DatabaseSync> {
```

and inside the loop replace `db.exec(sql)` (rename the loop variable `sql` to `migration`):

```ts
    for (const [index, migration] of migrations.entries()) {
      if (index < version) continue
      db.exec('BEGIN')
      try {
        if (typeof migration === 'string') db.exec(migration)
        else migration(db, context)
```

`apps/api/src/server.ts`: `db = await openDatabase(join(config.dataDir, DB_FILE), { dataDir: config.dataDir })`.

- [ ] **Step 4: Thread `dataDir` and move install/sandbox to disk**

`apps/api/src/app.ts`: `config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir'>`; `registerWidgetPackages(app, { db, now, dataDir: config.dataDir })`.

`apps/api/src/widget-packages.ts`:

```ts
import { existsSync } from 'node:fs'
import { cleanUserwidgets, moveToOrphaned, userwidgetsDir, versionDir, writeV1Version } from './userwidgets.ts'

export interface WidgetPackagesDeps {
  db: DatabaseSync
  now: () => Date
  dataDir: string
}

/** `"<id>/<version>"` of every installed version. */
export function installedVersions(db: DatabaseSync): Set<string> {
  const rows = db.prepare('SELECT package_id, version FROM widget_package_versions').all() as unknown as { package_id: string; version: string }[]
  return new Set(rows.map((row) => `${row.package_id}/${row.version}`))
}
```

At the top of `registerWidgetPackages` (destructure `dataDir`):

```ts
  const root = userwidgetsDir(dataDir)
  // Spec «Startup cleanup»: runs once per process, after migrations.
  cleanUserwidgets(root, installedVersions(db), now())
```

Pass `root` into `install(db, root, parse(request.body), now())`. In `install`, replace the `INSERT INTO widget_package_versions (… files …)` statement with:

```ts
      db.prepare('INSERT INTO widget_package_versions (package_id, version, hash, manifest, installed_at) VALUES (?, ?, ?, ?, ?)').run(
        manifest.id, manifest.version, parsed.hash, JSON.stringify(manifest), at,
      )
      // ponytail: transitional v1 route, replaced by uploads in Task 5.
      const dir = versionDir(root, manifest.id, manifest.version)
      if (existsSync(dir)) moveToOrphaned(root, manifest.id, manifest.version, now)
      writeV1Version(dir, manifest, files)
```

`apps/api/src/sandbox.ts`:

```ts
import { classifyPath } from '@lifedashboard/contracts/widget-package'
import { userwidgetsDir, versionDir, resolveInside } from './userwidgets.ts'

export interface SandboxDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir'>
}
```

Replace `findVersion` with:

```ts
  const root = userwidgetsDir(config.dataDir)

  function findVersion(hash: string): { manifest: WidgetPackageManifest; dir: string } {
    const row = HASH.test(hash)
      ? (db.prepare('SELECT package_id, version, manifest FROM widget_package_versions WHERE hash = ?').get(hash) as
          | { package_id: string; version: string; manifest: string }
          | undefined)
      : undefined
    if (!row) throw new ApiError('NOT_FOUND', 'Widget package not found')
    return { manifest: JSON.parse(row.manifest) as WidgetPackageManifest, dir: versionDir(root, row.package_id, row.version) }
  }
```

and the file route body with:

```ts
    const { dir } = findVersion(request.params.hash)
    const { file } = request.params
    const full = classifyPath(file, Infinity) === 'code' ? resolveInside(dir, file) : null
    if (full === null) throw new ApiError('NOT_FOUND', 'File not found')
    let body: string
    try {
      body = await readFile(full, 'utf8')
    } catch {
      throw new ApiError('NOT_FOUND', 'File not found')
    }
    return reply.header('cache-control', IMMUTABLE).type(file.endsWith('.css') ? CSS : JS).send(body)
```

- [ ] **Step 5: Update test helpers and callers**

`apps/api/test/helpers.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestApp {
  app: FastifyInstance
  db: DatabaseSync
  dataDir: string
  codes: string[]
  clock: { now: number }
  close(): Promise<void>
}

/** A test app on an in-memory database and a temporary data dir, or on `base` (then the caller closes both). */
export async function testApp(base?: Pick<TestApp, 'db' | 'dataDir'>): Promise<TestApp> {
  const dataDir = base?.dataDir ?? mkdtempSync(join(tmpdir(), 'ld-api-'))
  const database = base?.db ?? (await openDatabase(':memory:', { dataDir }))
  const codes: string[] = []
  const clock = { now: T0 }
  const app = buildApp({
    db: database,
    config: { port: 3001, uiOrigins: [ORIGIN], dataDir },
    now: () => new Date(clock.now),
    onPairingCode: (code) => codes.push(code),
  })
  await app.ready()
  return {
    app,
    db: database,
    dataDir,
    codes,
    clock,
    async close() {
      await app.close()
      if (!base) {
        database.close()
        rmSync(dataDir, { recursive: true, force: true })
      }
    },
  }
}
```

Replace `testApp(t.db)` with `testApp(t)` in `auth.test.ts:198`, `widget-packages.test.ts:163`, `widget-gateway.test.ts:180` and `:210`.

In `widget-packages.test.ts` «stores the version, files, hash and grants», replace the `SELECT files` assertion with:

```ts
    const dir = join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0')
    expect(readFileSync(join(dir, 'index.js'), 'utf8')).toBe(pkg.files['index.js'])
    expect(JSON.parse(readFileSync(join(dir, 'widget.json'), 'utf8'))).toEqual({ format: 2, ...pkg.manifest })
```

(imports: `readFileSync` from `node:fs`, `join` from `node:path`). Add a startup cleanup test in the same file:

```ts
describe('startup cleanup', () => {
  it('moves a version folder without a row to .orphaned on restart', async () => {
    await installPackage(t, cookie)
    t.db.prepare('DELETE FROM widget_packages').run()
    const restarted = await testApp(t)
    try {
      expect(readdirSync(join(t.dataDir, 'userwidgets', '.orphaned'))).toHaveLength(1)
      expect(existsSync(join(t.dataDir, 'userwidgets', 'dev.test.hello'))).toBe(false)
    } finally {
      await restarted.close()
    }
  })
})
```

(imports: `existsSync, readdirSync`).

- [ ] **Step 6: Run the API suite**

Run: `pnpm -C apps/api test && pnpm -C apps/api typecheck`
Expected: PASS (sandbox tests pass unchanged: files now come from disk).

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): store widget versions on disk and migrate v1 files"
```

---

### Task 4: Sandbox serving v2 — assets, Range, CSP, `<base>`

**Files:**
- Modify: `apps/api/src/sandbox.ts`
- Test: `apps/api/test/sandbox.test.ts`

**Interfaces:**
- Consumes: Task 1 `classifyPath`, `fileExtension`, `SERVED_TYPES`; Task 2 `resolveInside`; Task 3 `findVersion` returning `{ manifest, dir }`.
- Produces: `parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null`; `sandboxDocument(base, hash, manifest)` with the v2 CSP and `<base>`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/sandbox.test.ts`:

1. In «serves the document…», change the expected body and CSP:

```ts
    const pkgDir = `${BASE}/sandbox/packages/${hash}/`
    expect(response.body.startsWith(`<!doctype html>\n<html>\n<head>\n  <base href="${pkgDir}">\n  <meta charset="utf-8">\n`)).toBe(true)
    ...
    expect(response.headers['content-security-policy']).toBe(
      [
        "default-src 'none'",
        `script-src ${BASE}/sandbox/runtime/ ${pkgDir} 'sha256-${sha}' 'wasm-unsafe-eval'`,
        `style-src ${pkgDir} 'unsafe-inline'`,
        `img-src ${pkgDir} data: blob:`,
        `media-src ${pkgDir} blob:`,
        `font-src ${pkgDir} data:`,
        `connect-src ${pkgDir} data: blob:`,
        'worker-src blob:',
        "frame-src 'none'",
        "object-src 'none'",
        `base-uri ${pkgDir}`,
        "form-action 'none'",
      ].join('; '),
    )
```

2. Add asset fixtures: after `installPackage` in `beforeEach`, write files straight into the version folder (Task 5 replaces this with uploads):

```ts
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))

function versionPath(...parts: string[]) {
  return join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0', ...parts)
}

function addFile(path: string, content: string | Buffer) {
  mkdirSync(join(versionPath(path), '..'), { recursive: true })
  writeFileSync(versionPath(path), content)
}
```

and add a `describe`:

```ts
describe('package files from disk', () => {
  beforeEach(() => {
    addFile('assets/clip.mp4', VIDEO)
    addFile('assets/Big.MP4', VIDEO)
    addFile('assets/evil.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    addFile('source/src/index.vue', '<template/>')
    addFile(`${'a'.repeat(210)}.js`, 'export default 1')
  })

  const url = (path: string) => `/sandbox/packages/${hash}/${path}`

  it('serves an asset with its type, immutable cache, ranges and the sandbox CSP', async () => {
    const response = await call(t.app, { url: url('assets/clip.mp4'), origin: 'null' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('video/mp4')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.headers['content-length']).toBe('1000')
    expect(response.headers['cache-control']).toBe(IMMUTABLE)
    expect(response.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.rawPayload.equals(VIDEO)).toBe(true)
  })

  it('serves an upper-case extension with the lower-case type', async () => {
    expect((await call(t.app, { url: url('assets/Big.MP4') })).headers['content-type']).toBe('video/mp4')
  })

  it.each([
    ['bytes=0-99', 206, 'bytes 0-99/1000', 0, 100],
    ['bytes=900-', 206, 'bytes 900-999/1000', 900, 100],
    ['bytes=-10', 206, 'bytes 990-999/1000', 990, 10],
    ['bytes=990-5000', 206, 'bytes 990-999/1000', 990, 10],
  ])('answers %s with a partial response', async (range, status, contentRange, start, length) => {
    const response = await call(t.app, { url: url('assets/clip.mp4'), headers: { range } })
    expect(response.statusCode).toBe(status)
    expect(response.headers['content-range']).toBe(contentRange)
    expect(response.rawPayload.equals(VIDEO.subarray(start, start + length))).toBe(true)
  })

  it('answers 416 for an unsatisfiable range and 200 for a multi-range', async () => {
    const unsatisfiable = await call(t.app, { url: url('assets/clip.mp4'), headers: { range: 'bytes=1000-' } })
    expect(unsatisfiable.statusCode).toBe(416)
    expect(unsatisfiable.headers['content-range']).toBe('bytes */1000')
    expect((await call(t.app, { url: url('assets/clip.mp4'), headers: { range: 'bytes=0-1,5-6' } })).statusCode).toBe(200)
  })

  it('puts the sandbox CSP on an SVG so a direct visit runs no script', async () => {
    const response = await call(t.app, { url: url('assets/evil.svg') })
    expect(response.headers['content-type']).toBe('image/svg+xml')
    expect(response.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
  })

  it('serves a migrated v1 file name longer than 200 characters', async () => {
    expect((await call(t.app, { url: url(`${'a'.repeat(210)}.js`) })).statusCode).toBe(200)
  })

  it.each(['source/src/index.vue', 'widget.json', 'assets/missing.png', 'assets/..%2Fwidget.json', '..%2F..%2Fx.js', 'assets/x.exe'])(
    'answers 404 for %s',
    async (path) => {
      expect((await call(t.app, { url: url(path) })).statusCode).toBe(404)
    },
  )
})
```

Imports: `mkdirSync, writeFileSync` from `node:fs`; `join` from `node:path`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/sandbox.test.ts`
Expected: FAIL — old CSP, no `<base>`, assets 404, no Range.

- [ ] **Step 3: Implement**

In `apps/api/src/sandbox.ts`:

1. `sandboxDocument`: the HTML starts with `<base>` and the CSP becomes:

```ts
  const html =
    '<!doctype html>\n<html>\n<head>\n' +
    // Relative URLs (assets/…) must resolve against the API origin, not the proxying UI origin.
    `  <base href="${packageDir}">\n` +
    '  <meta charset="utf-8">\n' +
    `  <script type="importmap">${importMap}</script>\n` +
    links +
    `  <script type="module" src="${runtime}sdk.js"></script>\n` +
    '</head>\n<body><div id="app"></div></body>\n</html>\n'
  // Explicit URLs, not 'self': engines treat 'self' differently in opaque-origin documents.
  const csp = [
    "default-src 'none'",
    `script-src ${runtime} ${packageDir} 'sha256-${createHash('sha256').update(importMap).digest('base64')}' 'wasm-unsafe-eval'`,
    `style-src ${packageDir} 'unsafe-inline'`,
    `img-src ${packageDir} data: blob:`,
    `media-src ${packageDir} blob:`,
    `font-src ${packageDir} data:`,
    `connect-src ${packageDir} data: blob:`,
    'worker-src blob:',
    "frame-src 'none'",
    "object-src 'none'",
    `base-uri ${packageDir}`,
    "form-action 'none'",
  ].join('; ')
```

2. Add:

```ts
/** A single `bytes=` range; null means «send the whole file» (absent, malformed or multi-range). */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  let start: number
  let end: number
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (suffix === 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  return start >= size || start > end ? 'unsatisfiable' : { start, end }
}
```

3. Replace the `/sandbox/packages/:hash/:file` route with a wildcard route:

```ts
  // Spec «Sandbox serving»: root code and assets/** from the version folder; never source/** or widget.json.
  app.get<{ Params: { hash: string; '*': string } }>('/sandbox/packages/:hash/*', async (request, reply) => {
    const { dir } = findVersion(request.params.hash)
    const path = request.params['*']
    const fileClass = classifyPath(path, Infinity)
    const full = fileClass === 'code' || fileClass === 'asset' ? resolveInside(dir, path) : null
    const info = full === null ? null : await stat(full).catch(() => null)
    if (full === null || info === null || !info.isFile()) throw new ApiError('NOT_FOUND', 'File not found')
    reply
      .header('cache-control', IMMUTABLE)
      .header('accept-ranges', 'bytes')
      // A file opened directly in a tab runs in an opaque origin without scripts.
      .header('content-security-policy', "sandbox; default-src 'none'")
      .type(SERVED_TYPES[fileExtension(path)]!)
    const range = parseRange(request.headers.range, info.size)
    if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${info.size}`).send()
    if (range === null) return reply.header('content-length', info.size).send(createReadStream(full))
    return reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
      .header('content-length', range.end - range.start + 1)
      .send(createReadStream(full, { start: range.start, end: range.end }))
  })
```

Imports: `createReadStream` from `node:fs`; `stat` from `node:fs/promises`; `classifyPath, fileExtension, SERVED_TYPES` from contracts. Remove the now unused `readFile`-based file route and the `JS`/`CSS` constants only if nothing else uses them (the runtime route still uses `JS`).

- [ ] **Step 4: Run tests**

Run: `pnpm -C apps/api exec vitest run test/sandbox.test.ts && pnpm -C apps/api typecheck`
Expected: PASS. If `'..%2Fwidget.json'` reaches the handler decoded as `../widget.json`, `classifyPath` rejects it; the 404 holds either way.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sandbox.ts apps/api/test/sandbox.test.ts
git commit -m "feat(api): serve package assets with ranges and a wider sandbox CSP"
```

---

### Task 5: Upload sessions API and removal of v1 install routes

**Files:**
- Create: `apps/api/src/widget-uploads.ts`
- Modify: `apps/api/src/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/widget-packages.ts`, `packages/contracts/src/widget-package.ts`
- Test: create `apps/api/test/widget-uploads.test.ts`; modify `apps/api/test/helpers.ts`, `apps/api/test/widget-packages.test.ts`, `apps/api/test/sandbox.test.ts`, `apps/api/test/auth.test.ts`; fix `InstalledPackageVersion` fixtures in `apps/ui/test/*.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseWidgetFolder`, `parseWidgetManifest`, `canonicalJson`; Task 2 `stagingDir`, `versionDir`, `versionHash`, `moveToOrphaned`, `userwidgetsDir`; Task 3 `installedVersions`.
- Produces:
  - Contracts: `PackageInspection { manifest; hash: string | null; installed: boolean; newPermissions; sizes: FolderSizes }`; `InstalledPackageVersion.paths: { source: string | null; assets: string | null }`; `interface UploadCreated { uploadId: string; inspection: PackageInspection }`
  - Routes: `POST /api/v1/widget-uploads`, `PUT /api/v1/widget-uploads/:id/files/*`, `POST /api/v1/widget-uploads/:id/install`, `DELETE /api/v1/widget-uploads/:id`
  - `widget-packages.ts`: `insertVersion(db, manifest, hash, at): void`, `newPermissionsOf(db, manifest): WidgetPermission[]`
  - Test helpers: `widgetPackage(change?)` returns `{ manifest: { format: 2, … }, files: Record<string, string | Buffer> }`; `uploadPackage(t, cookie, pkg?)` → `UploadCreated`; `putFile(t, cookie, uploadId, path, body)`; `installPackage(t, cookie, pkg?)` → `PackageInspection`

- [ ] **Step 1: Contracts types**

In `packages/contracts/src/widget-package.ts`:

```ts
/** `POST /widget-uploads` (hash null) and `POST /widget-uploads/:id/install` answer with this. */
export interface PackageInspection {
  manifest: WidgetPackageManifest
  hash: string | null
  installed: boolean
  // Manifest permissions the package does not hold yet.
  newPermissions: WidgetPermission[]
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
```

Run `pnpm typecheck` at the root and add `paths: { source: null, assets: null }` to every `InstalledPackageVersion` literal the errors point at (UI tests).

- [ ] **Step 2: Rewrite test helpers**

`apps/api/test/helpers.ts` — replace `widgetPackage` and `installPackage`:

```ts
export interface TestPackage {
  manifest: Record<string, any>
  files: Record<string, string | Buffer>
}

/** A valid v2 folder; `widget.json` is written from `manifest` unless `files` has one. `change` edits it first. */
export function widgetPackage(change?: (pkg: any) => void): TestPackage {
  const pkg: TestPackage = {
    manifest: {
      format: 2,
      id: 'dev.test.hello',
      version: '1.0.0',
      title: 'Hello',
      author: 'test',
      sdk: 1,
      entry: 'index.js',
      styles: ['style.css'],
      sizing: { default: { w: 3, h: 3 }, min: { w: 2, h: 2 }, max: { w: 6, h: 6 } },
      permissions: ['state'],
    },
    files: { 'index.js': 'export default {}', 'style.css': '.hello{}' },
  }
  change?.(pkg)
  return pkg
}

export function folderFiles(pkg: TestPackage): Record<string, string | Buffer> {
  return { 'widget.json': JSON.stringify(pkg.manifest), ...pkg.files }
}

export function putFile(t: TestApp, cookie: string, uploadId: string, path: string, body: string | Buffer) {
  return call(t.app, {
    method: 'PUT',
    url: `/api/v1/widget-uploads/${uploadId}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
    cookie,
    contentType: 'application/octet-stream',
    payload: body,
  })
}

/** Creates an upload session and sends every file; does not install. */
export async function uploadPackage(t: TestApp, cookie: string, pkg: TestPackage = widgetPackage()): Promise<UploadCreated> {
  const files = folderFiles(pkg)
  const created = await call(t.app, {
    method: 'POST',
    url: '/api/v1/widget-uploads',
    cookie,
    payload: { manifest: pkg.manifest, files: Object.entries(files).map(([path, body]) => ({ path, size: Buffer.byteLength(body) })) },
  })
  expect(created.statusCode).toBe(200)
  const data: UploadCreated = created.json().data
  for (const [path, body] of Object.entries(files)) expect((await putFile(t, cookie, data.uploadId, path, body)).statusCode).toBe(200)
  return data
}

export async function installPackage(t: TestApp, cookie: string, pkg: TestPackage = widgetPackage()): Promise<PackageInspection> {
  const { uploadId } = await uploadPackage(t, cookie, pkg)
  const response = await call(t.app, { method: 'POST', url: `/api/v1/widget-uploads/${uploadId}/install`, cookie, payload: {} })
  expect(response.statusCode).toBe(200)
  return response.json().data
}
```

Change `CallOptions.payload` handling: Buffers pass through unchanged (`app.inject` accepts them). Import `UploadCreated` from contracts.

In `sandbox.test.ts`, the `beforeEach` package becomes `widgetPackage((p) => { p.manifest.entry = 'main.js'; p.files = { 'main.js': 'export default {}', 'style.css': '.hello{}' } })`; the `addFile` fixtures from Task 4 move into `pkg.files` (`'assets/clip.mp4': VIDEO`, …) except the 210-character name, which stays a direct write (it breaks the upload limit on purpose). `sandboxDocument(BASE, hash, pkg.manifest)` keeps working (the document reads only `entry` and `styles`).

- [ ] **Step 3: Write the failing upload tests**

Create `apps/api/test/widget-uploads.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { call, errorCode, folderFiles, installPackage, pair, putFile, testApp, uploadPackage, widgetPackage, type TestApp } from './helpers.ts'

const UPLOADS = '/api/v1/widget-uploads'
let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
})

afterEach(async () => {
  await t.close()
})

const staging = () => join(t.dataDir, 'userwidgets', '.staging')
const versionPath = (...parts: string[]) => join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0', ...parts)

function create(manifest: unknown, files: { path: string; size: number }[]) {
  return call(t.app, { method: 'POST', url: UPLOADS, cookie, payload: { manifest, files } })
}

function listOf(pkg = widgetPackage()) {
  return Object.entries(folderFiles(pkg)).map(([path, body]) => ({ path, size: Buffer.byteLength(body) }))
}

function install(uploadId: string) {
  return call(t.app, { method: 'POST', url: `${UPLOADS}/${uploadId}/install`, cookie, payload: {} })
}

describe('POST /widget-uploads', () => {
  it('answers an upload id and an inspection without a hash', async () => {
    const pkg = widgetPackage()
    const response = await create(pkg.manifest, listOf(pkg))
    expect(response.statusCode).toBe(200)
    const { uploadId, inspection } = response.json().data
    expect(uploadId).toMatch(/^[0-9a-f]{32}$/)
    const { format: _format, ...manifest } = pkg.manifest
    expect(inspection).toEqual({ manifest, hash: null, installed: false, newPermissions: ['state'], sizes: { code: 25, assets: 0, source: 0 } })
    expect(existsSync(join(staging(), uploadId))).toBe(true)
  })

  it.each([
    ['a ../ path', (f: any[]) => f.push({ path: '../x.js', size: 1 }), /not an allowed path/],
    ['code over 10 MB', (f: any[]) => { f[1].size = 10_485_760 }, /larger than 10 MB/],
  ])('rejects %s with 400', async (_name, change, message) => {
    const files = listOf()
    change(files)
    const response = await create(widgetPackage().manifest, files)
    expect([response.statusCode, errorCode(response)]).toEqual([400, 'VALIDATION_ERROR'])
    expect(response.json().error.message).toMatch(message)
  })

  it('keeps at most three sessions and deletes the oldest staging folder', async () => {
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push((await create(widgetPackage().manifest, listOf())).json().data.uploadId)
    expect(readdirSync(staging()).sort()).toEqual(ids.slice(1).sort())
    expect(errorCode(await putFile(t, cookie, ids[0]!, 'index.js', 'export default {}'))).toBe('NOT_FOUND')
  })

  it('expires a session idle for 30 minutes', async () => {
    const { uploadId } = (await create(widgetPackage().manifest, listOf())).json().data
    t.clock.now += 30 * 60_000 + 1
    expect(errorCode(await putFile(t, cookie, uploadId, 'index.js', 'export default {}'))).toBe('NOT_FOUND')
    expect(existsSync(join(staging(), uploadId))).toBe(false)
  })
})

describe('PUT /widget-uploads/:id/files/*', () => {
  async function session() {
    return (await create(widgetPackage().manifest, listOf())).json().data.uploadId as string
  }

  it('requires application/octet-stream; JSON is refused here and octet-stream elsewhere', async () => {
    const uploadId = await session()
    const json = await call(t.app, { method: 'PUT', url: `${UPLOADS}/${uploadId}/files/index.js`, cookie, payload: { a: 1 } })
    expect([json.statusCode, errorCode(json)]).toEqual([403, 'FORBIDDEN'])
    const elsewhere = await call(t.app, { method: 'POST', url: UPLOADS, cookie, contentType: 'application/octet-stream', payload: 'x' })
    expect([elsewhere.statusCode, errorCode(elsewhere)]).toEqual([403, 'FORBIDDEN'])
  })

  it('stores a declared file and overwrites it on a repeat', async () => {
    const uploadId = await session()
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default 1')).statusCode).toBe(400)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default {}')).statusCode).toBe(200)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default {}')).statusCode).toBe(200)
    expect(readFileSync(join(staging(), uploadId, 'index.js'), 'utf8')).toBe('export default {}')
  })

  it('stores a zero-byte file', async () => {
    const pkg = widgetPackage((p) => { p.files['style.css'] = '' })
    const { uploadId } = await uploadPackage(t, cookie, pkg)
    expect(readFileSync(join(staging(), uploadId, 'style.css'), 'utf8')).toBe('')
  })

  it('rejects an undeclared path and a body larger than declared, deleting the partial file', async () => {
    const uploadId = await session()
    expect(errorCode(await putFile(t, cookie, uploadId, 'other.js', 'x'))).toBe('VALIDATION_ERROR')
    const big = await putFile(t, cookie, uploadId, 'index.js', 'x'.repeat(5000))
    expect([big.statusCode, errorCode(big)]).toEqual([400, 'VALIDATION_ERROR'])
    expect(existsSync(join(staging(), uploadId, 'index.js'))).toBe(false)
  })

  it('keeps the session and the other files after a failed PUT', async () => {
    const uploadId = await session()
    expect((await putFile(t, cookie, uploadId, 'style.css', '.hello{}')).statusCode).toBe(200)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'short')).statusCode).toBe(400)
    expect(existsSync(join(staging(), uploadId, 'style.css'))).toBe(true)
    expect((await putFile(t, cookie, uploadId, 'index.js', 'export default {}')).statusCode).toBe(200)
  })

  it('answers NOT_FOUND after an API restart', async () => {
    const uploadId = await session()
    const restarted = await testApp(t)
    try {
      expect(errorCode(await putFile(restarted, cookie, uploadId, 'index.js', 'export default {}'))).toBe('NOT_FOUND')
      expect(existsSync(join(staging(), uploadId))).toBe(false)
    } finally {
      await restarted.close()
    }
  })
})

describe('POST /widget-uploads/:id/install', () => {
  it('moves the folder into userwidgets, writes rows and ends the session', async () => {
    const inspection = await installPackage(t, cookie, widgetPackage((p) => {
      p.files['assets/bg.mp4'] = Buffer.from([1, 2, 3])
      p.files['source/src/index.vue'] = '<template/>'
    }))
    expect(inspection).toMatchObject({ installed: true, newPermissions: [], sizes: { code: 25, assets: 3, source: 11 } })
    expect(inspection.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(versionPath('assets', 'bg.mp4'))).toEqual(Buffer.from([1, 2, 3]))
    expect(readdirSync(staging())).toEqual([])
    expect(t.db.prepare('SELECT hash FROM widget_package_versions').get()).toEqual({ hash: inspection.hash })
  })

  it('treats the same folder installed twice as installed and keeps one version', async () => {
    const first = await installPackage(t, cookie)
    const second = await installPackage(t, cookie)
    expect(second).toMatchObject({ installed: true, hash: first.hash })
    expect(t.db.prepare('SELECT count(*) AS n FROM widget_package_versions').get()).toEqual({ n: 1 })
    expect(readdirSync(staging())).toEqual([])
  })

  it('answers CONFLICT for the same version with other content', async () => {
    await installPackage(t, cookie)
    const { uploadId } = await uploadPackage(t, cookie, widgetPackage((p) => { p.files['index.js'] = 'export default {x:1}' }))
    const response = await install(uploadId)
    expect([response.statusCode, errorCode(response)]).toEqual([409, 'CONFLICT'])
    expect(readFileSync(versionPath('index.js'), 'utf8')).toBe('export default {}')
  })

  it('rejects a missing file and ends the session', async () => {
    const pkg = widgetPackage()
    const { uploadId } = (await create(pkg.manifest, listOf(pkg))).json().data
    await putFile(t, cookie, uploadId, 'widget.json', JSON.stringify(pkg.manifest))
    await putFile(t, cookie, uploadId, 'index.js', 'export default {}')
    const response = await install(uploadId)
    expect([response.statusCode, errorCode(response)]).toEqual([400, 'VALIDATION_ERROR'])
    expect(response.json().error.message).toMatch(/"style\.css" is missing/)
    expect(existsSync(join(staging(), uploadId))).toBe(false)
  })

  it('rejects a widget.json that differs from the declared manifest', async () => {
    const pkg = widgetPackage()
    const other = JSON.stringify({ ...pkg.manifest, title: 'Other' })
    const { uploadId } = (await create(pkg.manifest, listOf(pkg).map((f) => (f.path === 'widget.json' ? { ...f, size: Buffer.byteLength(other) } : f)))).json().data
    await putFile(t, cookie, uploadId, 'widget.json', other)
    await putFile(t, cookie, uploadId, 'index.js', 'export default {}')
    await putFile(t, cookie, uploadId, 'style.css', '.hello{}')
    const response = await install(uploadId)
    expect(response.json().error.message).toMatch(/widget\.json differs/)
  })

  it('moves an existing folder without a row to .orphaned before installing', async () => {
    const { uploadId } = await uploadPackage(t, cookie)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(versionPath('source'), { recursive: true })
    writeFileSync(versionPath('source', 'old.txt'), 'old')
    expect((await install(uploadId)).statusCode).toBe(200)
    expect(readdirSync(join(t.dataDir, 'userwidgets', '.orphaned'))).toHaveLength(1)
  })
})

describe('busy session', () => {
  it('rejects a PUT that arrives while install hashes the files', async () => {
    // A large asset keeps install in versionHash long enough for the PUT to arrive.
    const { uploadId } = await uploadPackage(t, cookie, widgetPackage((p) => { p.files['assets/big.bin'] = Buffer.alloc(20_000_000) }))
    const installing = install(uploadId)
    const put = await putFile(t, cookie, uploadId, 'index.js', 'export default {}')
    expect([put.statusCode, errorCode(put)]).toEqual([409, 'CONFLICT'])
    expect((await installing).statusCode).toBe(200)
  })
})

describe('DELETE /widget-uploads/:id', () => {
  it('ends the session and deletes its staging folder', async () => {
    const { uploadId } = await uploadPackage(t, cookie)
    expect((await call(t.app, { method: 'DELETE', url: `${UPLOADS}/${uploadId}`, cookie, payload: {} })).statusCode).toBe(200)
    expect(existsSync(join(staging(), uploadId))).toBe(false)
    expect(errorCode(await install(uploadId))).toBe('NOT_FOUND')
  })
})
```

In `widget-packages.test.ts`:
- delete the `packageHash` and `POST /widget-packages/inspect` describes and the v1-only tests «rejects a body over 1 MB…», «requires a session» (move «requires a session» to `widget-uploads.test.ts` as `POST /widget-uploads` without cookie → 401);
- in «stores the version…» expect `versions: [{ version: '1.0.0', hash: inspection.hash, manifest, paths: { source: null, assets: null } }]` where `manifest` is `pkg.manifest` without `format`;
- add:

```ts
  it('lists the source and assets paths of a version', async () => {
    await installPackage(t, cookie, widgetPackage((p) => {
      p.files['assets/a.png'] = 'x'
      p.files['source/src/index.vue'] = '<template/>'
    }))
    const dir = join(t.dataDir, 'userwidgets', 'dev.test.hello', '1.0.0')
    expect((await list())[0].versions[0].paths).toEqual({ source: join(dir, 'source'), assets: join(dir, 'assets') })
  })
```

- in `DELETE` «deletes an unplaced package…» add `expect(existsSync(join(t.dataDir, 'userwidgets', 'dev.test.hello'))).toBe(false)`;
- the CONFLICT test uses `uploadPackage` + install as above.

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm -C apps/api test`
Expected: FAIL — `/api/v1/widget-uploads` routes do not exist.

- [ ] **Step 5: Implement the auth exception**

`apps/api/src/auth.ts`:

```ts
// Spec 2026-10-10 «API»: the only mutating route without JSON; octet-stream still forces a CORS preflight.
const UPLOAD_FILE_PATH = /^\/api\/v1\/widget-uploads\/[^/]+\/files\//

  function checkRequest(request: FastifyRequest, path: string): void {
    ...
    if (MUTATING_METHODS.has(request.method)) {
      if (origin === undefined) throw new ApiError('FORBIDDEN', 'Origin is required')
      const type = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
      const required = request.method === 'PUT' && UPLOAD_FILE_PATH.test(path) ? 'application/octet-stream' : 'application/json'
      if (type !== required) {
        throw new ApiError('FORBIDDEN', required === 'application/json' ? 'A JSON body is required' : 'An application/octet-stream body is required')
      }
    }
  }
```

and call `checkRequest(request, path)` in the hook.

- [ ] **Step 6: Implement uploads and trim `widget-packages.ts`**

In `apps/api/src/widget-packages.ts`: delete `PACKAGE_BODY`, the two `POST` routes, `ParsedPackage`, `packageHash`, `parse`, `inspect`, `install`. Add:

```ts
export function newPermissionsOf(db: DatabaseSync, manifest: WidgetPackageManifest): WidgetPermission[] {
  const granted = new Set(grantsOf(db, manifest.id).map((grant) => grant.permission))
  return manifest.permissions.filter((permission) => !granted.has(permission))
}

/** Package, version and grants rows; the caller holds the transaction. */
export function insertVersion(db: DatabaseSync, manifest: WidgetPackageManifest, hash: string, at: string): void {
  db.prepare(
    'INSERT INTO widget_packages (id, title, author, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, author = excluded.author',
  ).run(manifest.id, manifest.title, manifest.author, at)
  db.prepare('INSERT INTO widget_package_versions (package_id, version, hash, manifest, installed_at) VALUES (?, ?, ?, ?, ?)').run(
    manifest.id, manifest.version, hash, JSON.stringify(manifest), at,
  )
  // A new confirmable grant asks; OR IGNORE keeps the mode of a grant the package already holds.
  const confirmable = new Set<WidgetPermission>(confirmablePermissions())
  const grant = db.prepare('INSERT OR IGNORE INTO widget_grants (package_id, permission, granted_at, mode) VALUES (?, ?, ?, ?)')
  for (const permission of manifest.permissions) grant.run(manifest.id, permission, at, confirmable.has(permission) ? 'ask' : 'allow')
}
```

`listPackages(db, root)` maps each version with:

```ts
      .map((row) => {
        const dir = versionDir(root, row.package_id, row.version)
        const optional = (name: string) => (existsSync(join(dir, name)) ? join(dir, name) : null)
        return { version: row.version, hash: row.hash, manifest: JSON.parse(row.manifest) as WidgetPackageManifest, paths: { source: optional('source'), assets: optional('assets') } }
      })
```

`deletePackage(db, root, id)` ends with `rmSync(join(root, id), { recursive: true, force: true })` after the `DELETE`. Remove the transitional `writeV1Version` usage; keep `cleanUserwidgets` at registration.

Create `apps/api/src/widget-uploads.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import {
  canonicalJson,
  parseWidgetFolder,
  parseWidgetManifest,
  type FolderSizes,
  type PackageInspection,
  type UploadCreated,
  type WidgetPackageManifest,
} from '@lifedashboard/contracts/widget-package'
import { ApiError, ok } from './errors.ts'
import { moveToOrphaned, stagingDir, userwidgetsDir, versionDir, versionHash } from './userwidgets.ts'
import { insertVersion, newPermissionsOf } from './widget-packages.ts'

const MAX_UPLOADS = 3
const UPLOAD_IDLE_MS = 30 * 60_000

interface UploadSession {
  id: string
  manifest: WidgetPackageManifest
  files: Map<string, number>
  sizes: FolderSizes
  dir: string
  lastUsedAt: number
  busy: boolean
}

export interface WidgetUploadsDeps {
  db: DatabaseSync
  now: () => Date
  dataDir: string
}

// Spec 2026-10-10 «Upload sessions»: create with the file list, one streamed PUT per file, install.
export function registerWidgetUploads(app: FastifyInstance, { db, now, dataDir }: WidgetUploadsDeps): void {
  const root = userwidgetsDir(dataDir)
  // ponytail: in memory like widget sessions; a restart drops them and startup cleanup removes the folders.
  const sessions = new Map<string, UploadSession>()

  function end(session: UploadSession): void {
    sessions.delete(session.id)
    rmSync(session.dir, { recursive: true, force: true })
  }

  function sweep(t: number): void {
    for (const session of [...sessions.values()]) if (t - session.lastUsedAt > UPLOAD_IDLE_MS && !session.busy) end(session)
  }

  function find(id: string): UploadSession {
    const t = now().getTime()
    sweep(t)
    const session = sessions.get(id)
    if (!session) throw new ApiError('NOT_FOUND', 'Upload not found or expired')
    if (session.busy) throw new ApiError('CONFLICT', 'The upload is being installed')
    session.lastUsedAt = t
    return session
  }

  app.post<{ Body: { manifest?: unknown; files?: unknown } | undefined }>('/api/v1/widget-uploads', async (request) => {
    const parsed = parseWidgetFolder(request.body?.manifest, request.body?.files)
    if (!parsed.ok) throw new ApiError('VALIDATION_ERROR', parsed.error)
    const t = now().getTime()
    sweep(t)
    const oldest = [...sessions.values()].filter((item) => !item.busy).sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    while (sessions.size >= MAX_UPLOADS && oldest.length > 0) end(oldest.shift()!)
    const id = randomBytes(16).toString('hex')
    const session: UploadSession = {
      id,
      manifest: parsed.value.manifest,
      files: new Map(parsed.value.files.map((file) => [file.path, file.size])),
      sizes: parsed.value.sizes,
      dir: stagingDir(root, id),
      lastUsedAt: t,
      busy: false,
    }
    mkdirSync(session.dir, { recursive: true })
    sessions.set(id, session)
    const { id: packageId, version } = session.manifest
    const installed = db.prepare('SELECT 1 FROM widget_package_versions WHERE package_id = ? AND version = ?').get(packageId, version) !== undefined
    const result: UploadCreated = {
      uploadId: id,
      inspection: { manifest: session.manifest, hash: null, installed, newPermissions: newPermissionsOf(db, session.manifest), sizes: session.sizes },
    }
    return ok(request, result)
  })

  app.register(async (scope) => {
    // The raw body stream; Fastify applies no body limit to it, the route enforces the declared size.
    scope.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload))

    scope.put<{ Params: { id: string; '*': string } }>('/api/v1/widget-uploads/:id/files/*', async (request) => {
      const session = find(request.params.id)
      const path = request.params['*']
      const size = session.files.get(path)
      if (size === undefined) throw new ApiError('VALIDATION_ERROR', `"${path}" is not in the declared file list`)
      const target = join(session.dir, path)
      mkdirSync(dirname(target), { recursive: true })
      let received = 0
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length
          done(received > size ? new ApiError('VALIDATION_ERROR', `"${path}" is larger than declared (${size} bytes)`) : null, chunk)
        },
      })
      // An empty body may arrive without a parsed stream.
      const body = (request.body as Readable | undefined) ?? Readable.from([])
      try {
        await pipeline(body, limit, createWriteStream(target))
      } catch (error) {
        rmSync(target, { force: true })
        throw error
      }
      if (received !== size) {
        rmSync(target, { force: true })
        throw new ApiError('VALIDATION_ERROR', `"${path}" has ${received} bytes, ${size} declared`)
      }
      session.lastUsedAt = now().getTime()
      return ok(request, null)
    })
  })

  app.post<{ Params: { id: string } }>('/api/v1/widget-uploads/:id/install', async (request) => {
    const session = find(request.params.id)
    session.busy = true
    try {
      for (const [path, size] of session.files) {
        const info = statSync(join(session.dir, path), { throwIfNoEntry: false })
        if (info?.size !== size) throw new ApiError('VALIDATION_ERROR', `"${path}" is missing or has another size`)
      }
      let onDisk: unknown
      try {
        onDisk = JSON.parse(readFileSync(join(session.dir, 'widget.json'), 'utf8'))
      } catch {
        throw new ApiError('VALIDATION_ERROR', 'widget.json is not valid JSON')
      }
      const parsed = parseWidgetManifest(onDisk)
      if (!parsed.ok || canonicalJson(parsed.value) !== canonicalJson(session.manifest)) {
        throw new ApiError('VALIDATION_ERROR', 'widget.json differs from the declared manifest')
      }
      const hash = await versionHash(session.dir)
      return ok(request, commit(session, hash))
    } finally {
      end(session)
    }
  })

  // Spec «Install» steps 4–7: synchronous, so no other request's write falls inside the transaction.
  function commit(session: UploadSession, hash: string): PackageInspection {
    const { id, version } = session.manifest
    db.exec('BEGIN IMMEDIATE')
    let moved = false
    const target = versionDir(root, id, version)
    try {
      const stored = db.prepare('SELECT hash FROM widget_package_versions WHERE package_id = ? AND version = ?').get(id, version) as
        | { hash: string }
        | undefined
      if (stored && stored.hash !== hash) throw new ApiError('CONFLICT', `Version ${version} of ${id} is already installed with different content`)
      if (!stored) {
        if (existsSync(target)) moveToOrphaned(root, id, version, now())
        mkdirSync(join(root, id), { recursive: true })
        renameSync(session.dir, target)
        moved = true
        insertVersion(db, session.manifest, hash, now().toISOString())
      }
      db.exec('COMMIT')
      return { manifest: session.manifest, hash, installed: true, newPermissions: [], sizes: session.sizes }
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      if (moved) renameSync(target, session.dir)
      throw error
    }
  }

  app.delete<{ Params: { id: string } }>('/api/v1/widget-uploads/:id', async (request) => {
    const session = sessions.get(request.params.id)
    if (session && !session.busy) end(session)
    return ok(request, null)
  })
}
```

Install answers `newPermissions: []` as v1 did. Register in `apps/api/src/app.ts` after `registerWidgetPackages`: `registerWidgetUploads(app, { db, now, dataDir: config.dataDir })`.

- [ ] **Step 7: Run the whole repository checks**

Run: `pnpm -C apps/api test && pnpm typecheck && pnpm test`
Expected: PASS. The UI still compiles: `api.inspectPackage`/`installPackage` call removed routes but keep types until Task 7 (they now return 404 at runtime; Task 7 replaces them).

- [ ] **Step 8: Commit**

```bash
git add apps/api packages/contracts apps/ui/test
git commit -m "feat(api): folder upload sessions replace .ldwidget.json install"
```

---

### Task 6: `ld-widget build` emits a v2 folder

**Files:**
- Modify: `packages/widget-sdk/src/build.ts`, `packages/widget-sdk/src/cli.ts`
- Test: `packages/widget-sdk/test/build.test.ts`; create fixture `packages/widget-sdk/test/fixtures/lazy/{widget.json,src/index.vue,src/heavy.ts}`

**Interfaces:**
- Consumes: Task 1 `parseWidgetFolder`, `ASSET_TYPES`, `fileExtension`.
- Produces: `buildWidget(dir: string, options?: { source?: boolean }): Promise<string>` returning `<dir>/dist/<id>-<version>`; `keepInSource(path: string): boolean` (path relative to the project, platform separators).

- [ ] **Step 1: Write the failing tests**

Create fixture `packages/widget-sdk/test/fixtures/lazy/widget.json` (copy of `counter/widget.json` with `"id": "dev.test.lazy"`, `"styles": []`), `src/heavy.ts`:

```ts
export const heavy = 'heavy module'
```

and `src/index.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'

const text = ref('')
onMounted(async () => {
  text.value = (await import('./heavy.ts')).heavy
})
</script>

<template>
  <p>{{ text }}</p>
</template>
```

Replace `packages/widget-sdk/test/build.test.ts` tests with:

```ts
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWidget, keepInSource } from '../src/build.ts'

// … keep `fixtures`, `dirs`, `copyOf`, `afterEach` as they are …

async function filesOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1).split('\\').join('/')).sort()
}

describe('buildWidget', () => {
  it('builds a folder with code, a v2 widget.json and the sources', async () => {
    const dir = await copyOf('counter')
    const target = await buildWidget(dir)
    expect(target).toBe(join(dir, 'dist', 'dev.test.counter-1.0.0'))
    expect(await filesOf(target)).toEqual(['index.js', 'source/src/index.vue', 'source/widget.json', 'style.css', 'widget.json'])
    expect(JSON.parse(await readFile(join(target, 'widget.json'), 'utf8')).format).toBe(2)
    expect(await readFile(join(target, 'index.js'), 'utf8')).toMatch(/from\s*["']@lifedashboard\/widget-sdk["']/)
  }, 30_000)

  it('emits a chunk for a dynamic import', async () => {
    const files = await filesOf(await buildWidget(await copyOf('lazy')))
    expect(files.filter((file) => /^[^/]+\.js$/.test(file)).length).toBeGreaterThan(1)
  }, 30_000)

  it('copies assets verbatim and keeps them out of source/', async () => {
    const dir = await copyOf('counter')
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'bg.mp4'), Buffer.from([1, 2, 3]))
    const target = await buildWidget(dir)
    expect(await readFile(join(target, 'assets', 'bg.mp4'))).toEqual(Buffer.from([1, 2, 3]))
    expect(existsSync(join(target, 'source', 'assets'))).toBe(false)
  }, 30_000)

  it('drops .env*, .git, .DS_Store, node_modules and dist from source/ but keeps other dot files', async () => {
    const dir = await copyOf('counter')
    for (const [path, body] of [['.env', 'SECRET=1'], ['.env.local', 'SECRET=2'], ['.git/HEAD', 'x'], ['.DS_Store', 'x'], ['node_modules/x/index.js', 'x'], ['src/node_modules/y.js', 'x'], ['dist/old.txt', 'x'], ['.npmrc', 'x'], ['src/.data.json', '{}']]) {
      await mkdir(join(dir, path, '..'), { recursive: true })
      await writeFile(join(dir, path), body)
    }
    const source = (await filesOf(await buildWidget(dir))).filter((file) => file.startsWith('source/'))
    expect(source).toEqual(['source/.npmrc', 'source/src/.data.json', 'source/src/index.vue', 'source/widget.json'])
  }, 30_000)

  it('omits source/ with source: false', async () => {
    const target = await buildWidget(await copyOf('counter'), { source: false })
    expect(existsSync(join(target, 'source'))).toBe(false)
  }, 30_000)

  it.each([
    ['any video', 'clip.mp4', 10],
    ['a large image', 'big.png', 102_401],
  ])('fails when code imports %s', async (_name, file, size) => {
    const dir = await copyOf('counter')
    await writeFile(join(dir, 'src', file), Buffer.alloc(size))
    const vue = await readFile(join(dir, 'src', 'index.vue'), 'utf8')
    await writeFile(join(dir, 'src', 'index.vue'), vue.replace("import { ref } from 'vue'", `import { ref } from 'vue'\nimport media from './${file}'\nvoid media`))
    await expect(buildWidget(dir)).rejects.toThrow(new RegExp(`reference media by URL: assets/${file.replace('.', '\\.')}`))
  }, 30_000)

  it('names a source file whose name breaks the path rules', async () => {
    const dir = await copyOf('counter')
    await writeFile(join(dir, 'src', 'my file.ts'), 'export {}')
    await expect(buildWidget(dir)).rejects.toThrow(/"source\/src\/my file\.ts" is not an allowed path/)
  }, 30_000)

  it('rejects a manifest the package format does not allow', async () => {
    const dir = await copyOf('counter')
    const manifest = JSON.parse(await readFile(join(dir, 'widget.json'), 'utf8'))
    await writeFile(join(dir, 'widget.json'), JSON.stringify({ ...manifest, permissions: ['http'] }))
    await expect(buildWidget(dir)).rejects.toThrow(/Invalid widget package: manifest\.permissions/)
  }, 30_000)

  it('rebuilds the same code from the restored source/ and assets/', async () => {
    const dir = await copyOf('counter')
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'a.png'), 'x')
    const first = await buildWidget(dir)
    const restored = await mkdtemp(join(tmpdir(), 'ld-widget-restored-'))
    dirs.push(restored)
    await cp(join(first, 'source'), restored, { recursive: true })
    await cp(join(first, 'assets'), join(restored, 'assets'), { recursive: true })
    const second = await buildWidget(restored)
    for (const file of ['index.js', 'style.css']) {
      expect(await readFile(join(second, file), 'utf8')).toBe(await readFile(join(first, file), 'utf8'))
    }
  }, 60_000)
})

describe('keepInSource', () => {
  it.each([
    ['src/index.vue', true],
    ['.npmrc', true],
    ['node_modules', false],
    ['src/node_modules', false],
    ['dist', false],
    ['src/dist', true],
    ['assets', false],
    ['.git', false],
    ['.env.production', false],
    ['src/.DS_Store', false],
  ])('%s → %s', (path, kept) => {
    expect(keepInSource(path)).toBe(kept)
  })
})
```

Delete the old `plain` test expectation of `pkg.files`; keep a «builds a package without CSS» test:

```ts
  it('builds a folder without CSS', async () => {
    const target = await buildWidget(await copyOf('plain'))
    expect(existsSync(join(target, 'style.css'))).toBe(false)
    expect(JSON.parse(await readFile(join(target, 'widget.json'), 'utf8')).styles).toEqual([])
  }, 30_000)
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/build.test.ts`
Expected: FAIL — `keepInSource` is not exported; the build writes `.ldwidget.json`.

- [ ] **Step 3: Implement**

Replace `packages/widget-sdk/src/build.ts`:

```ts
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build, type Plugin } from 'vite'
import { ASSET_TYPES, fileExtension, parseWidgetFolder } from '@lifedashboard/contracts/widget-package'

const AUDIO_VIDEO = new Set(['mp4', 'webm', 'mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'flac'])
const MEDIA_INLINE_LIMIT = 102_400

/** Whether a project path (relative, platform separators) goes into `source/`. */
export function keepInSource(path: string): boolean {
  if (path === '') return true
  const segments = path.split(sep)
  const name = segments.at(-1)!
  if (segments.length === 1 && (name === 'dist' || name === 'assets')) return false
  return name !== 'node_modules' && name !== '.git' && name !== '.DS_Store' && !name.startsWith('.env')
}

// Vite library mode inlines imported assets as data: URLs; media-src does not allow data:.
function mediaImportGuard(): Plugin {
  return {
    name: 'ld-widget-media-guard',
    enforce: 'pre',
    async load(id) {
      const path = id.split('?')[0]!
      const extension = fileExtension(path)
      if (!Object.hasOwn(ASSET_TYPES, extension) || extension === 'json') return null
      if (AUDIO_VIDEO.has(extension) || (await stat(path)).size > MEDIA_INLINE_LIMIT) {
        this.error(`reference media by URL: assets/${basename(path)}`)
      }
      return null
    },
  }
}

async function listFolder(dir: string): Promise<{ path: string; size: number }[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const full = join(entry.parentPath, entry.name)
        return { path: relative(dir, full).split(sep).join('/'), size: (await stat(full)).size }
      }),
  )
}

/**
 * Builds `<dir>/src/index.vue` with `<dir>/widget.json` into the folder `<dir>/dist/<id>-<version>/`
 * (code, `assets/`, `source/` unless `source: false`) and returns its path.
 */
export async function buildWidget(dir: string, { source = true }: { source?: boolean } = {}): Promise<string> {
  const root = resolve(dir)
  const raw = JSON.parse(await readFile(join(root, 'widget.json'), 'utf8')) as Record<string, unknown>
  const { format: _format, ...fields } = raw
  const manifest = { format: 2, ...fields }
  const entry = typeof manifest.entry === 'string' ? manifest.entry : 'index.js'
  const work = await mkdtemp(join(tmpdir(), 'ld-widget-'))
  const stage = join(work, 'package')
  try {
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      plugins: [mediaImportGuard(), vue()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: stage,
        emptyOutDir: true,
        lib: { entry: join(root, 'src', 'index.vue'), formats: ['es'], fileName: () => entry, cssFileName: 'style' },
        // Both resolve through the sandbox import map: one Vue, one SDK instance.
        rolldownOptions: { external: ['vue', '@lifedashboard/widget-sdk'] },
      },
    })
    if (existsSync(join(root, 'assets'))) await cp(join(root, 'assets'), join(stage, 'assets'), { recursive: true })
    // Copied from outside the project: fs.cp refuses a destination inside its source.
    if (source) await cp(root, join(stage, 'source'), { recursive: true, filter: (from) => keepInSource(relative(root, from)) })
    await writeFile(join(stage, 'widget.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const result = parseWidgetFolder(manifest, await listFolder(stage))
    if (!result.ok) throw new Error(`Invalid widget package: ${result.error}`)
    const target = join(root, 'dist', `${result.value.manifest.id}-${result.value.manifest.version}`)
    await rm(target, { recursive: true, force: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    await cp(stage, target, { recursive: true })
    return target
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
```

`packages/widget-sdk/src/cli.ts`:

```ts
#!/usr/bin/env node
import { buildWidget } from './build.ts'

const [command, ...rest] = process.argv.slice(2)
const unknown = rest.find((arg) => arg.startsWith('--') && arg !== '--no-source')
if (command !== 'build' || unknown !== undefined) {
  console.error('Usage: ld-widget build [dir] [--no-source]')
  process.exit(2)
}
const dir = rest.find((arg) => !arg.startsWith('--')) ?? process.cwd()
try {
  console.log(`Built ${await buildWidget(dir, { source: !rest.includes('--no-source') })}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm -C packages/widget-sdk test && pnpm -C packages/widget-sdk typecheck`
Expected: PASS. If the `invalid file name` case fails because Vite emits the error first, keep the assertion on the folder validator message: the file is not imported, so Vite ignores it.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk
git commit -m "feat(sdk): ld-widget build emits a folder with assets and sources"
```

---

### Task 7: UI — folder install, progress, retry, source paths

**Files:**
- Modify: `apps/ui/app/api.ts`, `apps/ui/app/widgets/catalog.ts`, `apps/ui/app/widgets/PackagesDialog.vue`
- Test: `apps/ui/test/api.test.ts`, `apps/ui/test/catalog.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseWidgetFolder`, `FolderFile`; Task 5 `UploadCreated`, `PackageInspection`, routes.
- Produces:
  - `apiRequest(method, path, body?, timeout: number | AbortSignal = API_TIMEOUT_MS, headers?)`; a `Blob` body is sent raw as `application/octet-stream`
  - `api.createUpload(manifest: unknown, files: FolderFile[])`, `api.uploadFile(uploadId: string, path: string, file: Blob, signal: AbortSignal)`, `api.installUpload(uploadId: string, signal: AbortSignal)`, `api.cancelUpload(uploadId: string)`
  - `catalog.ts`: `interface PickedFile { path: string; file: Blob }`, `filesFromInput(files: ArrayLike<File>): PickedFile[]`, `filesFromEntry(entry: FileSystemDirectoryEntry): Promise<PickedFile[]>`, `readFolder(files: readonly PickedFile[]): Promise<FolderRead>`, `uploadFiles(client, uploadId, files, signal, onSent): Promise<UploadOutcome>`, `formatBytes(bytes: number): string`

- [ ] **Step 1: Write the failing tests**

`apps/ui/test/api.test.ts` — add:

```ts
describe('upload calls', () => {
  it('sends a file raw as octet-stream with encoded segments and the caller signal', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const file = new Blob(['abc'])
    await api.uploadFile('u1', 'assets/a b.png', file, controller.signal)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-uploads/u1/files/assets/a%20b.png')
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/octet-stream' })
    expect(init?.body).toBe(file)
    expect(init?.signal).toBe(controller.signal)
  })

  it('installs with the caller signal and an empty JSON body', async () => {
    const fetchMock = respond(200, { data: {}, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await api.installUpload('u1', controller.signal)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-uploads/u1/install')
    expect(init?.body).toBe('{}')
    expect(init?.signal).toBe(controller.signal)
  })
})
```

`apps/ui/test/catalog.test.ts` — remove the `readPackageFile` describe and import; add (imports `filesFromEntry, filesFromInput, formatBytes, readFolder, uploadFiles, type PickedFile`):

```ts
const MANIFEST = { format: 2, id: 'dev.a.clock', version: '1.0.0', title: 'Clock', author: 'a', sdk: 1, entry: 'index.js', styles: [], sizing: { default: { w: 2, h: 2 }, min: { w: 1, h: 1 }, max: { w: 4, h: 4 } }, permissions: [] }

function picked(path: string, body: string): PickedFile {
  return { path, file: new Blob([body]) }
}

describe('filesFromInput', () => {
  it('strips the picked folder name from webkitRelativePath', () => {
    const file = Object.assign(new File(['x'], 'index.js'), { webkitRelativePath: 'clock-1.0.0/index.js' })
    const nested = Object.assign(new File(['y'], 'a.png'), { webkitRelativePath: 'clock-1.0.0/assets/a.png' })
    expect(filesFromInput([file, nested]).map((item) => item.path)).toEqual(['index.js', 'assets/a.png'])
  })
})

describe('filesFromEntry', () => {
  function fileEntry(name: string, body: string) {
    return { isFile: true, isDirectory: false, name, file: (ok: (file: File) => void) => ok(new File([body], name)) }
  }
  function dirEntry(name: string, children: unknown[]) {
    return {
      isFile: false,
      isDirectory: true,
      name,
      // readEntries returns batches until an empty one.
      createReader: () => {
        const batches = [children.slice(0, 1), children.slice(1), []]
        return { readEntries: (ok: (entries: unknown[]) => void) => ok(batches.shift() ?? []) }
      },
    }
  }

  it('walks a dropped directory with batched reads', async () => {
    const root = dirEntry('clock', [fileEntry('widget.json', '{}'), dirEntry('assets', [fileEntry('a.png', 'x')]), fileEntry('index.js', '')])
    const files = await filesFromEntry(root as unknown as FileSystemDirectoryEntry)
    expect(files.map((item) => item.path).sort()).toEqual(['assets/a.png', 'index.js', 'widget.json'])
  })
})

describe('readFolder', () => {
  it('needs widget.json at the root', async () => {
    expect(await readFolder([picked('clock-1.0.0/widget.json', '{}')])).toEqual({ ok: false, message: 'В папке нет widget.json' })
  })

  it('rejects a widget.json that is not JSON', async () => {
    expect(await readFolder([picked('widget.json', '<html>')])).toEqual({ ok: false, message: 'widget.json не является JSON' })
  })

  it('reports the folder validation error', async () => {
    const result = await readFolder([picked('widget.json', JSON.stringify(MANIFEST)), picked('index.js', ''), picked('notes.txt', 'x')])
    expect(result).toEqual({ ok: false, message: 'Папка отклонена: files: "notes.txt" is not an allowed path' })
  })

  it('returns the manifest and the file list', async () => {
    const result = await readFolder([picked('widget.json', JSON.stringify(MANIFEST)), picked('index.js', 'abc')])
    expect(result).toEqual({
      ok: true,
      manifest: MANIFEST,
      files: [{ path: 'widget.json', size: JSON.stringify(MANIFEST).length }, { path: 'index.js', size: 3 }],
    })
  })
})

describe('uploadFiles', () => {
  it('sends at most three files at once and reports each sent file', async () => {
    let active = 0
    let peak = 0
    const sent: string[] = []
    const client = {
      uploadFile: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return { ok: true as const, data: null }
      },
    }
    const files = ['a', 'b', 'c', 'd', 'e'].map((name) => picked(name, name))
    expect(await uploadFiles(client, 'u1', files, new AbortController().signal, (file) => sent.push(file.path))).toEqual({ ok: true })
    expect(peak).toBe(3)
    expect(sent.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('stops at the first failure and names the file', async () => {
    const client = {
      uploadFile: async (_id: string, path: string) =>
        path === 'b' ? { ok: false as const, kind: 'invalid' as const, code: 'NOT_FOUND', message: 'Upload not found or expired' } : { ok: true as const, data: null },
    }
    const result = await uploadFiles(client, 'u1', [picked('a', ''), picked('b', ''), picked('c', '')], new AbortController().signal, () => {})
    expect(result).toEqual({ ok: false, path: 'b', failure: { kind: 'invalid', code: 'NOT_FOUND', message: 'Upload not found or expired' } })
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 КБ'],
    [1, '1 КБ'],
    [1536, '2 КБ'],
    [1_048_576, '1.0 МБ'],
    [52_428_800, '50.0 МБ'],
  ])('%d → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/ui test`
Expected: FAIL — the new exports and API calls are missing.

- [ ] **Step 3: Implement `api.ts`**

```ts
import type { FolderFile, Grant, GrantMode, InstalledPackage, PackageInspection, UploadCreated, WidgetPermission } from '@lifedashboard/contracts/widget-package'

/** Never throws … `timeout` is a duration, or the caller's signal for calls whose length grows with file size. */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeout: number | AbortSignal = API_TIMEOUT_MS,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  ...
    const raw = body instanceof Blob
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      credentials: 'same-origin',
      signal: typeof timeout === 'number' ? AbortSignal.timeout(timeout) : timeout,
    })
```

In `api`, replace `inspectPackage` and `installPackage` with:

```ts
  createUpload: (manifest: unknown, files: FolderFile[]) => apiRequest<UploadCreated>('POST', '/widget-uploads', { manifest, files }),
  // No absolute timeout: the duration grows with the file; «Отмена» aborts through the signal.
  uploadFile: (uploadId: string, path: string, file: Blob, signal: AbortSignal) =>
    apiRequest<null>('PUT', `/widget-uploads/${encodeURIComponent(uploadId)}/files/${path.split('/').map(encodeURIComponent).join('/')}`, file, signal),
  installUpload: (uploadId: string, signal: AbortSignal) =>
    apiRequest<PackageInspection>('POST', `/widget-uploads/${encodeURIComponent(uploadId)}/install`, {}, signal),
  cancelUpload: (uploadId: string) => apiRequest<null>('DELETE', `/widget-uploads/${encodeURIComponent(uploadId)}`, {}),
```

- [ ] **Step 4: Implement `catalog.ts`**

Remove `PackageFile`, `readPackageFile` and the `PACKAGE_LIMITS` import. Add:

```ts
import { parseWidgetFolder, type FolderFile } from '@lifedashboard/contracts/widget-package'
import type { ApiFailure } from '../api'

export interface PickedFile {
  path: string
  file: Blob
}

export type FolderRead = { ok: true; manifest: unknown; files: FolderFile[] } | { ok: false; message: string }

export type UploadOutcome = { ok: true } | { ok: false; path: string; failure: ApiFailure }

/** `<input webkitdirectory>`: paths relative to the picked folder. */
export function filesFromInput(files: ArrayLike<File>): PickedFile[] {
  return Array.from(files, (file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), file }))
}

/** A dropped folder (`DataTransferItem.webkitGetAsEntry()`), walked recursively. */
export async function filesFromEntry(entry: FileSystemDirectoryEntry, prefix = ''): Promise<PickedFile[]> {
  const reader = entry.createReader()
  const children: FileSystemEntry[] = []
  // readEntries answers in batches; an empty batch ends the directory.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    children.push(...batch)
  }
  const nested = await Promise.all(
    children.map(async (child): Promise<PickedFile[]> => {
      const path = `${prefix}${child.name}`
      if (child.isDirectory) return filesFromEntry(child as FileSystemDirectoryEntry, `${path}/`)
      const file = await new Promise<File>((resolve, reject) => (child as FileSystemFileEntry).file(resolve, reject))
      return [{ path, file }]
    }),
  )
  return nested.flat()
}

/** Reads widget.json and checks the folder with the API's rules before any request. */
export async function readFolder(files: readonly PickedFile[]): Promise<FolderRead> {
  const manifestFile = files.find((item) => item.path === 'widget.json')
  if (!manifestFile) return { ok: false, message: 'В папке нет widget.json' }
  let manifest: unknown
  try {
    manifest = JSON.parse(await manifestFile.file.text())
  } catch {
    return { ok: false, message: 'widget.json не является JSON' }
  }
  const list = files.map((item) => ({ path: item.path, size: item.file.size }))
  const parsed = parseWidgetFolder(manifest, list)
  return parsed.ok ? { ok: true, manifest, files: list } : { ok: false, message: `Папка отклонена: ${parsed.error}` }
}

/** Sends files three at a time; stops at the first failure and names its file. */
export async function uploadFiles(
  client: Pick<typeof api, 'uploadFile'>,
  uploadId: string,
  files: readonly PickedFile[],
  signal: AbortSignal,
  onSent: (file: PickedFile) => void,
): Promise<UploadOutcome> {
  let next = 0
  let failed: UploadOutcome | null = null
  async function worker(): Promise<void> {
    while (failed === null && next < files.length) {
      const item = files[next++]!
      const result = await client.uploadFile(uploadId, item.path, item.file, signal)
      if (!result.ok) {
        const { ok: _ok, ...failure } = result
        failed ??= { ok: false, path: item.path, failure }
        return
      }
      onSent(item)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return failed ?? { ok: true }
}

export function formatBytes(bytes: number): string {
  return bytes < 1_048_576 ? `${Math.ceil(bytes / 1024)} КБ` : `${(bytes / 1_048_576).toFixed(1)} МБ`
}
```

(The `import type { api }` already in the file covers `client`.)

- [ ] **Step 5: Implement `PackagesDialog.vue`**

Script changes (replace `fileInput`, `pending`, `chooseFile`, `install`):

```ts
import { filesFromEntry, filesFromInput, formatBytes, readFolder, uploadFiles, type PickedFile } from './catalog'

const folderInput = useTemplateRef<HTMLInputElement>('folderBox')
// The created upload and its files; the review screen shows while it is set.
const pending = ref<{ uploadId: string; inspection: PackageInspection; files: PickedFile[] } | null>(null)
// Files not sent yet; a retry sends only these.
const remaining = ref<PickedFile[]>([])
const progress = ref<{ sent: number; total: number } | null>(null)
const failedPath = ref<string | null>(null)
const confirmDelete = ref<string | null>(null)
let controller: AbortController | null = null

async function start(files: PickedFile[]) {
  message.value = null
  const read = await readFolder(files)
  if (!read.ok) {
    message.value = read.message
    return
  }
  busy.value = true
  const result = await api.createUpload(read.manifest, read.files)
  busy.value = false
  if (!result.ok) {
    message.value = failureText(result, VERSION_CONFLICT)
    return
  }
  pending.value = { uploadId: result.data.uploadId, inspection: result.data.inspection, files }
  remaining.value = files
  progress.value = null
  failedPath.value = null
  modes.value = initialModes(result.data.inspection.newPermissions)
}

function chooseFolder(event: Event) {
  const input = event.target as HTMLInputElement
  const files = filesFromInput(input.files ?? [])
  input.value = ''
  if (files.length > 0) void start(files)
}

async function dropFolder(event: DragEvent) {
  const entry = event.dataTransfer?.items[0]?.webkitGetAsEntry()
  if (!entry?.isDirectory) {
    message.value = 'Перетащите папку виджета'
    return
  }
  await start(await filesFromEntry(entry as FileSystemDirectoryEntry))
}

async function install() {
  const current = pending.value
  if (!current) return
  busy.value = true
  failedPath.value = null
  controller = new AbortController()
  const total = current.files.reduce((sum, item) => sum + item.file.size, 0)
  progress.value ??= { sent: 0, total }
  const sent = await uploadFiles(api, current.uploadId, remaining.value, controller.signal, (file) => {
    remaining.value = remaining.value.filter((item) => item !== file)
    progress.value = { sent: progress.value!.sent + file.file.size, total }
  })
  if (!sent.ok) {
    busy.value = false
    failedPath.value = sent.path
    // An ended session (API restart, expiry) cannot continue: start over.
    if (sent.failure.kind === 'invalid' && sent.failure.code === 'NOT_FOUND') {
      pending.value = null
      message.value = `Загрузка прервана на ${sent.path}, начните заново`
    } else message.value = `Не удалось загрузить ${sent.path}`
    return
  }
  const result = await api.installUpload(current.uploadId, controller.signal)
  if (!result.ok) {
    busy.value = false
    pending.value = null
    message.value = failureText(result, VERSION_CONFLICT)
    return
  }
  // New confirmable grants come out as «ask»; a failed PUT leaves that safer mode.
  const relaxed = relaxedPermissions(current.inspection.newPermissions, modes.value)
  const saved = await Promise.all(relaxed.map((permission) => api.setGrantMode(current.inspection.manifest.id, permission, 'allow')))
  busy.value = false
  pending.value = null
  progress.value = null
  message.value = saved.every((item) => item.ok) ? 'Виджет установлен' : 'Виджет установлен, но режим «Разрешить» не сохранён'
  await loadPackages(api)
}

function cancel() {
  controller?.abort()
  if (pending.value) void api.cancelUpload(pending.value.uploadId)
  pending.value = null
  progress.value = null
  busy.value = false
}
```

`remove(id)`: first call sets `confirmDelete.value = id` and returns; the confirmation block calls the existing delete logic with `confirmDelete.value = null` afterwards. Also call `cancel()` when the dialog closes (`watch(open)` when `value` is false).

Template, review screen — after the «Размер» row:

```vue
        <dt>Размер файлов</dt>
        <dd>
          Код {{ formatBytes(pending.inspection.sizes.code) }}, медиа {{ formatBytes(pending.inspection.sizes.assets) }},
          исходники {{ formatBytes(pending.inspection.sizes.source) }}
        </dd>
```

replace the actions block with:

```vue
      <progress v-if="progress" class="packages__progress" :value="progress.sent" :max="progress.total" />
      <div class="packages__actions">
        <button type="button" class="packages__button" :disabled="busy" @click="install">
          {{ failedPath ? 'Повторить' : 'Установить' }}
        </button>
        <button type="button" class="packages__button" @click="cancel">Отмена</button>
      </div>
```

List screen — under each package's versions add:

```vue
          <ul class="packages__sources">
            <li v-for="version in pkg.versions" :key="version.version">
              {{ version.version }} · Исходники:
              <template v-if="version.paths.source">
                <code class="packages__path">{{ version.paths.source }}</code>
                <button type="button" class="packages__button" @click="copy(version.paths.source)">Копировать</button>
              </template>
              <template v-else>Исходники не включены</template>
              <template v-if="version.paths.assets">
                · Медиа: <code class="packages__path">{{ version.paths.assets }}</code>
                <button type="button" class="packages__button" @click="copy(version.paths.assets)">Копировать</button>
              </template>
            </li>
          </ul>
          <p v-if="confirmDelete === pkg.id" class="packages__warning">
            Исходники и медиа в userwidgets/{{ pkg.id }}/ тоже будут удалены
            <button type="button" class="packages__button" :disabled="busy" @click="remove(pkg.id)">Удалить</button>
            <button type="button" class="packages__button" @click="confirmDelete = null">Отмена</button>
          </p>
```

with `async function copy(path: string) { await navigator.clipboard.writeText(path) }`. Replace «Установить из файла» and the file input with:

```vue
        <button type="button" class="packages__button" :disabled="busy" @click="folderInput?.click()">Выбрать папку</button>
      ...
      <input ref="folderBox" type="file" webkitdirectory hidden @change="chooseFolder" />
```

and put `@dragover.prevent @drop.prevent="dropFolder"` on the `<dialog>`. Styles: `.packages__progress { width: 100%; }`, `.packages__sources { grid-column: 1 / -1; margin: 0; padding: 0; list-style: none; font-size: 0.875rem; color: var(--ld-text-muted); }`, `.packages__path { overflow-wrap: anywhere; font-family: var(--ld-font-mono, monospace); }` — tokens only (if `--ld-font-mono` is not in the theme contract, use `font-family: monospace`; `theme-contract.test.ts` decides).

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm -C apps/ui test && pnpm -C apps/ui typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/ui
git commit -m "feat(ui): install widgets from a folder with progress and source paths"
```

---

### Task 8: Examples, README, v1 removal, full verification and browser acceptance

**Files:**
- Modify: `examples/widgets/hello/src/index.vue`; create `examples/widgets/hello/assets/bg.mp4`
- Modify: `examples/widgets/hostile/src/index.vue`; create `examples/widgets/hostile/assets/evil.svg`
- Modify: `README.md`, `packages/contracts/src/widget-package.ts`, `packages/contracts/test/widget-package.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new code interfaces.

- [ ] **Step 1: Remove the v1 format**

In `packages/contracts/src/widget-package.ts` delete `parseWidgetPackage`, `WidgetPackage`, `TOP_KEYS`, `FILE_NAME_PATTERN`, `V1_MAX_FILES` and `PACKAGE_LIMITS.maxBytes`. Keep `canonicalJson` (the gateway and uploads use it). In the test file delete the `valid`-based `parseWidgetPackage` describe but keep `valid.manifest` as a plain `WidgetPackageManifest` constant for the v2 tests. Run `pnpm typecheck` and remove every reference the errors list (there should be none outside contracts after Tasks 3–7).

- [ ] **Step 2: `hello` with a background video**

```bash
mkdir -p examples/widgets/hello/assets
ffmpeg -y -f lavfi -i testsrc=duration=4:size=320x240:rate=24 -pix_fmt yuv420p -movflags +faststart -an examples/widgets/hello/assets/bg.mp4
```

In `examples/widgets/hello/src/index.vue` add inside `.hello` before `.hello__count`:

```vue
    <video ref="videoBox" class="hello__bg" src="assets/bg.mp4" autoplay muted loop playsinline />
```

and a «Перемотать» button with status text:

```ts
const video = useTemplateRef<HTMLVideoElement>('videoBox')
function seek() {
  if (!video.value) return
  video.value.currentTime = 2
  status.value = `Видео: ${video.value.currentTime.toFixed(1)} с`
}
```

```vue
      <button type="button" class="hello__button" @click="seek">Перемотать</button>
```

CSS: `.hello { position: relative; }`, `.hello__bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.35; z-index: -1; }`. Import `useTemplateRef` from `vue`.

- [ ] **Step 3: `hostile` probes**

`examples/widgets/hostile/assets/evil.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>document.title = 'pwned'</script></svg>
```

In `examples/widgets/hostile/src/index.vue` `onMounted`, after the existing probes:

```ts
  await probe('fetch https://example.com/', async () => (await fetch('https://example.com/')).status)
  await probe('fetch source/', async () => (await fetch('source/src/index.vue')).status)
  await probe('fetch widget.json', async () => (await fetch('widget.json')).status)
  await probe('new Worker(index.js)', () => {
    new Worker('index.js', { type: 'module' })
    return 'constructed'
  })
```

Expected results: the first and the worker probe are `blocked: …`; the two `fetch` probes return `value: 404`.

- [ ] **Step 4: README**

In `README.md`:
- «What works today» row «Installable widgets»: `Widget folders built by ld-widget build: code up to 10 MB, unlimited media, bundled sources; installed through the UI into the userwidgets library with permission review.`
- «Widget SDK» table row `ld-widget build [dir]` → `ld-widget build [dir] [--no-source]` — `Build a widget project into an installable folder dist/<id>-<version>/.`
- Replace the paragraph after the project tree («The manifest describes… still needs dedicated support.») with:

```markdown
`ld-widget build` writes `dist/<id>-<version>/`: `widget.json` (`"format": 2`), compiled code (`.js`, `.mjs`, `.css`, `.wasm`, up to **10 MB** in total), `assets/` copied from the project (images, video, audio, fonts, models — **no size limit**) and `source/`, the project itself without `node_modules/`, `dist/`, `assets/`, `.git/` and `.env*` files. `--no-source` leaves `source/` out.

Reference media by URL, for example `<video src="assets/bg.mp4">` or `fetch('assets/model.glb')`; importing a video, audio or a media file over 100 KB into code fails the build. Workers start from a `blob:` URL. A widget still has no network access beyond its own folder.

To rebuild an installed widget, copy its `source/` and `assets/` (paths are shown in «Виджеты») into `examples/widgets/<name>/` of a LifeDashboard checkout and run `pnpm -C examples/widgets/<name> build`.
```

- Build instructions: output line `# examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0/`; then «select **«Виджеты» → «Выбрать папку»**, pick that folder (or drop it on the dialog), review the permissions and sizes, install…».
- Security section: replace «Currently supported permissions…» paragraph's preceding sentence about packages if it mentions `.ldwidget.json`; grep `ldwidget` and remove every mention.

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm -C examples/widgets/hello build && pnpm -C examples/widgets/hostile build`
Expected: all pass; `grep -rn "ldwidget" --include='*.ts' --include='*.vue' --include='*.md' apps packages examples README.md` prints nothing.

- [ ] **Step 6: Browser acceptance in Orca's browser (`orca-cli`)**

Prepare a v1 database first, from a `main` worktree:

```bash
git worktree add ../ld-main main
export LIFEDASHBOARD_DATA_DIR="$(mktemp -d)"
(cd ../ld-main && pnpm install && pnpm -C examples/widgets/hello build)
(cd ../ld-main && pnpm dev)   # pair, install ../ld-main/examples/widgets/hello/dist/*.ldwidget.json, place it, stop
```

Then on this branch with the same `LIFEDASHBOARD_DATA_DIR`, `pnpm dev`, open `http://127.0.0.1:3000` in Orca's browser and check:

1. The v1 `hello` placed on `main` still renders (migration 6). Its version shows «Исходники не включены».
2. «Виджеты» → «Выбрать папку» → `examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0`: same id and version as the migrated v1 with another hash, so after the upload expect «Эта версия уже установлена с другим содержимым». Bump `examples/widgets/hello/widget.json` to `1.0.1` locally (do not commit), rebuild, install: review screen shows sizes, progress runs, install succeeds.
3. Place `hello` 1.0.1: the video plays behind the counter; «Перемотать» shows «Видео: 2.0 с».
4. Picking `examples/widgets/hello/dist` (the parent) shows «В папке нет widget.json».
5. Packages list shows the `source/` and `assets/` paths; «Копировать» copies.
6. Restore: copy the shown `source/` and `assets/` into `examples/widgets/hello-restored/`, set version `1.0.2` in its `widget.json`, `pnpm install`, `pnpm -C examples/widgets/hello-restored build`, install it. Then delete `examples/widgets/hello-restored/` (not committed).
7. Install and place `hostile`: probes show `fetch https://example.com/ → blocked`, `fetch source/ → value: 404`, `fetch widget.json → value: 404`, `new Worker(index.js) → blocked`, plus the v1 probes as before.
8. Open `http://127.0.0.1:3001/sandbox/packages/<hostile hash>/assets/evil.svg` in a tab: the tab title is not `pwned`.
9. Delete `hello` 1.0.1's package after removing it from the board: the warning names `userwidgets/dev.lifedashboard.hello/`, and the folder is gone afterwards.

Clean up: `git worktree remove ../ld-main`, `rm -rf "$LIFEDASHBOARD_DATA_DIR"`, revert the local version bump.

- [ ] **Step 7: Commit**

```bash
git add examples README.md packages/contracts
git commit -m "feat: widget package v2 examples and docs; drop the v1 format"
```
