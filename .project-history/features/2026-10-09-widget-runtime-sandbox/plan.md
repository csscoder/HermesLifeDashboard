# Widget Runtime: Installable Packages in a Sandbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let other developers ship Vue widgets as `*.ldwidget.json` packages that the user installs after a permissions screen and that run in a sandboxed iframe, reaching data only through a permission-checked Fastify gateway, while built-in widgets keep running in-process behind the same `useWidget()` SDK.

**Architecture:** `packages/contracts` gains the package format, gateway operations, RPC message types and built-in manifests. The API stores packages, grants and widget state in SQLite (migration 2), issues in-memory widget sessions bound to the dashboard session, runs every gateway call through one pipeline (session → op → grant → input → rate limit → handler → audit), and serves a per-package sandbox document with a strict CSP under `/sandbox`. A new `packages/widget-sdk` holds `useWidget()`, the transport-neutral `createWidget()`, the sandbox bootstrap (built to `dist/sandbox.js`) and the `ld-widget build` CLI. The UI broker (`apps/ui/app/widgets/broker.ts`) owns the widget session, the handshake checked by `event.source`, and a `MessagePort` bridge with size, in-flight, timeout and malformed-message limits; `WidgetHost` provides the in-process widget for built-ins and mounts `SandboxWidget` for packages.

**Tech Stack:** Node 24 (`node:sqlite`, `node:crypto`), Fastify 5.12.5, Nuxt 4.5.2 / Vue 3.5.43, Vite 8.3.2 + `@vitejs/plugin-vue` 6.0.9 (widget builds only), TypeScript 6.0.3 strict, Vitest 5.0.3, pnpm 10.30.2 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md` (read it before starting; base design: `docs/base-2026-10-04-lifegamehermes-design.md`). The `.whiteboard.json` next to the spec is a visual rendering of the same spec, not an extra source of requirements.

## Global Constraints

- New external dependencies, exactly these (approved in the spec): `vite` `8.3.2` and `@vitejs/plugin-vue` `6.0.9` as `devDependencies` of `packages/widget-sdk` (the versions Nuxt already resolves in `pnpm-lock.yaml`); `vue` `3.5.43` as a `dependency` of `apps/api`. Nothing else: no jsdom, happy-dom or `@vue/test-utils`.
- New workspace packages (`packages/widget-sdk`, `examples/widgets/*`) reuse lockfile versions for their own tooling: `typescript` `6.0.3`, `vitest` `5.0.3`, `@types/node` `24.19.1`, `vue` `3.5.43`; workspace links use `workspace:*`.
- TypeScript strict everywhere. `apps/api`, `packages/contracts`, `packages/widget-sdk` use `erasableSyntaxOnly`: no constructor parameter properties, no `enum`, no runtime `namespace`. Relative imports in these three carry the `.ts` extension. UI files import relative modules without an extension.
- The UI has `imports.autoImport: false` and `components: false`: import every Vue API and component explicitly. Utility classes in UI templates come only from the existing UnoCSS vocabulary (`apps/ui/uno.config.ts`); sandboxed package CSS uses `var(--ld-…)` tokens.
- Package format 1: file at most `1_048_576` bytes; at most 20 files; `id` `^[a-z0-9]+(\.[a-z0-9-]+)+$`, at most 100 characters; `version` `^\d+\.\d+\.\d+$`; `title` and `author` 1–60 characters of plain text; `sdk` `1`; permissions a subset of `state`, `notifications` without duplicates; file names `^[a-z0-9][a-z0-9._-]*$` without `..`, only `.js` and `.css`; sizing `1 ≤ min ≤ default ≤ max`, `max` within 12×8.
- Gateway: `state.get` (permission `state`, 120/min), `state.set` (`state`, 60/min, data at most `65_536` bytes serialized), `notifications.send` (`notifications`, 10/hour, title 1–80, body 0–300 characters). Rate counters key on `(widgetId, op)`, not the session.
- Widget sessions: 32 random bytes (base64url), in memory, bound to the dashboard session token hash, idle expiry 1 hour renewed on use, at most 200 (least recently used evicted). Audit rows older than 30 days are deleted at API start.
- Bridge (host side): message at most `131_072` bytes serialized; at most 16 requests in flight per widget; 10 s per request (`TIMEOUT`); 10 s for the hello; 20 malformed messages close the bridge.
- Error codes and statuses: `SESSION_EXPIRED` 401, `PERMISSION_DENIED` 403, `UNKNOWN_OP` 404, `INVALID_INPUT` 400, `CONFLICT` 409, `PACKAGE_IN_USE` 409, plus the existing ones. Widget-side errors are `WidgetError { code }` with the gateway codes plus `TIMEOUT`, `BRIDGE_CLOSED` and `UNAVAILABLE` (network or API down; this plan adds it, the spec lists no code for that case).
- The iframe attribute is exactly `sandbox="allow-scripts"`. Never add `allow-same-origin`, `allow-top-navigation*`, `allow-popups`, `allow-forms`, `allow-downloads`. The widget session token never enters the frame.
- UI copy (exact strings): «Виджеты», «Установить из файла», «Удалить», «Закрыть», «Установка виджета», «Название», «Автор», «Версия», «Размер», «Разрешения», «Это код стороннего автора», «Хранить собственные данные виджета», «Показывать уведомления», «Без разрешений», «Новые разрешения: », «Эта версия уже установлена», «Установить», «Отмена», «Пакеты не установлены», «Виджет установлен», «Файл больше 1 МБ», «Это не пакет виджета», «Пакет отклонён: », «Эта версия уже установлена с другим содержимым», «Виджет размещён на доске, сначала уберите его с доски», «Не удалось связаться с API», «Добавить виджет», «Добавить виджет…», «Загрузка…», «Ошибка виджета», «Повторить», «Неизвестный виджет».
- Code, comments, commit messages in English. The base design document stays in Russian. Commit format `type(scope): subject`; no attribution trailers. Work on branch `csscoder/widget-isolation-architecture`; never commit to `main`.
- Run commands from the repository root unless a step says otherwise. Browser checks use Orca's built-in browser through `orca-cli` only.

## Review Focus

1. **Theme switch while a sandboxed widget is mounted** — the new theme may not define an optional token (`--ld-glow`, `--ld-blur`) the old one had; the frame must drop it, not keep the old value. Pinned in Task 7 (`applyTokens` removes names the new theme lacks).
2. **Widget code passing a non-cloneable value** (a function, a DOM node) to `state.set` or `call` — the promise must reject with `INVALID_INPUT`, not hang forever. Pinned in Task 6 (port client rejects a function input).
3. **Choosing a wrong file in «Установить из файла»** (a 5 MB file, a non-JSON file) — the user must see a message and no request is sent. Pinned in Task 11 (`readPackageFile` with a large `Blob` and with text that is not JSON).
4. **A hello that arrives after the 10 s timeout or after the widget unmounted** — it must be ignored so a late frame never gets a port. Pinned in Task 10 (handshake: a cancelled registration rejects the hello).
5. **A package without CSS** (`styles: []`, no `<style>` in the SFC) — it must build, install and get a document without a `<link>`. Pinned in Task 8 (document for empty `styles`) and Task 9 (CLI build of a fixture without a style block).

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `packages/contracts/src/parse.ts` (new) | 1 | `ParseResult`, `fail`, `isRecord`, `unknownKey`, `byteLength` shared by parsers |
| `packages/contracts/src/widget-package.ts` (new) | 1 | Package format, limits, `parseWidgetPackage`, `canonicalJson`, `compareVersions`, API DTOs |
| `packages/contracts/src/grid.ts` | 1 | `WidgetSizing` type |
| `packages/contracts/src/widget-gateway.ts` (new) | 2 | Ops, input parsers, `sizeClass`, `WidgetContext`, RPC message types and limits |
| `packages/contracts/src/builtin-widgets.ts` (new) | 2 | Built-in manifests with permissions |
| `packages/contracts/src/api.ts`, `apps/api/src/errors.ts` | 2 | New error codes and statuses |
| `apps/ui/app/widgets/catalog.ts` | 2, 11 | Re-export built-ins; installed packages store, `describeSource`, picker entries, `readPackageFile` |
| `packages/contracts/src/board.ts` | 1, 3 | Shared helpers; `WidgetSource` union |
| `apps/api/src/migrations.ts` | 3 | Migration 2 |
| `apps/api/src/rooms.ts` | 3 | Package sources, installed check, state cleanup |
| `apps/api/src/widget-packages.ts` (new) | 4 | Inspect, install, list, delete |
| `apps/api/src/auth.ts` | 5, 8 | `request.sessionHash`; exported `allowedHosts` |
| `apps/api/src/widget-gateway.ts` (new) | 5 | Widget sessions, gateway pipeline, `state`, `notifications`, audit |
| `packages/widget-sdk/` (new) | 6, 7, 9 | `createWidget`, `useWidget`, `WidgetError`, port client, sandbox bootstrap, `ld-widget` |
| `apps/api/src/sandbox.ts` (new) | 8 | `/sandbox/*` routes, document, CSP |
| `apps/api/src/app.ts` | 4, 5, 8 | Register the new modules |
| `apps/ui/nuxt.config.ts` | 8 | `/sandbox` dev proxy |
| `examples/widgets/hello/`, `examples/widgets/hostile/` (new), `pnpm-workspace.yaml` | 9 | Example and boundary-probe packages |
| `apps/ui/app/api.ts` | 10 | `session-expired`, error `code`, `DELETE`, headers, package and gateway calls |
| `apps/ui/app/widgets/broker.ts` (new) | 10 | Gateway client, handshake, bridge |
| `apps/ui/app/widgets/PackagesDialog.vue` (new), `apps/ui/app/app.vue` | 11, 12 | Packages dialog, picker, toasts |
| `apps/ui/app/board/WidgetBoard.vue` | 2, 3, 11, 12 | Draft source and sizing, `widgetId`/`config`, iframe `pointer-events` |
| `apps/ui/app/toasts.ts` (new) | 12 | Widget notifications as toasts |
| `apps/ui/app/widgets/context.ts` (new) | 12 | Reactive `WidgetContext` of a placed widget |
| `apps/ui/app/widgets/WidgetHost.vue`, `SandboxWidget.vue` (new), `builtin/PlaceholderWidget.vue` | 3, 12 | In-process provider, sandbox branch, static draft card |
| `docs/base-2026-10-04-lifegamehermes-design.md`, `README.md` | 13 | Deviations and package workflow |

---

### Task 1: Package format in `packages/contracts`

**Files:**
- Create: `packages/contracts/src/parse.ts`, `packages/contracts/src/widget-package.ts`, `packages/contracts/test/widget-package.test.ts`
- Modify: `packages/contracts/src/board.ts` (use `parse.ts`), `packages/contracts/src/grid.ts` (add `WidgetSizing`)

**Interfaces:**
- Produces (`@lifedashboard/contracts/parse`):
  ```ts
  type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }
  function fail(error: string): { ok: false; error: string }
  function isRecord(value: unknown): value is Record<string, unknown>
  function unknownKey(record: Record<string, unknown>, allowed: readonly string[]): string | undefined
  function byteLength(text: string): number
  ```
- Produces (`@lifedashboard/contracts/grid`): `interface WidgetSizing extends SizeLimits { default: Size }`.
- Produces (`@lifedashboard/contracts/widget-package`):
  ```ts
  const WIDGET_PERMISSIONS: readonly ['state', 'notifications']
  type WidgetPermission = 'state' | 'notifications'
  const PACKAGE_LIMITS: { maxBytes: 1_048_576; maxFiles: 20; maxIdLength: 100; maxTextLength: 60 }
  interface WidgetPackageManifest { id: string; version: string; title: string; author: string; sdk: 1; entry: string; styles: string[]; sizing: WidgetSizing; permissions: WidgetPermission[] }
  interface WidgetPackage { format: 1; manifest: WidgetPackageManifest; files: Record<string, string> }
  interface PackageInspection { manifest: WidgetPackageManifest; hash: string; installed: boolean; newPermissions: WidgetPermission[] }
  interface InstalledPackageVersion { version: string; hash: string; manifest: WidgetPackageManifest }
  interface InstalledPackage { id: string; title: string; author: string; versions: InstalledPackageVersion[]; grants: WidgetPermission[] } // versions newest first
  function isPackageId(value: unknown): value is string
  function isPackageVersion(value: unknown): value is string
  function parseWidgetPackage(raw: unknown): ParseResult<WidgetPackage>
  function canonicalJson(value: unknown): string
  function compareVersions(a: string, b: string): number
  ```
- `board.ts` keeps exporting `ParseResult` (re-exported from `parse.ts`), so existing imports do not change.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/test/widget-package.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  compareVersions,
  isPackageId,
  parseWidgetPackage,
  type WidgetPackage,
} from '../src/widget-package.ts'

const valid: WidgetPackage = {
  format: 1,
  manifest: {
    id: 'dev.alex.pomodoro',
    version: '1.2.0',
    title: 'Pomodoro',
    author: 'alex',
    sdk: 1,
    entry: 'index.js',
    styles: ['style.css'],
    sizing: { default: { w: 3, h: 3 }, min: { w: 2, h: 2 }, max: { w: 6, h: 6 } },
    permissions: ['state', 'notifications'],
  },
  files: { 'index.js': 'export default {}', 'style.css': '.a{}' },
}

// Tests mutate a deep copy freely; the parser receives it as unknown input.
function mutated(change: (doc: any) => void): unknown {
  const doc = structuredClone(valid)
  change(doc)
  return doc
}

describe('parseWidgetPackage', () => {
  it('accepts a valid package', () => {
    expect(parseWidgetPackage(structuredClone(valid))).toEqual({ ok: true, value: valid })
  })

  it('accepts an entry other than index.js', () => {
    const result = parseWidgetPackage(mutated((d) => {
      d.manifest.entry = 'main.js'
      d.files = { 'main.js': 'export default {}', 'style.css': '' }
    }))
    expect(result.ok).toBe(true)
  })

  it('accepts a package without styles or permissions', () => {
    const result = parseWidgetPackage(mutated((d) => {
      d.manifest.styles = []
      d.manifest.permissions = []
      delete d.files['style.css']
    }))
    expect(result.ok).toBe(true)
  })

  it.each([
    ['null', null, /package must be an object/],
    ['an unknown top-level field', mutated((d) => { d.extra = 1 }), /unknown field "extra"/],
    ['format 2', mutated((d) => { d.format = 2 }), /format must be 1/],
    ['an unknown manifest field', mutated((d) => { d.manifest.configSchema = {} }), /manifest: unknown field "configSchema"/],
    ['an id with capitals', mutated((d) => { d.manifest.id = 'Dev.alex.x' }), /manifest\.id/],
    ['an id without a dot', mutated((d) => { d.manifest.id = 'pomodoro' }), /manifest\.id/],
    ['an id over 100 characters', mutated((d) => { d.manifest.id = `a.${'b'.repeat(99)}` }), /manifest\.id/],
    ['a two-part version', mutated((d) => { d.manifest.version = '1.2' }), /manifest\.version/],
    ['an empty title', mutated((d) => { d.manifest.title = '' }), /manifest\.title/],
    ['a 61-character title', mutated((d) => { d.manifest.title = 'x'.repeat(61) }), /manifest\.title/],
    ['a title with a control character', mutated((d) => { d.manifest.title = 'a\nb' }), /manifest\.title/],
    ['an empty author', mutated((d) => { d.manifest.author = '' }), /manifest\.author/],
    ['sdk 2', mutated((d) => { d.manifest.sdk = 2 }), /manifest\.sdk must be 1/],
    ['min above default', mutated((d) => { d.manifest.sizing.min.w = 4 }), /manifest\.sizing/],
    ['max wider than the grid', mutated((d) => { d.manifest.sizing.max.w = 13 }), /manifest\.sizing/],
    ['a fractional size', mutated((d) => { d.manifest.sizing.default.h = 2.5 }), /manifest\.sizing/],
    ['an unknown sizing field', mutated((d) => { d.manifest.sizing.step = 1 }), /manifest\.sizing/],
    ['an unknown permission', mutated((d) => { d.manifest.permissions = ['http'] }), /manifest\.permissions/],
    ['a duplicate permission', mutated((d) => { d.manifest.permissions = ['state', 'state'] }), /manifest\.permissions/],
    ['an uppercase file name', mutated((d) => { d.files['Index.js'] = '' }), /invalid name "Index\.js"/],
    ['a path in a file name', mutated((d) => { d.files['../x.js'] = '' }), /invalid name/],
    ['two dots in a file name', mutated((d) => { d.files['a..b.js'] = '' }), /invalid name/],
    ['an image file', mutated((d) => { d.files['logo.png'] = '' }), /"logo\.png" must be \.js or \.css/],
    ['21 files', mutated((d) => { for (let i = 0; i < 19; i++) d.files[`f${i}.js`] = '' }), /at most 20 files/],
    ['a non-string file', mutated((d) => { d.files['index.js'] = 1 }), /"index\.js" must be a string/],
    ['a missing entry file', mutated((d) => { d.manifest.entry = 'main.js' }), /manifest\.entry/],
    ['a CSS entry', mutated((d) => { d.manifest.entry = 'style.css' }), /manifest\.entry/],
    ['a missing style file', mutated((d) => { d.manifest.styles = ['theme.css'] }), /manifest\.styles/],
    ['a JS style', mutated((d) => { d.manifest.styles = ['index.js'] }), /manifest\.styles/],
    ['a package over 1 MB', mutated((d) => { d.files['index.js'] = 'x'.repeat(1_048_576) }), /larger than 1 MB/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseWidgetPackage(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})

describe('isPackageId', () => {
  it('accepts dotted lowercase ids only', () => {
    expect(isPackageId('dev.alex.pomodoro')).toBe(true)
    expect(isPackageId('dev.my-widget')).toBe(true)
    expect(isPackageId('dev')).toBe(false)
    expect(isPackageId(1)).toBe(false)
  })
})

describe('canonicalJson', () => {
  it('does not depend on key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { e: 3, f: 2 }] }, b: 1 }),
    )
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })
})

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-package.test.ts`
Expected: FAIL — `Cannot find module '../src/widget-package.ts'` (or "Failed to load url").

- [ ] **Step 3: Write the shared parse helpers and move `board.ts` onto them**

`packages/contracts/src/parse.ts`:

```ts
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The first key of `record` outside `allowed`, or undefined. */
export function unknownKey(record: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(record).find((key) => !allowed.includes(key))
}

/** UTF-8 size: limits are bytes on the wire, not UTF-16 code units. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
```

In `packages/contracts/src/board.ts`:
- replace line 1 with:
  ```ts
  import { GRID, inBounds, overlaps, type Rect } from './grid.ts'
  import { fail, isRecord, type ParseResult } from './parse.ts'

  export type { ParseResult } from './parse.ts'
  ```
- delete the local `export type ParseResult<T> = …` (line 42), `function fail(…)` (lines 96–98) and `function isRecord(…)` (lines 100–102).

In `packages/contracts/src/grid.ts`, after `SizeLimits`:

```ts
/** A widget type's size contract in cells (base design §7.4). */
export interface WidgetSizing extends SizeLimits {
  default: Size
}
```

- [ ] **Step 4: Write `widget-package.ts`**

`packages/contracts/src/widget-package.ts`:

```ts
import { GRID, type Size, type WidgetSizing } from './grid.ts'
import { byteLength, fail, isRecord, unknownKey, type ParseResult } from './parse.ts'

export const WIDGET_PERMISSIONS = ['state', 'notifications'] as const
export type WidgetPermission = (typeof WIDGET_PERMISSIONS)[number]

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
  grants: WidgetPermission[]
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
```

- [ ] **Step 5: Run the contracts suite and typecheck**

Run: `pnpm -C packages/contracts exec vitest run && pnpm -C packages/contracts typecheck`
Expected: PASS (new tests plus the unchanged `board.test.ts` and `grid.test.ts`), no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/parse.ts packages/contracts/src/widget-package.ts packages/contracts/src/board.ts packages/contracts/src/grid.ts packages/contracts/test/widget-package.test.ts
git commit -m "feat(contracts): widget package format and validation"
```

---

### Task 2: Gateway contracts, built-in manifests and error codes

**Files:**
- Create: `packages/contracts/src/widget-gateway.ts`, `packages/contracts/src/builtin-widgets.ts`, `packages/contracts/test/widget-gateway.test.ts`, `packages/contracts/test/builtin-widgets.test.ts`
- Modify: `packages/contracts/src/api.ts`, `apps/api/src/errors.ts`, `apps/api/test/errors.test.ts`, `apps/ui/app/widgets/catalog.ts`, `apps/ui/app/board/WidgetBoard.vue:6,68-70`, `apps/ui/test/catalog.test.ts`

**Interfaces:**
- Consumes: `ParseResult`, `fail`, `isRecord`, `unknownKey`, `byteLength` (Task 1); `WidgetSizing`, `Size` (Task 1); `WidgetPermission` (Task 1).
- Produces (`@lifedashboard/contracts/widget-gateway`):
  ```ts
  const GATEWAY_OPS: { 'state.get': { permission: 'state' }; 'state.set': { permission: 'state' }; 'notifications.send': { permission: 'notifications' } }
  type GatewayOp = 'state.get' | 'state.set' | 'notifications.send'
  const STATE_MAX_BYTES = 65_536
  interface StateGetOutput { data: unknown; revision: number }
  interface StateSetInput { data: unknown; expectedRevision: number }
  interface StateSetOutput { revision: number }
  interface NotificationInput { title: string; body: string }
  interface GatewayInputs { 'state.get': Record<string, never>; 'state.set': StateSetInput; 'notifications.send': NotificationInput }
  interface WidgetSessionResponse { widgetSession: string; grants: WidgetPermission[] }
  function isGatewayOp(op: unknown): op is GatewayOp
  function parseGatewayInput<Op extends GatewayOp>(op: Op, raw: unknown): ParseResult<GatewayInputs[Op]>
  type SizeClass = 'xs' | 's' | 'm' | 'l' | 'xl'
  function sizeClass(size: Size): SizeClass
  interface WidgetContext { size: Size; sizeClass: SizeClass; theme: { id: string; scheme: 'light' | 'dark'; tokens: Record<string, string> }; rootFontSize: number; config: Record<string, unknown>; locale: string; visible: boolean }
  type WidgetErrorCode = 'SESSION_EXPIRED' | 'UNKNOWN_OP' | 'PERMISSION_DENIED' | 'INVALID_INPUT' | 'RATE_LIMITED' | 'CONFLICT' | 'TIMEOUT' | 'BRIDGE_CLOSED' | 'UNAVAILABLE'
  const SDK_VERSION = 1
  interface HelloMessage { t: 'ld:hello'; sdk: number }
  interface InitMessage { t: 'ld:init'; context: WidgetContext }
  interface RequestMessage { t: 'req'; id: number; op: string; input: unknown }
  type ResponseMessage = { t: 'res'; id: number; ok: true; value: unknown } | { t: 'res'; id: number; ok: false; error: { code: WidgetErrorCode; message: string } }
  interface ContextMessage { t: 'context'; patch: Partial<WidgetContext> }
  interface ErrorReportMessage { t: 'error'; message: string }
  const BRIDGE_LIMITS: { maxMessageBytes: 131_072; maxInFlight: 16; requestTimeoutMs: 10_000; helloTimeoutMs: 10_000; maxMalformed: 20 }
  function parseSandboxMessage(raw: unknown): RequestMessage | ErrorReportMessage | null
  ```
- Produces (`@lifedashboard/contracts/builtin-widgets`):
  ```ts
  interface BuiltinWidgetManifest { type: string; title: string; sizing: WidgetSizing; permissions: readonly WidgetPermission[] }
  const BUILTIN_WIDGETS: readonly BuiltinWidgetManifest[]
  function findBuiltinWidget(type: string): BuiltinWidgetManifest | undefined
  ```
- Produces (`@lifedashboard/contracts/api`): `ErrorCode` gains `SESSION_EXPIRED | UNKNOWN_OP | PERMISSION_DENIED | INVALID_INPUT | CONFLICT | PACKAGE_IN_USE`.
- Produces (`apps/ui/app/widgets/catalog.ts`): `BUILTIN_WIDGETS`, `findBuiltinWidget`, `BuiltinWidgetManifest` re-exported; `placeholderManifest` kept until Task 11. `findManifest`, `WidgetManifest`, `WidgetSizing`, `builtinWidgetCatalog` are removed.

`sizeClass` uses the smaller side of the widget in cells (legibility follows the short side): 1 → `xs`, 2 → `s`, 3–4 → `m`, 5–6 → `l`, 7 and more → `xl`. This fixes the thresholds the spec leaves to the plan.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/test/widget-gateway.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isGatewayOp, parseGatewayInput, parseSandboxMessage, sizeClass } from '../src/widget-gateway.ts'

// JSON of 'x'.repeat(n) is n + 2 bytes (the quotes).
const exactly64k = 'x'.repeat(65_534)

describe('isGatewayOp', () => {
  it('knows the three operations and nothing from the prototype', () => {
    expect(['state.get', 'state.set', 'notifications.send'].every(isGatewayOp)).toBe(true)
    expect(isGatewayOp('http.get')).toBe(false)
    expect(isGatewayOp('toString')).toBe(false)
    expect(isGatewayOp('constructor')).toBe(false)
    expect(isGatewayOp(1)).toBe(false)
  })
})

describe('parseGatewayInput', () => {
  it.each([
    ['state.get', {}, {}],
    ['state.set', { data: { n: 1 }, expectedRevision: 0 }, { data: { n: 1 }, expectedRevision: 0 }],
    ['state.set', { data: null, expectedRevision: 3 }, { data: null, expectedRevision: 3 }],
    ['state.set', { data: exactly64k, expectedRevision: 0 }, { data: exactly64k, expectedRevision: 0 }],
    ['notifications.send', { title: 'Hi', body: '' }, { title: 'Hi', body: '' }],
    ['notifications.send', { title: 'x'.repeat(80), body: 'y'.repeat(300) }, { title: 'x'.repeat(80), body: 'y'.repeat(300) }],
  ] as const)('accepts %s %j', (op, raw, value) => {
    expect(parseGatewayInput(op, raw)).toEqual({ ok: true, value })
  })

  it('normalizes state data to JSON', () => {
    const result = parseGatewayInput('state.set', { data: { at: new Date(0), skip: undefined }, expectedRevision: 0 })
    expect(result).toEqual({ ok: true, value: { data: { at: '1970-01-01T00:00:00.000Z' }, expectedRevision: 0 } })
  })

  it.each([
    ['state.get', { x: 1 }],
    ['state.get', null],
    ['state.set', { expectedRevision: 0 }],
    ['state.set', { data: 1 }],
    ['state.set', { data: 1, expectedRevision: -1 }],
    ['state.set', { data: 1, expectedRevision: 1.5 }],
    ['state.set', { data: 1, expectedRevision: 0, extra: 1 }],
    ['state.set', { data: undefined, expectedRevision: 0 }],
    ['state.set', { data: 10n, expectedRevision: 0 }],
    ['state.set', { data: `${exactly64k}x`, expectedRevision: 0 }],
    ['notifications.send', { title: '', body: '' }],
    ['notifications.send', { title: 'x'.repeat(81), body: '' }],
    ['notifications.send', { title: 'x', body: 'y'.repeat(301) }],
    ['notifications.send', { title: 'x' }],
    ['notifications.send', { title: 'x', body: '', html: '<b>' }],
  ] as const)('rejects %s %s', (op, raw) => {
    expect(parseGatewayInput(op, raw).ok).toBe(false)
  })
})

describe('parseSandboxMessage', () => {
  it('accepts a request and an error report', () => {
    expect(parseSandboxMessage({ t: 'req', id: 0, op: 'state.get', input: {} })).toEqual({ t: 'req', id: 0, op: 'state.get', input: {} })
    expect(parseSandboxMessage({ t: 'error', message: 'boom' })).toEqual({ t: 'error', message: 'boom' })
  })

  it.each([
    null,
    'req',
    { t: 'req', id: -1, op: 'state.get', input: {} },
    { t: 'req', id: 1.5, op: 'state.get', input: {} },
    { t: 'req', id: 1, op: '', input: {} },
    { t: 'req', id: 1, op: 'x'.repeat(101), input: {} },
    { t: 'req', id: 1, op: 'state.get' },
    { t: 'error', message: 1 },
    { t: 'ld:hello', sdk: 1 },
  ])('drops %j', (raw) => {
    expect(parseSandboxMessage(raw)).toBeNull()
  })
})

describe('sizeClass', () => {
  it.each([
    [{ w: 1, h: 8 }, 'xs'],
    [{ w: 2, h: 2 }, 's'],
    [{ w: 12, h: 2 }, 's'],
    [{ w: 3, h: 4 }, 'm'],
    [{ w: 4, h: 4 }, 'm'],
    [{ w: 5, h: 6 }, 'l'],
    [{ w: 6, h: 6 }, 'l'],
    [{ w: 7, h: 7 }, 'xl'],
    [{ w: 12, h: 8 }, 'xl'],
  ] as const)('%j is %s', (size, expected) => {
    expect(sizeClass(size)).toBe(expected)
  })
})
```

`packages/contracts/test/builtin-widgets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUILTIN_WIDGETS, findBuiltinWidget } from '../src/builtin-widgets.ts'

describe('builtin widgets', () => {
  it('describes the placeholder without permissions', () => {
    expect(BUILTIN_WIDGETS.map((manifest) => manifest.type)).toEqual(['placeholder'])
    expect(findBuiltinWidget('placeholder')).toEqual({
      type: 'placeholder',
      title: 'Заглушка',
      sizing: { default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 12, h: 8 } },
      permissions: [],
    })
  })

  it('never resolves prototype members', () => {
    expect(findBuiltinWidget('toString')).toBeUndefined()
    expect(findBuiltinWidget('constructor')).toBeUndefined()
  })
})
```

In `apps/api/test/errors.test.ts`, add inside `describe('error handling', …)`:

```ts
  it.each([
    ['SESSION_EXPIRED', 401],
    ['PERMISSION_DENIED', 403],
    ['UNKNOWN_OP', 404],
    ['INVALID_INPUT', 400],
    ['CONFLICT', 409],
    ['PACKAGE_IN_USE', 409],
  ] as const)('maps %s to %i', async (code, status) => {
    const app = Fastify({ genReqId: newRequestId })
    registerErrorHandling(app)
    app.get('/x', async () => {
      throw new ApiError(code, 'm')
    })
    const response = await app.inject({ url: '/x' })
    expect(response.statusCode).toBe(status)
    expect(response.json().error).toMatchObject({ code, message: 'm', retryable: false })
    await app.close()
  })
```

Replace `apps/ui/test/catalog.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { findBuiltinWidget } from '../app/widgets/catalog'

describe('catalog', () => {
  it('re-exports the built-in manifests from contracts', () => {
    expect(findBuiltinWidget('placeholder')?.sizing).toEqual({
      default: { w: 4, h: 4 },
      min: { w: 1, h: 1 },
      max: { w: 12, h: 8 },
    })
    expect(findBuiltinWidget('toString')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-gateway.test.ts test/builtin-widgets.test.ts; pnpm -C apps/api exec vitest run test/errors.test.ts; pnpm -C apps/ui exec vitest run test/catalog.test.ts`
Expected: FAIL — missing modules in contracts; `errors.test.ts` answers `500`/`undefined` status for the new codes (`STATUS[code]` is undefined); `findBuiltinWidget` is not exported by the catalog.

- [ ] **Step 3: Add the error codes**

`packages/contracts/src/api.ts`, replace `ErrorCode`:

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  // Widget runtime (spec 2026-10-08).
  | 'SESSION_EXPIRED'
  | 'UNKNOWN_OP'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'PACKAGE_IN_USE'
```

`apps/api/src/errors.ts`, replace `STATUS`:

```ts
const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SESSION_EXPIRED: 401,
  UNKNOWN_OP: 404,
  PERMISSION_DENIED: 403,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  PACKAGE_IN_USE: 409,
}
```

- [ ] **Step 4: Write `widget-gateway.ts` and `builtin-widgets.ts`**

`packages/contracts/src/widget-gateway.ts`:

```ts
import type { Size } from './grid.ts'
import { byteLength, fail, isRecord, unknownKey, type ParseResult } from './parse.ts'
import type { WidgetPermission } from './widget-package.ts'

export const GATEWAY_OPS = {
  'state.get': { permission: 'state' },
  'state.set': { permission: 'state' },
  'notifications.send': { permission: 'notifications' },
} as const satisfies Record<string, { permission: WidgetPermission }>

export type GatewayOp = keyof typeof GATEWAY_OPS

export const STATE_MAX_BYTES = 65_536
const NOTIFICATION_TITLE_MAX = 80
const NOTIFICATION_BODY_MAX = 300

export interface StateGetOutput {
  data: unknown
  revision: number
}

export interface StateSetInput {
  data: unknown
  expectedRevision: number
}

export interface StateSetOutput {
  revision: number
}

export interface NotificationInput {
  title: string
  body: string
}

export interface GatewayInputs {
  'state.get': Record<string, never>
  'state.set': StateSetInput
  'notifications.send': NotificationInput
}

/** `POST /widget-sessions` answers with this. */
export interface WidgetSessionResponse {
  widgetSession: string
  grants: WidgetPermission[]
}

export function isGatewayOp(op: unknown): op is GatewayOp {
  return typeof op === 'string' && Object.hasOwn(GATEWAY_OPS, op)
}

function parseStateSet(raw: Record<string, unknown>): ParseResult<StateSetInput> {
  if (unknownKey(raw, ['data', 'expectedRevision']) !== undefined) return fail('state.set takes data and expectedRevision only')
  const revision = raw.expectedRevision
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    return fail('expectedRevision must be a non-negative integer')
  }
  let json: string | undefined
  try {
    json = JSON.stringify(raw.data)
  } catch {
    json = undefined
  }
  if (json === undefined) return fail('data must be a JSON value')
  if (byteLength(json) > STATE_MAX_BYTES) return fail('data must be at most 64 KB as JSON')
  // The stored value is exactly what was measured: dates become strings, undefined fields disappear.
  return { ok: true, value: { data: JSON.parse(json) as unknown, expectedRevision: revision } }
}

function parseNotification(raw: Record<string, unknown>): ParseResult<NotificationInput> {
  if (unknownKey(raw, ['title', 'body']) !== undefined) return fail('notifications.send takes title and body only')
  const { title, body } = raw
  if (typeof title !== 'string' || title.length < 1 || title.length > NOTIFICATION_TITLE_MAX) {
    return fail('title must be 1–80 characters')
  }
  if (typeof body !== 'string' || body.length > NOTIFICATION_BODY_MAX) return fail('body must be at most 300 characters')
  return { ok: true, value: { title, body } }
}

// Validated twice: by the host broker before the API call and by the API (spec «RPC bridge»).
export function parseGatewayInput<Op extends GatewayOp>(op: Op, raw: unknown): ParseResult<GatewayInputs[Op]> {
  if (!isRecord(raw)) return fail('input must be an object')
  let result: ParseResult<unknown>
  if (op === 'state.get') {
    result = Object.keys(raw).length === 0 ? { ok: true, value: {} } : fail('state.get takes no input')
  } else if (op === 'state.set') {
    result = parseStateSet(raw)
  } else {
    result = parseNotification(raw)
  }
  return result as ParseResult<GatewayInputs[Op]>
}

export type SizeClass = 'xs' | 's' | 'm' | 'l' | 'xl'

/** Base design §7.4 size classes, by the smaller side in cells. One function for both hosts. */
export function sizeClass(size: Size): SizeClass {
  const side = Math.min(size.w, size.h)
  if (side <= 1) return 'xs'
  if (side <= 2) return 's'
  if (side <= 4) return 'm'
  if (side <= 6) return 'l'
  return 'xl'
}

export interface WidgetContext {
  size: Size
  sizeClass: SizeClass
  // Tokens are full custom property names (`--ld-bg`) with resolved values.
  theme: { id: string; scheme: 'light' | 'dark'; tokens: Record<string, string> }
  // px of the dashboard's html font-size, so `rem` in a frame matches the board (§7.4).
  rootFontSize: number
  config: Record<string, unknown>
  locale: string
  visible: boolean
}

export type WidgetErrorCode =
  | 'SESSION_EXPIRED'
  | 'UNKNOWN_OP'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'TIMEOUT'
  | 'BRIDGE_CLOSED'
  | 'UNAVAILABLE'

export const SDK_VERSION = 1

export interface HelloMessage {
  t: 'ld:hello'
  sdk: number
}

export interface InitMessage {
  t: 'ld:init'
  context: WidgetContext
}

export interface RequestMessage {
  t: 'req'
  id: number
  op: string
  input: unknown
}

export type ResponseMessage =
  | { t: 'res'; id: number; ok: true; value: unknown }
  | { t: 'res'; id: number; ok: false; error: { code: WidgetErrorCode; message: string } }

export interface ContextMessage {
  t: 'context'
  patch: Partial<WidgetContext>
}

export interface ErrorReportMessage {
  t: 'error'
  message: string
}

export const BRIDGE_LIMITS = {
  maxMessageBytes: 131_072,
  maxInFlight: 16,
  requestTimeoutMs: 10_000,
  helloTimeoutMs: 10_000,
  maxMalformed: 20,
} as const

/** A message from a sandbox frame, or null when it is malformed. */
export function parseSandboxMessage(raw: unknown): RequestMessage | ErrorReportMessage | null {
  if (!isRecord(raw)) return null
  if (raw.t === 'error') return typeof raw.message === 'string' ? { t: 'error', message: raw.message } : null
  if (raw.t !== 'req' || !('input' in raw)) return null
  const { id, op } = raw
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return null
  if (typeof op !== 'string' || op.length < 1 || op.length > 100) return null
  return { t: 'req', id, op, input: raw.input }
}
```

`packages/contracts/src/builtin-widgets.ts`:

```ts
import type { WidgetSizing } from './grid.ts'
import type { WidgetPermission } from './widget-package.ts'

/** A widget compiled into the app build. The API reads its grants here; there is no install screen. */
export interface BuiltinWidgetManifest {
  type: string
  title: string
  sizing: WidgetSizing
  permissions: readonly WidgetPermission[]
}

export const BUILTIN_WIDGETS: readonly BuiltinWidgetManifest[] = [
  {
    type: 'placeholder',
    title: 'Заглушка',
    sizing: { default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 12, h: 8 } },
    permissions: [],
  },
]

// A Map (not an object) so types like "toString" never resolve to prototype members.
const byType = new Map(BUILTIN_WIDGETS.map((manifest) => [manifest.type, manifest]))

export function findBuiltinWidget(type: string): BuiltinWidgetManifest | undefined {
  return byType.get(type)
}
```

- [ ] **Step 5: Point the UI catalog at contracts**

Replace `apps/ui/app/widgets/catalog.ts`:

```ts
import { findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'

// One trusted list shared with the API; the UI adds only renderers (registry.ts).
export { BUILTIN_WIDGETS, findBuiltinWidget, type BuiltinWidgetManifest } from '@lifedashboard/contracts/builtin-widgets'

export const placeholderManifest = findBuiltinWidget('placeholder')!
```

In `apps/ui/app/board/WidgetBoard.vue`:
- line 6: `import { findBuiltinWidget, placeholderManifest } from '../widgets/catalog'`
- lines 68–70:
  ```ts
  function sizingOf(instance: WidgetInstance) {
    return findBuiltinWidget(instance.source.type)?.sizing ?? null
  }
  ```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm -C packages/contracts exec vitest run && pnpm -C apps/api exec vitest run && pnpm -C apps/ui exec vitest run && pnpm typecheck`
Expected: PASS everywhere, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/widget-gateway.ts packages/contracts/src/builtin-widgets.ts packages/contracts/src/api.ts packages/contracts/test/widget-gateway.test.ts packages/contracts/test/builtin-widgets.test.ts apps/api/src/errors.ts apps/api/test/errors.test.ts apps/ui/app/widgets/catalog.ts apps/ui/app/board/WidgetBoard.vue apps/ui/test/catalog.test.ts
git commit -m "feat(contracts): gateway operations, rpc messages and built-in manifests"
```

---

### Task 3: Package widget sources on the board (migration 2)

**Files:**
- Modify: `packages/contracts/src/board.ts`, `packages/contracts/test/board.test.ts`, `apps/api/src/migrations.ts`, `apps/api/src/rooms.ts`, `apps/api/test/db.test.ts`, `apps/api/test/rooms.test.ts`, `apps/ui/app/widgets/WidgetHost.vue:10`, `apps/ui/app/board/WidgetBoard.vue` (`sizingOf`)

**Interfaces:**
- Consumes: `isPackageId`, `isPackageVersion` (Task 1).
- Produces: `WidgetSource = { kind: 'builtin'; type: string } | { kind: 'package'; packageId: string; version: string }`; `parseScreenBoard` accepts both kinds. Migration 2 tables: `widget_packages`, `widget_package_versions`, `widget_grants`, `widget_state`, `widget_audit`, column `widgets.source_version`. A package widget row stores `source_kind = 'package'`, `source_type = packageId`, `source_version = version`.
- `PUT /rooms/:roomId/board` answers `400 VALIDATION_ERROR` "Widget package <id>@<version> is not installed" and deletes `widget_state` rows of widgets the save removed.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/test/board.test.ts`, add inside `describe('parseScreenBoard', …)` before the `it.each`:

```ts
  it('accepts a package source', () => {
    const source = { kind: 'package', packageId: 'dev.alex.pomodoro', version: '1.2.0' }
    const result = parseScreenBoard(mutated((d) => { d.instances[0].source = { ...source, extra: 1 } }))
    expect(result.ok && result.value.instances[0]!.source).toEqual(source)
  })
```

and add to the `it.each` rejection list:

```ts
    ['a package source with a bad id', mutated((d) => { d.instances[0].source = { kind: 'package', packageId: 'X', version: '1.0.0' } }), /invalid source/],
    ['a package source with a bad version', mutated((d) => { d.instances[0].source = { kind: 'package', packageId: 'dev.a', version: 'latest' } }), /invalid source/],
```

In `apps/api/test/db.test.ts`:
- in `creates the schema and the seed room with one screen`, replace the `tables` expectation with:
  ```ts
  expect(tables(db)).toEqual([
    'rooms',
    'screens',
    'sessions',
    'widget_audit',
    'widget_grants',
    'widget_package_versions',
    'widget_packages',
    'widget_state',
    'widgets',
  ])
  ```
- add:
  ```ts
  it('migrates a version 1 database with widgets and sessions to version 2', async () => {
    const v1 = await openDatabase(file, [MIGRATIONS[0]!])
    v1.exec(`
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('w1', '${SEED_SCREEN_ID}', 'builtin', 'placeholder', '{}', 1, 0, 0, 2, 2);
      INSERT INTO sessions (token_hash, created_at, expires_at) VALUES ('h', 'a', 'b');
    `)
    v1.close()

    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(2)
    expect(db.prepare('SELECT id, source_kind, source_version FROM widgets').all()).toEqual([
      { id: 'w1', source_kind: 'builtin', source_version: null },
    ])
    expect(db.prepare('SELECT token_hash FROM sessions').all()).toEqual([{ token_hash: 'h' }])
    db.close()

    const saved = new DatabaseSync(`${file}.bak-v1`)
    expect(userVersion(saved)).toBe(1)
    expect(tables(saved)).not.toContain('widget_packages')
    saved.close()

    const again = await openDatabase(file)
    expect(userVersion(again)).toBe(2)
    expect(again.prepare('SELECT count(*) AS n FROM widgets').get()).toEqual({ n: 1 })
    again.close()
    expect(existsSync(`${file}.bak-v2`)).toBe(false)
  })
  ```

In `apps/api/test/rooms.test.ts`, add after the existing `describe('PUT …')` block:

```ts
describe('package widgets on the board', () => {
  const pomodoro = { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' } as const

  function installVersion(): void {
    t.db.exec(`
      INSERT INTO widget_packages (id, title, author, created_at) VALUES ('dev.test.hello', 'Hello', 'test', 'x');
      INSERT INTO widget_package_versions (package_id, version, hash, manifest, files, installed_at)
      VALUES ('dev.test.hello', '1.0.0', '${'a'.repeat(64)}', '{}', '{}', 'x');
    `)
  }

  const withPackage: ScreenBoard = {
    id: SEED_SCREEN_ID,
    instances: [
      { id: A, source: { ...pomodoro }, configVersion: 1, config: {} },
      { id: B, source: { ...placeholder }, configVersion: 1, config: {} },
    ],
    layout: [
      { instanceId: A, x: 0, y: 0, w: 3, h: 3 },
      { instanceId: B, x: 4, y: 0, w: 2, h: 2 },
    ],
  }

  it('saves and reads back a package source', async () => {
    installVersion()
    const response = await put({ expectedRevision: 1, screens: [withPackage] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens).toEqual([withPackage])
    expect(t.db.prepare('SELECT source_kind, source_type, source_version FROM widgets WHERE id = ?').get(A)).toEqual({
      source_kind: 'package',
      source_type: 'dev.test.hello',
      source_version: '1.0.0',
    })
    expect(t.db.prepare('SELECT source_version FROM widgets WHERE id = ?').get(B)).toEqual({ source_version: null })
  })

  it('answers 400 for a package version that is not installed and changes nothing', async () => {
    const response = await put({ expectedRevision: 1, screens: [withPackage] })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain('dev.test.hello@1.0.0 is not installed')
    expect(await getBoard()).toEqual({ roomId: SEED_ROOM_ID, revision: 1, screens: [EMPTY_SCREEN] })
  })

  it('keeps widget state across a save that keeps the widget and drops it with the widget', async () => {
    installVersion()
    await put({ expectedRevision: 1, screens: [withPackage] })
    t.db.exec(`
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${A}', '{"n":1}', 1, 'x');
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${B}', '{"n":2}', 1, 'x');
    `)
    const onlyA: ScreenBoard = { id: SEED_SCREEN_ID, instances: [withPackage.instances[0]!], layout: [withPackage.layout[0]!] }
    expect((await put({ expectedRevision: 2, screens: [onlyA] })).statusCode).toBe(200)
    expect(t.db.prepare('SELECT widget_id FROM widget_state').all()).toEqual([{ widget_id: A }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/board.test.ts; pnpm -C apps/api exec vitest run test/db.test.ts test/rooms.test.ts`
Expected: FAIL — package sources are `invalid source`; no `widget_*` tables (`no such table: widget_packages`); the schema test lists four tables.

- [ ] **Step 3: Accept package sources in `board.ts`**

In `packages/contracts/src/board.ts`:
- add `import { isPackageId, isPackageVersion } from './widget-package.ts'` to the imports;
- replace the `WidgetSource` type:
  ```ts
  export type WidgetSource =
    | { kind: 'builtin'; type: string }
    | { kind: 'package'; packageId: string; version: string }
  ```
- in `parseScreenBoard`, replace the source block and the `instances.push(…)` line:
  ```ts
      const source = parseSource(item.source)
      if (!source) return fail(`instances[${index}]: invalid source`)
  ```
  ```ts
      instances.push({ id: item.id, source, configVersion: version, config: item.config })
  ```
- add below `parseScreenBoard`:
  ```ts
  function parseSource(raw: unknown): WidgetSource | null {
    if (!isRecord(raw)) return null
    if (raw.kind === 'builtin') return isNonEmptyString(raw.type) ? { kind: 'builtin', type: raw.type } : null
    if (raw.kind === 'package' && isPackageId(raw.packageId) && isPackageVersion(raw.version)) {
      return { kind: 'package', packageId: raw.packageId, version: raw.version }
    }
    return null
  }
  ```

- [ ] **Step 4: Add migration 2**

In `apps/api/src/migrations.ts`, append a second element to `MIGRATIONS` (after the first template literal, before `]`):

```ts
  `
CREATE TABLE widget_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE widget_package_versions (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL,
  files TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version)
);

CREATE TABLE widget_grants (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (package_id, permission)
);

ALTER TABLE widgets ADD COLUMN source_version TEXT;

-- No foreign key: a board save re-inserts widget rows; the save deletes orphaned state itself.
CREATE TABLE widget_state (
  widget_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE widget_audit (
  at TEXT NOT NULL,
  widget_id TEXT NOT NULL,
  package_id TEXT,
  op TEXT NOT NULL,
  outcome TEXT NOT NULL
);
`,
```

- [ ] **Step 5: Store and read package sources in `rooms.ts`**

In `apps/api/src/rooms.ts`:
- import `type WidgetSource` from `@lifedashboard/contracts/board` next to the other board types;
- add to `WidgetRow`: `source_kind: string` and `source_version: string | null`;
- in `readBoard`, replace `source: { kind: 'builtin' as const, type: row.source_type },` with `source: sourceOf(row),`;
- add below `readBoard`:
  ```ts
  function sourceOf(row: WidgetRow): WidgetSource {
    return row.source_kind === 'package'
      ? { kind: 'package', packageId: row.source_type, version: row.source_version ?? '' }
      : { kind: 'builtin', type: row.source_type }
  }

  function checkPackagesInstalled(db: DatabaseSync, screens: ScreenBoard[]): void {
    const installed = db.prepare('SELECT 1 FROM widget_package_versions WHERE package_id = ? AND version = ?')
    for (const { source } of screens.flatMap((screen) => screen.instances)) {
      if (source.kind === 'package' && !installed.get(source.packageId, source.version)) {
        throw new ApiError('VALIDATION_ERROR', `Widget package ${source.packageId}@${source.version} is not installed`)
      }
    }
  }
  ```
- in `saveBoard`, after `const screens = validateScreens(…)` add `checkPackagesInstalled(db, screens)`;
- replace the insert statement and its `insert.run(…)` arguments:
  ```ts
      const insert = db.prepare(
        'INSERT INTO widgets (id, screen_id, source_kind, source_type, source_version, config, config_version, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
  ```
  ```ts
          const { source } = instance
          try {
            insert.run(
              instance.id,
              screen.id,
              source.kind,
              source.kind === 'package' ? source.packageId : source.type,
              source.kind === 'package' ? source.version : null,
              JSON.stringify(instance.config),
              instance.configVersion,
              place.x,
              place.y,
              place.w,
              place.h,
            )
  ```
- before the `UPDATE rooms SET revision …` line add:
  ```ts
      // widget_state has no foreign key (spec «Data»): drop the state of widgets this save removed.
      db.prepare('DELETE FROM widget_state WHERE widget_id NOT IN (SELECT id FROM widgets)').run()
  ```

- [ ] **Step 6: Narrow the source in the UI**

`apps/ui/app/widgets/WidgetHost.vue` line 10:

```ts
const renderer = computed(() => (props.source.kind === 'builtin' ? builtinWidgetRenderers.get(props.source.type) : undefined))
```

`apps/ui/app/board/WidgetBoard.vue`, `sizingOf`:

```ts
function sizingOf(instance: WidgetInstance) {
  return instance.source.kind === 'builtin' ? (findBuiltinWidget(instance.source.type)?.sizing ?? null) : null
}
```

(Task 11 replaces this with sizing from installed packages.)

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm -C packages/contracts exec vitest run && pnpm -C apps/api exec vitest run && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/board.ts packages/contracts/test/board.test.ts apps/api/src/migrations.ts apps/api/src/rooms.ts apps/api/test/db.test.ts apps/api/test/rooms.test.ts apps/ui/app/widgets/WidgetHost.vue apps/ui/app/board/WidgetBoard.vue
git commit -m "feat(api): package widget sources and widget tables (migration 2)"
```

---
### Task 4: Package routes — inspect, install, list, delete

**Files:**
- Create: `apps/api/src/widget-packages.ts`, `apps/api/test/widget-packages.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/test/helpers.ts`

**Interfaces:**
- Consumes: `parseWidgetPackage`, `canonicalJson`, `compareVersions`, `PACKAGE_LIMITS`, `PackageInspection`, `InstalledPackage`, `WidgetPermission` (Task 1); migration 2 tables (Task 3); `ApiError('CONFLICT' | 'PACKAGE_IN_USE')` (Task 2).
- Produces (`apps/api/src/widget-packages.ts`):
  ```ts
  function registerWidgetPackages(app: FastifyInstance, deps: { db: DatabaseSync; now: () => Date }): void
  function packageHash(pkg: WidgetPackage): string           // sha256 hex of canonicalJson({ manifest, files })
  function grantsOf(db: DatabaseSync, packageId: string): WidgetPermission[]  // sorted by name
  ```
- Routes: `POST /api/v1/widget-packages/inspect` → `PackageInspection` (writes nothing; `409 CONFLICT` for an installed version with another hash); `POST /api/v1/widget-packages` → `PackageInspection` with `installed: true, newPermissions: []`; `GET /api/v1/widget-packages` → `InstalledPackage[]` (by title, versions newest first, grants sorted); `DELETE /api/v1/widget-packages/:id` → `null`, `404` unknown, `409 PACKAGE_IN_USE` while placed. Package routes take bodies up to `1_048_576` bytes.
- Produces (`apps/api/test/helpers.ts`): `CallOptions.method` accepts `'DELETE'`; `CallOptions.headers?: Record<string, string>`; `widgetPackage(change?)` (id `dev.test.hello`, version `1.0.0`, permissions `['state']`); `installPackage(t, cookie, pkg?)` → `PackageInspection`.

- [ ] **Step 1: Extend the test helpers**

In `apps/api/test/helpers.ts`:
- add `import type { PackageInspection } from '@lifedashboard/contracts/widget-package'`;
- in `CallOptions`, change `method` to `method?: 'GET' | 'POST' | 'PUT' | 'DELETE'` and add `headers?: Record<string, string>`;
- in `call`, before `return app.inject(…)` add `Object.assign(headers, options.headers)`;
- append:
  ```ts
  /** A valid widget package; `change` edits it before it is returned. */
  export function widgetPackage(change?: (pkg: any) => void): any {
    const pkg = {
      format: 1,
      manifest: {
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

  export async function installPackage(t: TestApp, cookie: string, pkg: unknown = widgetPackage()): Promise<PackageInspection> {
    const response = await call(t.app, { method: 'POST', url: '/api/v1/widget-packages', cookie, payload: pkg })
    expect(response.statusCode).toBe(200)
    return response.json().data
  }
  ```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/widget-packages.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { packageHash } from '../src/widget-packages.ts'
import { call, errorCode, installPackage, pair, testApp, widgetPackage, type TestApp } from './helpers.ts'

const PACKAGES = '/api/v1/widget-packages'
const BOARD = `/api/v1/rooms/${SEED_ROOM_ID}/board`
const W = '00000000-0000-4000-8000-0000000000c1'

let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
})

afterEach(async () => {
  await t.close()
})

function inspect(payload: unknown) {
  return call(t.app, { method: 'POST', url: `${PACKAGES}/inspect`, cookie, payload })
}

function remove(id: string) {
  return call(t.app, { method: 'DELETE', url: `${PACKAGES}/${id}`, cookie, payload: {} })
}

async function list(): Promise<any[]> {
  const response = await call(t.app, { url: PACKAGES, cookie })
  expect(response.statusCode).toBe(200)
  return response.json().data
}

function count(table: string): unknown {
  return t.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()
}

describe('packageHash', () => {
  it('is a sha256 hex digest that ignores key order', () => {
    const pkg = widgetPackage()
    const reordered = { ...pkg, files: { 'style.css': pkg.files['style.css'], 'index.js': pkg.files['index.js'] } }
    expect(packageHash(pkg)).toMatch(/^[0-9a-f]{64}$/)
    expect(packageHash(reordered)).toBe(packageHash(pkg))
    expect(packageHash(widgetPackage((p) => { p.files['index.js'] = 'x' }))).not.toBe(packageHash(pkg))
  })
})

describe('POST /widget-packages/inspect', () => {
  it('summarizes a new package and writes nothing', async () => {
    const pkg = widgetPackage()
    const response = await inspect(pkg)
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ manifest: pkg.manifest, hash: packageHash(pkg), installed: false, newPermissions: ['state'] })
    expect(count('widget_packages')).toEqual({ n: 0 })
    expect(count('widget_grants')).toEqual({ n: 0 })
  })

  it('reports an installed version and only the permissions the package lacks', async () => {
    await installPackage(t, cookie)
    expect((await inspect(widgetPackage())).json().data).toMatchObject({ installed: true, newPermissions: [] })
    const next = widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'notifications']
    })
    expect((await inspect(next)).json().data).toMatchObject({ installed: false, newPermissions: ['notifications'] })
  })

  it('answers 400 with the validation message', async () => {
    const response = await inspect(widgetPackage((p) => { p.manifest.permissions = ['http'] }))
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(response.json().error.message).toMatch(/manifest\.permissions/)
  })

  it('answers 409 CONFLICT for an installed version with other content', async () => {
    await installPackage(t, cookie)
    const response = await inspect(widgetPackage((p) => { p.files['index.js'] = 'export default { name: "x" }' }))
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('CONFLICT')
  })
})

describe('POST /widget-packages', () => {
  it('stores the version, files, hash and grants', async () => {
    const pkg = widgetPackage()
    expect(await installPackage(t, cookie, pkg)).toEqual({ manifest: pkg.manifest, hash: packageHash(pkg), installed: true, newPermissions: [] })
    expect(await list()).toEqual([
      {
        id: 'dev.test.hello',
        title: 'Hello',
        author: 'test',
        versions: [{ version: '1.0.0', hash: packageHash(pkg), manifest: pkg.manifest }],
        grants: ['state'],
      },
    ])
    expect(t.db.prepare('SELECT files FROM widget_package_versions').get()).toEqual({ files: JSON.stringify(pkg.files) })
  })

  it('treats a repeated install of the same content as a no-op', async () => {
    await installPackage(t, cookie)
    await installPackage(t, cookie)
    expect(count('widget_package_versions')).toEqual({ n: 1 })
  })

  it('rejects the same version with other content and keeps the stored one', async () => {
    const first = widgetPackage()
    await installPackage(t, cookie, first)
    const response = await call(t.app, {
      method: 'POST',
      url: PACKAGES,
      cookie,
      payload: widgetPackage((p) => { p.files['index.js'] = 'export default { name: "x" }' }),
    })
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('CONFLICT')
    expect((await list())[0].versions).toEqual([{ version: '1.0.0', hash: packageHash(first), manifest: first.manifest }])
  })

  it('lists versions newest first and adds new permissions to the package grants', async () => {
    await installPackage(t, cookie)
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.10.0'
      p.manifest.permissions = ['notifications']
    }))
    await installPackage(t, cookie, widgetPackage((p) => { p.manifest.version = '1.9.0' }))
    const [pkg] = await list()
    expect(pkg.versions.map((item: { version: string }) => item.version)).toEqual(['1.10.0', '1.9.0', '1.0.0'])
    expect(pkg.grants).toEqual(['notifications', 'state'])
  })

  it('installs a package whose entry is main.js', async () => {
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.entry = 'main.js'
      p.files = { 'main.js': 'export default {}', 'style.css': '' }
    }))
    expect((await list())[0].versions[0].manifest.entry).toBe('main.js')
  })

  it('rejects a body over 1 MB and stores nothing', async () => {
    const response = await call(t.app, {
      method: 'POST',
      url: PACKAGES,
      cookie,
      payload: widgetPackage((p) => { p.files['index.js'] = 'x'.repeat(1_100_000) }),
    })
    expect(response.statusCode).toBe(400)
    expect(await list()).toEqual([])
  })

  it('keeps the package after an API restart', async () => {
    await installPackage(t, cookie)
    const restarted = await testApp(t.db)
    try {
      const response = await call(restarted.app, { url: PACKAGES, cookie })
      expect(response.json().data.map((item: { id: string }) => item.id)).toEqual(['dev.test.hello'])
    } finally {
      await restarted.close()
    }
  })

  it('requires a session', async () => {
    const response = await call(t.app, { method: 'POST', url: PACKAGES, payload: widgetPackage() })
    expect(response.statusCode).toBe(401)
  })
})

describe('DELETE /widget-packages/:id', () => {
  it('deletes an unplaced package with its versions and grants', async () => {
    await installPackage(t, cookie)
    const response = await remove('dev.test.hello')
    expect(response.statusCode).toBe(200)
    expect(await list()).toEqual([])
    expect(count('widget_package_versions')).toEqual({ n: 0 })
    expect(count('widget_grants')).toEqual({ n: 0 })
  })

  it('answers 409 PACKAGE_IN_USE while a widget of the package is placed', async () => {
    await installPackage(t, cookie)
    const screen = {
      id: SEED_SCREEN_ID,
      instances: [{ id: W, source: { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }, configVersion: 1, config: {} }],
      layout: [{ instanceId: W, x: 0, y: 0, w: 3, h: 3 }],
    }
    const saved = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: 1, screens: [screen] } })
    expect(saved.statusCode).toBe(200)
    const response = await remove('dev.test.hello')
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('PACKAGE_IN_USE')
    expect(await list()).toHaveLength(1)
  })

  it('answers 404 for an unknown package', async () => {
    expect((await remove('dev.test.none')).statusCode).toBe(404)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/widget-packages.test.ts`
Expected: FAIL — `Cannot find module '../src/widget-packages.ts'`.

- [ ] **Step 4: Write `widget-packages.ts`**

`apps/api/src/widget-packages.ts`:

```ts
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import {
  canonicalJson,
  compareVersions,
  PACKAGE_LIMITS,
  parseWidgetPackage,
  type InstalledPackage,
  type PackageInspection,
  type WidgetPackage,
  type WidgetPackageManifest,
  type WidgetPermission,
} from '@lifedashboard/contracts/widget-package'
import { ApiError, ok } from './errors.ts'

const PACKAGE_BODY = { bodyLimit: PACKAGE_LIMITS.maxBytes }

interface ParsedPackage {
  pkg: WidgetPackage
  hash: string
}

export interface WidgetPackagesDeps {
  db: DatabaseSync
  now: () => Date
}

// Spec «API»: packages arrive as files from other people; every body is validated again here.
export function registerWidgetPackages(app: FastifyInstance, { db, now }: WidgetPackagesDeps): void {
  app.post('/api/v1/widget-packages/inspect', PACKAGE_BODY, async (request) => ok(request, inspect(db, parse(request.body))))

  app.post('/api/v1/widget-packages', PACKAGE_BODY, async (request) => ok(request, install(db, parse(request.body), now())))

  app.get('/api/v1/widget-packages', async (request) => ok(request, listPackages(db)))

  app.delete<{ Params: { id: string } }>('/api/v1/widget-packages/:id', async (request) => {
    deletePackage(db, request.params.id)
    return ok(request, null)
  })
}

export function packageHash(pkg: WidgetPackage): string {
  return createHash('sha256').update(canonicalJson({ manifest: pkg.manifest, files: pkg.files })).digest('hex')
}

export function grantsOf(db: DatabaseSync, packageId: string): WidgetPermission[] {
  const rows = db.prepare('SELECT permission FROM widget_grants WHERE package_id = ? ORDER BY permission').all(packageId) as unknown as {
    permission: WidgetPermission
  }[]
  return rows.map((row) => row.permission)
}

function parse(body: unknown): ParsedPackage {
  const result = parseWidgetPackage(body)
  if (!result.ok) throw new ApiError('VALIDATION_ERROR', result.error)
  return { pkg: result.value, hash: packageHash(result.value) }
}

function inspect(db: DatabaseSync, { pkg, hash }: ParsedPackage): PackageInspection {
  const { manifest } = pkg
  const stored = db.prepare('SELECT hash FROM widget_package_versions WHERE package_id = ? AND version = ?').get(manifest.id, manifest.version) as
    | { hash: string }
    | undefined
  // A version is immutable: the same version with other content is never installed.
  if (stored && stored.hash !== hash) {
    throw new ApiError('CONFLICT', `Version ${manifest.version} of ${manifest.id} is already installed with different content`)
  }
  const granted = new Set(grantsOf(db, manifest.id))
  return {
    manifest,
    hash,
    installed: stored !== undefined,
    newPermissions: manifest.permissions.filter((permission) => !granted.has(permission)),
  }
}

function install(db: DatabaseSync, parsed: ParsedPackage, now: Date): PackageInspection {
  db.exec('BEGIN IMMEDIATE')
  try {
    const inspection = inspect(db, parsed)
    if (!inspection.installed) {
      const { manifest, files } = parsed.pkg
      const at = now.toISOString()
      db.prepare(
        'INSERT INTO widget_packages (id, title, author, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, author = excluded.author',
      ).run(manifest.id, manifest.title, manifest.author, at)
      db.prepare(
        'INSERT INTO widget_package_versions (package_id, version, hash, manifest, files, installed_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(manifest.id, manifest.version, parsed.hash, JSON.stringify(manifest), JSON.stringify(files), at)
      const grant = db.prepare('INSERT OR IGNORE INTO widget_grants (package_id, permission, granted_at) VALUES (?, ?, ?)')
      for (const permission of manifest.permissions) grant.run(manifest.id, permission, at)
    }
    db.exec('COMMIT')
    return { ...inspection, installed: true, newPermissions: [] }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function listPackages(db: DatabaseSync): InstalledPackage[] {
  const packages = db.prepare('SELECT id, title, author FROM widget_packages ORDER BY title, id').all() as unknown as {
    id: string
    title: string
    author: string
  }[]
  const versions = db.prepare('SELECT package_id, version, hash, manifest FROM widget_package_versions').all() as unknown as {
    package_id: string
    version: string
    hash: string
    manifest: string
  }[]
  return packages.map((pkg) => ({
    id: pkg.id,
    title: pkg.title,
    author: pkg.author,
    versions: versions
      .filter((row) => row.package_id === pkg.id)
      .map((row) => ({ version: row.version, hash: row.hash, manifest: JSON.parse(row.manifest) as WidgetPackageManifest }))
      .sort((a, b) => compareVersions(b.version, a.version)),
    grants: grantsOf(db, pkg.id),
  }))
}

function deletePackage(db: DatabaseSync, id: string): void {
  if (!db.prepare('SELECT 1 FROM widget_packages WHERE id = ?').get(id)) throw new ApiError('NOT_FOUND', 'Widget package not found')
  if (db.prepare("SELECT 1 FROM widgets WHERE source_kind = 'package' AND source_type = ? LIMIT 1").get(id)) {
    throw new ApiError('PACKAGE_IN_USE', 'Widgets of this package are placed on a board')
  }
  // Versions and grants go with it (ON DELETE CASCADE).
  db.prepare('DELETE FROM widget_packages WHERE id = ?').run(id)
}
```

In `apps/api/src/app.ts`, import `registerWidgetPackages` from `./widget-packages.ts` and add after `registerRooms(app, { db, now })`:

```ts
  registerWidgetPackages(app, { db, now })
```

- [ ] **Step 5: Run the API suite and typecheck**

Run: `pnpm -C apps/api exec vitest run && pnpm -C apps/api typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/widget-packages.ts apps/api/src/app.ts apps/api/test/widget-packages.test.ts apps/api/test/helpers.ts
git commit -m "feat(api): inspect, install, list and delete widget packages"
```

---

### Task 5: Widget sessions and the gateway pipeline

**Files:**
- Create: `apps/api/src/widget-gateway.ts`, `apps/api/test/widget-gateway.test.ts`
- Modify: `apps/api/src/auth.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `findBuiltinWidget` (Task 2); `GATEWAY_OPS`, `isGatewayOp`, `parseGatewayInput`, `GatewayInputs`, `WidgetSessionResponse` (Task 2); `grantsOf` (Task 4); helpers `widgetPackage`, `installPackage`, `CallOptions.headers` (Task 4).
- Produces (`apps/api/src/auth.ts`): `request.sessionHash: string` — sha256 hex of the dashboard session token, set for every authenticated `/api` request.
- Produces (`apps/api/src/widget-gateway.ts`):
  ```ts
  interface GatewayContext { widgetId: string; packageId: string | null; grants: ReadonlySet<WidgetPermission> }
  function registerWidgetGateway(app: FastifyInstance, deps: { db: DatabaseSync; now: () => Date }): void
  ```
- Routes: `POST /api/v1/widget-sessions` body `{ widgetId }` → `WidgetSessionResponse` (`404` unknown widget, unknown built-in type, uninstalled package version; `400` without a string `widgetId`); `DELETE /api/v1/widget-sessions/:widgetSession` → `null` (only the owning dashboard session can end it); `POST /api/v1/widget-gateway/:op` with header `x-widget-session` → operation output.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/widget-gateway.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { call, DAY, errorCode, HOUR, installPackage, pair, T0, testApp, widgetPackage, type TestApp } from './helpers.ts'

const BOARD = `/api/v1/rooms/${SEED_ROOM_ID}/board`
const PKG_WIDGET = '00000000-0000-4000-8000-0000000000a1'
const BUILTIN_WIDGET = '00000000-0000-4000-8000-0000000000b1'
// JSON of 'x'.repeat(n) is n + 2 bytes.
const exactly64k = 'x'.repeat(65_534)

let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
  await installPackage(t, cookie)
  const screen = {
    id: SEED_SCREEN_ID,
    instances: [
      { id: PKG_WIDGET, source: { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }, configVersion: 1, config: {} },
      { id: BUILTIN_WIDGET, source: { kind: 'builtin', type: 'placeholder' }, configVersion: 1, config: {} },
    ],
    layout: [
      { instanceId: PKG_WIDGET, x: 0, y: 0, w: 3, h: 3 },
      { instanceId: BUILTIN_WIDGET, x: 4, y: 0, w: 2, h: 2 },
    ],
  }
  const saved = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: 1, screens: [screen] } })
  expect(saved.statusCode).toBe(200)
})

afterEach(async () => {
  await t.close()
})

function createSession(widgetId: unknown, sessionCookie = cookie) {
  return call(t.app, { method: 'POST', url: '/api/v1/widget-sessions', cookie: sessionCookie, payload: { widgetId } })
}

async function openSession(widgetId: string, app = t.app): Promise<string> {
  const response = await call(app, { method: 'POST', url: '/api/v1/widget-sessions', cookie, payload: { widgetId } })
  expect(response.statusCode).toBe(200)
  return response.json().data.widgetSession
}

// `sessionCookie: null` sends no dashboard cookie (undefined would pick the default).
function gateway(op: string, token: string | null, payload: unknown = {}, sessionCookie: string | null = cookie, app = t.app) {
  return call(app, {
    method: 'POST',
    url: `/api/v1/widget-gateway/${op}`,
    cookie: sessionCookie ?? undefined,
    payload,
    headers: token === null ? {} : { 'x-widget-session': token },
  })
}

function auditRows(): unknown[] {
  return t.db.prepare('SELECT widget_id, package_id, op, outcome FROM widget_audit ORDER BY rowid').all()
}

async function pairAgain(): Promise<string> {
  t.clock.now += 10_000
  expect((await call(t.app, { method: 'POST', url: '/api/v1/auth/pair-code', payload: {} })).statusCode).toBe(200)
  return pair(t)
}

describe('POST /widget-sessions', () => {
  it('returns a random session with the package grants', async () => {
    const response = await createSession(PKG_WIDGET)
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ widgetSession: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), grants: ['state'] })
    expect((await createSession(PKG_WIDGET)).json().data.widgetSession).not.toBe(response.json().data.widgetSession)
  })

  it('takes built-in grants from builtin-widgets.ts', async () => {
    expect((await createSession(BUILTIN_WIDGET)).json().data.grants).toEqual([])
  })

  it.each([
    ['an unknown widget', () => '00000000-0000-4000-8000-0000000000ff'],
    ['an unknown built-in type', () => {
      t.db.prepare("UPDATE widgets SET source_type = 'nope' WHERE id = ?").run(BUILTIN_WIDGET)
      return BUILTIN_WIDGET
    }],
    ['a package version that is not installed', () => {
      t.db.prepare("UPDATE widgets SET source_version = '9.9.9' WHERE id = ?").run(PKG_WIDGET)
      return PKG_WIDGET
    }],
  ])('answers 404 for %s', async (_name, widgetId) => {
    const response = await createSession(widgetId())
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })

  it('answers 400 without a widgetId', async () => {
    expect((await createSession(undefined)).statusCode).toBe(400)
  })

  it('ends a session on DELETE by its owner only', async () => {
    const token = await openSession(PKG_WIDGET)
    const other = await pairAgain()
    await call(t.app, { method: 'DELETE', url: `/api/v1/widget-sessions/${token}`, cookie: other, payload: {} })
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    const ended = await call(t.app, { method: 'DELETE', url: `/api/v1/widget-sessions/${token}`, cookie, payload: {} })
    expect(ended.statusCode).toBe(200)
    expect(errorCode(await gateway('state.get', token))).toBe('SESSION_EXPIRED')
  })
})

describe('gateway pipeline', () => {
  it('answers 401 UNAUTHORIZED without the dashboard cookie', async () => {
    const token = await openSession(PKG_WIDGET)
    const response = await gateway('state.get', token, {}, null)
    expect(response.statusCode).toBe(401)
    expect(errorCode(response)).toBe('UNAUTHORIZED')
  })

  it('answers 401 SESSION_EXPIRED for a missing, unknown or foreign widget session and audits none', async () => {
    const token = await openSession(PKG_WIDGET)
    const other = await pairAgain()
    for (const response of [
      await gateway('state.get', null),
      await gateway('state.get', 'nope'),
      await gateway('state.get', token, {}, other),
    ]) {
      expect(response.statusCode).toBe(401)
      expect(errorCode(response)).toBe('SESSION_EXPIRED')
    }
    expect(auditRows()).toEqual([])
  })

  it('expires an idle session after one hour and renews it on use', async () => {
    const token = await openSession(PKG_WIDGET)
    t.clock.now += HOUR - 1
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    t.clock.now += HOUR - 1
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    t.clock.now += HOUR
    expect(errorCode(await gateway('state.get', token))).toBe('SESSION_EXPIRED')
  })

  it('evicts the least recently used session beyond 200', async () => {
    const first = await openSession(PKG_WIDGET)
    const second = await openSession(PKG_WIDGET)
    expect((await gateway('state.get', first)).statusCode).toBe(200)
    for (let index = 0; index < 199; index++) await openSession(PKG_WIDGET)
    expect((await gateway('state.get', first)).statusCode).toBe(200)
    expect(errorCode(await gateway('state.get', second))).toBe('SESSION_EXPIRED')
  })

  it('answers 404 UNKNOWN_OP, 403 PERMISSION_DENIED and 400 INVALID_INPUT and audits each', async () => {
    const token = await openSession(PKG_WIDGET)
    const builtin = await openSession(BUILTIN_WIDGET)
    const unknown = await gateway('http.get', token)
    expect([unknown.statusCode, errorCode(unknown)]).toEqual([404, 'UNKNOWN_OP'])
    const denied = await gateway('notifications.send', token, { title: 'x', body: '' })
    expect([denied.statusCode, errorCode(denied)]).toEqual([403, 'PERMISSION_DENIED'])
    const builtinDenied = await gateway('state.get', builtin)
    expect([builtinDenied.statusCode, errorCode(builtinDenied)]).toEqual([403, 'PERMISSION_DENIED'])
    const invalid = await gateway('state.set', token, { data: 1 })
    expect([invalid.statusCode, errorCode(invalid)]).toEqual([400, 'INVALID_INPUT'])
    expect((await gateway('state.get', token)).statusCode).toBe(200)
    expect(auditRows()).toEqual([
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'http.get', outcome: 'UNKNOWN_OP' },
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'notifications.send', outcome: 'PERMISSION_DENIED' },
      { widget_id: BUILTIN_WIDGET, package_id: null, op: 'state.get', outcome: 'PERMISSION_DENIED' },
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'state.set', outcome: 'INVALID_INPUT' },
      { widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'state.get', outcome: 'ok' },
    ])
  })

  it('deletes audit rows older than 30 days at start', async () => {
    t.db.exec(`
      INSERT INTO widget_audit (at, widget_id, package_id, op, outcome) VALUES ('${new Date(T0 - 31 * DAY).toISOString()}', 'w', NULL, 'state.get', 'ok');
      INSERT INTO widget_audit (at, widget_id, package_id, op, outcome) VALUES ('${new Date(T0 - 29 * DAY).toISOString()}', 'w', NULL, 'state.set', 'ok');
    `)
    const restarted = await testApp(t.db)
    await restarted.close()
    expect(t.db.prepare('SELECT op FROM widget_audit').all()).toEqual([{ op: 'state.set' }])
  })
})

describe('state', () => {
  it('returns null at revision 0 before the first write', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('state.get', token)).json().data).toEqual({ data: null, revision: 0 })
  })

  it('writes with the expected revision and answers 409 CONFLICT to a stale one', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('state.set', token, { data: { n: 1 }, expectedRevision: 0 })).json().data).toEqual({ revision: 1 })
    const stale = await gateway('state.set', token, { data: { n: 2 }, expectedRevision: 0 })
    expect([stale.statusCode, errorCode(stale)]).toEqual([409, 'CONFLICT'])
    expect((await gateway('state.get', token)).json().data).toEqual({ data: { n: 1 }, revision: 1 })
  })

  it('stores exactly 64 KB and rejects one byte more', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('state.set', token, { data: exactly64k, expectedRevision: 0 })).statusCode).toBe(200)
    expect((await gateway('state.get', token)).json().data).toEqual({ data: exactly64k, revision: 1 })
    const tooBig = await gateway('state.set', token, { data: `${exactly64k}x`, expectedRevision: 1 })
    expect([tooBig.statusCode, errorCode(tooBig)]).toEqual([400, 'INVALID_INPUT'])
  })

  it('survives an API restart', async () => {
    await gateway('state.set', await openSession(PKG_WIDGET), { data: { n: 7 }, expectedRevision: 0 })
    const restarted = await testApp(t.db)
    try {
      const token = await openSession(PKG_WIDGET, restarted.app)
      expect((await gateway('state.get', token, {}, cookie, restarted.app)).json().data).toEqual({ data: { n: 7 }, revision: 1 })
    } finally {
      await restarted.close()
    }
  })

  it('limits state.set to 60 calls a minute per widget, also across a new session', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let revision = 0; revision < 60; revision++) {
      expect((await gateway('state.set', token, { data: revision, expectedRevision: revision })).statusCode).toBe(200)
    }
    const limited = await gateway('state.set', token, { data: 60, expectedRevision: 60 })
    expect([limited.statusCode, errorCode(limited)]).toEqual([429, 'RATE_LIMITED'])
    expect(errorCode(await gateway('state.set', await openSession(PKG_WIDGET), { data: 60, expectedRevision: 60 }))).toBe('RATE_LIMITED')
    t.clock.now += 60_000
    expect((await gateway('state.set', token, { data: 60, expectedRevision: 60 })).statusCode).toBe(200)
  })
})

describe('notifications', () => {
  beforeEach(async () => {
    // Grants belong to the package: a new version that asks for more extends them.
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'notifications']
    }))
  })

  it('accepts the text limits and rejects text outside them', async () => {
    const token = await openSession(PKG_WIDGET)
    const sent = await gateway('notifications.send', token, { title: 'x'.repeat(80), body: 'y'.repeat(300) })
    expect(sent.json().data).toEqual({ ok: true })
    for (const input of [{ title: '', body: '' }, { title: 'x'.repeat(81), body: '' }, { title: 'x', body: 'y'.repeat(301) }]) {
      expect(errorCode(await gateway('notifications.send', token, input))).toBe('INVALID_INPUT')
    }
  })

  it('allows 10 an hour per widget, also across a new session', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let index = 0; index < 10; index++) {
      expect((await gateway('notifications.send', token, { title: 'x', body: '' })).statusCode).toBe(200)
    }
    expect(errorCode(await gateway('notifications.send', token, { title: 'x', body: '' }))).toBe('RATE_LIMITED')
    const fresh = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('notifications.send', fresh, { title: 'x', body: '' }))).toBe('RATE_LIMITED')
    t.clock.now += HOUR
    expect((await gateway('notifications.send', fresh, { title: 'x', body: '' })).statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/widget-gateway.test.ts`
Expected: FAIL — the session and gateway routes answer `404 NOT_FOUND` (`Route not found`).

- [ ] **Step 3: Expose the dashboard session hash in `auth.ts`**

In `apps/api/src/auth.ts`:
- after the imports add:
  ```ts
  declare module 'fastify' {
    interface FastifyRequest {
      // sha256 of the dashboard session token; set by the /api session check.
      sessionHash: string
    }
  }
  ```
- first line of `registerAuth`: `app.decorateRequest('sessionHash', '')`
- in `authenticate`, after the expiry `if` block (before the renewal check), add `request.sessionHash = hash`.

- [ ] **Step 4: Write `widget-gateway.ts`**

`apps/api/src/widget-gateway.ts`:

```ts
import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'
import {
  GATEWAY_OPS,
  isGatewayOp,
  parseGatewayInput,
  type GatewayInputs,
  type GatewayOp,
  type WidgetSessionResponse,
} from '@lifedashboard/contracts/widget-gateway'
import type { WidgetPermission } from '@lifedashboard/contracts/widget-package'
import { ApiError, ok } from './errors.ts'
import { grantsOf } from './widget-packages.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SESSION_IDLE_MS = HOUR
const MAX_SESSIONS = 200
const AUDIT_TTL_MS = 30 * DAY
const RATE_LIMITS: Record<GatewayOp, { max: number; windowMs: number }> = {
  'state.get': { max: 120, windowMs: MINUTE },
  'state.set': { max: 60, windowMs: MINUTE },
  'notifications.send': { max: 10, windowMs: HOUR },
}

/** What an operation handler may use; sub-project 2 adds a secret resolver here without changing the pipeline. */
export interface GatewayContext {
  widgetId: string
  packageId: string | null
  grants: ReadonlySet<WidgetPermission>
}

interface WidgetSession extends GatewayContext {
  // Hash of the dashboard session that created it; a call must carry the same cookie.
  dashboard: string
  lastUsedAt: number
}

type Handlers = { [Op in GatewayOp]: (context: GatewayContext, input: GatewayInputs[Op]) => unknown }

export interface WidgetGatewayDeps {
  db: DatabaseSync
  now: () => Date
}

// Spec «Widget sessions» and «Gateway pipeline»: the widget never states who it is.
export function registerWidgetGateway(app: FastifyInstance, { db, now }: WidgetGatewayDeps): void {
  db.prepare('DELETE FROM widget_audit WHERE at < ?').run(new Date(now().getTime() - AUDIT_TTL_MS).toISOString())
  // ponytail: sessions and rate counters are in memory; a restart drops them and the host renews the session.
  const sessions = new Map<string, WidgetSession>()
  const hits = new Map<string, number[]>()
  const handlers = operationHandlers(db, now)

  function useSession(request: FastifyRequest): WidgetSession {
    const token = request.headers['x-widget-session']
    const session = typeof token === 'string' ? sessions.get(token) : undefined
    if (typeof token !== 'string' || !session || session.dashboard !== request.sessionHash) {
      throw new ApiError('SESSION_EXPIRED', 'Widget session expired')
    }
    const t = now().getTime()
    sessions.delete(token)
    if (t - session.lastUsedAt >= SESSION_IDLE_MS) throw new ApiError('SESSION_EXPIRED', 'Widget session expired')
    session.lastUsedAt = t
    // Re-inserted last: the Map's first key is always the least recently used session.
    sessions.set(token, session)
    return session
  }

  function rateLimit(widgetId: string, op: GatewayOp): void {
    const { max, windowMs } = RATE_LIMITS[op]
    const t = now().getTime()
    const key = `${widgetId} ${op}`
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      throw new ApiError('RATE_LIMITED', `Too many ${op} calls`)
    }
    recent.push(t)
    hits.set(key, recent)
  }

  function audit(session: WidgetSession, op: string, outcome: string): void {
    db.prepare('INSERT INTO widget_audit (at, widget_id, package_id, op, outcome) VALUES (?, ?, ?, ?, ?)').run(
      now().toISOString(),
      session.widgetId,
      session.packageId,
      op.slice(0, 100),
      outcome,
    )
  }

  app.post<{ Body: { widgetId?: unknown } | undefined }>('/api/v1/widget-sessions', async (request) => {
    const widgetId = request.body?.widgetId
    if (typeof widgetId !== 'string') throw new ApiError('VALIDATION_ERROR', 'widgetId must be a string')
    const { packageId, grants } = resolveWidget(db, widgetId)
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, { dashboard: request.sessionHash, widgetId, packageId, grants: new Set(grants), lastUsedAt: now().getTime() })
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
    const response: WidgetSessionResponse = { widgetSession: token, grants }
    return ok(request, response)
  })

  app.delete<{ Params: { widgetSession: string } }>('/api/v1/widget-sessions/:widgetSession', async (request) => {
    const { widgetSession } = request.params
    if (sessions.get(widgetSession)?.dashboard === request.sessionHash) sessions.delete(widgetSession)
    return ok(request, null)
  })

  app.post<{ Params: { op: string } }>('/api/v1/widget-gateway/:op', async (request) => {
    // Step 1 (dashboard session) ran in the auth hook. A rejected widget session has no trusted identity: no audit.
    const session = useSession(request)
    const { op } = request.params
    let outcome = 'ok'
    try {
      if (!isGatewayOp(op)) throw new ApiError('UNKNOWN_OP', `Unknown operation "${op.slice(0, 100)}"`)
      const { permission } = GATEWAY_OPS[op]
      if (!session.grants.has(permission)) throw new ApiError('PERMISSION_DENIED', `The widget has no "${permission}" permission`)
      const input = parseGatewayInput(op, request.body)
      if (!input.ok) throw new ApiError('INVALID_INPUT', input.error)
      rateLimit(session.widgetId, op)
      const handler = handlers[op] as (context: GatewayContext, input: unknown) => unknown
      return ok(request, handler({ widgetId: session.widgetId, packageId: session.packageId, grants: session.grants }, input.value))
    } catch (error) {
      outcome = error instanceof ApiError ? error.code : 'INTERNAL_ERROR'
      throw error
    } finally {
      audit(session, op, outcome)
    }
  })
}

function resolveWidget(db: DatabaseSync, widgetId: string): { packageId: string | null; grants: WidgetPermission[] } {
  const row = db.prepare('SELECT source_kind, source_type, source_version FROM widgets WHERE id = ?').get(widgetId) as
    | { source_kind: string; source_type: string; source_version: string | null }
    | undefined
  if (!row) throw new ApiError('NOT_FOUND', 'Widget not found')
  if (row.source_kind === 'package') {
    const installed = db.prepare('SELECT 1 FROM widget_package_versions WHERE package_id = ? AND version = ?').get(row.source_type, row.source_version)
    if (!installed) throw new ApiError('NOT_FOUND', 'Widget package version is not installed')
    return { packageId: row.source_type, grants: grantsOf(db, row.source_type) }
  }
  const manifest = findBuiltinWidget(row.source_type)
  if (!manifest) throw new ApiError('NOT_FOUND', 'Unknown built-in widget')
  return { packageId: null, grants: [...manifest.permissions] }
}

function operationHandlers(db: DatabaseSync, now: () => Date): Handlers {
  const read = db.prepare('SELECT data, revision FROM widget_state WHERE widget_id = ?')
  return {
    'state.get': ({ widgetId }) => {
      const row = read.get(widgetId) as { data: string; revision: number } | undefined
      return row ? { data: JSON.parse(row.data) as unknown, revision: row.revision } : { data: null, revision: 0 }
    },
    // node:sqlite is synchronous, so the read and the write cannot interleave with another call.
    'state.set': ({ widgetId }, { data, expectedRevision }) => {
      const row = read.get(widgetId) as { revision: number } | undefined
      const current = row?.revision ?? 0
      if (current !== expectedRevision) throw new ApiError('CONFLICT', 'The widget state changed since it was read')
      db.prepare(
        'INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (widget_id) DO UPDATE SET data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at',
      ).run(widgetId, JSON.stringify(data), current + 1, now().toISOString())
      return { revision: current + 1 }
    },
    // The host displays the notification after this answer (toast now, Tauri plugin at E7).
    'notifications.send': () => ({ ok: true }),
  }
}
```

In `apps/api/src/app.ts`, import `registerWidgetGateway` from `./widget-gateway.ts` and add after `registerWidgetPackages(…)`:

```ts
  registerWidgetGateway(app, { db, now })
```

- [ ] **Step 5: Run the API suite and typecheck**

Run: `pnpm -C apps/api exec vitest run && pnpm -C apps/api typecheck`
Expected: PASS (all earlier API tests unchanged), no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/widget-gateway.ts apps/api/src/auth.ts apps/api/src/app.ts apps/api/test/widget-gateway.test.ts
git commit -m "feat(api): widget sessions and gateway with state and notifications"
```

---

### Task 6: `packages/widget-sdk` — `useWidget`, `createWidget` and the port client

**Files:**
- Create: `packages/widget-sdk/package.json`, `packages/widget-sdk/tsconfig.json`, `packages/widget-sdk/src/widget.ts`, `packages/widget-sdk/src/port-client.ts`, `packages/widget-sdk/src/index.ts`, `packages/widget-sdk/test/widget.test.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Consumes: `WidgetContext`, `WidgetErrorCode`, `ResponseMessage`, `ContextMessage`, `StateSetOutput` (Task 2).
- Produces (`@lifedashboard/widget-sdk`):
  ```ts
  type WidgetCall = (op: string, input: unknown) => Promise<unknown>
  class WidgetError extends Error { readonly code: WidgetErrorCode; constructor(code: WidgetErrorCode, message?: string) }
  interface Widget {
    readonly context: Readonly<WidgetContext>                  // reactive
    state: {
      get<T>(): Promise<{ data: T | null; revision: number }>
      set(data: unknown, expectedRevision: number): Promise<{ revision: number }>
    }
    notify(message: { title: string; body?: string }): Promise<void>
    call<T>(op: string, input: unknown): Promise<T>
  }
  const WIDGET_KEY: InjectionKey<Widget>
  function createWidget(call: WidgetCall, context: WidgetContext): Widget
  function useWidget(): Widget                                   // throws outside a widget host
  function provideInProcessWidget(deps: { call: WidgetCall; context: WidgetContext }): Widget  // inside setup()
  function createPortClient(port: MessagePort, onContext: (patch: Partial<WidgetContext>) => void): WidgetCall
  type WidgetContext, WidgetErrorCode, SizeClass   // re-exported from contracts
  ```
- `provideInProcessWidget` takes the component scope only (it calls `provide()` inside `setup()`); the spec's "app or component scope" needs only the component case in this slice.

- [ ] **Step 1: Create the package**

`packages/widget-sdk/package.json`:

```json
{
  "name": "@lifedashboard/widget-sdk",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@lifedashboard/contracts": "workspace:*",
    "vue": "3.5.43"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

`packages/widget-sdk/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "noEmit": true,
    "types": []
  },
  "include": ["src", "test"]
}
```

Run: `pnpm install`
Expected: the lockfile gains the `packages/widget-sdk` importer with links only; no new registry packages are downloaded.

- [ ] **Step 2: Write the failing tests**

`packages/widget-sdk/test/widget.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { createPortClient } from '../src/port-client.ts'
import { createWidget, provideInProcessWidget, useWidget, WidgetError, type Widget, type WidgetCall } from '../src/widget.ts'

const CONTEXT: WidgetContext = {
  size: { w: 3, h: 3 },
  sizeClass: 'm',
  theme: { id: 'builtin:glass', scheme: 'dark', tokens: { '--ld-bg': '#000' } },
  rootFontSize: 16,
  config: {},
  locale: 'ru-RU',
  visible: true,
}

interface Harness {
  widget: Widget
  calls: [string, unknown][]
  patch(patch: Partial<WidgetContext>): void
  close(): void
}

// The host's answers: state at revision 3, notifications ok, every other op unknown.
function fakeCall(calls: [string, unknown][]): WidgetCall {
  return async (op, input) => {
    calls.push([op, input])
    if (op === 'state.get') return { data: { n: 1 }, revision: 3 }
    if (op === 'state.set') {
      if ((input as { expectedRevision: number }).expectedRevision !== 3) throw new WidgetError('CONFLICT', 'stale')
      return { revision: 4 }
    }
    if (op === 'notifications.send') return { ok: true }
    throw new WidgetError('UNKNOWN_OP', `Unknown operation "${op}"`)
  }
}

// In-process: WidgetHost's setup provides, the widget's setup injects (rendered on the server, no DOM).
async function inProcess(): Promise<Harness> {
  const calls: [string, unknown][] = []
  const context = reactive(structuredClone(CONTEXT))
  let widget: Widget | undefined
  const Child = defineComponent({
    setup() {
      widget = useWidget()
      return () => null
    },
  })
  const Host = defineComponent({
    setup() {
      provideInProcessWidget({ call: fakeCall(calls), context })
      return () => h(Child)
    },
  })
  await renderToString(createSSRApp(Host))
  return { widget: widget!, calls, patch: (patch) => Object.assign(context, patch), close() {} }
}

// Sandbox: the widget talks over a MessagePort; the other end answers like the host bridge.
async function sandbox(): Promise<Harness> {
  const calls: [string, unknown][] = []
  const answer = fakeCall(calls)
  const { port1, port2 } = new MessageChannel()
  port1.onmessage = async (event: MessageEvent) => {
    const { id, op, input } = event.data as { id: number; op: string; input: unknown }
    try {
      port1.postMessage({ t: 'res', id, ok: true, value: await answer(op, input) })
    } catch (error) {
      const { code, message } = error as WidgetError
      port1.postMessage({ t: 'res', id, ok: false, error: { code, message } })
    }
  }
  const context = reactive(structuredClone(CONTEXT))
  const widget = createWidget(createPortClient(port2, (patch) => Object.assign(context, patch)), context)
  return {
    widget,
    calls,
    patch: (patch) => port1.postMessage({ t: 'context', patch }),
    close() {
      port1.close()
      port2.close()
    },
  }
}

let current: Harness | undefined

afterEach(() => {
  current?.close()
  current = undefined
  vi.restoreAllMocks()
})

// One suite, two transports: a widget must not notice which host runs it.
describe.each([
  ['in-process', inProcess],
  ['sandbox', sandbox],
] as const)('Widget contract (%s)', (_name, create) => {
  it('reads state', async () => {
    current = await create()
    expect(await current.widget.state.get()).toEqual({ data: { n: 1 }, revision: 3 })
    expect(current.calls).toEqual([['state.get', {}]])
  })

  it('writes state with the expected revision', async () => {
    current = await create()
    expect(await current.widget.state.set({ n: 2 }, 3)).toEqual({ revision: 4 })
    expect(current.calls).toEqual([['state.set', { data: { n: 2 }, expectedRevision: 3 }]])
  })

  it('rejects a stale write with a CONFLICT WidgetError', async () => {
    current = await create()
    const error = await current.widget.state.set({}, 1).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WidgetError)
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'stale' })
  })

  it('notifies with an empty body by default and resolves to undefined', async () => {
    current = await create()
    expect(await current.widget.notify({ title: 'Hi' })).toBeUndefined()
    expect(current.calls).toEqual([['notifications.send', { title: 'Hi', body: '' }]])
  })

  it('passes other operations through call', async () => {
    current = await create()
    await expect(current.widget.call('data.query', { a: 1 })).rejects.toMatchObject({ code: 'UNKNOWN_OP' })
    expect(current.calls).toEqual([['data.query', { a: 1 }]])
  })

  it('exposes a read-only context that follows the host', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    current = await create()
    current.patch({ size: { w: 4, h: 2 }, sizeClass: 's' })
    await vi.waitFor(() => expect(current!.widget.context.size).toEqual({ w: 4, h: 2 }))
    expect(current.widget.context.sizeClass).toBe('s')
    ;(current.widget.context as WidgetContext).visible = false
    expect(current.widget.context.visible).toBe(true)
  })
})

describe('useWidget', () => {
  it('throws outside a widget host', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => useWidget()).toThrow(/inside a LifeDashboard widget/)
  })
})

describe('createPortClient', () => {
  it('rejects an input the port cannot clone with INVALID_INPUT', async () => {
    const { port1, port2 } = new MessageChannel()
    try {
      const call = createPortClient(port2, () => {})
      await expect(call('state.set', { data: () => 1, expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    } finally {
      port1.close()
      port2.close()
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C packages/widget-sdk exec vitest run`
Expected: FAIL — `Cannot find module '../src/port-client.ts'` / `'../src/widget.ts'`.

- [ ] **Step 4: Write the SDK**

`packages/widget-sdk/src/widget.ts`:

```ts
import { inject, provide, readonly, type InjectionKey } from 'vue'
import type { StateSetOutput, WidgetContext, WidgetErrorCode } from '@lifedashboard/contracts/widget-gateway'

/** One gateway call: resolves with the operation output or rejects with a WidgetError. */
export type WidgetCall = (op: string, input: unknown) => Promise<unknown>

export class WidgetError extends Error {
  readonly code: WidgetErrorCode

  constructor(code: WidgetErrorCode, message: string = code) {
    super(message)
    this.name = 'WidgetError'
    this.code = code
  }
}

export interface Widget {
  // Reactive; the host owns it.
  readonly context: Readonly<WidgetContext>
  state: {
    get<T>(): Promise<{ data: T | null; revision: number }>
    // Rejects with CONFLICT when `expectedRevision` is stale (DATA-06).
    set(data: unknown, expectedRevision: number): Promise<{ revision: number }>
  }
  notify(message: { title: string; body?: string }): Promise<void>
  // Other gateway operations.
  call<T>(op: string, input: unknown): Promise<T>
}

export const WIDGET_KEY: InjectionKey<Widget> = Symbol('lifedashboard.widget')

/** The same Widget over any transport: the in-process broker client or the sandbox port. */
export function createWidget(call: WidgetCall, context: WidgetContext): Widget {
  return {
    context: readonly(context) as Readonly<WidgetContext>,
    state: {
      get: async <T>() => (await call('state.get', {})) as { data: T | null; revision: number },
      set: async (data, expectedRevision) => (await call('state.set', { data, expectedRevision })) as StateSetOutput,
    },
    notify: async ({ title, body = '' }) => {
      await call('notifications.send', { title, body })
    },
    call: async <T>(op: string, input: unknown) => (await call(op, input)) as T,
  }
}

export function useWidget(): Widget {
  const widget = inject(WIDGET_KEY, null)
  if (!widget) throw new Error('useWidget() must be called inside a LifeDashboard widget')
  return widget
}

/** For WidgetHost: call inside setup() of the component that renders a built-in widget. */
export function provideInProcessWidget(deps: { call: WidgetCall; context: WidgetContext }): Widget {
  const widget = createWidget(deps.call, deps.context)
  provide(WIDGET_KEY, widget)
  return widget
}
```

`packages/widget-sdk/src/port-client.ts`:

```ts
import type { ContextMessage, ResponseMessage, WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from './widget.ts'

/** The sandbox end of the bridge: requests go out on the port, answers and context patches come in. */
export function createPortClient(port: MessagePort, onContext: (patch: Partial<WidgetContext>) => void): WidgetCall {
  let nextId = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: WidgetError): void }>()

  // Setting onmessage also starts the port.
  port.onmessage = (event: MessageEvent) => {
    const message = event.data as ResponseMessage | ContextMessage | null
    if (message?.t === 'context') {
      onContext(message.patch)
      return
    }
    if (message?.t !== 'res') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok) entry.resolve(message.value)
    else entry.reject(new WidgetError(message.error.code, message.error.message))
  }

  return (op, input) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      try {
        port.postMessage({ t: 'req', id, op, input })
      } catch {
        // A function or a DOM node cannot be structured-cloned; the host would never see the request.
        pending.delete(id)
        reject(new WidgetError('INVALID_INPUT', 'The input cannot be sent to the host'))
      }
    })
}
```

`packages/widget-sdk/src/index.ts`:

```ts
export { createWidget, provideInProcessWidget, useWidget, WIDGET_KEY, WidgetError, type Widget, type WidgetCall } from './widget.ts'
export { createPortClient } from './port-client.ts'
export type { SizeClass, WidgetContext, WidgetErrorCode } from '@lifedashboard/contracts/widget-gateway'
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm -C packages/widget-sdk exec vitest run && pnpm -C packages/widget-sdk typecheck`
Expected: PASS (14 tests: 6 per transport, `useWidget`, port client), no type errors. Vue prints a readonly-assignment warning only if the spy is missing.

- [ ] **Step 6: Commit**

```bash
git add packages/widget-sdk pnpm-lock.yaml
git commit -m "feat(widget-sdk): useWidget with in-process and port transports"
```

---
### Task 7: Sandbox bootstrap and its build (`dist/sandbox.js`)

**Files:**
- Create: `packages/widget-sdk/src/theme.ts`, `packages/widget-sdk/src/sandbox.ts`, `packages/widget-sdk/src/env.d.ts`, `packages/widget-sdk/vite.config.ts`, `packages/widget-sdk/test/theme.test.ts`, `packages/widget-sdk/test/sandbox-build.test.ts`
- Modify: `packages/widget-sdk/package.json`, `packages/widget-sdk/tsconfig.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `createWidget`, `WIDGET_KEY`, `createPortClient` (Task 6); `SDK_VERSION`, `InitMessage`, `WidgetContext` (Task 2).
- Produces: `packages/widget-sdk/dist/sandbox.js` — one ES module that re-exports everything from `src/index.ts`, imports only the bare specifiers `vue` and `@lifedashboard/widget-entry` (both mapped by the sandbox document's import map), and on load runs the bootstrap: `parent.postMessage({ t: 'ld:hello', sdk: 1 }, '*')`, waits for `{ t: 'ld:init', context }` with a port from `parent`, applies theme tokens, `color-scheme` and the root font size, mounts the entry's default export on `#app` with the widget provided, and reports `{ t: 'error', message }` from `app.config.errorHandler`, `error` and `unhandledrejection`.
- Produces (`packages/widget-sdk/src/theme.ts`): `function applyTokens(style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown }, previous: readonly string[], tokens: Record<string, string>): string[]`.
- Scripts: `build` = `vite build`; `dev` = `vite build --watch` (so `pnpm dev` keeps `dist/sandbox.js` fresh).

- [ ] **Step 1: Add the build tooling**

In `packages/widget-sdk/package.json`:
- `scripts` become:
  ```json
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  ```
- `devDependencies` become:
  ```json
  "devDependencies": {
    "@types/node": "24.19.1",
    "typescript": "6.0.3",
    "vite": "8.3.2",
    "vitest": "5.0.3"
  }
  ```

In `packages/widget-sdk/tsconfig.json`: `"types": ["node"]` and `"include": ["src", "test", "vite.config.ts"]`.

Run: `pnpm install`
Expected: `vite 8.3.2` and `@types/node 24.19.1` are linked from the store (already in the lockfile for Nuxt and the API); no other package is added.

- [ ] **Step 2: Write the failing tests**

`packages/widget-sdk/test/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyTokens } from '../src/theme.ts'

describe('applyTokens', () => {
  it('sets custom properties and removes the ones the new theme lacks', () => {
    const props = new Map<string, string>()
    const style = {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => props.delete(name),
    }
    const applied = applyTokens(style, [], { '--ld-bg': '#000', '--ld-glow': 'red', color: 'blue' })
    expect(applied).toEqual(['--ld-bg', '--ld-glow'])
    expect([...props]).toEqual([['--ld-bg', '#000'], ['--ld-glow', 'red']])
    applyTokens(style, applied, { '--ld-bg': '#fff' })
    expect([...props]).toEqual([['--ld-bg', '#fff']])
  })
})
```

`packages/widget-sdk/test/sandbox-build.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = mkdtempSync(join(tmpdir(), 'ld-sdk-'))

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('sandbox build', () => {
  it('bundles the bootstrap and leaves vue and the widget entry to the import map', async () => {
    await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir } })
    const code = readFileSync(join(outDir, 'sandbox.js'), 'utf8')
    expect(code).toMatch(/from\s*["']vue["']/)
    expect(code).toMatch(/import\(\s*["']@lifedashboard\/widget-entry["']\s*\)/)
    expect(code).not.toMatch(/@lifedashboard\/contracts/)
    expect(code).toContain('ld:hello')
    expect(code).toMatch(/export\s*\{[^}]*useWidget/)
  }, 30_000)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/theme.test.ts test/sandbox-build.test.ts`
Expected: FAIL — `Cannot find module '../src/theme.ts'`; the build fails because `vite.config.ts` does not exist.

- [ ] **Step 4: Write the bootstrap and the build config**

`packages/widget-sdk/src/theme.ts`:

```ts
interface StyleTarget {
  setProperty(name: string, value: string): void
  removeProperty(name: string): unknown
}

/**
 * Sets theme tokens on the frame root. Names the previous theme set but the new one lacks
 * (optional tokens such as --ld-glow) are removed, so a theme switch never leaves stale values.
 * Returns the names now applied.
 */
export function applyTokens(style: StyleTarget, previous: readonly string[], tokens: Record<string, string>): string[] {
  const names = Object.keys(tokens).filter((name) => name.startsWith('--'))
  for (const name of previous) if (!names.includes(name)) style.removeProperty(name)
  for (const name of names) style.setProperty(name, tokens[name]!)
  return names
}
```

`packages/widget-sdk/src/env.d.ts`:

```ts
// Resolved by the sandbox document's import map to the package's manifest.entry.
declare module '@lifedashboard/widget-entry' {
  const component: import('vue').Component
  export default component
}
```

`packages/widget-sdk/src/sandbox.ts`:

```ts
import { createApp, reactive, watchEffect } from 'vue'
import { SDK_VERSION, type InitMessage, type WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { createPortClient } from './port-client.ts'
import { applyTokens } from './theme.ts'
import { createWidget, WIDGET_KEY } from './widget.ts'

// Widget code imports '@lifedashboard/widget-sdk', which the import map resolves to this module.
export * from './index.ts'

function report(port: MessagePort, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  port.postMessage({ t: 'error', message: message.slice(0, 1000) })
}

// Theme and scale come from the host: the frame inherits nothing from the dashboard (spec «Theme and size»).
function followContext(context: WidgetContext): void {
  const root = document.documentElement
  root.style.background = 'transparent'
  document.body.style.margin = '0'
  let applied: string[] = []
  watchEffect(() => {
    applied = applyTokens(root.style, applied, context.theme.tokens)
    root.style.colorScheme = context.theme.scheme
    root.style.fontSize = `${context.rootFontSize}px`
  })
}

async function boot(port: MessagePort, initial: WidgetContext): Promise<void> {
  const context = reactive(initial) as WidgetContext
  const call = createPortClient(port, (patch) => Object.assign(context, patch))
  addEventListener('error', (event) => report(port, event.error ?? event.message))
  addEventListener('unhandledrejection', (event) => report(port, event.reason))
  followContext(context)
  try {
    const entry = await import('@lifedashboard/widget-entry')
    const app = createApp(entry.default)
    app.config.errorHandler = (error) => report(port, error)
    app.provide(WIDGET_KEY, createWidget(call, context))
    app.mount('#app')
  } catch (error) {
    report(port, error)
  }
}

function start(): void {
  if (parent === window) return
  addEventListener('message', function onInit(event: MessageEvent) {
    const data = event.data as Partial<InitMessage> | null
    const port = event.ports[0]
    if (event.source !== parent || data?.t !== 'ld:init' || !data.context || !port) return
    removeEventListener('message', onInit)
    void boot(port, data.context)
  })
  parent.postMessage({ t: 'ld:hello', sdk: SDK_VERSION }, '*')
}

start()
```

`packages/widget-sdk/vite.config.ts`:

```ts
import { defineConfig } from 'vite'

// The sandbox runtime served at /sandbox/runtime/sdk.js: bootstrap + RPC client + useWidget in one
// ES module. Contracts are bundled; vue and the widget entry come from the document's import map.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: { entry: 'src/sandbox.ts', formats: ['es'], fileName: () => 'sandbox.js' },
    rolldownOptions: { external: ['vue', '@lifedashboard/widget-entry'] },
  },
})
```

- [ ] **Step 5: Run the tests, the build and typecheck**

Run: `pnpm -C packages/widget-sdk exec vitest run && pnpm -C packages/widget-sdk build && pnpm -C packages/widget-sdk typecheck && ls packages/widget-sdk/dist`
Expected: PASS; `dist/sandbox.js` exists (git-ignored by the root `dist/` rule); no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/widget-sdk pnpm-lock.yaml
git commit -m "feat(widget-sdk): sandbox bootstrap built as one runtime module"
```

---

### Task 8: Sandbox serving in the API

**Files:**
- Create: `apps/api/src/sandbox.ts`, `apps/api/test/sandbox.test.ts`
- Modify: `apps/api/src/auth.ts`, `apps/api/src/app.ts`, `apps/api/package.json`, `apps/ui/nuxt.config.ts`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: migration 2 tables (Task 3); `WidgetPackageManifest` (Task 1); `widgetPackage`, `installPackage` (Task 4); `dist/sandbox.js` (Task 7).
- Produces (`apps/api/src/auth.ts`): `function allowedHosts(config: Pick<ApiConfig, 'port'>): ReadonlySet<string>`.
- Produces (`apps/api/src/sandbox.ts`):
  ```ts
  function registerSandbox(app: FastifyInstance, deps: { db: DatabaseSync; config: Pick<ApiConfig, 'port' | 'uiOrigins'> }): void
  function sandboxDocument(base: string, hash: string, manifest: WidgetPackageManifest): { html: string; csp: string }
  ```
- Routes (outside `/api`, no session): `GET /sandbox/runtime/vue.js`, `GET /sandbox/runtime/sdk.js` (`no-cache`), `GET /sandbox/packages/:hash/` (document, CSP header), `GET /sandbox/packages/:hash/:file`. All carry `Access-Control-Allow-Origin: *` and `X-Content-Type-Options: nosniff`; package documents and files are `Cache-Control: public, max-age=31536000, immutable`. Host is checked as for the API; Origin may be absent, `null` or an allowed UI origin, anything else is `403`.
- The Nuxt dev server proxies `/sandbox` to the API. The proxy rewrites Host to the API (`changeOrigin`), so `<base>` in the document is the API origin (`http://127.0.0.1:3001`) and the frame loads its scripts from there.

- [ ] **Step 1: Add the API dependencies**

In `apps/api/package.json` `dependencies`, add `"@lifedashboard/widget-sdk": "workspace:*"` and `"vue": "3.5.43"` (keep keys sorted).

Run: `pnpm install`
Expected: `vue 3.5.43` linked from the store; no other package added.

- [ ] **Step 2: Write the failing tests**

`apps/api/test/sandbox.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sandboxDocument } from '../src/sandbox.ts'
import { call, HOST, installPackage, pair, testApp, widgetPackage, type TestApp } from './helpers.ts'

const BASE = `http://${HOST}`
const IMMUTABLE = 'public, max-age=31536000, immutable'

let t: TestApp
let cookie: string
let pkg: any
let hash: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
  pkg = widgetPackage((p) => {
    p.manifest.entry = 'main.js'
    p.files = { 'main.js': 'export default {}', 'style.css': '.hello{}' }
  })
  hash = (await installPackage(t, cookie, pkg)).hash
})

afterEach(async () => {
  await t.close()
})

describe('GET /sandbox/packages/:hash/', () => {
  it('serves the document with the import map, stylesheet, bootstrap and CSP', async () => {
    const response = await call(t.app, { url: `/sandbox/packages/${hash}/` })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    const importMap = JSON.stringify({
      imports: {
        vue: `${BASE}/sandbox/runtime/vue.js`,
        '@lifedashboard/widget-sdk': `${BASE}/sandbox/runtime/sdk.js`,
        '@lifedashboard/widget-entry': `${BASE}/sandbox/packages/${hash}/main.js`,
      },
    })
    expect(response.body).toContain(`<script type="importmap">${importMap}</script>`)
    expect(response.body).toContain(`<link rel="stylesheet" href="${BASE}/sandbox/packages/${hash}/style.css">`)
    expect(response.body).toContain(`<script type="module" src="${BASE}/sandbox/runtime/sdk.js"></script>`)
    expect(response.body).toContain('<body><div id="app"></div></body>')
    const sha = createHash('sha256').update(importMap).digest('base64')
    expect(response.headers['content-security-policy']).toBe(
      [
        "default-src 'none'",
        `script-src ${BASE}/sandbox/runtime/ ${BASE}/sandbox/packages/${hash}/ 'sha256-${sha}'`,
        `style-src ${BASE}/sandbox/packages/${hash}/ 'unsafe-inline'`,
        'img-src data:',
        "connect-src 'none'",
        "font-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    )
    expect(response.headers['access-control-allow-origin']).toBe('*')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cache-control']).toBe(IMMUTABLE)
  })

  it('contains no instance or user data', async () => {
    const response = await call(t.app, { url: `/sandbox/packages/${hash}/` })
    expect(response.body).toBe(sandboxDocument(BASE, hash, pkg.manifest).html)
    expect(response.body).not.toContain(cookie.split('=')[1]!)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('has no stylesheet link for a package without styles', async () => {
    const plain = widgetPackage((p) => {
      p.manifest.id = 'dev.test.plain'
      p.manifest.styles = []
      p.files = { 'index.js': 'export default {}' }
    })
    const { hash: plainHash } = await installPackage(t, cookie, plain)
    const response = await call(t.app, { url: `/sandbox/packages/${plainHash}/` })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('<link')
  })

  it('accepts Origin: null and rejects a foreign origin or host', async () => {
    const url = `/sandbox/packages/${hash}/`
    expect((await call(t.app, { url, origin: 'null' })).statusCode).toBe(200)
    const foreign = await call(t.app, { url, origin: 'http://evil.test' })
    expect(foreign.statusCode).toBe(403)
    expect(foreign.headers['access-control-allow-origin']).toBe('*')
    expect((await call(t.app, { url, host: 'evil.test:3001' })).statusCode).toBe(403)
  })

  it('answers 404 for an unknown or malformed hash', async () => {
    expect((await call(t.app, { url: `/sandbox/packages/${'f'.repeat(64)}/` })).statusCode).toBe(404)
    expect((await call(t.app, { url: '/sandbox/packages/abc/' })).statusCode).toBe(404)
  })
})

describe('GET /sandbox/packages/:hash/:file', () => {
  it('serves package files with their content type', async () => {
    const script = await call(t.app, { url: `/sandbox/packages/${hash}/main.js`, origin: 'null' })
    expect(script.statusCode).toBe(200)
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(script.headers['cache-control']).toBe(IMMUTABLE)
    expect(script.headers['access-control-allow-origin']).toBe('*')
    expect(script.body).toBe('export default {}')
    const style = await call(t.app, { url: `/sandbox/packages/${hash}/style.css` })
    expect(style.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(style.body).toBe('.hello{}')
  })

  it('answers 404 for a file outside the package', async () => {
    expect((await call(t.app, { url: `/sandbox/packages/${hash}/other.js` })).statusCode).toBe(404)
    expect((await call(t.app, { url: `/sandbox/packages/${hash}/toString` })).statusCode).toBe(404)
  })
})

describe('GET /sandbox/runtime/:file', () => {
  it('serves the Vue runtime from the API dependency', async () => {
    const response = await call(t.app, { url: '/sandbox/runtime/vue.js', origin: 'null' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.body).toContain('createApp')
  })

  it('answers 404 for an unknown runtime file', async () => {
    expect((await call(t.app, { url: '/sandbox/runtime/evil.js' })).statusCode).toBe(404)
    expect((await call(t.app, { url: '/sandbox/runtime/constructor' })).statusCode).toBe(404)
  })
})
```

`sdk.js` is not asserted here: it exists only after `pnpm -C packages/widget-sdk build`, and the test run must not depend on build order. Task 14 checks it in the browser.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/sandbox.test.ts`
Expected: FAIL — `Cannot find module '../src/sandbox.ts'`.

- [ ] **Step 4: Export the allowed hosts from `auth.ts`**

In `apps/api/src/auth.ts`, add above `registerAuth`:

```ts
/** Host header values the API answers to (DNS rebinding guard, base design §13.1). */
export function allowedHosts(config: Pick<ApiConfig, 'port'>): ReadonlySet<string> {
  return new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`])
}
```

and replace the `const hosts = new Set([…])` line in `registerAuth` with `const hosts = allowedHosts(config)`.

- [ ] **Step 5: Write `sandbox.ts`**

`apps/api/src/sandbox.ts`:

```ts
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { allowedHosts } from './auth.ts'
import type { ApiConfig } from './config.ts'
import { ApiError } from './errors.ts'

const require = createRequire(import.meta.url)
const HASH = /^[0-9a-f]{64}$/
const IMMUTABLE = 'public, max-age=31536000, immutable'
const JS = 'text/javascript; charset=utf-8'
const CSS = 'text/css; charset=utf-8'

// Resolved per request: in development `vite build --watch` rewrites sdk.js while the API runs.
const RUNTIME_FILES = new Map<string, () => string>([
  ['vue.js', () => require.resolve('vue/dist/vue.runtime.esm-browser.prod.js')],
  ['sdk.js', () => join(dirname(require.resolve('@lifedashboard/widget-sdk/package.json')), 'dist', 'sandbox.js')],
])

export interface SandboxDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins'>
}

/**
 * The document of one package version. `base` is built from a validated Host, the hash is hex and
 * file names match the package pattern, so nothing here needs HTML escaping. No instance or user
 * data: config, theme and size arrive over the port.
 */
export function sandboxDocument(base: string, hash: string, manifest: WidgetPackageManifest): { html: string; csp: string } {
  const runtime = `${base}/sandbox/runtime/`
  const packageDir = `${base}/sandbox/packages/${hash}/`
  const importMap = JSON.stringify({
    imports: {
      vue: `${runtime}vue.js`,
      '@lifedashboard/widget-sdk': `${runtime}sdk.js`,
      '@lifedashboard/widget-entry': `${packageDir}${manifest.entry}`,
    },
  })
  const links = manifest.styles.map((name) => `  <link rel="stylesheet" href="${packageDir}${name}">\n`).join('')
  const html =
    '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n' +
    `  <script type="importmap">${importMap}</script>\n` +
    links +
    `  <script type="module" src="${runtime}sdk.js"></script>\n` +
    '</head>\n<body><div id="app"></div></body>\n</html>\n'
  // Explicit URLs, not 'self': engines treat 'self' differently in opaque-origin documents.
  const csp = [
    "default-src 'none'",
    `script-src ${runtime} ${packageDir} 'sha256-${createHash('sha256').update(importMap).digest('base64')}'`,
    `style-src ${packageDir} 'unsafe-inline'`,
    'img-src data:',
    "connect-src 'none'",
    "font-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return { html, csp }
}

// Spec «Sandbox serving»: public by hash, no session (the cookie has Path=/api).
export function registerSandbox(app: FastifyInstance, { db, config }: SandboxDeps): void {
  const hosts = allowedHosts(config)
  const origins = new Set(config.uiOrigins)

  function findVersion(hash: string): { manifest: WidgetPackageManifest; files: Record<string, string> } {
    const row = HASH.test(hash)
      ? (db.prepare('SELECT manifest, files FROM widget_package_versions WHERE hash = ?').get(hash) as
          | { manifest: string; files: string }
          | undefined)
      : undefined
    if (!row) throw new ApiError('NOT_FOUND', 'Widget package not found')
    return { manifest: JSON.parse(row.manifest) as WidgetPackageManifest, files: JSON.parse(row.files) as Record<string, string> }
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/sandbox/')) return
    // Module scripts from an opaque-origin frame are CORS requests with Origin: null.
    reply.header('access-control-allow-origin', '*').header('x-content-type-options', 'nosniff')
    const host = request.headers.host
    if (host === undefined || !hosts.has(host)) throw new ApiError('FORBIDDEN', 'Host is not allowed')
    const origin = request.headers.origin
    if (origin !== undefined && origin !== 'null' && !origins.has(origin)) throw new ApiError('FORBIDDEN', 'Origin is not allowed')
  })

  app.get<{ Params: { file: string } }>('/sandbox/runtime/:file', async (request, reply) => {
    const locate = RUNTIME_FILES.get(request.params.file)
    if (!locate) throw new ApiError('NOT_FOUND', 'Runtime file not found')
    let body: string
    try {
      body = await readFile(locate(), 'utf8')
    } catch {
      throw new ApiError('NOT_FOUND', 'Runtime file is missing; run pnpm -C packages/widget-sdk build')
    }
    return reply.header('cache-control', 'no-cache').type(JS).send(body)
  })

  app.get<{ Params: { hash: string } }>('/sandbox/packages/:hash/', async (request, reply) => {
    const { manifest } = findVersion(request.params.hash)
    const { html, csp } = sandboxDocument(`${request.protocol}://${request.headers.host}`, request.params.hash, manifest)
    return reply.header('cache-control', IMMUTABLE).header('content-security-policy', csp).type('text/html; charset=utf-8').send(html)
  })

  app.get<{ Params: { hash: string; file: string } }>('/sandbox/packages/:hash/:file', async (request, reply) => {
    const { files } = findVersion(request.params.hash)
    const { file } = request.params
    if (!Object.hasOwn(files, file)) throw new ApiError('NOT_FOUND', 'File not found')
    return reply.header('cache-control', IMMUTABLE).type(file.endsWith('.css') ? CSS : JS).send(files[file])
  })
}
```

In `apps/api/src/app.ts`, import `registerSandbox` from `./sandbox.ts` and add after `registerWidgetGateway(…)`:

```ts
  registerSandbox(app, { db, config })
```

In `apps/ui/nuxt.config.ts`, add to `nitro.devProxy`:

```ts
      '/sandbox': { target: `${apiOrigin}/sandbox`, changeOrigin: true },
```

- [ ] **Step 6: Run the API suite and typecheck**

Run: `pnpm -C apps/api exec vitest run && pnpm -C apps/api typecheck && pnpm -C apps/ui typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/sandbox.ts apps/api/src/auth.ts apps/api/src/app.ts apps/api/package.json apps/api/test/sandbox.test.ts apps/ui/nuxt.config.ts pnpm-lock.yaml
git commit -m "feat(api): serve sandbox documents, package files and runtime"
```

---

### Task 9: `ld-widget build` and the example packages

**Files:**
- Create: `packages/widget-sdk/src/build.ts`, `packages/widget-sdk/src/cli.ts`, `packages/widget-sdk/test/build.test.ts`, `packages/widget-sdk/test/fixtures/counter/widget.json`, `packages/widget-sdk/test/fixtures/counter/src/index.vue`, `packages/widget-sdk/test/fixtures/plain/widget.json`, `packages/widget-sdk/test/fixtures/plain/src/index.vue`, `examples/widgets/hello/{package.json,widget.json,src/index.vue}`, `examples/widgets/hostile/{package.json,widget.json,src/index.vue}`
- Modify: `packages/widget-sdk/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `parseWidgetPackage` (Task 1); `useWidget`, `WidgetError` (Task 6).
- Produces (`packages/widget-sdk/src/build.ts`): `function buildWidget(dir: string): Promise<string>` — builds `<dir>/src/index.vue` with `<dir>/widget.json` (the manifest without `files`) into `<dir>/dist/<id>-<version>.ldwidget.json` and returns that path; rejects with `Invalid widget package: <reason>`.
- Produces: bin `ld-widget` (`packages/widget-sdk/src/cli.ts`), usage `ld-widget build [dir]`.
- The built entry is stored under `manifest.entry`; extracted CSS is stored as `style.css`. A manifest that lists `style.css` for an SFC without styles (or omits it when CSS exists) fails validation with the parser's message.

- [ ] **Step 1: Add the CLI tooling and the examples to the workspace**

In `packages/widget-sdk/package.json`:
- add `"bin": { "ld-widget": "./src/cli.ts" },` after `"exports"`;
- add `"@vitejs/plugin-vue": "6.0.9"` to `devDependencies` (keep keys sorted).

Replace `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
  - examples/widgets/*

saveExact: true

onlyBuiltDependencies:
  - esbuild
ignoredBuiltDependencies:
  - vue-demi
```

Run: `pnpm install`
Expected: `@vitejs/plugin-vue 6.0.9` linked from the store; no other package added.

- [ ] **Step 2: Write the fixtures and the failing tests**

`packages/widget-sdk/test/fixtures/counter/widget.json`:

```json
{
  "id": "dev.test.counter",
  "version": "1.0.0",
  "title": "Counter",
  "author": "test",
  "sdk": 1,
  "entry": "index.js",
  "styles": ["style.css"],
  "sizing": { "default": { "w": 2, "h": 2 }, "min": { "w": 1, "h": 1 }, "max": { "w": 4, "h": 4 } },
  "permissions": ["state"]
}
```

`packages/widget-sdk/test/fixtures/counter/src/index.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const count = ref(0)
</script>

<template>
  <button type="button" class="counter" @click="count++">{{ count }} · {{ widget.context.sizeClass }}</button>
</template>

<style scoped>
.counter {
  color: var(--ld-text-primary);
}
</style>
```

`packages/widget-sdk/test/fixtures/plain/widget.json`:

```json
{
  "id": "dev.test.plain",
  "version": "0.1.0",
  "title": "Plain",
  "author": "test",
  "sdk": 1,
  "entry": "index.js",
  "styles": [],
  "sizing": { "default": { "w": 2, "h": 2 }, "min": { "w": 1, "h": 1 }, "max": { "w": 4, "h": 4 } },
  "permissions": []
}
```

`packages/widget-sdk/test/fixtures/plain/src/index.vue`:

```vue
<template>
  <p>Plain</p>
</template>
```

`packages/widget-sdk/test/build.test.ts`:

```ts
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseWidgetPackage } from '@lifedashboard/contracts/widget-package'
import { buildWidget } from '../src/build.ts'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const dirs: string[] = []

// Each build runs on a copy, so dist/ never lands in the fixtures.
async function copyOf(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ld-widget-test-'))
  dirs.push(dir)
  await cp(join(fixtures, name), dir, { recursive: true })
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('buildWidget', () => {
  it('builds an SFC with scoped CSS into a valid package', async () => {
    const dir = await copyOf('counter')
    const target = await buildWidget(dir)
    expect(target).toBe(join(dir, 'dist', 'dev.test.counter-1.0.0.ldwidget.json'))
    const pkg = JSON.parse(await readFile(target, 'utf8'))
    expect(parseWidgetPackage(pkg).ok).toBe(true)
    expect(Object.keys(pkg.files).sort()).toEqual(['index.js', 'style.css'])
    expect(pkg.files['index.js']).toMatch(/from\s*["']vue["']/)
    expect(pkg.files['index.js']).toMatch(/from\s*["']@lifedashboard\/widget-sdk["']/)
    expect(pkg.files['style.css']).toMatch(/\[data-v-[0-9a-f]+\]/)
  }, 30_000)

  it('builds a package without CSS', async () => {
    const dir = await copyOf('plain')
    const pkg = JSON.parse(await readFile(await buildWidget(dir), 'utf8'))
    expect(Object.keys(pkg.files)).toEqual(['index.js'])
    expect(pkg.manifest.styles).toEqual([])
  }, 30_000)

  it('rejects a manifest the package format does not allow', async () => {
    const dir = await copyOf('counter')
    const manifest = JSON.parse(await readFile(join(dir, 'widget.json'), 'utf8'))
    await writeFile(join(dir, 'widget.json'), JSON.stringify({ ...manifest, permissions: ['http'] }))
    await expect(buildWidget(dir)).rejects.toThrow(/Invalid widget package: manifest\.permissions/)
  }, 30_000)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/build.test.ts`
Expected: FAIL — `Cannot find module '../src/build.ts'`.

- [ ] **Step 4: Write the builder and the CLI**

`packages/widget-sdk/src/build.ts`:

```ts
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { parseWidgetPackage } from '@lifedashboard/contracts/widget-package'

/**
 * Builds `<dir>/src/index.vue` with the manifest `<dir>/widget.json` into
 * `<dir>/dist/<id>-<version>.ldwidget.json` and returns that path.
 */
export async function buildWidget(dir: string): Promise<string> {
  const root = resolve(dir)
  const manifest = JSON.parse(await readFile(join(root, 'widget.json'), 'utf8')) as { entry?: unknown }
  const out = await mkdtemp(join(tmpdir(), 'ld-widget-'))
  try {
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      plugins: [vue()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: out,
        emptyOutDir: true,
        lib: { entry: join(root, 'src', 'index.vue'), formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
        // Both resolve through the sandbox import map: one Vue, one SDK instance.
        rolldownOptions: { external: ['vue', '@lifedashboard/widget-sdk'] },
      },
    })
    const entry = typeof manifest.entry === 'string' ? manifest.entry : 'index.js'
    const files: Record<string, string> = { [entry]: await readFile(join(out, 'index.js'), 'utf8') }
    if (existsSync(join(out, 'style.css'))) files['style.css'] = await readFile(join(out, 'style.css'), 'utf8')
    const result = parseWidgetPackage({ format: 1, manifest, files })
    if (!result.ok) throw new Error(`Invalid widget package: ${result.error}`)
    const { id, version } = result.value.manifest
    await mkdir(join(root, 'dist'), { recursive: true })
    const target = join(root, 'dist', `${id}-${version}.ldwidget.json`)
    await writeFile(target, `${JSON.stringify(result.value)}\n`)
    return target
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}
```

`packages/widget-sdk/src/cli.ts`:

```ts
#!/usr/bin/env node
import { buildWidget } from './build.ts'

const [command, dir = process.cwd()] = process.argv.slice(2)
if (command !== 'build') {
  console.error('Usage: ld-widget build [dir]')
  process.exit(2)
}
try {
  console.log(`Built ${await buildWidget(dir)}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
```

- [ ] **Step 5: Run the builder tests**

Run: `pnpm -C packages/widget-sdk exec vitest run && pnpm -C packages/widget-sdk typecheck`
Expected: PASS, no type errors. If `@vitejs/plugin-vue` cannot resolve `vue/compiler-sfc` from the temporary root, it falls back to its own peer `vue`; if that still fails, report the error instead of changing the plugin setup.

- [ ] **Step 6: Write the example packages**

`examples/widgets/hello/package.json`:

```json
{
  "name": "@lifedashboard/example-hello",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "ld-widget build"
  },
  "devDependencies": {
    "@lifedashboard/widget-sdk": "workspace:*"
  }
}
```

`examples/widgets/hello/widget.json`:

```json
{
  "id": "dev.lifedashboard.hello",
  "version": "1.0.0",
  "title": "Привет",
  "author": "LifeDashboard",
  "sdk": 1,
  "entry": "index.js",
  "styles": ["style.css"],
  "sizing": { "default": { "w": 3, "h": 3 }, "min": { "w": 2, "h": 2 }, "max": { "w": 6, "h": 6 } },
  "permissions": ["state", "notifications"]
}
```

`examples/widgets/hello/src/index.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWidget, WidgetError } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const count = ref(0)
const revision = ref(0)
const status = ref('')

async function load() {
  const state = await widget.state.get<{ count: number }>()
  count.value = state.data?.count ?? 0
  revision.value = state.revision
}

async function increment() {
  try {
    revision.value = (await widget.state.set({ count: count.value + 1 }, revision.value)).revision
    count.value += 1
    status.value = ''
  } catch (error) {
    if (!(error instanceof WidgetError) || error.code !== 'CONFLICT') throw error
    status.value = 'Изменено в другой вкладке'
    await load()
  }
}

async function remind() {
  await widget.notify({ title: 'Напоминание', body: `Счётчик: ${count.value}` })
}

onMounted(load)
</script>

<template>
  <div class="hello" :data-size="widget.context.sizeClass">
    <p class="hello__count">{{ count }}</p>
    <div class="hello__actions">
      <button type="button" class="hello__button" @click="increment">+1</button>
      <button type="button" class="hello__button" @click="remind">Напомнить</button>
    </div>
    <p class="hello__status" role="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.hello {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.5rem;
  height: 100vh;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.hello__count {
  margin: 0;
  font-size: 2rem;
  font-weight: var(--ld-weight-strong);
}

.hello__actions {
  display: flex;
  gap: 0.5rem;
}

.hello__button {
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.hello__status {
  min-height: 1rem;
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}
</style>
```

`examples/widgets/hostile/package.json`: the same as `hello/package.json` with `"name": "@lifedashboard/example-hostile"`.

`examples/widgets/hostile/widget.json`:

```json
{
  "id": "dev.lifedashboard.hostile",
  "version": "1.0.0",
  "title": "Проверка песочницы",
  "author": "LifeDashboard",
  "sdk": 1,
  "entry": "index.js",
  "styles": ["style.css"],
  "sizing": { "default": { "w": 4, "h": 4 }, "min": { "w": 3, "h": 3 }, "max": { "w": 6, "h": 6 } },
  "permissions": ["state"]
}
```

`examples/widgets/hostile/src/index.vue`:

```vue
<script setup lang="ts">
// Test package: probes the sandbox boundary and shows what each probe got (spec «Testing»).
import { onMounted, ref } from 'vue'
import { useWidget, WidgetError } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const results = ref<{ name: string; result: string }[]>([])

function describe(error: unknown): string {
  if (error instanceof WidgetError) return `blocked: ${error.code}`
  return `blocked: ${error instanceof Error ? error.name : String(error)}`
}

async function probe(name: string, run: () => unknown) {
  try {
    results.value.push({ name, result: `value: ${JSON.stringify(await run())}` })
  } catch (error) {
    results.value.push({ name, result: describe(error) })
  }
}

function fail() {
  throw new Error('hostile: thrown on purpose')
}

function leave() {
  location.href = 'https://example.com/'
}

onMounted(async () => {
  await probe('document.cookie', () => document.cookie)
  await probe('parent.document', () => parent.document.title)
  await probe('localStorage', () => localStorage.length)
  await probe('fetch /api/v1/rooms', async () => (await fetch('/api/v1/rooms')).status)
  // The manifest grants `state` only.
  await probe('notifications.send', () => widget.notify({ title: 'hostile' }))
})
</script>

<template>
  <div class="hostile">
    <ul class="hostile__list">
      <li v-for="item in results" :key="item.name" :data-probe="item.name">{{ item.name }} → {{ item.result }}</li>
    </ul>
    <div class="hostile__actions">
      <button type="button" class="hostile__button" @click="fail">Ошибка</button>
      <button type="button" class="hostile__button" @click="leave">Уйти</button>
    </div>
  </div>
</template>

<style scoped>
.hostile {
  display: grid;
  gap: 0.5rem;
  height: 100vh;
  padding: 0.5rem;
  box-sizing: border-box;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
  font-size: 0.75rem;
}

.hostile__list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.hostile__actions {
  display: flex;
  gap: 0.5rem;
}

.hostile__button {
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}
</style>
```

Run: `pnpm install && pnpm -C examples/widgets/hello build && pnpm -C examples/widgets/hostile build`
Expected: `Built …/examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json` and the same for `dev.lifedashboard.hostile-1.0.0` (acceptance 1). The `dist/` folders are git-ignored. If Node refuses to strip types for `cli.ts` behind the `node_modules/.bin` shim (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), stop and report it: the fix changes how the CLI ships and needs a decision.

- [ ] **Step 7: Commit**

```bash
git add packages/widget-sdk examples/widgets pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(widget-sdk): ld-widget build and example packages"
```

---
### Task 10: UI API client and the widget broker

**Files:**
- Create: `apps/ui/app/widgets/broker.ts`, `apps/ui/test/broker.test.ts`
- Modify: `apps/ui/app/api.ts`, `apps/ui/test/api.test.ts`, `apps/ui/test/room-sync.test.ts:60`, `apps/ui/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `WidgetError`, `WidgetCall` (Task 6); `isGatewayOp`, `parseGatewayInput`, `parseSandboxMessage`, `BRIDGE_LIMITS`, `SDK_VERSION`, `NotificationInput`, `WidgetContext`, `WidgetErrorCode`, `WidgetSessionResponse` (Task 2); `PackageInspection`, `InstalledPackage` (Task 1).
- Produces (`apps/ui/app/api.ts`):
  ```ts
  type ApiFailure =
    | { kind: 'unauthorized' } | { kind: 'session-expired' } | { kind: 'conflict' } | { kind: 'rate-limited' }
    | { kind: 'invalid'; code: string; message: string } | { kind: 'unavailable' }
  function apiRequest<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number, headers?: Record<string, string>): Promise<ApiResult<T>>
  api.widgetPackages(): Promise<ApiResult<InstalledPackage[]>>
  api.inspectPackage(pkg: unknown): Promise<ApiResult<PackageInspection>>
  api.installPackage(pkg: unknown): Promise<ApiResult<PackageInspection>>
  api.deletePackage(id: string): Promise<ApiResult<null>>
  api.createWidgetSession(widgetId: string): Promise<ApiResult<WidgetSessionResponse>>
  api.endWidgetSession(token: string): Promise<ApiResult<null>>
  api.gateway(op: string, token: string, input: unknown): Promise<ApiResult<unknown>>
  ```
  `401` with code `SESSION_EXPIRED` maps to `session-expired`; every other `401` stays `unauthorized` (pairing).
- Produces (`apps/ui/app/widgets/broker.ts`):
  ```ts
  type GatewayApi = Pick<typeof api, 'createWidgetSession' | 'endWidgetSession' | 'gateway'>
  interface GatewayClient { start(): Promise<boolean>; call: WidgetCall; close(): Promise<void> }
  function createGatewayClient(deps: { api: GatewayApi; widgetId: string; onNotify(message: NotificationInput): void; onSessionLost(): void }): GatewayClient
  interface HelloEvent { data: unknown; source: unknown }
  function createHandshakes(): { register(frame: unknown, onHello: () => void): () => void; handle(event: HelloEvent): boolean }
  function listenForHello(frame: Window, onHello: () => void): () => void   // the single window listener
  interface Bridge { push(patch: Partial<WidgetContext>): void; close(): void }
  function createBridge(port: MessagePort, deps: { call: WidgetCall; onError(message: string): void; onClose(): void }): Bridge
  ```

- [ ] **Step 1: Link the SDK into the UI**

In `apps/ui/package.json` `dependencies`, add `"@lifedashboard/widget-sdk": "workspace:*"` (keep keys sorted).

Run: `pnpm install`
Expected: a workspace link only.

- [ ] **Step 2: Write the failing tests**

In `apps/ui/test/api.test.ts`:
- change the expectation in `maps another 4xx to invalid with the server message` to
  `expect(await api.rooms()).toEqual({ ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'bad rect' })`;
- add inside `describe('apiRequest', …)`:
  ```ts
  it('maps 401 SESSION_EXPIRED apart from a lost dashboard session', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'SESSION_EXPIRED', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('state.get', 'tok', {})).toEqual({ ok: false, kind: 'session-expired' })
    vi.stubGlobal('fetch', respond(401, { error: { code: 'UNAUTHORIZED', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('state.get', 'tok', {})).toEqual({ ok: false, kind: 'unauthorized' })
  })

  it('sends the widget session header and the input on a gateway call', async () => {
    const fetchMock = respond(200, { data: { revision: 1 }, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.gateway('state.set', 'tok', { data: 1, expectedRevision: 0 })).toEqual({ ok: true, data: { revision: 1 } })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-gateway/state.set')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-widget-session': 'tok' })
    expect(init?.body).toBe('{"data":1,"expectedRevision":0}')
  })

  it('sends an empty JSON body on DELETE', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.deletePackage('dev.a.clock')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-packages/dev.a.clock')
    expect(init?.method).toBe('DELETE')
    expect(init?.body).toBe('{}')
  })
  ```

In `apps/ui/test/room-sync.test.ts` line 60: `['a rejected request', { ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'm' }],`.

`apps/ui/test/broker.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import type { ApiResult } from '../app/api'
import { createBridge, createGatewayClient, createHandshakes, type GatewayApi } from '../app/widgets/broker'

// JSON of 'x'.repeat(n) is n + 2 bytes.
const exactly64k = 'x'.repeat(65_534)
const never = () => new Promise<never>(() => {})

function fakeApi(answer: (op: string, token: string, input: unknown) => Promise<ApiResult<unknown>>) {
  let created = 0
  return {
    createWidgetSession: vi.fn(async (_widgetId: string) => ({ ok: true as const, data: { widgetSession: `s${++created}`, grants: [] } })),
    endWidgetSession: vi.fn(async (_token: string) => ({ ok: true as const, data: null })),
    gateway: vi.fn(answer),
  } satisfies GatewayApi
}

function setup(answer: (op: string, token: string, input: unknown) => Promise<ApiResult<unknown>>) {
  const api = fakeApi(answer)
  const onNotify = vi.fn()
  const onSessionLost = vi.fn()
  return { api, onNotify, onSessionLost, client: createGatewayClient({ api, widgetId: 'w1', onNotify, onSessionLost }) }
}

function answers(...results: ApiResult<unknown>[]) {
  return async () => results.shift()!
}

describe('createGatewayClient', () => {
  it('rejects an unknown op and invalid input before any API call', async () => {
    const { api, client } = setup(answers())
    await expect(client.call('http.get', {})).rejects.toMatchObject({ code: 'UNKNOWN_OP' })
    await expect(client.call('state.set', { data: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(api.createWidgetSession).not.toHaveBeenCalled()
    expect(api.gateway).not.toHaveBeenCalled()
  })

  it('creates a session on the first call and sends its token with the parsed input', async () => {
    const { api, client } = setup(answers({ ok: true, data: { revision: 1 } }))
    expect(await client.call('state.set', { data: { n: 1 }, expectedRevision: 0 })).toEqual({ revision: 1 })
    expect(api.createWidgetSession).toHaveBeenCalledWith('w1')
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: { n: 1 }, expectedRevision: 0 })
  })

  it('renews an expired session once and repeats the call', async () => {
    const { api, client, onSessionLost } = setup(
      answers({ ok: false, kind: 'session-expired' }, { ok: true, data: { data: null, revision: 0 } }),
    )
    expect(await client.call('state.get', {})).toEqual({ data: null, revision: 0 })
    expect(api.gateway.mock.calls.map((call) => call[1])).toEqual(['s1', 's2'])
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('reports a second SESSION_EXPIRED as a lost session, not as pairing', async () => {
    const { api, client, onSessionLost } = setup(
      answers({ ok: false, kind: 'session-expired' }, { ok: false, kind: 'session-expired' }),
    )
    await expect(client.call('state.get', {})).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(api.createWidgetSession).toHaveBeenCalledTimes(2)
    expect(onSessionLost).toHaveBeenCalledTimes(1)
  })

  it('reports a session that cannot be created as lost', async () => {
    const { api, client, onSessionLost } = setup(answers())
    api.createWidgetSession.mockResolvedValueOnce({ ok: false, kind: 'unavailable' } as never)
    expect(await client.start()).toBe(false)
    api.createWidgetSession.mockResolvedValueOnce({ ok: false, kind: 'unavailable' } as never)
    await expect(client.call('state.get', {})).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(api.gateway).not.toHaveBeenCalled()
    expect(onSessionLost).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ ok: false, kind: 'invalid', code: 'PERMISSION_DENIED', message: 'm' }, 'PERMISSION_DENIED'],
    [{ ok: false, kind: 'invalid', code: 'UNKNOWN_OP', message: 'm' }, 'UNKNOWN_OP'],
    [{ ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'm' }, 'INVALID_INPUT'],
    [{ ok: false, kind: 'conflict' }, 'CONFLICT'],
    [{ ok: false, kind: 'rate-limited' }, 'RATE_LIMITED'],
    [{ ok: false, kind: 'unavailable' }, 'UNAVAILABLE'],
    [{ ok: false, kind: 'unauthorized' }, 'UNAVAILABLE'],
  ] as const)('maps %j to %s', async (failure, code) => {
    const { client } = setup(answers(failure as ApiResult<unknown>))
    const error = await client.call('state.get', {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WidgetError)
    expect(error).toMatchObject({ code })
  })

  it('shows a notification only after the gateway accepted it', async () => {
    const { client, onNotify } = setup(answers({ ok: false, kind: 'rate-limited' }, { ok: true, data: { ok: true } }))
    await expect(client.call('notifications.send', { title: 'Hi', body: '' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(onNotify).not.toHaveBeenCalled()
    await client.call('notifications.send', { title: 'Hi', body: '' })
    expect(onNotify).toHaveBeenCalledWith({ title: 'Hi', body: '' })
  })

  it('ends its session on close', async () => {
    const { api, client } = setup(answers({ ok: true, data: { data: null, revision: 0 } }))
    await client.call('state.get', {})
    await client.close()
    await client.close()
    expect(api.endWidgetSession.mock.calls).toEqual([['s1']])
  })
})

describe('createHandshakes', () => {
  const hello = { t: 'ld:hello', sdk: 1 }

  it('accepts a hello only from a registered frame, once', () => {
    const handshakes = createHandshakes()
    const frame = {}
    const onHello = vi.fn()
    handshakes.register(frame, onHello)
    expect(handshakes.handle({ data: hello, source: {} })).toBe(false)
    expect(handshakes.handle({ data: hello, source: null })).toBe(false)
    expect(handshakes.handle({ data: hello, source: frame })).toBe(true)
    expect(handshakes.handle({ data: hello, source: frame })).toBe(false)
    expect(onHello).toHaveBeenCalledTimes(1)
  })

  it('ignores other messages and another SDK version', () => {
    const handshakes = createHandshakes()
    const frame = {}
    const onHello = vi.fn()
    handshakes.register(frame, onHello)
    expect(handshakes.handle({ data: { t: 'ld:hello', sdk: 2 }, source: frame })).toBe(false)
    expect(handshakes.handle({ data: 'ld:hello', source: frame })).toBe(false)
    expect(onHello).not.toHaveBeenCalled()
  })

  it('ignores a hello after the registration was cancelled (timeout or unmount)', () => {
    const handshakes = createHandshakes()
    const frame = {}
    const onHello = vi.fn()
    const cancel = handshakes.register(frame, onHello)
    cancel()
    expect(handshakes.handle({ data: hello, source: frame })).toBe(false)
    expect(onHello).not.toHaveBeenCalled()
  })
})

describe('createBridge', () => {
  let ports: MessagePort[] = []
  let bridges: { close(): void }[] = []

  // Closing the bridges clears their request timers; closing the ports lets the test process exit.
  afterEach(() => {
    for (const bridge of bridges) bridge.close()
    for (const port of ports) port.close()
    bridges = []
    ports = []
    vi.useRealTimers()
  })

  // The frame's end of the channel: sends raw messages, reads answers in order.
  function connect(call: WidgetCall) {
    const { port1, port2 } = new MessageChannel()
    ports.push(port1, port2)
    const inbox: unknown[] = []
    const waiting: ((message: unknown) => void)[] = []
    port2.onmessage = (event: MessageEvent) => {
      const next = waiting.shift()
      if (next) next(event.data)
      else inbox.push(event.data)
    }
    const onError = vi.fn()
    const onClose = vi.fn()
    const bridge = createBridge(port1, { call, onError, onClose })
    bridges.push(bridge)
    return {
      bridge,
      onError,
      onClose,
      send: (message: unknown) => port2.postMessage(message),
      next: () => (inbox.length > 0 ? Promise.resolve(inbox.shift()) : new Promise<unknown>((resolve) => waiting.push(resolve))),
    }
  }

  it('answers a request with the call result', async () => {
    const call = vi.fn(async () => ({ revision: 1 }))
    const frame = connect(call)
    frame.send({ t: 'req', id: 1, op: 'state.set', input: { data: 1, expectedRevision: 0 } })
    expect(await frame.next()).toEqual({ t: 'res', id: 1, ok: true, value: { revision: 1 } })
    expect(call).toHaveBeenCalledWith('state.set', { data: 1, expectedRevision: 0 })
  })

  it('passes a 64 KB state.set through the bridge and the gateway client', async () => {
    const { api, client } = setup(answers({ ok: true, data: { revision: 1 } }))
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 1, op: 'state.set', input: { data: exactly64k, expectedRevision: 0 } })
    expect(await frame.next()).toEqual({ t: 'res', id: 1, ok: true, value: { revision: 1 } })
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: exactly64k, expectedRevision: 0 })
  })

  it('answers UNKNOWN_OP from the gateway client without an API call', async () => {
    const { api, client } = setup(answers())
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 4, op: 'http.get', input: {} })
    expect(await frame.next()).toMatchObject({ t: 'res', id: 4, ok: false, error: { code: 'UNKNOWN_OP' } })
    expect(api.gateway).not.toHaveBeenCalled()
  })

  it('answers a message over 128 KB with INVALID_INPUT and does not call', async () => {
    const call = vi.fn(async () => null)
    const frame = connect(call)
    frame.send({ t: 'req', id: 2, op: 'state.set', input: { data: 'x'.repeat(131_072), expectedRevision: 0 } })
    expect(await frame.next()).toMatchObject({ t: 'res', id: 2, ok: false, error: { code: 'INVALID_INPUT' } })
    expect(call).not.toHaveBeenCalled()
  })

  it('caps requests in flight at 16', async () => {
    const call = vi.fn(never)
    const frame = connect(call)
    for (let id = 0; id <= 16; id++) frame.send({ t: 'req', id, op: 'state.get', input: {} })
    expect(await frame.next()).toMatchObject({ t: 'res', id: 16, ok: false, error: { code: 'RATE_LIMITED' } })
    expect(call).toHaveBeenCalledTimes(16)
  })

  it('times out a request after 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const call = vi.fn(never)
    const frame = connect(call)
    frame.send({ t: 'req', id: 3, op: 'state.get', input: {} })
    await vi.waitFor(() => expect(call).toHaveBeenCalled())
    vi.advanceTimersByTime(10_000)
    expect(await frame.next()).toMatchObject({ t: 'res', id: 3, ok: false, error: { code: 'TIMEOUT' } })
  })

  it('forwards an error report from the frame', async () => {
    const frame = connect(vi.fn(never))
    frame.send({ t: 'error', message: 'Error: boom' })
    await vi.waitFor(() => expect(frame.onError).toHaveBeenCalledWith('Error: boom'))
  })

  it('closes after 20 malformed messages', async () => {
    const call = vi.fn(async () => null)
    const frame = connect(call)
    for (let index = 0; index < 19; index++) frame.send({ t: 'junk' })
    frame.send({ t: 'req', id: 1, op: 'state.get', input: {} })
    expect(await frame.next()).toMatchObject({ id: 1, ok: true })
    expect(frame.onClose).not.toHaveBeenCalled()
    frame.send('junk')
    await vi.waitFor(() => expect(frame.onClose).toHaveBeenCalledTimes(1))
    frame.send({ t: 'req', id: 2, op: 'state.get', input: {} })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('pushes context patches to the frame', async () => {
    const frame = connect(vi.fn(never))
    frame.bridge.push({ visible: false })
    expect(await frame.next()).toEqual({ t: 'context', patch: { visible: false } })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/api.test.ts test/broker.test.ts`
Expected: FAIL — `api.gateway` / `api.deletePackage` are not functions, `invalid` has no `code`; `Cannot find module '../app/widgets/broker'`.

- [ ] **Step 4: Extend `api.ts`**

`apps/ui/app/api.ts` becomes:

```ts
import type { RoomBoard, RoomSummary, SaveBoardRequest } from '@lifedashboard/contracts/board'
import type { WidgetSessionResponse } from '@lifedashboard/contracts/widget-gateway'
import type { InstalledPackage, PackageInspection } from '@lifedashboard/contracts/widget-package'

export const API_TIMEOUT_MS = 5000

export type ApiFailure =
  | { kind: 'unauthorized' }
  // A widget session ended (API restart, idle expiry): never a reason to pair again.
  | { kind: 'session-expired' }
  | { kind: 'conflict' }
  | { kind: 'rate-limited' }
  | { kind: 'invalid'; code: string; message: string }
  | { kind: 'unavailable' }

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure)

/** Never throws: every failure, including a timeout while the body is read, becomes a typed result. */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = API_TIMEOUT_MS,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  let response: Response
  let payload: unknown
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(timeoutMs),
    })
    payload = await response.json()
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
  if (response.ok && isRecord(payload) && 'data' in payload) return { ok: true, data: payload.data as T }
  if (response.status === 401) {
    return errorField(payload, 'code') === 'SESSION_EXPIRED' ? { ok: false, kind: 'session-expired' } : { ok: false, kind: 'unauthorized' }
  }
  if (response.status === 409) return { ok: false, kind: 'conflict' }
  if (response.status === 429) return { ok: false, kind: 'rate-limited' }
  if (response.status >= 400 && response.status < 500) {
    return {
      ok: false,
      kind: 'invalid',
      code: errorField(payload, 'code') ?? 'UNKNOWN',
      message: errorField(payload, 'message') ?? 'Request rejected',
    }
  }
  return { ok: false, kind: 'unavailable' }
}

const boardPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}/board`

export const api = {
  rooms: () => apiRequest<RoomSummary[]>('GET', '/rooms'),
  board: (roomId: string) => apiRequest<RoomBoard>('GET', boardPath(roomId)),
  saveBoard: (roomId: string, request: SaveBoardRequest) => apiRequest<RoomBoard>('PUT', boardPath(roomId), request),
  pair: (code: string) => apiRequest<null>('POST', '/auth/pair', { code }),
  // The API requires a JSON body on every mutation, DELETE included.
  pairCode: () => apiRequest<null>('POST', '/auth/pair-code', {}),
  widgetPackages: () => apiRequest<InstalledPackage[]>('GET', '/widget-packages'),
  inspectPackage: (pkg: unknown) => apiRequest<PackageInspection>('POST', '/widget-packages/inspect', pkg),
  installPackage: (pkg: unknown) => apiRequest<PackageInspection>('POST', '/widget-packages', pkg),
  deletePackage: (id: string) => apiRequest<null>('DELETE', `/widget-packages/${encodeURIComponent(id)}`, {}),
  createWidgetSession: (widgetId: string) => apiRequest<WidgetSessionResponse>('POST', '/widget-sessions', { widgetId }),
  endWidgetSession: (token: string) => apiRequest<null>('DELETE', `/widget-sessions/${encodeURIComponent(token)}`, {}),
  gateway: (op: string, token: string, input: unknown) =>
    apiRequest<unknown>('POST', `/widget-gateway/${encodeURIComponent(op)}`, input, API_TIMEOUT_MS, { 'x-widget-session': token }),
}

function errorField(payload: unknown, field: 'code' | 'message'): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined
  const value = payload.error[field]
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 5: Write `broker.ts`**

`apps/ui/app/widgets/broker.ts`:

```ts
import {
  BRIDGE_LIMITS,
  isGatewayOp,
  parseGatewayInput,
  parseSandboxMessage,
  SDK_VERSION,
  type NotificationInput,
  type WidgetContext,
  type WidgetErrorCode,
} from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import type { api, ApiFailure, ApiResult } from '../api'

export type GatewayApi = Pick<typeof api, 'createWidgetSession' | 'endWidgetSession' | 'gateway'>

export interface GatewayClient {
  start(): Promise<boolean>
  call: WidgetCall
  close(): Promise<void>
}

const GATEWAY_CODES: ReadonlySet<string> = new Set<WidgetErrorCode>(['UNKNOWN_OP', 'PERMISSION_DENIED', 'INVALID_INPUT'])

function toWidgetError(failure: ApiFailure): WidgetError {
  switch (failure.kind) {
    case 'conflict':
      return new WidgetError('CONFLICT', 'The widget state changed since it was read')
    case 'rate-limited':
      return new WidgetError('RATE_LIMITED', 'Too many calls')
    case 'invalid':
      return new WidgetError(GATEWAY_CODES.has(failure.code) ? (failure.code as WidgetErrorCode) : 'INVALID_INPUT', failure.message)
    default:
      return new WidgetError('UNAVAILABLE', 'The LifeDashboard API is unavailable')
  }
}

/**
 * A widget's way to the gateway, shared by both hosts. It holds the widget session (the frame never
 * sees the token), checks op and input with the shared contracts, and renews an expired session once:
 * a session failure happens before the operation runs, so one repeat is safe.
 */
export function createGatewayClient(deps: {
  api: GatewayApi
  widgetId: string
  onNotify(message: NotificationInput): void
  onSessionLost(): void
}): GatewayClient {
  let token: string | null = null

  async function start(): Promise<boolean> {
    const result = await deps.api.createWidgetSession(deps.widgetId)
    token = result.ok ? result.data.widgetSession : null
    return token !== null
  }

  async function send(op: string, input: unknown): Promise<ApiResult<unknown> | null> {
    if (token === null && !(await start())) return null
    return deps.api.gateway(op, token!, input)
  }

  function lost(): WidgetError {
    token = null
    deps.onSessionLost()
    return new WidgetError('SESSION_EXPIRED', 'Widget session expired')
  }

  async function call(op: string, input: unknown): Promise<unknown> {
    if (!isGatewayOp(op)) throw new WidgetError('UNKNOWN_OP', `Unknown operation "${op.slice(0, 100)}"`)
    const parsed = parseGatewayInput(op, input)
    if (!parsed.ok) throw new WidgetError('INVALID_INPUT', parsed.error)
    let result = await send(op, parsed.value)
    if (result && !result.ok && result.kind === 'session-expired') {
      token = null
      result = await send(op, parsed.value)
    }
    if (!result || (!result.ok && result.kind === 'session-expired')) throw lost()
    if (!result.ok) throw toWidgetError(result)
    if (op === 'notifications.send') deps.onNotify(parsed.value as NotificationInput)
    return result.data
  }

  async function close(): Promise<void> {
    const current = token
    token = null
    if (current !== null) await deps.api.endWidgetSession(current)
  }

  return { start, call, close }
}

export interface HelloEvent {
  data: unknown
  source: unknown
}

/**
 * The bootstrap check (spec «RPC bridge» step 2): a hello counts only when its source is a registered
 * frame window that has not shaken hands yet. `event.source` is the only identity an opaque origin has.
 */
export function createHandshakes() {
  const waiting = new Map<unknown, () => void>()
  return {
    register(frame: unknown, onHello: () => void): () => void {
      waiting.set(frame, onHello)
      return () => {
        if (waiting.get(frame) === onHello) waiting.delete(frame)
      }
    },
    handle(event: HelloEvent): boolean {
      const onHello = waiting.get(event.source)
      const data = event.data as { t?: unknown; sdk?: unknown } | null
      if (!onHello || typeof data !== 'object' || data === null || data.t !== 'ld:hello' || data.sdk !== SDK_VERSION) return false
      waiting.delete(event.source)
      onHello()
      return true
    },
  }
}

const handshakes = createHandshakes()
let listening = false

/** Waits for the hello of one frame; the returned function stops waiting. One window listener for all frames. */
export function listenForHello(frame: Window, onHello: () => void): () => void {
  if (!listening) {
    window.addEventListener('message', (event) => handshakes.handle(event))
    listening = true
  }
  return handshakes.register(frame, onHello)
}

export interface Bridge {
  push(patch: Partial<WidgetContext>): void
  close(): void
}

/** The host end of one widget's port, with the limits of spec «RPC bridge» step 4. */
export function createBridge(
  port: MessagePort,
  deps: { call: WidgetCall; onError(message: string): void; onClose(): void },
): Bridge {
  const encoder = new TextEncoder()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let inFlight = 0
  let malformed = 0
  let closed = false

  function reply(id: number, outcome: { value: unknown } | { error: WidgetError }): void {
    if (closed) return
    port.postMessage(
      'value' in outcome
        ? { t: 'res', id, ok: true, value: outcome.value }
        : { t: 'res', id, ok: false, error: { code: outcome.error.code, message: outcome.error.message } },
    )
  }

  function close(): void {
    if (closed) return
    closed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    port.onmessage = null
    port.close()
  }

  function dropMalformed(): void {
    malformed += 1
    if (malformed < BRIDGE_LIMITS.maxMalformed) return
    close()
    deps.onClose()
  }

  function sizeOf(data: unknown): number {
    try {
      return encoder.encode(JSON.stringify(data) ?? '').length
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  function run(id: number, op: string, input: unknown): void {
    if (inFlight >= BRIDGE_LIMITS.maxInFlight) {
      reply(id, { error: new WidgetError('RATE_LIMITED', 'Too many requests in flight') })
      return
    }
    inFlight += 1
    let settled = false
    const settle = (outcome: { value: unknown } | { error: WidgetError }) => {
      if (settled) return
      settled = true
      inFlight -= 1
      clearTimeout(timer)
      timers.delete(timer)
      reply(id, outcome)
    }
    const timer = setTimeout(() => settle({ error: new WidgetError('TIMEOUT', 'The request timed out') }), BRIDGE_LIMITS.requestTimeoutMs)
    timers.add(timer)
    deps.call(op, input).then(
      (value) => settle({ value }),
      (error: unknown) => settle({ error: error instanceof WidgetError ? error : new WidgetError('UNAVAILABLE', 'The request failed') }),
    )
  }

  port.onmessage = (event: MessageEvent) => {
    if (closed) return
    const message = parseSandboxMessage(event.data)
    if (!message) {
      dropMalformed()
      return
    }
    if (sizeOf(event.data) > BRIDGE_LIMITS.maxMessageBytes) {
      if (message.t === 'req') reply(message.id, { error: new WidgetError('INVALID_INPUT', 'The message is larger than 128 KB') })
      dropMalformed()
      return
    }
    if (message.t === 'error') deps.onError(message.message)
    else run(message.id, message.op, message.input)
  }

  return {
    push(patch) {
      if (!closed) port.postMessage({ t: 'context', patch })
    },
    close,
  }
}
```

- [ ] **Step 6: Run the UI suite and typecheck**

Run: `pnpm -C apps/ui exec vitest run && pnpm -C apps/ui typecheck`
Expected: PASS (all earlier UI tests, including `room-sync.test.ts`), no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/ui/app/api.ts apps/ui/app/widgets/broker.ts apps/ui/test/api.test.ts apps/ui/test/broker.test.ts apps/ui/test/room-sync.test.ts apps/ui/package.json pnpm-lock.yaml
git commit -m "feat(ui): widget broker with session renewal, handshake and bridge limits"
```

---

### Task 11: Packages dialog and the widget picker

**Files:**
- Create: `apps/ui/app/widgets/PackagesDialog.vue`
- Modify: `apps/ui/app/widgets/catalog.ts`, `apps/ui/test/catalog.test.ts`, `apps/ui/app/board/WidgetBoard.vue`, `apps/ui/app/app.vue`

**Interfaces:**
- Consumes: `api.widgetPackages`, `api.inspectPackage`, `api.installPackage`, `api.deletePackage`, `ApiFailure` (Task 10); `InstalledPackage`, `PackageInspection`, `PACKAGE_LIMITS`, `WidgetPermission` (Task 1); `BUILTIN_WIDGETS`, `findBuiltinWidget` (Task 2).
- Produces (`apps/ui/app/widgets/catalog.ts`):
  ```ts
  interface SourceInfo { title: string; sizing: WidgetSizing; hash: string | null }     // hash only for packages
  interface PickerEntry { key: string; title: string; source: WidgetSource }
  type PackageFile = { ok: true; body: unknown } | { ok: false; message: string }
  const installedPackages: Ref<InstalledPackage[]>
  function loadPackages(client: Pick<typeof api, 'widgetPackages'>): Promise<boolean>     // keeps the last list on failure
  function describeSource(source: WidgetSource, packages?: readonly InstalledPackage[]): SourceInfo | null
  function pickerEntries(packages?: readonly InstalledPackage[]): PickerEntry[]           // built-ins, then the newest version of each package
  function readPackageFile(file: Blob): Promise<PackageFile>
  ```
  `placeholderManifest` is removed.
- Produces (`WidgetBoard.vue`): new required prop `draftSource: WidgetSource`; the draft and edit sizing come from `describeSource`.
- Produces (`app.vue`): the header «+» button becomes a `<select aria-label="Добавить виджет">` with «Добавить виджет…» and the picker entries; «Виджеты» opens `PackagesDialog`; installed packages load once the app is ready.

- [ ] **Step 1: Write the failing tests**

Replace `apps/ui/test/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { InstalledPackage, WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import {
  describeSource,
  findBuiltinWidget,
  installedPackages,
  loadPackages,
  pickerEntries,
  readPackageFile,
} from '../app/widgets/catalog'

function manifest(version: string, title: string): WidgetPackageManifest {
  return {
    id: 'dev.a.clock',
    version,
    title,
    author: 'a',
    sdk: 1,
    entry: 'index.js',
    styles: [],
    sizing: { default: { w: 2, h: 2 }, min: { w: 1, h: 1 }, max: { w: 3, h: 3 } },
    permissions: [],
  }
}

// The API lists versions newest first.
const clock: InstalledPackage = {
  id: 'dev.a.clock',
  title: 'Часы',
  author: 'a',
  versions: [
    { version: '2.0.0', hash: 'h2', manifest: manifest('2.0.0', 'Часы 2') },
    { version: '1.0.0', hash: 'h1', manifest: manifest('1.0.0', 'Часы') },
  ],
  grants: [],
}

describe('catalog', () => {
  it('re-exports the built-in manifests from contracts', () => {
    expect(findBuiltinWidget('placeholder')?.sizing).toEqual({ default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 12, h: 8 } })
    expect(findBuiltinWidget('toString')).toBeUndefined()
  })

  it('describes built-in sources and the exact package version of a placed widget', () => {
    expect(describeSource({ kind: 'builtin', type: 'placeholder' }, [])).toEqual({
      title: 'Заглушка',
      sizing: findBuiltinWidget('placeholder')!.sizing,
      hash: null,
    })
    expect(describeSource({ kind: 'package', packageId: 'dev.a.clock', version: '1.0.0' }, [clock])).toEqual({
      title: 'Часы',
      sizing: clock.versions[1]!.manifest.sizing,
      hash: 'h1',
    })
    expect(describeSource({ kind: 'package', packageId: 'dev.a.clock', version: '3.0.0' }, [clock])).toBeNull()
    expect(describeSource({ kind: 'builtin', type: 'nope' }, [])).toBeNull()
  })

  it('offers built-ins and the newest version of each package', () => {
    expect(pickerEntries([clock])).toEqual([
      { key: 'builtin:placeholder', title: 'Заглушка', source: { kind: 'builtin', type: 'placeholder' } },
      { key: 'package:dev.a.clock', title: 'Часы 2', source: { kind: 'package', packageId: 'dev.a.clock', version: '2.0.0' } },
    ])
  })

  it('loads installed packages and keeps the last list on failure', async () => {
    expect(await loadPackages({ widgetPackages: async () => ({ ok: true, data: [clock] }) })).toBe(true)
    expect(installedPackages.value).toEqual([clock])
    expect(await loadPackages({ widgetPackages: async () => ({ ok: false, kind: 'unavailable' }) })).toBe(false)
    expect(installedPackages.value).toEqual([clock])
  })
})

describe('readPackageFile', () => {
  it('rejects a file over 1 MB without reading it', async () => {
    expect(await readPackageFile(new Blob(['x'.repeat(1_048_577)]))).toEqual({ ok: false, message: 'Файл больше 1 МБ' })
  })

  it('rejects text that is not JSON', async () => {
    expect(await readPackageFile(new Blob(['<html>']))).toEqual({ ok: false, message: 'Это не пакет виджета' })
  })

  it('returns the parsed body; the API validates the rest', async () => {
    expect(await readPackageFile(new Blob(['{"format":1}']))).toEqual({ ok: true, body: { format: 1 } })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/catalog.test.ts`
Expected: FAIL — `describeSource`, `pickerEntries`, `installedPackages`, `loadPackages`, `readPackageFile` are not exported.

- [ ] **Step 3: Write the catalog store**

Replace `apps/ui/app/widgets/catalog.ts`:

```ts
import { ref } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { BUILTIN_WIDGETS, findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'
import type { WidgetSizing } from '@lifedashboard/contracts/grid'
import { PACKAGE_LIMITS, type InstalledPackage } from '@lifedashboard/contracts/widget-package'
import type { api } from '../api'

// One trusted list shared with the API; the UI adds only renderers (registry.ts).
export { BUILTIN_WIDGETS, findBuiltinWidget }
export type { BuiltinWidgetManifest } from '@lifedashboard/contracts/builtin-widgets'

export interface SourceInfo {
  title: string
  sizing: WidgetSizing
  // The sandbox document of a package version; null for built-in widgets.
  hash: string | null
}

export interface PickerEntry {
  key: string
  title: string
  source: WidgetSource
}

export type PackageFile = { ok: true; body: unknown } | { ok: false; message: string }

/** Installed packages, newest version first in each. Loaded when the app is ready and after install or delete. */
export const installedPackages = ref<InstalledPackage[]>([])

export async function loadPackages(client: Pick<typeof api, 'widgetPackages'>): Promise<boolean> {
  const result = await client.widgetPackages()
  if (result.ok) installedPackages.value = result.data
  return result.ok
}

/** Title, sizing and document of a source; a placed package widget stays on its own version. */
export function describeSource(source: WidgetSource, packages: readonly InstalledPackage[] = installedPackages.value): SourceInfo | null {
  if (source.kind === 'builtin') {
    const manifest = findBuiltinWidget(source.type)
    return manifest ? { title: manifest.title, sizing: manifest.sizing, hash: null } : null
  }
  const version = packages.find((pkg) => pkg.id === source.packageId)?.versions.find((item) => item.version === source.version)
  return version ? { title: version.manifest.title, sizing: version.manifest.sizing, hash: version.hash } : null
}

/** «Добавить виджет»: built-in widgets, then the newest installed version of each package. */
export function pickerEntries(packages: readonly InstalledPackage[] = installedPackages.value): PickerEntry[] {
  const builtins = BUILTIN_WIDGETS.map((manifest): PickerEntry => ({
    key: `builtin:${manifest.type}`,
    title: manifest.title,
    source: { kind: 'builtin', type: manifest.type },
  }))
  const latest = packages.flatMap((pkg): PickerEntry[] => {
    const newest = pkg.versions[0]
    return newest
      ? [{ key: `package:${pkg.id}`, title: newest.manifest.title, source: { kind: 'package', packageId: pkg.id, version: newest.version } }]
      : []
  })
  return [...builtins, ...latest]
}

/** Reads a chosen package file; a file that is too large or not JSON never reaches the API. */
export async function readPackageFile(file: Blob): Promise<PackageFile> {
  if (file.size > PACKAGE_LIMITS.maxBytes) return { ok: false, message: 'Файл больше 1 МБ' }
  try {
    return { ok: true, body: JSON.parse(await file.text()) as unknown }
  } catch {
    return { ok: false, message: 'Это не пакет виджета' }
  }
}
```

- [ ] **Step 4: Run the catalog tests**

Run: `pnpm -C apps/ui exec vitest run test/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Take the draft source and sizing from the catalog in `WidgetBoard.vue`**

In `apps/ui/app/board/WidgetBoard.vue`:
- import line 6: `import { describeSource } from '../widgets/catalog'`;
- props: `const props = defineProps<{ roomId: string; themeId: string; draftSource: WidgetSource }>()`;
- delete `const draftSource: WidgetSource = …` and `const sizing = placeholderManifest.sizing`; add after `emptyScreen`:
  ```ts
  const draftSizing = computed(() => describeSource(props.draftSource)?.sizing ?? null)
  ```
- `sizingOf`:
  ```ts
  function sizingOf(instance: WidgetInstance) {
    return describeSource(instance.source)?.sizing ?? null
  }
  ```
- in `useActiveRect({ … })`: `sizing: () => (editing.value ? activeSizing.value : draftSizing.value),`
- in `start()`, replace the first lines up to the `if (!rect)` check:
  ```ts
  function start() {
    emit('notice', null)
    const sizing = draftSizing.value
    const others = doc.value.layout
    const rect = sizing && (findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others))
  ```
- in `confirmBuild()`: `instances: [...doc.value.instances, { id, source: { ...props.draftSource }, configVersion: 1, config: {} }],`
- the draft `<WidgetHost :source="draftSource" …>` in the template stays as is (it now reads the prop).

- [ ] **Step 6: Write `PackagesDialog.vue`**

`apps/ui/app/widgets/PackagesDialog.vue`:

```vue
<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import type { PackageInspection, WidgetPermission } from '@lifedashboard/contracts/widget-package'
import { api, type ApiFailure } from '../api'
import { installedPackages, loadPackages, readPackageFile } from './catalog'

const open = defineModel<boolean>('open', { required: true })

const PERMISSIONS: Record<WidgetPermission, string> = {
  state: 'Хранить собственные данные виджета',
  notifications: 'Показывать уведомления',
}
const VERSION_CONFLICT = 'Эта версия уже установлена с другим содержимым'

// Template ref keys differ from setup bindings (see WidgetBoard.vue).
const dialog = useTemplateRef<HTMLDialogElement>('dialogBox')
const fileInput = useTemplateRef<HTMLInputElement>('fileBox')
const message = ref<string | null>(null)
const busy = ref(false)
// The chosen file and what the API says about it; the permissions screen shows while it is set.
const pending = ref<{ body: unknown; inspection: PackageInspection } | null>(null)

const manifest = computed(() => pending.value?.inspection.manifest ?? null)
const isUpdate = computed(() => installedPackages.value.some((pkg) => pkg.id === manifest.value?.id))

function permissionList(permissions: readonly WidgetPermission[]): string {
  return permissions.map((permission) => PERMISSIONS[permission]).join(', ')
}

function failureText(failure: ApiFailure, conflict: string): string {
  if (failure.kind === 'invalid') return `Пакет отклонён: ${failure.message}`
  if (failure.kind === 'conflict') return conflict
  return 'Не удалось связаться с API'
}

watch(
  open,
  (value) => {
    if (!value) {
      dialog.value?.close()
      return
    }
    message.value = null
    pending.value = null
    void loadPackages(api)
    dialog.value?.showModal()
  },
  { flush: 'post' },
)

async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  message.value = null
  const read = await readPackageFile(file)
  if (!read.ok) {
    message.value = read.message
    return
  }
  busy.value = true
  const result = await api.inspectPackage(read.body)
  busy.value = false
  if (result.ok) pending.value = { body: read.body, inspection: result.data }
  else message.value = failureText(result, VERSION_CONFLICT)
}

async function install() {
  if (!pending.value) return
  busy.value = true
  const result = await api.installPackage(pending.value.body)
  busy.value = false
  if (!result.ok) {
    message.value = failureText(result, VERSION_CONFLICT)
    return
  }
  pending.value = null
  message.value = 'Виджет установлен'
  await loadPackages(api)
}

async function remove(id: string) {
  busy.value = true
  const result = await api.deletePackage(id)
  busy.value = false
  if (!result.ok) {
    message.value = failureText(result, 'Виджет размещён на доске, сначала уберите его с доски')
    return
  }
  message.value = null
  await loadPackages(api)
}
</script>

<template>
  <dialog ref="dialogBox" class="packages" aria-labelledby="packages-title" @close="open = false">
    <template v-if="pending && manifest">
      <h2 id="packages-title" class="packages__title">Установка виджета</h2>
      <dl class="packages__facts">
        <dt>Название</dt>
        <dd>{{ manifest.title }}</dd>
        <dt>Автор</dt>
        <dd>{{ manifest.author }}</dd>
        <dt>Версия</dt>
        <dd>{{ manifest.version }}</dd>
        <dt>Размер</dt>
        <dd>
          от {{ manifest.sizing.min.w }}×{{ manifest.sizing.min.h }} до {{ manifest.sizing.max.w }}×{{ manifest.sizing.max.h }}
        </dd>
      </dl>
      <p class="packages__warning">Это код стороннего автора</p>
      <h3 class="packages__subtitle">Разрешения</h3>
      <ul class="packages__permissions">
        <li v-for="permission in manifest.permissions" :key="permission">{{ PERMISSIONS[permission] }}</li>
        <li v-if="manifest.permissions.length === 0">Без разрешений</li>
      </ul>
      <p v-if="isUpdate && pending.inspection.newPermissions.length > 0" class="packages__warning">
        Новые разрешения: {{ permissionList(pending.inspection.newPermissions) }}
      </p>
      <p v-if="pending.inspection.installed">Эта версия уже установлена</p>
      <div class="packages__actions">
        <button type="button" class="packages__button" :disabled="busy" @click="install">Установить</button>
        <button type="button" class="packages__button" :disabled="busy" @click="pending = null">Отмена</button>
      </div>
    </template>
    <template v-else>
      <h2 id="packages-title" class="packages__title">Виджеты</h2>
      <p v-if="installedPackages.length === 0">Пакеты не установлены</p>
      <ul v-else class="packages__list">
        <li v-for="pkg in installedPackages" :key="pkg.id" class="packages__item">
          <span class="packages__name">{{ pkg.title }}</span>
          <span>{{ pkg.author }}</span>
          <span>{{ pkg.versions.map((item) => item.version).join(', ') }}</span>
          <span>{{ permissionList(pkg.grants) || 'Без разрешений' }}</span>
          <button type="button" class="packages__button" :disabled="busy" @click="remove(pkg.id)">Удалить</button>
        </li>
      </ul>
      <div class="packages__actions">
        <button type="button" class="packages__button" :disabled="busy" @click="fileInput?.click()">Установить из файла</button>
        <button type="button" class="packages__button" @click="open = false">Закрыть</button>
      </div>
      <input ref="fileBox" type="file" accept=".json,application/json" hidden @change="chooseFile" />
    </template>
    <p class="packages__message" role="status">{{ message }}</p>
  </dialog>
</template>

<style scoped>
.packages {
  width: 36rem;
  max-width: calc(100vw - 2rem);
  padding: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.packages::backdrop {
  background: var(--ld-scrim);
}

.packages__title {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}

.packages__subtitle {
  margin: 1rem 0 0.5rem;
  font-size: 1rem;
}

.packages__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
}

.packages__facts dt {
  color: var(--ld-text-muted);
}

.packages__facts dd {
  margin: 0;
}

.packages__warning {
  color: var(--ld-warning-text);
}

.packages__permissions,
.packages__list {
  margin: 0;
  padding: 0 0 0 1.25rem;
}

.packages__list {
  padding: 0;
  list-style: none;
}

.packages__item {
  display: grid;
  grid-template-columns: 1fr auto auto auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: var(--ld-border-width) solid var(--ld-border-subtle);
}

.packages__name {
  font-weight: var(--ld-weight-strong);
}

.packages__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.packages__button {
  height: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.packages__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.packages__button:disabled {
  cursor: default;
  opacity: 0.5;
}

.packages__message {
  min-height: 1.25rem;
  margin: 1rem 0 0;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}
</style>
```

- [ ] **Step 7: Wire the picker and the dialog into `app.vue`**

In `apps/ui/app/app.vue` `<script setup>`:
- add imports:
  ```ts
  import type { WidgetSource } from '@lifedashboard/contracts/board'
  import { installedPackages, loadPackages, pickerEntries } from './widgets/catalog'
  import PackagesDialog from './widgets/PackagesDialog.vue'
  ```
- add after `const boardRef = …`:
  ```ts
  // The widget the next build draft places; set by the «Добавить виджет» picker.
  const draftSource = ref<WidgetSource>({ kind: 'builtin', type: 'placeholder' })
  const packagesOpen = ref(false)
  const entries = computed(() => pickerEntries(installedPackages.value))

  function pickWidget(event: Event) {
    const select = event.target as HTMLSelectElement
    const entry = entries.value.find((item) => item.key === select.value)
    select.value = ''
    if (!entry) return
    draftSource.value = entry.source
    mode.value = 'build'
  }
  ```
- in `check()`, replace `if (result.state === 'ready') roomId.value = result.roomId` with:
  ```ts
    if (result.state === 'ready') {
      roomId.value = result.roomId
      void loadPackages(api)
    }
  ```

In the template, replace the «+» `<button … aria-label="Добавить виджет" …>+</button>` (keep the comment above it) with:

```html
            <select
              class="app__select"
              aria-label="Добавить виджет"
              :disabled="!boardRef?.loaded"
              @change="pickWidget"
            >
              <option value="" selected>Добавить виджет…</option>
              <option v-for="entry in entries" :key="entry.key" :value="entry.key">{{ entry.title }}</option>
            </select>
```

after the «Изменить» button add:

```html
            <button type="button" class="app__button" @click="packagesOpen = true">Виджеты</button>
```

add `:draft-source="draftSource"` to `<WidgetBoard …>`, and after `</main>` add:

```html
      <PackagesDialog v-if="state === 'ready'" v-model:open="packagesOpen" />
```

- [ ] **Step 8: Run the UI suite and typecheck**

Run: `pnpm -C apps/ui exec vitest run && pnpm -C apps/ui typecheck`
Expected: PASS, no type errors. A placed package widget still shows «Неизвестный виджет» until Task 12.

- [ ] **Step 9: Commit**

```bash
git add apps/ui/app/widgets/catalog.ts apps/ui/app/widgets/PackagesDialog.vue apps/ui/app/board/WidgetBoard.vue apps/ui/app/app.vue apps/ui/test/catalog.test.ts
git commit -m "feat(ui): install widget packages and pick them for the board"
```

---

### Task 12: Widget runtime in the UI — in-process host, sandbox frame, toasts

**Files:**
- Create: `apps/ui/app/toasts.ts`, `apps/ui/test/toasts.test.ts`, `apps/ui/app/widgets/context.ts`, `apps/ui/app/widgets/SandboxWidget.vue`
- Modify: `apps/ui/app/widgets/WidgetHost.vue`, `apps/ui/app/widgets/builtin/PlaceholderWidget.vue`, `apps/ui/app/board/WidgetBoard.vue`, `apps/ui/app/app.vue`

**Interfaces:**
- Consumes: `createGatewayClient`, `listenForHello`, `createBridge`, `Bridge`, `GatewayClient` (Task 10); `describeSource` (Task 11); `provideInProcessWidget`, `useWidget` (Task 6); `sizeClass`, `WidgetContext`, `BRIDGE_LIMITS` (Task 2); `REQUIRED_TOKENS`, `OPTIONAL_TOKENS` (`apps/ui/app/theme/contract.ts`); `themeMeta` (`apps/ui/app/theme/builtin.ts`).
- Produces (`apps/ui/app/toasts.ts`): `interface Toast { id: number; source: string; title: string; body: string }`, `const toasts: Ref<Toast[]>`, `function showToast(message: Omit<Toast, 'id'>): void` (6 s).
- Produces (`apps/ui/app/widgets/context.ts`): `function readThemeTokens(el: Element): Record<string, string>`; `function useWidgetContext(source: { size: () => Size; themeId: () => string; config: () => Record<string, unknown>; frame: () => Element | null }): WidgetContext` (reactive; call in `setup()`).
- Produces (`WidgetHost.vue`): props `source`, `size`, `themeId`, `widgetId?`, `config?`. Without `widgetId`: a static title card. Built-in with `widgetId`: renderer with the in-process widget (session on the first gateway call). Package with `widgetId`: `SandboxWidget`.
- Produces (`SandboxWidget.vue`): props `widgetId`, `hash`, `title`, `context`; states `loading` → `ready` | `error` («Ошибка виджета», «Повторить»).

- [ ] **Step 1: Write the failing test**

`apps/ui/test/toasts.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { showToast, toasts } from '../app/toasts'

afterEach(() => {
  vi.useRealTimers()
})

describe('showToast', () => {
  it('shows a widget notification labeled with the widget and hides it after 6 s', () => {
    vi.useFakeTimers()
    showToast({ source: 'Привет', title: 'Напоминание', body: 'Счётчик: 1' })
    expect(toasts.value).toEqual([{ id: expect.any(Number), source: 'Привет', title: 'Напоминание', body: 'Счётчик: 1' }])
    vi.advanceTimersByTime(5_999)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/ui exec vitest run test/toasts.test.ts`
Expected: FAIL — `Cannot find module '../app/toasts'`.

- [ ] **Step 3: Write `toasts.ts`**

`apps/ui/app/toasts.ts`:

```ts
import { ref } from 'vue'

export interface Toast {
  id: number
  // The widget title: the user sees which widget speaks.
  source: string
  title: string
  body: string
}

const TOAST_MS = 6000
let nextId = 0

export const toasts = ref<Toast[]>([])

/** Shows a widget notification in web mode (the Tauri notification plugin replaces it at E7). */
export function showToast(message: Omit<Toast, 'id'>): void {
  const toast = { ...message, id: nextId++ }
  toasts.value = [...toasts.value, toast]
  setTimeout(() => {
    toasts.value = toasts.value.filter((item) => item.id !== toast.id)
  }, TOAST_MS)
}
```

Run: `pnpm -C apps/ui exec vitest run test/toasts.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the widget context**

`apps/ui/app/widgets/context.ts`:

```ts
import { nextTick, onMounted, onUnmounted, reactive, watch } from 'vue'
import type { Size } from '@lifedashboard/contracts/grid'
import { sizeClass, type WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { themeMeta } from '../theme/builtin'
import { OPTIONAL_TOKENS, REQUIRED_TOKENS } from '../theme/contract'

const TOKEN_NAMES = [...Object.keys(REQUIRED_TOKENS), ...Object.keys(OPTIONAL_TOKENS)].map((name) => `--ld-${name}`)

/** Resolved theme tokens (docs/theme-contract.md) on a widget frame; a sandbox frame inherits nothing. */
export function readThemeTokens(el: Element): Record<string, string> {
  const style = getComputedStyle(el)
  const tokens: Record<string, string> = {}
  for (const name of TOKEN_NAMES) {
    const value = style.getPropertyValue(name).trim()
    if (value) tokens[name] = value
  }
  return tokens
}

function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
}

/** The reactive WidgetContext of one widget; both hosts read it. Call inside setup(). */
export function useWidgetContext(source: {
  size: () => Size
  themeId: () => string
  config: () => Record<string, unknown>
  frame: () => Element | null
}): WidgetContext {
  const initial = source.size()
  const context = reactive<WidgetContext>({
    size: { w: initial.w, h: initial.h },
    sizeClass: sizeClass(initial),
    theme: { id: source.themeId(), scheme: themeMeta(source.themeId()).mode, tokens: {} },
    rootFontSize: 16,
    config: source.config(),
    locale: navigator.language,
    visible: document.visibilityState === 'visible',
  })

  // Tokens are read after the frame re-renders with the new theme class.
  async function readTheme() {
    await nextTick()
    const id = source.themeId()
    const frame = source.frame()
    context.theme = { id, scheme: themeMeta(id).mode, tokens: frame ? readThemeTokens(frame) : {} }
  }

  const onResize = () => {
    context.rootFontSize = rootFontSize()
  }
  const onVisibility = () => {
    context.visible = document.visibilityState === 'visible'
  }

  watch(
    () => [source.size().w, source.size().h] as const,
    ([w, h]) => {
      context.size = { w, h }
      context.sizeClass = sizeClass({ w, h })
    },
  )
  watch(source.config, (config) => {
    context.config = config
  })
  watch(source.themeId, readTheme)
  onMounted(() => {
    onResize()
    void readTheme()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVisibility)
  })
  return context
}
```

- [ ] **Step 5: Write `SandboxWidget.vue`**

`apps/ui/app/widgets/SandboxWidget.vue`:

```vue
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { BRIDGE_LIMITS, type WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { api } from '../api'
import { showToast } from '../toasts'
import { createBridge, createGatewayClient, listenForHello, type Bridge, type GatewayClient } from './broker'

const props = defineProps<{ widgetId: string; hash: string; title: string; context: WidgetContext }>()

const state = ref<'loading' | 'ready' | 'error'>('loading')
const showFrame = ref(false)
const iframe = useTemplateRef<HTMLIFrameElement>('frameBox')
let client: GatewayClient | null = null
let bridge: Bridge | null = null
let stopWaiting: (() => void) | null = null
let helloTimer: ReturnType<typeof setTimeout> | undefined
let loads = 0

// The context is JSON; a reactive proxy cannot be structured-cloned into the frame.
function snapshot(): WidgetContext {
  return JSON.parse(JSON.stringify(props.context)) as WidgetContext
}

// Spec «Sandbox host» step 4: close the port, end the session, remove the iframe.
function teardown() {
  clearTimeout(helloTimer)
  stopWaiting?.()
  stopWaiting = null
  bridge?.close()
  bridge = null
  void client?.close()
  client = null
  showFrame.value = false
}

function fail() {
  teardown()
  state.value = 'error'
}

async function start() {
  teardown()
  state.value = 'loading'
  loads = 0
  const current = createGatewayClient({
    api,
    widgetId: props.widgetId,
    onNotify: (message) => showToast({ source: props.title, ...message }),
    onSessionLost: () => {
      if (client === current) fail()
    },
  })
  client = current
  const started = await current.start()
  if (client !== current) {
    // Unmounted or restarted while the session was created.
    void current.close()
    return
  }
  if (!started) return fail()
  showFrame.value = true
  await nextTick()
  if (client !== current) return
  const frameWindow = iframe.value?.contentWindow
  if (!frameWindow) return fail()
  helloTimer = setTimeout(fail, BRIDGE_LIMITS.helloTimeoutMs)
  stopWaiting = listenForHello(frameWindow, () => connect(frameWindow, current))
}

function connect(frameWindow: Window, current: GatewayClient) {
  clearTimeout(helloTimer)
  stopWaiting = null
  const channel = new MessageChannel()
  frameWindow.postMessage({ t: 'ld:init', context: snapshot() }, '*', [channel.port2])
  bridge = createBridge(channel.port1, { call: current.call, onError: fail, onClose: fail })
  state.value = 'ready'
}

// The first load is the package document; another one means the frame navigated itself.
// ponytail: not audited; the API has no host-event route in this slice (spec «RPC bridge» step 6).
function onLoad() {
  loads += 1
  if (loads > 1) fail()
}

watch(
  () => JSON.stringify(props.context),
  (json) => bridge?.push(JSON.parse(json) as WidgetContext),
)

onMounted(start)
onUnmounted(teardown)
</script>

<template>
  <div class="sandbox">
    <!-- Same color-scheme as the frame document, or the browser paints an opaque backdrop. -->
    <iframe
      v-if="showFrame"
      ref="frameBox"
      class="sandbox__frame"
      :class="{ 'sandbox__frame--waiting': state !== 'ready' }"
      sandbox="allow-scripts"
      :src="`/sandbox/packages/${hash}/`"
      :title="title"
      :style="{ colorScheme: context.theme.scheme }"
      @load="onLoad"
    />
    <p v-if="state === 'loading'" class="sandbox__status">Загрузка…</p>
    <div v-else-if="state === 'error'" class="sandbox__status" role="alert">
      <p class="sandbox__text">Ошибка виджета</p>
      <button type="button" class="sandbox__retry" @click="start">Повторить</button>
    </div>
  </div>
</template>

<style scoped>
.sandbox {
  position: relative;
  height: 100%;
}

.sandbox__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}

.sandbox__frame--waiting {
  visibility: hidden;
}

.sandbox__status {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
  text-align: center;
}

.sandbox__text {
  margin: 0;
}

.sandbox__retry {
  height: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.sandbox__retry:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
```

- [ ] **Step 6: Rewrite `WidgetHost.vue` and the placeholder**

Replace `apps/ui/app/widgets/WidgetHost.vue`:

```vue
<script setup lang="ts">
import { computed, onUnmounted, useTemplateRef } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import type { Size } from '@lifedashboard/contracts/grid'
import { provideInProcessWidget } from '@lifedashboard/widget-sdk'
import { api } from '../api'
import { showToast } from '../toasts'
import { createGatewayClient } from './broker'
import { describeSource } from './catalog'
import { useWidgetContext } from './context'
import { builtinWidgetRenderers } from './registry'
import SandboxWidget from './SandboxWidget.vue'
import WidgetFrame from './WidgetFrame.vue'

// Without a widgetId (the build draft) the host shows a static title card: no session, no sandbox.
// The runtime starts once the board save gave the widget an id.
const props = defineProps<{
  source: WidgetSource
  size: Size
  themeId: string
  widgetId?: string
  config?: Record<string, unknown>
}>()

const frame = useTemplateRef<{ $el: Element }>('frameBox')
const info = computed(() => describeSource(props.source))
const title = computed(() => info.value?.title ?? 'Неизвестный виджет')
const renderer = computed(() => (props.source.kind === 'builtin' ? builtinWidgetRenderers.get(props.source.type) : undefined))
const context = useWidgetContext({
  size: () => props.size,
  themeId: () => props.themeId,
  config: () => props.config ?? {},
  frame: () => frame.value?.$el ?? null,
})

// A placed built-in widget runs in-process behind the same broker client as a sandboxed one;
// its widget session is created on the first gateway call.
if (props.widgetId && props.source.kind === 'builtin') {
  const client = createGatewayClient({
    api,
    widgetId: props.widgetId,
    onNotify: (message) => showToast({ source: title.value, ...message }),
    // ponytail: no error state for built-ins; the rejected call reaches the widget. Add one with the first built-in that uses the gateway.
    onSessionLost: () => {},
  })
  provideInProcessWidget({ call: client.call, context })
  onUnmounted(() => void client.close())
}
</script>

<template>
  <WidgetFrame ref="frameBox" :theme-id="themeId">
    <div v-if="!widgetId" class="grid place-items-center h-full text-center text-base font-strong text-secondary">{{ title }}</div>
    <component :is="renderer" v-else-if="renderer" />
    <SandboxWidget v-else-if="info?.hash" :widget-id="widgetId" :hash="info.hash" :title="title" :context="context" />
    <div v-else class="grid place-items-center h-full text-center text-sm text-muted">Неизвестный виджет</div>
  </WidgetFrame>
</template>
```

Replace `apps/ui/app/widgets/builtin/PlaceholderWidget.vue`:

```vue
<script setup lang="ts">
import { useWidget } from '@lifedashboard/widget-sdk'

// The size comes from useWidget(), like in an installed package (acceptance 6).
const { context } = useWidget()
</script>

<template>
  <div class="grid place-items-center h-full text-2xl font-strong text-secondary">{{ context.size.w }}×{{ context.size.h }}</div>
</template>
```

- [ ] **Step 7: Pass the instance to the host and silence frames while building**

In `apps/ui/app/board/WidgetBoard.vue`:
- the placed widget host becomes:
  ```html
  <WidgetHost
    class="board__content"
    :source="instance.source"
    :size="placement"
    :theme-id="themeId"
    :widget-id="instance.id"
    :config="instance.config"
  />
  ```
- in `<style scoped>`, replace the `/* Widget content stays inert … */` rule with:
  ```css
  /* Widget content (sandbox iframes included) stays inert while the board is built or edited, so a drag never reaches it. */
  .board__grid--building .board__content,
  .board__item--editable .board__content {
    pointer-events: none;
  }
  ```

- [ ] **Step 8: Show toasts in `app.vue`**

In `apps/ui/app/app.vue`:
- import `import { toasts } from './toasts'`;
- after `<p class="app__narrow">Окно слишком узкое</p>` add:
  ```html
  <ul class="app__toasts" aria-live="polite">
    <li v-for="toast in toasts" :key="toast.id" class="app__toast">
      <p class="app__toast-source">{{ toast.source }}</p>
      <p class="app__toast-title">{{ toast.title }}</p>
      <p v-if="toast.body" class="app__toast-body">{{ toast.body }}</p>
    </li>
  </ul>
  ```
- add to `<style>` before the `@media` block:
  ```css
  .app__toasts {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    display: grid;
    gap: 0.5rem;
    width: 20rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .app__toast {
    padding: 0.75rem 1rem;
    border: var(--ld-border-width) solid var(--ld-border-default);
    border-radius: var(--ld-radius-card);
    background: var(--ld-surface-1-solid);
    color: var(--ld-text-primary);
  }

  .app__toast p {
    margin: 0;
  }

  .app__toast-source {
    color: var(--ld-text-muted);
    font-size: 0.75rem;
  }

  .app__toast-title {
    font-weight: var(--ld-weight-strong);
  }

  .app__toast-body {
    font-size: 0.875rem;
  }
  ```

- [ ] **Step 9: Run the UI suite, typecheck and build**

Run: `pnpm -C apps/ui exec vitest run && pnpm -C apps/ui typecheck && pnpm -C apps/ui build`
Expected: PASS, no type errors, the static build succeeds.

- [ ] **Step 10: Smoke-check in the browser**

Run `pnpm dev` in a background terminal with `LIFEDASHBOARD_DATA_DIR="$(mktemp -d)"`. Load the `orca-cli` skill and use Orca's built-in browser: pair, pick «Заглушка» in «Добавить виджет…»: the draft card shows «Заглушка»; after «Готово» the card shows `4×4` (the in-process `useWidget()`). Install `examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json` through «Виджеты» → «Установить из файла» → «Установить», place «Привет»: after «Загрузка…» the frame shows `0`, «+1» raises it. Stop `pnpm dev`. Full acceptance runs in Task 14; a failure here is fixed in this task.

- [ ] **Step 11: Commit**

```bash
git add apps/ui/app/toasts.ts apps/ui/test/toasts.test.ts apps/ui/app/widgets/context.ts apps/ui/app/widgets/SandboxWidget.vue apps/ui/app/widgets/WidgetHost.vue apps/ui/app/widgets/builtin/PlaceholderWidget.vue apps/ui/app/board/WidgetBoard.vue apps/ui/app/app.vue
git commit -m "feat(ui): run built-in widgets in-process and packages in a sandbox frame"
```

---
### Task 13: Base design and README

**Files:**
- Modify: `docs/base-2026-10-04-lifegamehermes-design.md`, `README.md`

**Interfaces:** none (documentation). No application tests (documentation-only change); the check is a text review against the spec's «Deviations from the base design».

- [ ] **Step 1: Edit the base design (Russian, as the document is)**

In `docs/base-2026-10-04-lifegamehermes-design.md`:

1. **ARCH-08** (the paragraph starting `**ARCH-08.**`, §2) — replace the whole paragraph with:
   ```markdown
   **ARCH-08.** Виджеты, встроенные в сборку приложения, выполняются в контексте Nuxt UI. Установленные пакеты виджетов (`*.ldwidget.json`), включая собственные пакеты владельца, выполняются в sandbox-iframe (`sandbox="allow-scripts"`, без `allow-same-origin`) с документом, который отдаёт Fastify со строгой CSP. Пакет не получает cookies, DOM и storage дашборда и не обращается к API напрямую: данные и действия доступны только через widget gateway Fastify — по правам, принятым при установке, и по widget session, которую создаёт хост, а не виджет (`docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md`). Hermes key и секреты остаются в Fastify (ARCH-01). Остаточные риски — §13.6. ARCH-06 сохраняется: код виджета не получает shell endpoint и вызывает только зарегистрированные Actions.
   ```
2. **§4.1** — the `widget-sdk/` line of the tree becomes:
   ```text
       widget-sdk/               # useWidget(), sandbox runtime, ld-widget CLI
   ```
3. **§7.7** — replace the heading and the whole section body (up to `## 7.8.`) with:
   ```markdown
   ## 7.7. Пакеты виджетов и Widget SDK

   Код пользовательского виджета поставляется пакетом `*.ldwidget.json` до 1 MB: манифест (id, версия, название, автор, `sizing`, разрешения) и собранные файлы JS/CSS. Формат, установка и runtime — `docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md`.

   - **Сборка у разработчика.** Vue SFC собирается командой `ld-widget build` (Vite; `vue` и `@lifedashboard/widget-sdk` — внешние модули). Fastify не компилирует код: при установке он проверяет пакет и хранит файлы в SQLite по sha256. Runtime-компиляция шаблонов в браузере и CSP `unsafe-eval` не используются.
   - **Установка.** Пользователь выбирает файл и видит экран разрешений с предупреждением «Это код стороннего автора». Версии неизменяемы; размещённый виджет остаётся на своей версии; новая версия с новыми разрешениями снова показывает экран разрешений.
   - **Исполнение.** Встроенные виджеты работают in-process; установленные пакеты — в sandbox-iframe с мостом `postMessage` + `MessagePort` (ARCH-08).
   - **Widget SDK** (`useWidget()`) одинаков для обоих видов; все методы асинхронные:
     - `context` — `size`, `sizeClass`, `theme`, `rootFontSize`, `config`, `locale`, `visible`;
     - `state.get()` / `state.set(data, expectedRevision)` — `WidgetState` экземпляра с проверкой ревизии;
     - `notify({ title, body })` — уведомление, которое показывает хост;
     - `call(op, input)` — остальные операции gateway. Data sources (§7.8), `http.get` через прокси, AI-запросы и Actions добавляются следующими подпроектами.
   - **Отказоустойчивость.** Исключение в пакете переводит в `error` только его фрейм; встроенный виджет обёрнут в error boundary (`onErrorCaptured`). Зависание фрейма изоляцией не предотвращается (§13.6).
   ```
4. **§13.3** — replace the row `| Выполнить код \`component\`-виджета | … |` with two rows:
   ```markdown
   | Выполнить код установленного пакета виджета | Разрешено после экрана разрешений; выполняется в sandbox-iframe (ARCH-08, §13.6) |
   | Операция widget gateway | Только по разрешению пакета (`state`, `notifications`), с rate limit и audit; встроенные виджеты — по своему манифесту |
   ```
5. **§13.6** — replace the heading and the section body (up to the `---` before §14) with:
   ```markdown
   ## 13.6. Пакеты виджетов: остаточный риск

   Установленные пакеты изолированы sandbox-iframe и widget gateway (ARCH-08). Изоляция не закрывает:

   - Бесконечный цикл или тяжёлые вычисления во фрейме могут заморозить дашборд, если WebView исполняет фрейм в том же процессе; watchdog невозможен.
   - Фрейм может один раз перейти на внешний URL и унести данные, которые у него есть. Хост замечает второй `load` и удаляет фрейм, но запрос уже ушёл. Пакет держит только своё состояние и config.
   - Установка чужого пакета — запуск чужого кода с выданными ему правами gateway.

   Обязательные меры: экран разрешений и предупреждение при установке; неизменяемые версии; серверная проверка прав, лимиты и audit каждой операции gateway; Hermes key и секреты остаются на сервере; ARCH-06. План E7 проверяет, что `invoke` Tauri недоступен из фрейма пакета на macOS и Windows, а capabilities ограничены главным окном.
   ```
6. **§18.1** — delete the sentence `Изоляция \`component\`-виджетов (sandbox-iframe с мостом) — по отдельному ADR, если появится обмен виджетами между людьми.`
7. **§19.1** — replace the row `| Сгенерированный код виджета действует с правами UI | … |` with:
   ```markdown
   | Код пакета виджета зависает или уводит фрейм на внешний URL | Sandbox-iframe и widget gateway (ARCH-08); остаточный риск §13.6 |
   ```
8. **§20.4** — append after the last version entry (use the next version number after the last one present):
   ```markdown
   **v1.2 — 08.10.2026.** Пакеты виджетов `*.ldwidget.json` в sandbox-iframe с widget gateway вместо исполнения без изоляции (ARCH-08, §7.7, §13.3, §13.6, §18.1, §19.1); `widget-sdk` создан до E6 (§4.1). Спецификация: `docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md`.
   ```

Check: `grep -n "без sandbox-iframe\|принятый риск ARCH-08\|ADR об изоляции\|(E6)" docs/base-2026-10-04-lifegamehermes-design.md` prints nothing that still describes widgets running without isolation. Other mentions of `component`-виджеты in §7.1, §7.5 and the E-stage text stay: sub-project 4 (Hermes-generated packages) revisits them.

- [ ] **Step 2: Describe packages in `README.md`**

In `README.md`:
- in `## Layout`, replace the list with:
  ```markdown
  - `apps/api` — Fastify API: `GET /health`, pairing, rooms and boards, widget packages, widget sessions and the widget gateway in SQLite (`node:sqlite`); sandbox documents under `/sandbox`.
  - `packages/contracts` — grid, board, widget package and gateway contracts shared by the API, the UI and the SDK.
  - `packages/widget-sdk` — `useWidget()`, the sandbox runtime (`dist/sandbox.js`) and the `ld-widget` CLI.
  - `apps/ui` — Nuxt 4 SPA; `/api`, `/health` and `/sandbox` are proxied to the API in development.
  - `examples/widgets` — `hello` (state and a notification) and `hostile` (probes the sandbox boundary).
  ```
- append:
  ````markdown
  ## Widget packages

  An installed widget is a Vue SFC packaged as one `*.ldwidget.json` file. It runs in a sandboxed
  iframe and reaches data only through the API's widget gateway, with the permissions accepted at
  install (`docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md`).

  A widget project holds `widget.json` (the manifest: `id`, `version`, `title`, `author`, `sdk`,
  `entry`, `styles`, `sizing`, `permissions`) and `src/index.vue`. Build it with `ld-widget build`
  (from `@lifedashboard/widget-sdk`):

  ```bash
  pnpm -C examples/widgets/hello build   # → examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json
  ```

  Widget code imports only `vue` and `@lifedashboard/widget-sdk`: `useWidget()` gives `context`
  (size, `sizeClass`, theme, `rootFontSize`, config, locale, visibility), `state.get()` /
  `state.set(data, expectedRevision)`, `notify({ title, body })` and `call(op, input)`. Style with the
  theme's `var(--ld-…)` tokens; UnoCSS classes are not available in the sandbox.

  Install: «Виджеты» → «Установить из файла», check the permissions screen, «Установить». Place it
  from «Добавить виджет…». A package with widgets on the board cannot be deleted.

  `pnpm dev` also rebuilds the sandbox runtime `packages/widget-sdk/dist/sandbox.js`, which the API
  serves at `/sandbox/runtime/sdk.js`; `pnpm build` builds it once.
  ````

- [ ] **Step 3: Commit**

```bash
git add docs/base-2026-10-04-lifegamehermes-design.md README.md
git commit -m "docs: widget packages in the base design and README"
```

---

### Task 14: Full verification and browser acceptance

**Files:** none changed unless a check fails (then fix in the owning task's files and commit with `fix(scope): …`).

- [ ] **Step 1: Run the whole workspace**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: all three pass for `packages/contracts`, `packages/widget-sdk`, `apps/api`, `apps/ui`; `pnpm build` also builds `packages/widget-sdk/dist/sandbox.js` and both example packages (acceptance 8). Record the test counts for the final report.

- [ ] **Step 2: Start the app on a throwaway data directory**

```bash
export LIFEDASHBOARD_DATA_DIR="$(mktemp -d)"
pnpm dev
```

Run it in a background terminal; note the pairing code. Confirm `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/sandbox/runtime/sdk.js -H 'Host: 127.0.0.1:3001'` prints `200` (the dev build of the runtime is served).

- [ ] **Step 3: Browser acceptance in Orca's built-in browser**

Load the `orca-cli` skill and control Orca's built-in browser through `orca` (project rule: no external browser). Open `http://127.0.0.1:3000`, pair, and check in order:

1. **Install with the permissions screen** — «Виджеты» → «Установить из файла» → `examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json`: the screen shows «Привет», «LifeDashboard», `1.0.0`, «от 2×2 до 6×6», «Хранить собственные данные виджета», «Показывать уведомления», «Это код стороннего автора». «Установить» → the list shows the package. Restart `pnpm dev`, reopen «Виджеты»: the package is still listed (acceptance 2).
2. **Draft card** — pick «Привет» in «Добавить виджет…»: the draft shows the static title «Привет», no iframe exists in the DOM (`orca` snapshot); after «Готово» the frame starts with «Загрузка…» and then shows `0`.
3. **State and notify** — «+1» three times → `3`; reload the page → `3`; restart `pnpm dev` and reload → `3` and the app does not ask for pairing; «Напомнить» shows a toast labeled «Привет» with «Напоминание» / «Счётчик: 3» (acceptance 4).
4. **Conflict from a second tab** — open a second tab, press «+1» there (→ `4`); in the first tab (still showing `3`) press «+1»: the widget shows «Изменено в другой вкладке» and reloads `4` (acceptance 4).
5. **Theme, resize, rem scale** — switch the theme to «Бумага» and back: the frame's text colour follows the theme without a reload; in «Изменить», resize the widget: `data-size` in the frame changes (`m` → `l` at 5×5). At window sizes 1280×700 and 1920×1080, the frame's `getComputedStyle(document.documentElement).fontSize` equals the dashboard's `html` font size (check both documents through `orca`), and the `2rem` counter scales with the placeholder's text (acceptance 3, spec «Theme and size»).
6. **Built-in through `useWidget()`** — a placed «Заглушка» shows its size `w×h` and updates after a resize (acceptance 6).
7. **Hostile package** — build and install `examples/widgets/hostile`, place it next to «Привет» and «Заглушка». Its list shows: `document.cookie → blocked: SecurityError` (or `value: ""`), `parent.document → blocked: SecurityError`, `localStorage → blocked: SecurityError`, `fetch /api/v1/rooms → blocked: TypeError` with a CSP violation in the console, `notifications.send → blocked: PERMISSION_DENIED`. «Ошибка» puts only this frame into «Ошибка виджета» with «Повторить»; «Повторить» brings it back. «Уйти» removes the frame and shows «Ошибка виджета». After each step «Привет» still counts and «Заглушка» still renders (acceptance 5).
8. **Frame attributes** — in the DOM, every widget iframe has exactly `sandbox="allow-scripts"`; the frame document's response has the CSP header from Task 8; no `x-widget-session` value appears inside any frame (search the frame DOM and its `window.name`).
9. **Delete rules** — «Виджеты» → «Удалить» on «Привет» while placed shows «Виджет размещён на доске, сначала уберите его с доски»; remove the widget from the board («Изменить» → × → «Готово»), then «Удалить» succeeds (acceptance 7).
10. **Session renewal without pairing** — place «Привет» again, restart only the API (`pkill -f 'src/server.ts'` and `pnpm -C apps/api dev`), press «+1» in the widget: it works after the broker renews the session; the app does not show the pairing form.

- [ ] **Step 4: Report**

Write the final report in the session: test counts from Step 1, each browser check with pass/fail and evidence (snapshot or screenshot reference), any deviation from the spec (this plan's: `UNAVAILABLE` widget error code; `BRIDGE_CLOSED` is declared but no path produces it, because the host removes the frame whenever it closes the port; `sizeClass` thresholds; built-in widget sessions created on the first gateway call; `provideInProcessWidget` takes the component scope only; toast store `apps/ui/app/toasts.ts` and `apps/ui/app/widgets/context.ts` added beyond the spec's file table; §19.1 and §20.4 edited for consistency), and anything not verified. Do not mark this task done if a check failed.
