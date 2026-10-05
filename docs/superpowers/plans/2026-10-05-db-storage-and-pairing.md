# Board Storage in SQLite Behind a Paired API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the widget board from `localStorage` to SQLite owned by the Fastify API, reachable only after a one-time pairing, with a schema that already has rooms and screens.

**Architecture:** A new workspace package `packages/contracts` holds the grid, board types and validation shared by API and UI. The API opens `node:sqlite`, applies migrations, guards `/api` with Host/Origin/content-type checks and a session cookie created by pairing, and serves `GET /rooms`, `GET`/`PUT /rooms/:roomId/board`. The UI talks to the API through one `fetch` wrapper, shows a pairing form on `401` and saves edit sessions with `expectedRevision`.

**Tech Stack:** Node 24 (`node:sqlite`, `node:crypto`), Fastify 5.12.5, Nuxt 4.5.2 / Vue 3.5, TypeScript 6.0.3 strict, Vitest 5.0.3, pnpm 10.30.2 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-05-db-storage-and-pairing-design.md` (read it before starting; base design: `docs/base-2026-10-04-lifegamehermes-design.md`).

## Global Constraints

- No new external dependencies. `@lifedashboard/contracts` is a workspace package; its dev dependencies reuse the versions already in the lockfile (`typescript` 6.0.3, `vitest` 5.0.3).
- TypeScript strict everywhere. `apps/api` and `packages/contracts` use `erasableSyntaxOnly`: no constructor parameter properties, no `enum`, no `namespace`.
- Relative imports inside `apps/api` and `packages/contracts` carry the `.ts` extension (Node type stripping). UI files import relative modules without extension, as today.
- The UI has `imports.autoImport: false` and `components: false`: import every Vue API and component explicitly.
- The API binds `127.0.0.1` only. Defaults: port `3001`, `LIFEDASHBOARD_UI_ORIGINS=http://127.0.0.1:3000`, database file `lifedashboard.db` in the OS data directory (`~/Library/Application Support/LifeDashboard` on macOS).
- Session: cookie `ld_session`, `HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000`; renew when `expires_at <= now + 29 days`; expired when `expires_at <= now`.
- Pairing code: 6 digits, valid 10 minutes, one successful use, burnt by the 5th wrong attempt; `pair-code` at most once per 10 seconds.
- Error envelope `{ error: { code, message, requestId, retryable } }`; success `{ data, meta: { requestId } }`.
- UI copy (exact strings): «API: проверка…», «API: работает», «API: недоступен», «Подключение…», «Повторить», «Подключение к API», «Код из терминала API», «Войти», «Новый код», «Новый код выведен в терминал API», «Подождите несколько секунд», «Неверный или истёкший код», «Не удалось войти», «Доска изменена в другой вкладке», «Не удалось сохранить: данные отклонены», «Не удалось сохранить, повторите», «Нет свободного места».
- Code, comments, commit messages in English. Commit format `type(scope): subject`, no attribution trailers.
- Run commands from the repository root unless a step says otherwise.

## Review Focus

1. **API restart with a paired browser** — the session must survive a restart because it lives in SQLite. Pinned in Task 5 (`session survives a rebuilt app on the same database`).
2. **Pairing code with leading zeros or surrounding spaces** — `randomInt` can produce `000123`; the user may paste ` 000123 `. Pinned in Task 5 (`randomInt` mocked to `123`: the code is `000123` and ` 000123 ` is accepted).
3. **Saved board reads back with nested config intact, `instances` in the sent order and `layout` in instance order** — the UI compares its working copy with the loaded document by JSON. The UI never orders `layout` differently from `instances` (`setPlacement` maps in place, `removeInstance` filters both, a new widget is appended to both), and the working copy always starts from the server's response. Pinned in Task 6 (`round-trips order and nested config`, `returns the layout in instance order`).
4. **Malformed JSON body on PUT** — must be a `400 VALIDATION_ERROR` envelope, not a `500` or a bare Fastify error. Pinned in Task 6.
5. **Widget id already used by another room** — must be `400` and leave both rooms unchanged, not a `500` from the primary key. Pinned in Task 6.
6. **A background reload finishing after a mode was opened** — it must not replace the snapshot the working copy came from, or a save would carry a newer revision with older content and overwrite another tab (DATA-06). Pinned in Task 8 (`room-sync`: a late load is ignored and the save keeps the old revision).

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `pnpm-workspace.yaml` | 1 | Add `packages/*` |
| `packages/contracts/package.json`, `tsconfig.json` | 1 | Workspace package exporting `./src/*.ts` |
| `packages/contracts/src/grid.ts` | 1 | Moved from `apps/ui/app/widgets/grid.ts` unchanged |
| `packages/contracts/src/board.ts` | 1 | Board types, `isUuid`, `parseScreenBoard` |
| `packages/contracts/src/api.ts` | 1 | Error codes, envelopes, `PairRequest` |
| `packages/contracts/test/grid.test.ts`, `board.test.ts` | 1 | Moved and new tests |
| `apps/api/src/config.ts` | 2 | `dataDir`, `uiOrigins` |
| `apps/api/src/migrations.ts`, `db.ts` | 3 | Schema, seed, migrations, backup |
| `apps/api/src/errors.ts` | 4 | `ApiError`, `ok`, error and not-found handlers |
| `apps/api/src/auth.ts` | 5 | Request checks, pairing, sessions |
| `apps/api/src/app.ts`, `server.ts` | 4, 5, 6 | Composition and startup |
| `apps/api/src/rooms.ts` | 6 | Room list and board routes |
| `apps/api/test/helpers.ts` | 5 | Test app and request helpers |
| `README.md`, `.env.example` | 6 | Variables and pairing |
| `apps/ui/app/api.ts` | 7 | `fetch` wrapper |
| `apps/ui/app/board/room-sync.ts` | 8 | First room lookup, board load and save outcomes, ignoring late loads |
| `apps/ui/app/PairingForm.vue`, `app.vue` | 8, 9 | App states and pairing |
| `apps/ui/app/board/edit-session.ts`, `WidgetBoard.vue` | 9 | Board on the API |
| `apps/ui/app/widgets/board-document.ts` | 9 | Deleted |

---

### Task 1: `packages/contracts` with grid and board validation

**Files:**
- Modify: `pnpm-workspace.yaml`, `apps/api/package.json`, `apps/ui/package.json`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/board.ts`, `packages/contracts/src/api.ts`, `packages/contracts/test/board.test.ts`
- Move: `apps/ui/app/widgets/grid.ts` → `packages/contracts/src/grid.ts`; `apps/ui/test/grid.test.ts` → `packages/contracts/test/grid.test.ts`
- Modify imports: `apps/ui/app/widgets/catalog.ts`, `apps/ui/app/widgets/board-document.ts`, `apps/ui/app/widgets/WidgetHost.vue`, `apps/ui/app/board/edit-session.ts`, `apps/ui/app/board/use-active-rect.ts`, `apps/ui/app/board/WidgetBoard.vue`, `apps/ui/test/use-active-rect.test.ts`

**Interfaces:**
- Produces (`@lifedashboard/contracts/grid`): `GRID`, `Size`, `Rect`, `SizeLimits`, `inBounds`, `overlaps`, `isFree`, `findFreeRect`, `moveTo`, `resizeTo` — unchanged signatures.
- Produces (`@lifedashboard/contracts/board`):
  ```ts
  type WidgetSource = { kind: 'builtin'; type: string }
  interface WidgetInstance { id: string; source: WidgetSource; configVersion: number; config: Record<string, unknown> }
  interface WidgetPlacement extends Rect { instanceId: string }
  interface ScreenBoard { id: string; instances: WidgetInstance[]; layout: WidgetPlacement[] }
  interface RoomBoard { roomId: string; revision: number; screens: ScreenBoard[] }
  interface RoomSummary { id: string; title: string; position: number; revision: number }
  interface SaveBoardRequest { expectedRevision: number; screens: ScreenBoard[] }
  type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }
  function isUuid(value: unknown): value is string
  function parseScreenBoard(raw: unknown): ParseResult<ScreenBoard>
  ```
- Produces (`@lifedashboard/contracts/api`): `ErrorCode`, `SuccessEnvelope<T>`, `ErrorEnvelope`, `PairRequest`.

- [ ] **Step 1: Create the package skeleton and move the grid**

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*

saveExact: true

onlyBuiltDependencies:
  - esbuild
ignoredBuiltDependencies:
  - vue-demi
```

`packages/contracts/package.json`:

```json
{
  "name": "@lifedashboard/contracts",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./src/*.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

`packages/contracts/tsconfig.json`:

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

Move the files with history:

```bash
mkdir -p packages/contracts/src packages/contracts/test
git mv apps/ui/app/widgets/grid.ts packages/contracts/src/grid.ts
git mv apps/ui/test/grid.test.ts packages/contracts/test/grid.test.ts
```

In `packages/contracts/test/grid.test.ts` change the import source `'../app/widgets/grid'` to `'../src/grid.ts'`.

Add `"@lifedashboard/contracts": "workspace:*"` to `dependencies` of `apps/api/package.json` and `apps/ui/package.json` (keep keys sorted: it goes first in both). Then:

```bash
pnpm install
```

Expected: lockfile gains the workspace links, no new registry packages.

- [ ] **Step 2: Switch UI imports of the grid**

Replace the grid import source in each file; the imported names stay the same:

| File | Old source | New source |
| --- | --- | --- |
| `apps/ui/app/widgets/catalog.ts` | `'./grid'` | `'@lifedashboard/contracts/grid'` |
| `apps/ui/app/widgets/board-document.ts` | `'./grid'` | `'@lifedashboard/contracts/grid'` |
| `apps/ui/app/widgets/WidgetHost.vue` | `'./grid'` | `'@lifedashboard/contracts/grid'` |
| `apps/ui/app/board/edit-session.ts` | `'../widgets/grid'` | `'@lifedashboard/contracts/grid'` |
| `apps/ui/app/board/use-active-rect.ts` | `'../widgets/grid'` | `'@lifedashboard/contracts/grid'` |
| `apps/ui/app/board/WidgetBoard.vue` | `'../widgets/grid'` | `'@lifedashboard/contracts/grid'` |
| `apps/ui/test/use-active-rect.test.ts` | `'../app/widgets/grid'` | `'@lifedashboard/contracts/grid'` |

Check nothing else imports the old path:

```bash
grep -rn "widgets/grid\|from './grid'" apps/ui/app apps/ui/test
```

Expected: no output.

- [ ] **Step 3: Run the moved grid tests and the UI suite**

```bash
pnpm -C packages/contracts exec vitest run && pnpm -C apps/ui exec vitest run
```

Expected: PASS (the grid tests run from the new package; UI tests unchanged).

- [ ] **Step 4: Write the failing board validation test**

`packages/contracts/test/board.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isUuid, parseScreenBoard, type ScreenBoard } from '../src/board.ts'

const SCREEN = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const placeholder = { kind: 'builtin', type: 'placeholder' } as const

const valid: ScreenBoard = {
  id: SCREEN,
  instances: [
    { id: A, source: { ...placeholder }, configVersion: 1, config: {} },
    { id: B, source: { ...placeholder }, configVersion: 1, config: { title: 'x', nested: { n: 1 } } },
  ],
  layout: [
    { instanceId: A, x: 0, y: 0, w: 4, h: 4 },
    { instanceId: B, x: 4, y: 0, w: 2, h: 2 },
  ],
}

// Tests mutate a deep copy freely; the parser receives it as unknown input.
function mutated(change: (doc: any) => void): unknown {
  const doc = structuredClone(valid)
  change(doc)
  return doc
}

describe('isUuid', () => {
  it('accepts UUIDs in any case and rejects other values', () => {
    expect(isUuid(A)).toBe(true)
    expect(isUuid(A.toUpperCase())).toBe(true)
    expect(isUuid('a')).toBe(false)
    expect(isUuid(`${A}0`)).toBe(false)
    expect(isUuid(1)).toBe(false)
  })
})

describe('parseScreenBoard', () => {
  it('accepts a valid screen', () => {
    expect(parseScreenBoard(structuredClone(valid))).toEqual({ ok: true, value: valid })
  })

  it('accepts an unknown source.type', () => {
    expect(parseScreenBoard(mutated((d) => { d.instances[0].source.type = 'weather' })).ok).toBe(true)
  })

  it('drops unknown fields', () => {
    const result = parseScreenBoard(mutated((d) => {
      d.extra = 1
      d.instances[0].extra = 1
      d.layout[0].extra = 1
    }))
    expect(result).toEqual({ ok: true, value: valid })
  })

  it.each([
    ['null', null, /must be an object/],
    ['an array', [], /must be an object/],
    ['a non-UUID screen id', mutated((d) => { d.id = 'main' }), /screen id must be a UUID/],
    ['non-array instances', mutated((d) => { d.instances = {} }), /must be arrays/],
    ['a non-UUID instance id', mutated((d) => { d.instances[0].id = 'a' }), /id must be a UUID/],
    ['a duplicate id', mutated((d) => { d.instances[1].id = A }), /duplicate id/],
    ['a custom source', mutated((d) => { d.instances[0].source = { kind: 'custom' } }), /invalid source/],
    ['a missing configVersion', mutated((d) => { delete d.instances[0].configVersion }), /configVersion must be a positive integer/],
    ['a zero configVersion', mutated((d) => { d.instances[0].configVersion = 0 }), /configVersion must be a positive integer/],
    ['a fractional configVersion', mutated((d) => { d.instances[0].configVersion = 1.5 }), /configVersion must be a positive integer/],
    ['a missing config', mutated((d) => { delete d.instances[0].config }), /config must be an object/],
    ['a placement without an instance', mutated((d) => { d.layout[1].instanceId = 'zzz' }), /unknown instanceId "zzz"/],
    ['an instance without a placement', mutated((d) => { d.layout.pop() }), /has no placement/],
    ['two placements of one instance', mutated((d) => { d.layout[1].instanceId = A }), /placed twice/],
    ['an out-of-bounds placement', mutated((d) => { d.layout[1].x = 11 }), /inside the 12x8 grid/],
    ['a non-integer coordinate', mutated((d) => { d.layout[1].x = 1.5 }), /inside the 12x8 grid/],
    ['a string coordinate', mutated((d) => { d.layout[1].x = '4' }), /inside the 12x8 grid/],
    ['a zero width', mutated((d) => { d.layout[1].w = 0 }), /inside the 12x8 grid/],
    ['overlapping placements', mutated((d) => { d.layout[1] = { instanceId: B, x: 2, y: 2, w: 2, h: 2 } }), /overlaps/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseScreenBoard(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

```bash
pnpm -C packages/contracts exec vitest run test/board.test.ts
```

Expected: FAIL — `Cannot find module '../src/board.ts'` (or "Failed to load url").

- [ ] **Step 6: Implement `board.ts` and `api.ts`**

`packages/contracts/src/board.ts`:

```ts
import { GRID, inBounds, overlaps, type Rect } from './grid.ts'

export type WidgetSource = { kind: 'builtin'; type: string }

export interface WidgetInstance {
  id: string
  source: WidgetSource
  // Schema version of `config` (base design §12.2); every widget type starts at 1.
  configVersion: number
  config: Record<string, unknown>
}

export interface WidgetPlacement extends Rect {
  instanceId: string
}

export interface ScreenBoard {
  id: string
  instances: WidgetInstance[]
  layout: WidgetPlacement[]
}

export interface RoomBoard {
  roomId: string
  revision: number
  // Ordered by screen position.
  screens: ScreenBoard[]
}

export interface RoomSummary {
  id: string
  title: string
  position: number
  revision: number
}

export interface SaveBoardRequest {
  expectedRevision: number
  screens: ScreenBoard[]
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

// Single validation point for a screen from outside the process: API requests now, file import later.
export function parseScreenBoard(raw: unknown): ParseResult<ScreenBoard> {
  if (!isRecord(raw)) return fail('screen must be an object')
  if (!isUuid(raw.id)) return fail('screen id must be a UUID')
  if (!Array.isArray(raw.instances) || !Array.isArray(raw.layout)) return fail('instances and layout must be arrays')

  const instances: WidgetInstance[] = []
  const ids = new Set<string>()
  for (const [index, item] of raw.instances.entries()) {
    if (!isRecord(item) || !isUuid(item.id)) return fail(`instances[${index}]: id must be a UUID`)
    if (ids.has(item.id)) return fail(`instances[${index}]: duplicate id "${item.id}"`)
    const source = item.source
    if (!isRecord(source) || source.kind !== 'builtin' || !isNonEmptyString(source.type)) {
      return fail(`instances[${index}]: invalid source`)
    }
    const version = item.configVersion
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return fail(`instances[${index}]: configVersion must be a positive integer`)
    }
    if (!isRecord(item.config)) return fail(`instances[${index}]: config must be an object`)
    ids.add(item.id)
    instances.push({ id: item.id, source: { kind: 'builtin', type: source.type }, configVersion: version, config: item.config })
  }

  const layout: WidgetPlacement[] = []
  const placed = new Set<string>()
  for (const [index, item] of raw.layout.entries()) {
    if (!isRecord(item) || typeof item.instanceId !== 'string' || !ids.has(item.instanceId)) {
      return fail(`layout[${index}]: unknown instanceId ${JSON.stringify(isRecord(item) ? item.instanceId : item)}`)
    }
    if (placed.has(item.instanceId)) return fail(`layout[${index}]: instance "${item.instanceId}" placed twice`)
    const rect = toRect(item)
    if (!rect) {
      return fail(`layout[${index}]: x, y, w, h must be integers with w, h >= 1 inside the ${GRID.cols}x${GRID.rows} grid`)
    }
    if (layout.some((other) => overlaps(other, rect))) return fail(`layout[${index}]: overlaps another placement`)
    placed.add(item.instanceId)
    layout.push({ instanceId: item.instanceId, ...rect })
  }

  const unplaced = instances.find((instance) => !placed.has(instance.id))
  if (unplaced) return fail(`instance "${unplaced.id}" has no placement`)

  return { ok: true, value: { id: raw.id, instances, layout } }
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function toRect(item: Record<string, unknown>): Rect | null {
  const { x, y, w, h } = item
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) return null
  const rect = { x, y, w, h } as Rect
  return inBounds(rect) ? rect : null
}
```

`packages/contracts/src/api.ts`:

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export interface SuccessEnvelope<T> {
  data: T
  meta: { requestId: string }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; requestId: string; retryable: boolean }
}

export interface PairRequest {
  code: string
}
```

- [ ] **Step 7: Run the contracts tests and typecheck**

```bash
pnpm -C packages/contracts exec vitest run && pnpm -C packages/contracts typecheck && pnpm -C apps/ui typecheck && pnpm -C apps/api typecheck
```

Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/contracts apps/api/package.json apps/ui/package.json apps/ui/app apps/ui/test
git commit -m "feat(contracts): shared grid and screen board validation"
```

---

### Task 2: API configuration for data directory and UI origins

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/test/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ApiConfig { host: '127.0.0.1'; port: number; dataDir: string; uiOrigins: string[] }
  function loadConfig(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): ApiConfig
  ```

- [ ] **Step 1: Write the failing tests**

Replace `apps/api/test/config.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

const HOME = '/Users/u'

describe('loadConfig', () => {
  it('defaults to loopback, port 3001, the macOS data directory and the dev UI origin', () => {
    expect(loadConfig({}, 'darwin', HOME)).toEqual({
      host: '127.0.0.1',
      port: 3001,
      dataDir: '/Users/u/Library/Application Support/LifeDashboard',
      uiOrigins: ['http://127.0.0.1:3000'],
    })
  })

  it('reads LIFEDASHBOARD_API_PORT', () => {
    expect(loadConfig({ LIFEDASHBOARD_API_PORT: '4010' }, 'darwin', HOME).port).toBe(4010)
  })

  it.each(['', 'abc', '0', '65536', '3001.5', ' 4010', '-1'])('rejects port %j', (value) => {
    expect(() => loadConfig({ LIFEDASHBOARD_API_PORT: value }, 'darwin', HOME)).toThrow(
      `Invalid LIFEDASHBOARD_API_PORT: "${value}"`,
    )
  })

  it('uses XDG_DATA_HOME on Linux and falls back to ~/.local/share', () => {
    expect(loadConfig({ XDG_DATA_HOME: '/data' }, 'linux', HOME).dataDir).toBe('/data/lifedashboard')
    expect(loadConfig({}, 'linux', HOME).dataDir).toBe('/Users/u/.local/share/lifedashboard')
    expect(loadConfig({ XDG_DATA_HOME: 'relative' }, 'linux', HOME).dataDir).toBe('/Users/u/.local/share/lifedashboard')
  })

  it('uses APPDATA on Windows', () => {
    expect(loadConfig({ APPDATA: '/appdata' }, 'win32', HOME).dataDir).toBe(join('/appdata', 'LifeDashboard'))
  })

  it('reads an absolute LIFEDASHBOARD_DATA_DIR and rejects a relative one', () => {
    expect(loadConfig({ LIFEDASHBOARD_DATA_DIR: '/tmp/ld' }, 'darwin', HOME).dataDir).toBe('/tmp/ld')
    expect(() => loadConfig({ LIFEDASHBOARD_DATA_DIR: 'data' }, 'darwin', HOME)).toThrow(
      'Invalid LIFEDASHBOARD_DATA_DIR: "data"',
    )
  })

  it('reads a comma-separated LIFEDASHBOARD_UI_ORIGINS', () => {
    expect(
      loadConfig({ LIFEDASHBOARD_UI_ORIGINS: 'http://127.0.0.1:3000, http://localhost:3000' }, 'darwin', HOME).uiOrigins,
    ).toEqual(['http://127.0.0.1:3000', 'http://localhost:3000'])
  })

  it.each(['', 'http://127.0.0.1:3000/', 'http://127.0.0.1:3000/app', 'ftp://host', 'not a url', 'http://a:3000,'])(
    'rejects origins %j',
    (value) => {
      expect(() => loadConfig({ LIFEDASHBOARD_UI_ORIGINS: value }, 'darwin', HOME)).toThrow(
        `Invalid LIFEDASHBOARD_UI_ORIGINS: "${value}"`,
      )
    },
  )
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -C apps/api exec vitest run test/config.test.ts
```

Expected: FAIL — the default test sees no `dataDir`/`uiOrigins`; the data dir and origin tests do not throw.

- [ ] **Step 3: Implement**

Replace `apps/api/src/config.ts`:

```ts
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface ApiConfig {
  host: '127.0.0.1'
  port: number
  dataDir: string
  uiOrigins: string[]
}

const DEFAULT_PORT = 3001
const DEFAULT_UI_ORIGINS = ['http://127.0.0.1:3000']

export function loadConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): ApiConfig {
  return {
    host: '127.0.0.1',
    port: parsePort(env.LIFEDASHBOARD_API_PORT),
    dataDir: parseDataDir(env, platform, home),
    uiOrigins: parseOrigins(env.LIFEDASHBOARD_UI_ORIGINS),
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid LIFEDASHBOARD_API_PORT: "${raw}"`)
  return port
}

// The user data directory, never the repository (base design §12.1).
function parseDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const raw = env.LIFEDASHBOARD_DATA_DIR
  if (raw !== undefined) {
    if (!isAbsolute(raw)) throw new Error(`Invalid LIFEDASHBOARD_DATA_DIR: "${raw}"`)
    return raw
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'LifeDashboard')
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'LifeDashboard')
  const xdg = env.XDG_DATA_HOME
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, '.local', 'share'), 'lifedashboard')
}

function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_UI_ORIGINS]
  const origins = raw.split(',').map((item) => item.trim())
  if (!origins.every(isOrigin)) throw new Error(`Invalid LIFEDASHBOARD_UI_ORIGINS: "${raw}"`)
  return origins
}

// An origin is exactly scheme://host[:port]; a path or trailing slash changes URL.origin and fails.
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm -C apps/api exec vitest run test/config.test.ts && pnpm -C apps/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/test/config.test.ts
git commit -m "feat(api): data directory and UI origin configuration"
```

---

### Task 3: SQLite database with migrations and backup

**Files:**
- Create: `apps/api/src/migrations.ts`, `apps/api/src/db.ts`
- Test: `apps/api/test/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // migrations.ts
  const SEED_ROOM_ID: string   // '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b01'
  const SEED_SCREEN_ID: string // '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
  const MIGRATIONS: readonly string[]
  // db.ts
  const DB_FILE = 'lifedashboard.db'
  function openDatabase(file: string, migrations?: readonly string[]): Promise<DatabaseSync> // ':memory:' for tests
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/test/db.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DB_FILE, openDatabase } from '../src/db.ts'
import { MIGRATIONS, SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ld-db-'))
  file = join(dir, DB_FILE)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function tables(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as unknown as { name: string }[]
  return rows.map((row) => row.name)
}

describe('openDatabase', () => {
  it('creates the schema and the seed room with one screen', async () => {
    const db = await openDatabase(':memory:')
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(tables(db)).toEqual(['rooms', 'screens', 'sessions', 'widgets'])
    expect(db.prepare('SELECT id, title, position, revision FROM rooms').all()).toEqual([
      { id: SEED_ROOM_ID, title: 'Главная', position: 0, revision: 1 },
    ])
    expect(db.prepare('SELECT id, room_id, position FROM screens').all()).toEqual([
      { id: SEED_SCREEN_ID, room_id: SEED_ROOM_ID, position: 0 },
    ])
    db.close()
  })

  it('uses WAL, foreign keys and a busy timeout on a file database', async () => {
    const db = await openDatabase(file)
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
    db.close()
  })

  it('changes nothing when opened again', async () => {
    ;(await openDatabase(file)).close()
    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT count(*) AS n FROM rooms').get()).toEqual({ n: 1 })
    expect(existsSync(`${file}.bak-v1`)).toBe(false)
    db.close()
  })

  it('refuses a database newer than the app and leaves it unchanged', async () => {
    const raw = new DatabaseSync(file)
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    raw.close()

    await expect(openDatabase(file)).rejects.toThrow(/newer than this LifeDashboard supports/)

    const check = new DatabaseSync(file)
    expect(userVersion(check)).toBe(MIGRATIONS.length + 1)
    expect(tables(check)).toEqual([])
    check.close()
  })

  it('backs up an existing database before applying a pending migration', async () => {
    ;(await openDatabase(file, [MIGRATIONS[0]!])).close()
    const db = await openDatabase(file, [MIGRATIONS[0]!, 'CREATE TABLE extra (id INTEGER);'])
    expect(userVersion(db)).toBe(2)
    db.close()

    const saved = new DatabaseSync(`${file}.bak-v1`)
    expect(userVersion(saved)).toBe(1)
    expect(tables(saved)).not.toContain('extra')
    saved.close()
  })

  it('rolls back a failing migration whole and keeps the previous version', async () => {
    ;(await openDatabase(file, [MIGRATIONS[0]!])).close()
    // The first two statements succeed; the third fails, so all three must be undone.
    const failing = `
      CREATE TABLE half (id INTEGER);
      UPDATE rooms SET title = 'changed';
      CREATE TABLE broken (;
    `
    await expect(openDatabase(file, [MIGRATIONS[0]!, failing])).rejects.toThrow()
    const check = new DatabaseSync(file)
    expect(userVersion(check)).toBe(1)
    expect(tables(check)).not.toContain('half')
    expect(check.prepare('SELECT title FROM rooms').all()).toEqual([{ title: 'Главная' }])
    check.close()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -C apps/api exec vitest run test/db.test.ts
```

Expected: FAIL — `Cannot find module '../src/db.ts'`.

- [ ] **Step 3: Implement migrations and `openDatabase`**

`apps/api/src/migrations.ts`:

```ts
export const SEED_ROOM_ID = '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b01'
export const SEED_SCREEN_ID = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

// Applied in order inside a transaction; migration n sets PRAGMA user_version = n.
// Never edit a released migration: add a new one.
export const MIGRATIONS: readonly string[] = [
  `
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE screens (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  UNIQUE (room_id, position)
);

CREATE TABLE widgets (
  id TEXT PRIMARY KEY,
  screen_id TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  config TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL
);

CREATE INDEX widgets_screen_id ON widgets(screen_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

INSERT INTO rooms (id, title, position, revision, created_at, updated_at)
VALUES ('${SEED_ROOM_ID}', 'Главная', 0, 1, ${NOW}, ${NOW});

INSERT INTO screens (id, room_id, position) VALUES ('${SEED_SCREEN_ID}', '${SEED_ROOM_ID}', 0);
`,
]
```

`apps/api/src/db.ts`:

```ts
import { DatabaseSync, backup } from 'node:sqlite'
import { MIGRATIONS } from './migrations.ts'

export const DB_FILE = 'lifedashboard.db'

/**
 * Opens the database and applies pending migrations; the caller owns the returned connection.
 * Only this process opens the file (base design ARCH-02). ':memory:' opens a test database.
 */
export async function openDatabase(file: string, migrations: readonly string[] = MIGRATIONS): Promise<DatabaseSync> {
  const db = new DatabaseSync(file)
  try {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    // Checked before any write: a newer database stays exactly as it is (§12.2).
    if (version > migrations.length) {
      throw new Error(
        `Database schema version ${version} is newer than this LifeDashboard supports (${migrations.length}). ` +
          'Start a newer version of the app.',
      )
    }
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
    if (version > 0 && version < migrations.length && file !== ':memory:') {
      await backup(db, `${file}.bak-v${version}`)
    }
    for (const [index, sql] of migrations.entries()) {
      if (index < version) continue
      db.exec('BEGIN')
      try {
        db.exec(sql)
        db.exec(`PRAGMA user_version = ${index + 1}`)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  } catch (error) {
    db.close()
    throw error
  }
  return db
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm -C apps/api exec vitest run test/db.test.ts && pnpm -C apps/api typecheck
```

Expected: PASS. (`PRAGMA busy_timeout` reads back as `{ timeout: 5000 }`; verified on Node 24.21.0.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migrations.ts apps/api/src/db.ts apps/api/test/db.test.ts
git commit -m "feat(api): sqlite database with migrations and backup"
```

---

### Task 4: Error envelope and request ids

**Files:**
- Create: `apps/api/src/errors.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/errors.test.ts`

**Interfaces:**
- Consumes: `ErrorCode`, `ErrorEnvelope`, `SuccessEnvelope` from `@lifedashboard/contracts/api`.
- Produces:
  ```ts
  class ApiError extends Error { readonly code: ErrorCode; constructor(code: ErrorCode, message: string) }
  function ok<T>(request: FastifyRequest, data: T): SuccessEnvelope<T>
  function registerErrorHandling(app: FastifyInstance): void
  function newRequestId(): string
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/test/errors.test.ts`:

```ts
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { ApiError, newRequestId, ok, registerErrorHandling } from '../src/errors.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function appWithRoutes(log?: string[]) {
  const logger = log ? { level: 'warn', stream: { write: (line: string) => log.push(line) } } : false
  const app = Fastify({ genReqId: newRequestId, logger })
  registerErrorHandling(app)
  app.get('/ok', async (request) => ok(request, { a: 1 }))
  app.get('/conflict', async () => {
    throw new ApiError('REVISION_CONFLICT', 'changed')
  })
  app.get('/invalid', async () => {
    throw new ApiError('VALIDATION_ERROR', 'Widgets overlap')
  })
  app.get('/boom', async () => {
    throw new Error('secret detail')
  })
  app.post('/echo', { schema: { body: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } } } }, async (request) =>
    ok(request, request.body),
  )
  await app.ready()
  return app
}

describe('error handling', () => {
  it('wraps data in the success envelope with a UUID request id', async () => {
    const app = await appWithRoutes()
    const body = (await app.inject({ url: '/ok' })).json()
    expect(body.data).toEqual({ a: 1 })
    expect(body.meta.requestId).toMatch(UUID)
    await app.close()
  })

  it('maps an ApiError to its status and code', async () => {
    const app = await appWithRoutes()
    const response = await app.inject({ url: '/conflict' })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      error: { code: 'REVISION_CONFLICT', message: 'changed', requestId: expect.stringMatching(UUID), retryable: false },
    })
    await app.close()
  })

  it('hides unexpected errors behind INTERNAL_ERROR', async () => {
    const app = await appWithRoutes()
    const response = await app.inject({ url: '/boom' })
    expect(response.statusCode).toBe(500)
    expect(response.json().error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal error' })
    expect(response.body).not.toContain('secret detail')
    await app.close()
  })

  it.each([
    ['malformed JSON', '{"n":', 'application/json'],
    ['a schema violation', '{"n":"x"}', 'application/json'],
  ])('maps %s to VALIDATION_ERROR', async (_name, payload, contentType) => {
    const app = await appWithRoutes()
    const response = await app.inject({ method: 'POST', url: '/echo', payload, headers: { 'content-type': contentType } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
    await app.close()
  })

  it('logs the reason of a VALIDATION_ERROR with its request id, without the body', async () => {
    const log: string[] = []
    const app = await appWithRoutes(log)
    const invalid = await app.inject({ url: '/invalid' })
    await app.inject({ method: 'POST', url: '/echo', payload: '{"n":"secret-value"}', headers: { 'content-type': 'application/json' } })
    const entries = log.map((line) => JSON.parse(line))
    expect(entries).toContainEqual(
      expect.objectContaining({ code: 'VALIDATION_ERROR', reason: 'Widgets overlap', reqId: invalid.json().error.requestId }),
    )
    expect(entries.filter((entry) => entry.code === 'VALIDATION_ERROR')).toHaveLength(2)
    expect(log.join('')).not.toContain('secret-value')
    await app.close()
  })

  it('answers unknown routes with NOT_FOUND', async () => {
    const app = await appWithRoutes()
    const response = await app.inject({ url: '/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('NOT_FOUND')
    await app.close()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -C apps/api exec vitest run test/errors.test.ts
```

Expected: FAIL — `Cannot find module '../src/errors.ts'`.

- [ ] **Step 3: Implement `errors.ts` and wire it into `buildApp`**

`apps/api/src/errors.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ErrorCode, ErrorEnvelope, SuccessEnvelope } from '@lifedashboard/contracts/api'

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

export class ApiError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function newRequestId(): string {
  return randomUUID()
}

export function ok<T>(request: FastifyRequest, data: T): SuccessEnvelope<T> {
  return { data, meta: { requestId: request.id } }
}

function envelope(code: ErrorCode, message: string, requestId: string): ErrorEnvelope {
  return { error: { code, message, requestId, retryable: code === 'RATE_LIMITED' } }
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined
}

// The UI shows a generic text for a rejected save; the reason is in the API log (spec «UI flow»).
// Only the message is logged: never the body, cookies or a pairing code.
function logRejection(request: FastifyRequest, reason: string): void {
  request.log.warn({ code: 'VALIDATION_ERROR', reason }, 'request rejected')
}

// Base design §11.1: one envelope for every error, no stack traces or internal details.
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.code === 'VALIDATION_ERROR') logRejection(request, error.message)
      return reply.status(STATUS[error.code]).send(envelope(error.code, error.message, request.id))
    }
    const status = statusOf(error)
    // Fastify's own client errors: malformed JSON, schema validation, body too large.
    if (status !== undefined && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      logRejection(request, message)
      return reply.status(400).send(envelope('VALIDATION_ERROR', message, request.id))
    }
    request.log.error(error)
    return reply.status(500).send(envelope('INTERNAL_ERROR', 'Internal error', request.id))
  })
  app.setNotFoundHandler((request, reply) => reply.status(404).send(envelope('NOT_FOUND', 'Route not found', request.id)))
}
```

`apps/api/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { newRequestId, registerErrorHandling } from './errors.ts'

export function buildApp({ logger = false }: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger, genReqId: newRequestId })
  registerErrorHandling(app)
  app.get('/health', async () => ({ status: 'ok' as const }))
  return app
}
```

- [ ] **Step 4: Run the API suite**

```bash
pnpm -C apps/api exec vitest run && pnpm -C apps/api typecheck
```

Expected: PASS (including the unchanged `health.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/errors.ts apps/api/src/app.ts apps/api/test/errors.test.ts
git commit -m "feat(api): error envelope and request ids"
```

---

### Task 5: Request checks, pairing and sliding sessions

**Files:**
- Create: `apps/api/src/auth.ts`, `apps/api/test/helpers.ts`, `apps/api/test/auth.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- Consumes: `openDatabase` (Task 3), `ApiError`, `ok`, `registerErrorHandling`, `newRequestId` (Task 4), `ApiConfig` (Task 2), `PairRequest` (Task 1).
- Produces:
  ```ts
  // app.ts
  interface AppDeps {
    db: DatabaseSync
    config: Pick<ApiConfig, 'port' | 'uiOrigins'>
    onPairingCode: (code: string, expiresAt: Date) => void
    now?: () => Date
    logger?: boolean
  }
  function buildApp(deps: AppDeps): FastifyInstance
  // auth.ts
  const SESSION_COOKIE = 'ld_session'
  function registerAuth(app: FastifyInstance, deps: { db; config; now: () => Date; onPairingCode }): void
  // test/helpers.ts
  HOST = '127.0.0.1:3001', ORIGIN = 'http://127.0.0.1:3000', T0, DAY, HOUR
  testApp(db?: DatabaseSync): Promise<TestApp> // { app, db, codes, clock, close }
  call(app, options: CallOptions): Promise<LightMyRequestResponse>
  sessionCookie(response): string | null      // 'ld_session=<token>' or null
  pair(t: TestApp): Promise<string>            // returns the cookie
  errorCode(response): string
  ```

- [ ] **Step 1: Write the test helpers**

`apps/api/test/helpers.ts`:

```ts
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { expect } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase } from '../src/db.ts'

export const HOST = '127.0.0.1:3001'
export const ORIGIN = 'http://127.0.0.1:3000'
export const T0 = Date.parse('2026-10-05T10:00:00.000Z')
export const HOUR = 60 * 60_000
export const DAY = 24 * HOUR

export interface TestApp {
  app: FastifyInstance
  db: DatabaseSync
  codes: string[]
  clock: { now: number }
  close(): Promise<void>
}

/** A test app on an in-memory database, or on `db` when given (then the caller closes `db`). */
export async function testApp(db?: DatabaseSync): Promise<TestApp> {
  const database = db ?? (await openDatabase(':memory:'))
  const codes: string[] = []
  const clock = { now: T0 }
  const app = buildApp({
    db: database,
    config: { port: 3001, uiOrigins: [ORIGIN] },
    now: () => new Date(clock.now),
    onPairingCode: (code) => codes.push(code),
  })
  await app.ready()
  return {
    app,
    db: database,
    codes,
    clock,
    async close() {
      await app.close()
      if (!db) database.close()
    },
  }
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT'
  url: string
  payload?: unknown
  cookie?: string
  host?: string
  // null omits the header; the default is ORIGIN for mutations and no header for GET.
  origin?: string | null
  contentType?: string
}

export function call(app: FastifyInstance, options: CallOptions): Promise<LightMyRequestResponse> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { host: options.host ?? HOST }
  const origin = options.origin === undefined ? (method === 'GET' ? null : ORIGIN) : options.origin
  if (origin !== null) headers.origin = origin
  if (options.cookie) headers.cookie = options.cookie
  if (options.contentType) headers['content-type'] = options.contentType
  return app.inject({ method, url: options.url, headers, payload: options.payload as string | object | undefined })
}

export function sessionCookie(response: LightMyRequestResponse): string | null {
  const header = response.headers['set-cookie']
  const value = Array.isArray(header) ? header[0] : header
  return value ? value.split(';')[0]! : null
}

export async function pair(t: TestApp): Promise<string> {
  const response = await call(t.app, { method: 'POST', url: '/api/v1/auth/pair', payload: { code: t.codes.at(-1) } })
  expect(response.statusCode).toBe(200)
  const cookie = sessionCookie(response)
  expect(cookie).not.toBeNull()
  return cookie!
}

export function errorCode(response: LightMyRequestResponse): string {
  return response.json().error.code
}
```

- [ ] **Step 2: Write the failing auth tests**

`apps/api/test/auth.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY, HOUR, ORIGIN, T0, call, errorCode, pair, sessionCookie, testApp, type TestApp } from './helpers.ts'

// Queued values make pairing codes deterministic; an empty queue uses the real generator.
const nextCodes = vi.hoisted(() => [] as number[])
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomInt: (min: number, max: number) => nextCodes.shift() ?? actual.randomInt(min, max) }
})

// Any authenticated /api path: unknown routes answer 404 after the session check, 401 before it.
const PROBE = '/api/v1/probe'
const PAIR = '/api/v1/auth/pair'
const PAIR_CODE = '/api/v1/auth/pair-code'

let t: TestApp

beforeEach(async () => {
  t = await testApp()
})

afterEach(async () => {
  await t.close()
  nextCodes.length = 0
})

function storedExpiry(cookie: string): string {
  const hash = createHash('sha256').update(cookie.split('=')[1]!).digest('hex')
  return (t.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash) as { expires_at: string }).expires_at
}

describe('request checks', () => {
  it('rejects a foreign Host', async () => {
    const response = await call(t.app, { url: PROBE, host: 'evil.test:3001' })
    expect(response.statusCode).toBe(403)
    expect(errorCode(response)).toBe('FORBIDDEN')
  })

  it('accepts localhost with the API port as Host', async () => {
    const response = await call(t.app, { url: PROBE, host: 'localhost:3001' })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a foreign Origin on GET', async () => {
    const response = await call(t.app, { url: PROBE, origin: 'http://evil.test' })
    expect(response.statusCode).toBe(403)
  })

  it('rejects a mutation without Origin', async () => {
    const response = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] }, origin: null })
    expect(response.statusCode).toBe(403)
  })

  it('rejects a mutation without a JSON content type', async () => {
    const response = await call(t.app, {
      method: 'POST',
      url: PAIR,
      payload: `code=${t.codes[0]}`,
      contentType: 'application/x-www-form-urlencoded',
    })
    expect(response.statusCode).toBe(403)
  })

  it('leaves /health public', async () => {
    const response = await call(t.app, { url: '/health', host: 'evil.test' })
    expect(response.statusCode).toBe(200)
  })

  it('answers 401 without a session', async () => {
    const response = await call(t.app, { url: PROBE })
    expect(response.statusCode).toBe(401)
    expect(errorCode(response)).toBe('UNAUTHORIZED')
  })
})

describe('pairing', () => {
  it('prints a 6-digit code on start', () => {
    expect(t.codes).toHaveLength(1)
    expect(t.codes[0]).toMatch(/^\d{6}$/)
  })

  it('sets the session cookie for the right code and accepts it afterwards', async () => {
    const response = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toBeNull()
    expect(response.headers['set-cookie']).toMatch(
      /^ld_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/api; Max-Age=2592000$/,
    )
    const cookie = sessionCookie(response)!
    expect((await call(t.app, { url: PROBE, cookie })).statusCode).toBe(404)
  })

  it('keeps leading zeros and accepts the code with surrounding spaces', async () => {
    nextCodes.push(123)
    const fresh = await testApp()
    expect(fresh.codes).toEqual(['000123'])
    const response = await call(fresh.app, { method: 'POST', url: PAIR, payload: { code: ' 000123 ' } })
    expect(response.statusCode).toBe(200)
    await fresh.close()
  })

  it('accepts a code only once', async () => {
    await pair(t)
    const again = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })
    expect(again.statusCode).toBe(401)
  })

  it('rejects an expired code', async () => {
    t.clock.now += 10 * 60_000
    const response = await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })
    expect(response.statusCode).toBe(401)
  })

  it('burns the code on the fifth wrong attempt', async () => {
    const wrong = t.codes[0] === '000000' ? '000001' : '000000'
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: wrong } })).statusCode).toBe(401)
    }
    expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: t.codes[0] } })).statusCode).toBe(401)
  })

  it('issues a new code that replaces the old one, at most once per 10 seconds', async () => {
    nextCodes.push(111111, 222222)
    const first = await call(t.app, { method: 'POST', url: PAIR_CODE, payload: {} })
    expect(first.statusCode).toBe(200)
    expect(first.body).not.toContain('111111')
    expect(t.codes.slice(1)).toEqual(['111111'])

    const tooSoon = await call(t.app, { method: 'POST', url: PAIR_CODE, payload: {} })
    expect(tooSoon.statusCode).toBe(429)
    expect(tooSoon.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true })

    t.clock.now += 10_000
    expect((await call(t.app, { method: 'POST', url: PAIR_CODE, payload: {} })).statusCode).toBe(200)
    expect(t.codes.slice(1)).toEqual(['111111', '222222'])

    expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: '111111' } })).statusCode).toBe(401)
    expect((await call(t.app, { method: 'POST', url: PAIR, payload: { code: '222222' } })).statusCode).toBe(200)
  })
})

describe('sessions', () => {
  it('does not renew within a day of the last renewal', async () => {
    const cookie = await pair(t)
    t.clock.now += 12 * HOUR
    const response = await call(t.app, { url: PROBE, cookie })
    expect(response.statusCode).toBe(404)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(storedExpiry(cookie)).toBe(new Date(T0 + 30 * DAY).toISOString())
  })

  it('renews exactly one day after pairing, and the session then lasts 29 more days', async () => {
    const cookie = await pair(t)
    t.clock.now += DAY
    const renewed = await call(t.app, { url: PROBE, cookie })
    expect(renewed.statusCode).toBe(404)
    expect(sessionCookie(renewed)).toBe(cookie)
    expect(renewed.headers['set-cookie']).toMatch(/Max-Age=2592000$/)

    t.clock.now += 29 * DAY
    expect((await call(t.app, { url: PROBE, cookie })).statusCode).toBe(404)
  })

  it('keeps a session used at +12 h and +29 d 23 h', async () => {
    const cookie = await pair(t)
    t.clock.now += 12 * HOUR
    await call(t.app, { url: PROBE, cookie })
    t.clock.now += 29 * DAY + 11 * HOUR
    const response = await call(t.app, { url: PROBE, cookie })
    expect(response.statusCode).toBe(404)
    expect(sessionCookie(response)).toBe(cookie)
  })

  it('expires a session used at +12 h when the next request comes at +30 d 1 h', async () => {
    const cookie = await pair(t)
    t.clock.now += 12 * HOUR
    await call(t.app, { url: PROBE, cookie })
    t.clock.now += 29 * DAY + 13 * HOUR
    const response = await call(t.app, { url: PROBE, cookie })
    expect(response.statusCode).toBe(401)
    expect(t.db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it('expires exactly 30 days after the last renewal', async () => {
    const cookie = await pair(t)
    t.clock.now += 30 * DAY
    expect((await call(t.app, { url: PROBE, cookie })).statusCode).toBe(401)
  })

  it('rejects an unknown token', async () => {
    const response = await call(t.app, { url: PROBE, cookie: 'ld_session=unknown' })
    expect(response.statusCode).toBe(401)
  })

  it('survives a rebuilt app on the same database', async () => {
    const cookie = await pair(t)
    const restarted = await testApp(t.db)
    expect((await call(restarted.app, { url: PROBE, cookie })).statusCode).toBe(404)
    await restarted.close()
  })

  it('uses only the configured Origin', async () => {
    const cookie = await pair(t)
    expect((await call(t.app, { url: PROBE, cookie, origin: ORIGIN })).statusCode).toBe(404)
  })
})
```

Update `apps/api/test/health.test.ts`:

```ts
import { expect, it } from 'vitest'
import { testApp } from './helpers.ts'

it('GET /health returns status ok', async () => {
  const t = await testApp()
  const response = await t.app.inject({ method: 'GET', url: '/health' })

  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({ status: 'ok' })
  await t.close()
})
```

- [ ] **Step 3: Run them to verify they fail**

```bash
pnpm -C apps/api exec vitest run test/auth.test.ts test/health.test.ts
```

Expected: FAIL — `buildApp` does not accept `db`/`onPairingCode`; `codes` stays empty; no `403`/`401` answers.

- [ ] **Step 4: Implement `auth.ts`**

`apps/api/src/auth.ts`:

```ts
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PairRequest } from '@lifedashboard/contracts/api'
import type { ApiConfig } from './config.ts'
import { ApiError, ok } from './errors.ts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const CODE_TTL_MS = 10 * MINUTE
const CODE_REQUEST_INTERVAL_MS = 10_000
const MAX_CODE_FAILURES = 5
const SESSION_TTL_MS = 30 * DAY
// Renewal at most once a day: only when 29 days or less are left.
const RENEW_THRESHOLD_MS = 29 * DAY

export const SESSION_COOKIE = 'ld_session'

const PUBLIC_PATHS = new Set(['/api/v1/auth/pair', '/api/v1/auth/pair-code'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const PAIR_SCHEMA = {
  body: {
    type: 'object',
    required: ['code'],
    properties: { code: { type: 'string', maxLength: 32 } },
  },
} as const

export interface AuthDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins'>
  now: () => Date
  onPairingCode: (code: string, expiresAt: Date) => void
}

// Base design §13.1: one-time pairing code -> HttpOnly session cookie; Host and Origin checks.
export function registerAuth(app: FastifyInstance, { db, config, now, onPairingCode }: AuthDeps): void {
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`])
  const origins = new Set(config.uiOrigins)
  // ponytail: pairing state is in memory; a restart prints a fresh code, which is the intended flow.
  let pairing: { code: string; expiresAt: number; failures: number } | null = null
  let lastCodeRequestAt = Number.NEGATIVE_INFINITY

  function issueCode(): void {
    const expiresAt = now().getTime() + CODE_TTL_MS
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    pairing = { code, expiresAt, failures: 0 }
    onPairingCode(code, new Date(expiresAt))
  }

  // No CSRF token (spec deviation): SameSite=Strict, an allowlisted Origin and a JSON body cover it.
  function checkRequest(request: FastifyRequest): void {
    const host = request.headers.host
    if (host === undefined || !hosts.has(host)) throw new ApiError('FORBIDDEN', 'Host is not allowed')
    const origin = request.headers.origin
    if (origin !== undefined && !origins.has(origin)) throw new ApiError('FORBIDDEN', 'Origin is not allowed')
    if (MUTATING_METHODS.has(request.method)) {
      if (origin === undefined) throw new ApiError('FORBIDDEN', 'Origin is required')
      const type = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
      if (type !== 'application/json') throw new ApiError('FORBIDDEN', 'A JSON body is required')
    }
  }

  function authenticate(request: FastifyRequest, reply: FastifyReply): void {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE)
    if (token === null) throw new ApiError('UNAUTHORIZED', 'Pairing required')
    const hash = hashToken(token)
    const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash) as
      | { expires_at: string }
      | undefined
    if (!row) throw new ApiError('UNAUTHORIZED', 'Pairing required')
    const t = now().getTime()
    const expiresAt = Date.parse(row.expires_at)
    if (expiresAt <= t) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash)
      throw new ApiError('UNAUTHORIZED', 'Session expired')
    }
    if (expiresAt <= t + RENEW_THRESHOLD_MS) {
      db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(t + SESSION_TTL_MS).toISOString(), hash)
      reply.header('set-cookie', sessionCookie(token))
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/')) return
    checkRequest(request)
    if (!PUBLIC_PATHS.has(path)) authenticate(request, reply)
  })

  app.post('/api/v1/auth/pair-code', async (request) => {
    const t = now().getTime()
    if (t - lastCodeRequestAt < CODE_REQUEST_INTERVAL_MS) {
      throw new ApiError('RATE_LIMITED', 'Wait a few seconds before requesting a new code')
    }
    lastCodeRequestAt = t
    issueCode()
    // The code goes to the API terminal only, never into a response.
    return ok(request, null)
  })

  app.post<{ Body: PairRequest }>('/api/v1/auth/pair', { schema: PAIR_SCHEMA }, async (request, reply) => {
    const t = now().getTime()
    const current = pairing
    if (current === null || current.expiresAt <= t) {
      pairing = null
      throw new ApiError('UNAUTHORIZED', 'No valid pairing code; request a new one')
    }
    if (!sameCode(request.body.code.trim(), current.code)) {
      current.failures += 1
      if (current.failures >= MAX_CODE_FAILURES) pairing = null
      throw new ApiError('UNAUTHORIZED', 'Wrong pairing code')
    }
    pairing = null
    const token = randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
      hashToken(token),
      new Date(t).toISOString(),
      new Date(t + SESSION_TTL_MS).toISOString(),
    )
    reply.header('set-cookie', sessionCookie(token))
    return ok(request, null)
  })

  issueCode()
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL_MS / 1000}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sameCode(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || null
  }
  return null
}
```

- [ ] **Step 5: Wire `buildApp` and `server.ts`**

`apps/api/src/app.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from './auth.ts'
import type { ApiConfig } from './config.ts'
import { newRequestId, registerErrorHandling } from './errors.ts'

export interface AppDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins'>
  onPairingCode: (code: string, expiresAt: Date) => void
  now?: () => Date
  logger?: boolean
}

export function buildApp({ db, config, onPairingCode, now = () => new Date(), logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger, genReqId: newRequestId })
  registerErrorHandling(app)
  app.get('/health', async () => ({ status: 'ok' as const }))
  registerAuth(app, { db, config, now, onPairingCode })
  return app
}
```

`apps/api/src/server.ts`:

```ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { buildApp } from './app.ts'
import { type ApiConfig, loadConfig } from './config.ts'
import { DB_FILE, openDatabase } from './db.ts'

let config: ApiConfig
let db: DatabaseSync
try {
  config = loadConfig(process.env)
  mkdirSync(config.dataDir, { recursive: true })
  db = await openDatabase(join(config.dataDir, DB_FILE))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const app = buildApp({
  db,
  config,
  logger: true,
  // Printed apart from the JSON log so the code is easy to find in the `pnpm dev` terminal.
  onPairingCode: (code, expiresAt) => {
    console.log(`\nLifeDashboard pairing code: ${code} (valid until ${expiresAt.toLocaleTimeString()})\n`)
  },
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      db.close()
      process.exit(0)
    })
  })
}

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
```

- [ ] **Step 6: Run the API suite**

```bash
pnpm -C apps/api exec vitest run && pnpm -C apps/api typecheck
```

Expected: PASS for `auth`, `health`, `errors`, `db`, `config`.

- [ ] **Step 7: Smoke-test startup against a throwaway data directory**

```bash
LIFEDASHBOARD_DATA_DIR="$(mktemp -d)" LIFEDASHBOARD_API_PORT=3911 timeout 5 node apps/api/src/server.ts; echo "exit $?"
```

Expected: the log shows `LifeDashboard pairing code: NNNNNN (valid until …)` and `Server listening at http://127.0.0.1:3911`; `exit 124` from `timeout`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/test/helpers.ts apps/api/test/auth.test.ts apps/api/test/health.test.ts
git commit -m "feat(api): pairing, sessions and request checks"
```

---

### Task 6: Room list and board routes

**Files:**
- Create: `apps/api/src/rooms.ts`, `apps/api/test/rooms.test.ts`
- Modify: `apps/api/src/app.ts`, `README.md`, `.env.example`

**Interfaces:**
- Consumes: `parseScreenBoard`, `RoomBoard`, `RoomSummary`, `SaveBoardRequest`, `ScreenBoard` (Task 1); `ApiError`, `ok` (Task 4); test helpers (Task 5); `SEED_ROOM_ID`, `SEED_SCREEN_ID` (Task 3).
- Produces: `registerRooms(app, { db, now })`; routes `GET /api/v1/rooms` → `RoomSummary[]`, `GET /api/v1/rooms/:roomId/board` → `RoomBoard`, `PUT /api/v1/rooms/:roomId/board` (body `SaveBoardRequest`) → `RoomBoard`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/rooms.test.ts`:

```ts
import type { RoomBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { call, errorCode, pair, testApp, type TestApp } from './helpers.ts'

const BOARD = `/api/v1/rooms/${SEED_ROOM_ID}/board`
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const placeholder = { kind: 'builtin', type: 'placeholder' } as const
const EMPTY_SCREEN = { id: SEED_SCREEN_ID, instances: [], layout: [] }

// B is listed before A on purpose: the saved order must read back unchanged.
// The layout follows the instance order, as every board the UI produces does.
const screen: ScreenBoard = {
  id: SEED_SCREEN_ID,
  instances: [
    { id: B, source: { ...placeholder }, configVersion: 1, config: { title: 'x', nested: { list: [1, 'two', null] } } },
    { id: A, source: { ...placeholder }, configVersion: 1, config: {} },
  ],
  layout: [
    { instanceId: B, x: 4, y: 0, w: 2, h: 2 },
    { instanceId: A, x: 0, y: 0, w: 4, h: 4 },
  ],
}

let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
})

afterEach(async () => {
  await t.close()
})

async function getBoard(): Promise<RoomBoard> {
  const response = await call(t.app, { url: BOARD, cookie })
  expect(response.statusCode).toBe(200)
  return response.json().data
}

function put(payload: unknown, url = BOARD) {
  return call(t.app, { method: 'PUT', url, cookie, payload })
}

describe('GET /api/v1/rooms', () => {
  it('lists the seed room', async () => {
    const response = await call(t.app, { url: '/api/v1/rooms', cookie })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([{ id: SEED_ROOM_ID, title: 'Главная', position: 0, revision: 1 }])
  })
})

describe('GET /api/v1/rooms/:roomId/board', () => {
  it('returns the empty seed board', async () => {
    expect(await getBoard()).toEqual({
      roomId: SEED_ROOM_ID,
      revision: 1,
      screens: [{ id: SEED_SCREEN_ID, instances: [], layout: [] }],
    })
  })

  it('answers 404 for an unknown room', async () => {
    const response = await call(t.app, { url: '/api/v1/rooms/00000000-0000-4000-8000-000000000000/board', cookie })
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })
})

describe('PUT /api/v1/rooms/:roomId/board', () => {
  it('saves, increments the revision and round-trips order and nested config', async () => {
    const response = await put({ expectedRevision: 1, screens: [screen] })
    expect(response.statusCode).toBe(200)
    const saved: RoomBoard = response.json().data
    expect(saved).toEqual({ roomId: SEED_ROOM_ID, revision: 2, screens: [screen] })
    expect(JSON.stringify(saved.screens[0])).toBe(JSON.stringify(screen))
    expect(await getBoard()).toEqual(saved)
  })

  it('returns the layout in instance order', async () => {
    const swapped = { ...screen, layout: [screen.layout[1]!, screen.layout[0]!] }
    const response = await put({ expectedRevision: 1, screens: [swapped] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens).toEqual([screen])
  })

  it('replaces the previous widgets', async () => {
    await put({ expectedRevision: 1, screens: [screen] })
    const empty = { id: SEED_SCREEN_ID, instances: [], layout: [] }
    expect((await put({ expectedRevision: 2, screens: [empty] })).statusCode).toBe(200)
    expect((await getBoard()).screens).toEqual([empty])
  })

  it('answers 409 for a stale revision and changes nothing', async () => {
    await put({ expectedRevision: 1, screens: [screen] })
    const response = await put({ expectedRevision: 1, screens: [{ id: SEED_SCREEN_ID, instances: [], layout: [] }] })
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('REVISION_CONFLICT')
    expect(await getBoard()).toEqual({ roomId: SEED_ROOM_ID, revision: 2, screens: [screen] })
  })

  const overlapping = structuredClone(screen)
  overlapping.layout[0] = { instanceId: B, x: 2, y: 2, w: 2, h: 2 }
  const outside = structuredClone(screen)
  outside.layout[0] = { instanceId: B, x: 11, y: 0, w: 2, h: 2 }
  const duplicate = structuredClone(screen)
  duplicate.instances[1]!.id = B
  const otherScreen = { ...structuredClone(screen), id: '00000000-0000-4000-8000-0000000000ff' }

  // Each rejected payload targets a non-empty saved board (revision 2): a rejection must keep
  // every stored widget, not only the revision.
  it.each([
    ['an overlap', { expectedRevision: 2, screens: [overlapping] }],
    ['a rect outside the grid', { expectedRevision: 2, screens: [outside] }],
    ['a duplicate instance id', { expectedRevision: 2, screens: [duplicate] }],
    ['an unknown screen', { expectedRevision: 2, screens: [otherScreen] }],
    ['a missing screen', { expectedRevision: 2, screens: [] }],
    ['an extra screen', { expectedRevision: 2, screens: [screen, otherScreen] }],
    ['a missing expectedRevision', { screens: [EMPTY_SCREEN] }],
    ['a non-integer expectedRevision', { expectedRevision: 1.5, screens: [EMPTY_SCREEN] }],
  ])('answers 400 for %s and changes nothing', async (_name, payload) => {
    const before = (await put({ expectedRevision: 1, screens: [screen] })).json().data
    const response = await put(payload)
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(await getBoard()).toEqual(before)
  })

  it('answers 400 for malformed JSON and changes nothing', async () => {
    const before = (await put({ expectedRevision: 1, screens: [screen] })).json().data
    const response = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: '{"expectedRevision":', contentType: 'application/json' })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(await getBoard()).toEqual(before)
  })

  it('answers 400 when a widget id belongs to another room and changes neither room', async () => {
    const otherRoom = '00000000-0000-4000-8000-0000000000aa'
    const otherRoomScreen = '00000000-0000-4000-8000-0000000000ab'
    t.db.exec(`
      INSERT INTO rooms (id, title, position, revision, created_at, updated_at) VALUES ('${otherRoom}', 'Other', 1, 1, 'x', 'x');
      INSERT INTO screens (id, room_id, position) VALUES ('${otherRoomScreen}', '${otherRoom}', 0);
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('${A}', '${otherRoomScreen}', 'builtin', 'placeholder', '{}', 1, 0, 0, 1, 1);
    `)
    // The target room already holds B, so a partial replacement would be visible.
    const onlyB: ScreenBoard = { id: SEED_SCREEN_ID, instances: [screen.instances[0]!], layout: [screen.layout[0]!] }
    const before = (await put({ expectedRevision: 1, screens: [onlyB] })).json().data
    const response = await put({ expectedRevision: 2, screens: [screen] })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain(A)
    expect(await getBoard()).toEqual(before)
    expect(t.db.prepare('SELECT screen_id FROM widgets WHERE id = ?').get(A)).toEqual({ screen_id: otherRoomScreen })
  })

  it('answers 404 for an unknown room', async () => {
    const response = await put({ expectedRevision: 1, screens: [screen] }, '/api/v1/rooms/00000000-0000-4000-8000-000000000000/board')
    expect(response.statusCode).toBe(404)
  })

  it('requires a session', async () => {
    const response = await call(t.app, { method: 'PUT', url: BOARD, payload: { expectedRevision: 1, screens: [screen] } })
    expect(response.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -C apps/api exec vitest run test/rooms.test.ts
```

Expected: FAIL — the routes answer `404 NOT_FOUND`.

- [ ] **Step 3: Implement `rooms.ts` and register it**

`apps/api/src/rooms.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import {
  parseScreenBoard,
  type RoomBoard,
  type RoomSummary,
  type SaveBoardRequest,
  type ScreenBoard,
} from '@lifedashboard/contracts/board'
import { ApiError, ok } from './errors.ts'

interface WidgetRow {
  id: string
  screen_id: string
  source_type: string
  config: string
  config_version: number
  x: number
  y: number
  w: number
  h: number
}

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555

const SAVE_SCHEMA = {
  body: {
    type: 'object',
    required: ['expectedRevision', 'screens'],
    properties: {
      expectedRevision: { type: 'integer', minimum: 1 },
      screens: { type: 'array', maxItems: 100 },
    },
  },
} as const

export interface RoomsDeps {
  db: DatabaseSync
  now: () => Date
}

export function registerRooms(app: FastifyInstance, { db, now }: RoomsDeps): void {
  app.get('/api/v1/rooms', async (request) => ok(request, listRooms(db)))

  app.get<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/board', async (request) =>
    ok(request, readBoard(db, request.params.roomId)),
  )

  app.put<{ Params: { roomId: string }; Body: SaveBoardRequest }>(
    '/api/v1/rooms/:roomId/board',
    { schema: SAVE_SCHEMA },
    async (request) => ok(request, saveBoard(db, request.params.roomId, request.body, now())),
  )
}

function listRooms(db: DatabaseSync): RoomSummary[] {
  return db.prepare('SELECT id, title, position, revision FROM rooms ORDER BY position, created_at').all() as unknown as RoomSummary[]
}

function roomRevision(db: DatabaseSync, roomId: string): number {
  const room = db.prepare('SELECT revision FROM rooms WHERE id = ?').get(roomId) as { revision: number } | undefined
  if (!room) throw new ApiError('NOT_FOUND', 'Room not found')
  return room.revision
}

function screenIds(db: DatabaseSync, roomId: string): string[] {
  const rows = db.prepare('SELECT id FROM screens WHERE room_id = ? ORDER BY position').all(roomId) as unknown as { id: string }[]
  return rows.map((row) => row.id)
}

function readBoard(db: DatabaseSync, roomId: string): RoomBoard {
  const revision = roomRevision(db, roomId)
  // rowid keeps the insertion order: instances read back in the sent order, the layout follows them.
  const widgets = db
    .prepare('SELECT w.* FROM widgets w JOIN screens s ON s.id = w.screen_id WHERE s.room_id = ? ORDER BY w.rowid')
    .all(roomId) as unknown as WidgetRow[]
  return {
    roomId,
    revision,
    screens: screenIds(db, roomId).map((id) => {
      const rows = widgets.filter((row) => row.screen_id === id)
      return {
        id,
        instances: rows.map((row) => ({
          id: row.id,
          source: { kind: 'builtin' as const, type: row.source_type },
          configVersion: row.config_version,
          config: JSON.parse(row.config) as Record<string, unknown>,
        })),
        layout: rows.map((row) => ({ instanceId: row.id, x: row.x, y: row.y, w: row.w, h: row.h })),
      }
    }),
  }
}

// One transaction: 404, then 409, then 400, then the replacement (spec «PUT /rooms/:roomId/board»).
function saveBoard(db: DatabaseSync, roomId: string, body: SaveBoardRequest, now: Date): RoomBoard {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (roomRevision(db, roomId) !== body.expectedRevision) {
      throw new ApiError('REVISION_CONFLICT', 'The board changed since it was loaded')
    }
    const screens = validateScreens(body.screens as unknown[], screenIds(db, roomId))
    db.prepare('DELETE FROM widgets WHERE screen_id IN (SELECT id FROM screens WHERE room_id = ?)').run(roomId)
    const insert = db.prepare(
      'INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (const screen of screens) {
      for (const instance of screen.instances) {
        // parseScreenBoard guarantees exactly one placement per instance.
        const place = screen.layout.find((item) => item.instanceId === instance.id)!
        try {
          insert.run(
            instance.id,
            screen.id,
            instance.source.kind,
            instance.source.type,
            JSON.stringify(instance.config),
            instance.configVersion,
            place.x,
            place.y,
            place.w,
            place.h,
          )
        } catch (error) {
          if ((error as { errcode?: unknown }).errcode === SQLITE_CONSTRAINT_PRIMARYKEY) {
            throw new ApiError('VALIDATION_ERROR', `Widget id "${instance.id}" is already used`)
          }
          throw error
        }
      }
    }
    db.prepare('UPDATE rooms SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now.toISOString(), roomId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return readBoard(db, roomId)
}

function validateScreens(raw: unknown[], expectedIds: string[]): ScreenBoard[] {
  const screens: ScreenBoard[] = []
  const instanceIds = new Set<string>()
  for (const [index, item] of raw.entries()) {
    const result = parseScreenBoard(item)
    if (!result.ok) throw new ApiError('VALIDATION_ERROR', `screens[${index}]: ${result.error}`)
    for (const instance of result.value.instances) {
      if (instanceIds.has(instance.id)) {
        throw new ApiError('VALIDATION_ERROR', `screens[${index}]: widget id "${instance.id}" is used on another screen`)
      }
      instanceIds.add(instance.id)
    }
    screens.push(result.value)
  }
  // Step 1 of GO-3 cannot create or delete screens.
  if (screens.map((screen) => screen.id).join() !== expectedIds.join()) {
    throw new ApiError('VALIDATION_ERROR', 'Screens do not match the room')
  }
  return screens
}
```

In `apps/api/src/app.ts` add the import `import { registerRooms } from './rooms.ts'` and, after `registerAuth(...)`, the line:

```ts
  registerRooms(app, { db, now })
```

- [ ] **Step 4: Run the API suite**

```bash
pnpm -C apps/api exec vitest run && pnpm -C apps/api typecheck && pnpm -C apps/api build
```

Expected: PASS; `apps/api/dist` contains `app.js`, `auth.js`, `config.js`, `db.js`, `errors.js`, `migrations.js`, `rooms.js`, `server.js`.

- [ ] **Step 5: Smoke-test the built server**

```bash
LIFEDASHBOARD_DATA_DIR="$(mktemp -d)" LIFEDASHBOARD_API_PORT=3912 timeout 5 node apps/api/dist/server.js; echo "exit $?"
```

Expected: pairing code and `Server listening at http://127.0.0.1:3912`; `exit 124`. This proves `dist` loads `@lifedashboard/contracts` sources at runtime.

- [ ] **Step 6: Document the variables and pairing**

`.env.example`:

```bash
# Port of the LifeDashboard API (Fastify). The UI dev proxy reads the same value.
LIFEDASHBOARD_API_PORT=3001

# Absolute directory of lifedashboard.db. Default: the OS data directory
# (macOS: ~/Library/Application Support/LifeDashboard).
# LIFEDASHBOARD_DATA_DIR=

# Comma-separated browser origins allowed to call the API.
# LIFEDASHBOARD_UI_ORIGINS=http://127.0.0.1:3000
```

In `README.md` replace the `## Configuration` table and add a `## Pairing` section after it:

```markdown
## Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `LIFEDASHBOARD_API_PORT` | `3001` | API listen port and the UI dev proxy target |
| `LIFEDASHBOARD_DATA_DIR` | OS data directory (macOS: `~/Library/Application Support/LifeDashboard`) | Absolute directory of `lifedashboard.db` |
| `LIFEDASHBOARD_UI_ORIGINS` | `http://127.0.0.1:3000` | Comma-separated browser origins allowed to call the API |

Values from the process environment override the root `.env`.

## Pairing

The API prints `LifeDashboard pairing code: NNNNNN` in the `pnpm dev` terminal. Open
`http://127.0.0.1:3000` (not `localhost`, unless it is added to `LIFEDASHBOARD_UI_ORIGINS`) and
enter the code once. A code is valid for 10 minutes; «Новый код» prints a fresh one. The browser
then stays signed in while it is used at least once in 29 days.
```

In the `## Layout` section change the API line to:

```markdown
- `apps/api` — Fastify API: `GET /health`, pairing, rooms and boards in SQLite (`node:sqlite`).
- `packages/contracts` — grid, board types and validation shared by the API and the UI.
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/rooms.ts apps/api/src/app.ts apps/api/test/rooms.test.ts README.md .env.example
git commit -m "feat(api): room board routes with revision checks"
```

---

### Task 7: UI API client

**Files:**
- Create: `apps/ui/app/api.ts`, `apps/ui/test/api.test.ts`

**Interfaces:**
- Consumes: `RoomBoard`, `RoomSummary`, `SaveBoardRequest` (Task 1); routes from Tasks 5–6.
- Produces:
  ```ts
  const API_TIMEOUT_MS = 5000
  type ApiFailure = { kind: 'unauthorized' } | { kind: 'conflict' } | { kind: 'rate-limited' } | { kind: 'invalid'; message: string } | { kind: 'unavailable' }
  type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure)
  function apiRequest<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, timeoutMs?: number): Promise<ApiResult<T>>
  const api: {
    rooms(): Promise<ApiResult<RoomSummary[]>>
    board(roomId: string): Promise<ApiResult<RoomBoard>>
    saveBoard(roomId: string, request: SaveBoardRequest): Promise<ApiResult<RoomBoard>>
    pair(code: string): Promise<ApiResult<null>>
    pairCode(): Promise<ApiResult<null>>
  }
  ```

- [ ] **Step 1: Write the failing tests**

`apps/ui/test/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiRequest } from '../app/api'

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit]

function respond(status: number, body: unknown) {
  return vi.fn(async (..._args: FetchArgs) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('returns the data of a success envelope and sends a same-origin request with a timeout signal', async () => {
    const fetchMock = respond(200, { data: [{ id: 'r' }], meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.rooms()).toEqual({ ok: true, data: [{ id: 'r' }] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/rooms')
    expect(init?.method).toBe('GET')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.body).toBeUndefined()
  })

  it('sends a JSON body on PUT', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.saveBoard('room 1', { expectedRevision: 3, screens: [] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/rooms/room%201/board')
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe('{"expectedRevision":3,"screens":[]}')
  })

  it('sends an empty JSON object for a new pairing code', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.pairCode()
    expect(fetchMock.mock.calls[0]![1]?.body).toBe('{}')
  })

  it.each([
    [401, 'unauthorized'],
    [409, 'conflict'],
    [429, 'rate-limited'],
    [500, 'unavailable'],
    [502, 'unavailable'],
  ])('maps %i to %s', async (status, kind) => {
    vi.stubGlobal('fetch', respond(status, { error: { code: 'X', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.rooms()).toEqual({ ok: false, kind })
  })

  it('maps another 4xx to invalid with the server message', async () => {
    vi.stubGlobal('fetch', respond(400, { error: { code: 'VALIDATION_ERROR', message: 'bad rect', requestId: 'x', retryable: false } }))
    expect(await api.rooms()).toEqual({ ok: false, kind: 'invalid', message: 'bad rect' })
  })

  it('maps a network error to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await api.rooms()).toEqual({ ok: false, kind: 'unavailable' })
  })

  it('maps a non-JSON body to unavailable', async () => {
    vi.stubGlobal('fetch', respond(200, '<html>proxy error</html>'))
    expect(await api.rooms()).toEqual({ ok: false, kind: 'unavailable' })
  })

  it('times out when the headers never arrive', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    ))
    expect(await apiRequest('GET', '/rooms', undefined, 20)).toEqual({ ok: false, kind: 'unavailable' })
  })

  it('times out when the body never arrives', async () => {
    // Real fetch aborts reading the body when its signal fires; the stub does the same.
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    })))
    expect(await apiRequest('GET', '/rooms', undefined, 20)).toEqual({ ok: false, kind: 'unavailable' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -C apps/ui exec vitest run test/api.test.ts
```

Expected: FAIL — cannot resolve `../app/api`.

- [ ] **Step 3: Implement `api.ts`**

`apps/ui/app/api.ts`:

```ts
import type { RoomBoard, RoomSummary, SaveBoardRequest } from '@lifedashboard/contracts/board'

export const API_TIMEOUT_MS = 5000

export type ApiFailure =
  | { kind: 'unauthorized' }
  | { kind: 'conflict' }
  | { kind: 'rate-limited' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable' }

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure)

/** Never throws: every failure, including a timeout while the body is read, becomes a typed result. */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  timeoutMs = API_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  let response: Response
  let payload: unknown
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(timeoutMs),
    })
    payload = await response.json()
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
  if (response.ok && isRecord(payload) && 'data' in payload) return { ok: true, data: payload.data as T }
  if (response.status === 401) return { ok: false, kind: 'unauthorized' }
  if (response.status === 409) return { ok: false, kind: 'conflict' }
  if (response.status === 429) return { ok: false, kind: 'rate-limited' }
  if (response.status >= 400 && response.status < 500) return { ok: false, kind: 'invalid', message: errorMessage(payload) }
  return { ok: false, kind: 'unavailable' }
}

const boardPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}/board`

export const api = {
  rooms: () => apiRequest<RoomSummary[]>('GET', '/rooms'),
  board: (roomId: string) => apiRequest<RoomBoard>('GET', boardPath(roomId)),
  saveBoard: (roomId: string, request: SaveBoardRequest) => apiRequest<RoomBoard>('PUT', boardPath(roomId), request),
  pair: (code: string) => apiRequest<null>('POST', '/auth/pair', { code }),
  // The API requires a JSON body on every mutation.
  pairCode: () => apiRequest<null>('POST', '/auth/pair-code', {}),
}

function errorMessage(payload: unknown): string {
  return isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
    ? payload.error.message
    : 'Request rejected'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm -C apps/ui exec vitest run test/api.test.ts && pnpm -C apps/ui typecheck
```

Expected: PASS. (`fetchMock.mock.calls[0]![0]` is the URL string; `init.headers` is `undefined` for GET.)

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/api.ts apps/ui/test/api.test.ts
git commit -m "feat(ui): api client with typed failures and timeout"
```

---

### Task 8: Room sync, app states and the pairing form

**Files:**
- Create: `apps/ui/app/board/room-sync.ts`, `apps/ui/test/room-sync.test.ts`, `apps/ui/app/PairingForm.vue`
- Modify: `apps/ui/app/app.vue`, `apps/ui/app/board/WidgetBoard.vue` (exposed stubs only)

**Interfaces:**
- Consumes: `api` and `ApiResult` (Task 7); `RoomBoard`, `ScreenBoard` (Task 1).
- Produces:
  ```ts
  // room-sync.ts
  type ConnectResult = { state: 'ready'; roomId: string } | { state: 'pairing' | 'unavailable' }
  type LoadOutcome = 'loaded' | 'ignored' | 'unauthorized' | 'unavailable'
  type SaveOutcome = 'saved' | 'skipped' | 'conflict' | 'unauthorized' | 'invalid' | 'unavailable'
  function connect(client: Pick<typeof api, 'rooms'>): Promise<ConnectResult>
  function useRoomSync(client: Pick<typeof api, 'board' | 'saveBoard'>, roomId: () => string, idle: () => boolean): {
    room: Ref<RoomBoard | null>; saving: Ref<boolean>; loaded: ComputedRef<boolean>
    load(): Promise<LoadOutcome>; save(next: ScreenBoard): Promise<SaveOutcome>
  }
  ```
  `app.vue` state `'checking' | 'pairing' | 'ready' | 'unavailable'` and `roomId: Ref<string | null>`; `PairingForm` emits `paired`. Task 9 adds the board props and events.

The load and save decisions live in `room-sync.ts`, which uses only Vue reactivity and runs in the existing Vitest node environment. There is no component test harness (no DOM environment, no `@vue/test-utils`), so the components themselves — template wiring and the `PairingForm` texts — are verified by typecheck and the browser checks in Task 10.

- [ ] **Step 1: Write the failing room-sync tests**

`apps/ui/test/room-sync.test.ts`:

```ts
import type { RoomBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import { describe, expect, it, vi } from 'vitest'
import { connect, useRoomSync } from '../app/board/room-sync'

const ROOM = '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b01'
const SCREEN = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
const OTHER_SCREEN = '00000000-0000-4000-8000-0000000000ff'
const A = '00000000-0000-4000-8000-00000000000a'

function screen(ids: string[]): ScreenBoard {
  return {
    id: SCREEN,
    instances: ids.map((id) => ({ id, source: { kind: 'builtin', type: 'placeholder' }, configVersion: 1, config: {} })),
    layout: ids.map((id, index) => ({ instanceId: id, x: index, y: 0, w: 1, h: 1 })),
  }
}

function board(revision: number, ids: string[] = []): RoomBoard {
  return { roomId: ROOM, revision, screens: [screen(ids), { id: OTHER_SCREEN, instances: [], layout: [] }] }
}

const ok = <T>(data: T) => ({ ok: true as const, data })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const client = { board: vi.fn(), saveBoard: vi.fn() }
  const view = { idle: true }
  const sync = useRoomSync(client, () => ROOM, () => view.idle)
  return { client, view, sync }
}

async function loaded(revision = 1) {
  const s = setup()
  s.client.board.mockResolvedValueOnce(ok(board(revision)))
  expect(await s.sync.load()).toBe('loaded')
  return s
}

describe('connect', () => {
  it('is ready with the first room', async () => {
    const rooms = vi.fn().mockResolvedValue(ok([{ id: 'r1' }, { id: 'r2' }]))
    expect(await connect({ rooms })).toEqual({ state: 'ready', roomId: 'r1' })
  })

  it('asks for pairing on 401', async () => {
    const rooms = vi.fn().mockResolvedValue({ ok: false, kind: 'unauthorized' })
    expect(await connect({ rooms })).toEqual({ state: 'pairing' })
  })

  it.each([
    ['no room', ok([])],
    ['an unavailable API', { ok: false, kind: 'unavailable' }],
    ['a rejected request', { ok: false, kind: 'invalid', message: 'm' }],
  ])('is unavailable for %s', async (_name, result) => {
    expect(await connect({ rooms: vi.fn().mockResolvedValue(result) })).toEqual({ state: 'unavailable' })
  })
})

describe('load', () => {
  it('stores the board of the room', async () => {
    const { client, sync } = setup()
    client.board.mockResolvedValueOnce(ok(board(1)))
    expect(sync.loaded.value).toBe(false)
    expect(await sync.load()).toBe('loaded')
    expect(client.board).toHaveBeenCalledWith(ROOM)
    expect(sync.room.value).toEqual(board(1))
    expect(sync.loaded.value).toBe(true)
  })

  it.each([
    ['unauthorized', 'unauthorized'],
    ['unavailable', 'unavailable'],
    ['rate-limited', 'unavailable'],
  ])('reports a failed %s load as %s and keeps nothing', async (kind, outcome) => {
    const { client, sync } = setup()
    client.board.mockResolvedValueOnce({ ok: false, kind })
    expect(await sync.load()).toBe(outcome)
    expect(sync.room.value).toBeNull()
  })

  it('replaces the board on a later load in view mode', async () => {
    const { client, sync } = await loaded(1)
    client.board.mockResolvedValueOnce(ok(board(2, [A])))
    expect(await sync.load()).toBe('loaded')
    expect(sync.room.value?.revision).toBe(2)
  })

  it('ignores a load that finishes after a mode was opened, so the save keeps the old revision', async () => {
    const { client, view, sync } = await loaded(1)
    const late = deferred<unknown>()
    client.board.mockReturnValueOnce(late.promise)
    const pending = sync.load() // the tab became visible in view mode
    view.idle = false // «Изменить» was pressed before the response
    late.resolve(ok(board(2, [A])))
    expect(await pending).toBe('ignored')
    expect(sync.room.value).toEqual(board(1))

    client.saveBoard.mockResolvedValueOnce({ ok: false, kind: 'conflict' })
    expect(await sync.save(screen([]))).toBe('conflict')
    expect(client.saveBoard.mock.calls[0]![1].expectedRevision).toBe(1)
  })

  it('ignores a failed load while a mode is open', async () => {
    const { client, view, sync } = await loaded(1)
    view.idle = false
    client.board.mockResolvedValueOnce({ ok: false, kind: 'unavailable' })
    expect(await sync.load()).toBe('ignored')
    expect(sync.room.value).toEqual(board(1))
  })
})

describe('save', () => {
  it('is skipped before the first load', async () => {
    const { client, sync } = setup()
    expect(await sync.save(screen([A]))).toBe('skipped')
    expect(client.saveBoard).not.toHaveBeenCalled()
  })

  it('sends the loaded revision with only the given screen replaced and stores the response', async () => {
    const { client, sync } = await loaded(1)
    client.saveBoard.mockResolvedValueOnce(ok(board(2, [A])))
    expect(await sync.save(screen([A]))).toBe('saved')
    expect(client.saveBoard).toHaveBeenCalledWith(ROOM, { expectedRevision: 1, screens: board(2, [A]).screens })
    expect(sync.room.value).toEqual(board(2, [A]))
    expect(sync.saving.value).toBe(false)
  })

  it('is saving while the request runs and skips a second save', async () => {
    const { client, sync } = await loaded(1)
    const reply = deferred<unknown>()
    client.saveBoard.mockReturnValueOnce(reply.promise)
    const first = sync.save(screen([A]))
    expect(sync.saving.value).toBe(true)
    expect(await sync.save(screen([A]))).toBe('skipped')
    reply.resolve(ok(board(2, [A])))
    expect(await first).toBe('saved')
    expect(sync.saving.value).toBe(false)
    expect(client.saveBoard).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['conflict', 'conflict'],
    ['unauthorized', 'unauthorized'],
    ['invalid', 'invalid'],
    ['unavailable', 'unavailable'],
    ['rate-limited', 'unavailable'],
  ])('reports a failed %s save as %s and keeps the loaded board', async (kind, outcome) => {
    const { client, sync } = await loaded(1)
    client.saveBoard.mockResolvedValueOnce({ ok: false, kind, message: 'm' })
    expect(await sync.save(screen([A]))).toBe(outcome)
    expect(sync.room.value).toEqual(board(1))
    expect(sync.saving.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -C apps/ui exec vitest run test/room-sync.test.ts
```

Expected: FAIL — cannot resolve `../app/board/room-sync`.

- [ ] **Step 3: Implement `room-sync.ts`**

`apps/ui/app/board/room-sync.ts`:

```ts
import { computed, ref } from 'vue'
import type { RoomBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import type { api } from '../api'

export type ConnectResult = { state: 'ready'; roomId: string } | { state: 'pairing' | 'unavailable' }
export type LoadOutcome = 'loaded' | 'ignored' | 'unauthorized' | 'unavailable'
export type SaveOutcome = 'saved' | 'skipped' | 'conflict' | 'unauthorized' | 'invalid' | 'unavailable'

/** The first room decides the app state: 401 asks for pairing; no room or no API is unavailable. */
export async function connect(client: Pick<typeof api, 'rooms'>): Promise<ConnectResult> {
  const result = await client.rooms()
  if (result.ok) return result.data[0] ? { state: 'ready', roomId: result.data[0].id } : { state: 'unavailable' }
  return { state: result.kind === 'unauthorized' ? 'pairing' : 'unavailable' }
}

/**
 * The loaded board of one room. `idle()` is true while no build or edit mode is open. A load that
 * finishes after a mode opened is dropped, so a working copy is always saved with the revision of
 * the snapshot it was taken from (DATA-06); the save then meets any conflict or error itself.
 */
export function useRoomSync(client: Pick<typeof api, 'board' | 'saveBoard'>, roomId: () => string, idle: () => boolean) {
  const room = ref<RoomBoard | null>(null)
  // True while a PUT runs: the board ignores input so the working copy cannot change meanwhile.
  const saving = ref(false)
  const loaded = computed(() => room.value !== null)

  async function load(): Promise<LoadOutcome> {
    const result = await client.board(roomId())
    if (room.value !== null && (!idle() || saving.value)) return 'ignored'
    if (!result.ok) return result.kind === 'unauthorized' ? 'unauthorized' : 'unavailable'
    room.value = result.data
    return 'loaded'
  }

  // Saves one screen with the loaded revision; the server decides about conflicts.
  async function save(next: ScreenBoard): Promise<SaveOutcome> {
    const current = room.value
    if (!current || saving.value) return 'skipped'
    saving.value = true
    const result = await client.saveBoard(roomId(), {
      expectedRevision: current.revision,
      screens: current.screens.map((screen) => (screen.id === next.id ? next : screen)),
    })
    saving.value = false
    if (result.ok) {
      room.value = result.data
      return 'saved'
    }
    if (result.kind === 'conflict' || result.kind === 'unauthorized' || result.kind === 'invalid') return result.kind
    return 'unavailable'
  }

  return { room, saving, loaded, load, save }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm -C apps/ui exec vitest run test/room-sync.test.ts && pnpm -C apps/ui typecheck
```

Expected: PASS.

- [ ] **Step 5: Create `PairingForm.vue`**

`apps/ui/app/PairingForm.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { api } from './api'

const emit = defineEmits<{ paired: [] }>()

const code = ref('')
const message = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  busy.value = true
  const result = await api.pair(code.value.trim())
  busy.value = false
  if (result.ok) {
    emit('paired')
    return
  }
  message.value =
    result.kind === 'unauthorized'
      ? 'Неверный или истёкший код'
      : result.kind === 'unavailable'
        ? 'API: недоступен'
        : 'Не удалось войти'
}

async function requestCode() {
  const result = await api.pairCode()
  message.value = result.ok
    ? 'Новый код выведен в терминал API'
    : result.kind === 'rate-limited'
      ? 'Подождите несколько секунд'
      : 'API: недоступен'
}
</script>

<template>
  <form class="pairing" @submit.prevent="submit">
    <h2 class="pairing__title">Подключение к API</h2>
    <label class="pairing__label">
      Код из терминала API
      <input
        v-model="code"
        class="pairing__input"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="12"
        required
        autofocus
      />
    </label>
    <div class="pairing__actions">
      <button type="submit" class="app__button" :disabled="busy">Войти</button>
      <button type="button" class="app__button" @click="requestCode">Новый код</button>
    </div>
    <p class="pairing__message" role="status">{{ message }}</p>
  </form>
</template>

<style scoped>
.pairing {
  display: grid;
  gap: 1rem;
  width: 22rem;
  margin: 4rem auto 0;
  padding: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-2);
  color: var(--ld-text-primary);
}

.pairing__title {
  margin: 0;
  font-size: 1.125rem;
}

.pairing__label {
  display: grid;
  gap: 0.5rem;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}

.pairing__input {
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  font-size: 1.25rem;
  letter-spacing: 0.2em;
}

.pairing__input:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.pairing__actions {
  display: flex;
  gap: 0.75rem;
}

.pairing__message {
  min-height: 1.25rem;
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}
</style>
```

- [ ] **Step 6: Replace the health check in `app.vue` with app states**

Replace the whole `<script setup>` block of `apps/ui/app/app.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { api } from './api'
import WidgetBoard from './board/WidgetBoard.vue'
import type { BoardMode } from './board/edit-session'
import { connect } from './board/room-sync'
import PairingForm from './PairingForm.vue'
import { loadAppearance, saveAppearance } from './theme/appearance'
import { BUILTIN_THEMES, BUILTIN_THEME_IDS, themeMeta } from './theme/builtin'
import { resolveThemeId, themeClass } from './theme/resolve'

type AppState = 'checking' | 'pairing' | 'ready' | 'unavailable'

const state = ref<AppState>('checking')
// The first room; the rooms UI arrives with step 2 of GO-3.
const roomId = ref<string | null>(null)
// A failed save keeps the board but marks the API as unavailable in the header.
const apiDown = ref(false)
const mode = ref<BoardMode>('view')
const notice = ref<string | null>(null)
const boardRef = useTemplateRef('board')

const apiLabel = computed(() => {
  if (state.value === 'unavailable' || apiDown.value) return 'API: недоступен'
  return state.value === 'checking' ? 'API: проверка…' : 'API: работает'
})

// Workspace theme; Rooms (E2) will put their own id in front of it in the chain.
const storedThemeId = loadAppearance().themeId
const themeId = ref(resolveThemeId([storedThemeId], BUILTIN_THEME_IDS))
// An unknown stored id (deleted theme) is kept as it is; the default theme is shown meanwhile.
const themeNotice = ref<string | null>(
  storedThemeId !== null && !BUILTIN_THEME_IDS.has(storedThemeId) ? 'Тема не найдена, показана тема по умолчанию' : null,
)
const headerNotice = computed(() => [notice.value, themeNotice.value].filter(Boolean).join(' · ') || null)

function selectTheme(event: Event) {
  themeId.value = resolveThemeId([(event.target as HTMLSelectElement).value], BUILTIN_THEME_IDS)
  // A failed save keeps the theme applied for this session.
  themeNotice.value = saveAppearance({ schemaVersion: 1, themeId: themeId.value }) ? null : 'Не удалось сохранить тему'
}

const rootClass = computed(() => [
  'room',
  `room--theme-${themeClass(themeId.value)}`,
  `room--skin-${themeMeta(themeId.value).skin}`,
])

async function check() {
  state.value = 'checking'
  mode.value = 'view'
  notice.value = null
  apiDown.value = false
  const result = await connect(api)
  if (result.state === 'ready') roomId.value = result.roomId
  state.value = result.state
}

onMounted(check)
</script>
```

Replace the `<template>` block:

```vue
<template>
  <div :class="rootClass">
    <div class="room__backdrop" />
    <div class="app">
      <header class="app__header">
        <h1 class="app__title">LifeDashboard</h1>
        <template v-if="state === 'ready'">
          <template v-if="mode !== 'view'">
            <button type="button" class="app__button" :disabled="boardRef?.saving" @click="boardRef?.confirm()">
              Готово
            </button>
            <button type="button" class="app__button" :disabled="boardRef?.saving" @click="boardRef?.cancel()">
              Отмена
            </button>
          </template>
          <template v-else>
            <!-- Disabled until the board is loaded: a draft on an empty placeholder board could not be saved. -->
            <button
              type="button"
              class="app__button"
              aria-label="Добавить виджет"
              :disabled="!boardRef?.loaded"
              @click="mode = 'build'"
            >
              +
            </button>
            <button type="button" class="app__button" :disabled="!boardRef?.hasWidgets" @click="mode = 'edit'">
              Изменить
            </button>
          </template>
        </template>
        <label class="app__theme">
          Тема
          <select class="app__select" :value="themeId" @change="selectTheme">
            <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
          </select>
        </label>
        <p class="app__notice" role="status">{{ headerNotice }}</p>
        <p class="app__api">{{ apiLabel }}</p>
      </header>
      <main class="app__main">
        <p v-if="state === 'checking'" class="app__status">Подключение…</p>
        <PairingForm v-else-if="state === 'pairing'" @paired="check" />
        <div v-else-if="state === 'unavailable'" class="app__status">
          <p>API: недоступен</p>
          <button type="button" class="app__button" @click="check">Повторить</button>
        </div>
        <WidgetBoard v-else ref="board" v-model:mode="mode" :theme-id="themeId" @notice="notice = $event" />
      </main>
    </div>
    <p class="app__narrow">Окно слишком узкое</p>
  </div>
</template>
```

In the `<style>` block add after `.app__main`:

```css
.app__status {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  margin: 4rem 0 0;
  color: var(--ld-text-muted);
}
```

`WidgetBoard` still uses `localStorage` in this task: it is always loaded and never saving. Expose both flags now to keep the template typed:

In `apps/ui/app/board/WidgetBoard.vue`, change the import line `import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'` (unchanged) and replace `defineExpose({ confirm, cancel, hasWidgets })` with:

```ts
// Replaced by room-sync in the next task of the plan (board on the API).
const saving = ref(false)
const loaded = ref(true)

defineExpose({ confirm, cancel, hasWidgets, saving, loaded })
```

- [ ] **Step 7: Typecheck and run the UI suite**

```bash
pnpm -C apps/ui typecheck && pnpm -C apps/ui exec vitest run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/ui/app/board/room-sync.ts apps/ui/test/room-sync.test.ts apps/ui/app/PairingForm.vue apps/ui/app/app.vue apps/ui/app/board/WidgetBoard.vue
git commit -m "feat(ui): room sync, pairing form and api connection states"
```

---

### Task 9: Board on the API

**Files:**
- Modify: `apps/ui/app/board/edit-session.ts`, `apps/ui/app/board/WidgetBoard.vue`, `apps/ui/app/app.vue`, `apps/ui/app/widgets/WidgetHost.vue`
- Delete: `apps/ui/app/widgets/board-document.ts`, `apps/ui/test/board-document.test.ts`
- Create: `apps/ui/test/catalog.test.ts`
- Test: `apps/ui/test/edit-session.test.ts`

**Interfaces:**
- Consumes: `api` (Task 7); `useRoomSync` (Task 8); `ScreenBoard`, `WidgetInstance`, `WidgetSource`, `WidgetPlacement`, `parseScreenBoard` (Task 1); `app.vue` states (Task 8).
- Produces:
  - `edit-session.ts`: `BoardMode`, `setPlacement(doc: ScreenBoard, id, rect): ScreenBoard`, `removeInstance(doc: ScreenBoard, id): ScreenBoard`, `isSameBoard(a: ScreenBoard, b: ScreenBoard): boolean`, `readingOrder`, `focusAfterRemoval`. `ConfirmOutcome` and `confirmOutcome` are removed.
  - `WidgetBoard.vue`: props `{ roomId: string; themeId: string }`; model `mode`; emits `notice: [string | null]`, `api: ['ok' | 'down']`, `unauthorized: []`, `unavailable: []`; exposes `{ confirm, cancel, hasWidgets, saving, loaded }`.

- [ ] **Step 1: Rewrite the edit-session tests for `ScreenBoard`**

Replace `apps/ui/test/edit-session.test.ts`:

```ts
import { parseScreenBoard, type ScreenBoard } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setPlacement } from '../app/board/edit-session'

const placeholder = { kind: 'builtin', type: 'placeholder' } as const
const SCREEN = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

// Layout order differs from reading order on purpose: B (0,0), A (4,0), C (0,3).
const board: ScreenBoard = {
  id: SCREEN,
  instances: [
    { id: A, source: { ...placeholder }, configVersion: 1, config: {} },
    { id: B, source: { ...placeholder }, configVersion: 1, config: {} },
    { id: C, source: { ...placeholder }, configVersion: 1, config: {} },
  ],
  layout: [
    { instanceId: A, x: 4, y: 0, w: 2, h: 2 },
    { instanceId: B, x: 0, y: 0, w: 2, h: 2 },
    { instanceId: C, x: 0, y: 3, w: 1, h: 1 },
  ],
}

describe('setPlacement', () => {
  it('changes only the target placement and does not mutate its input', () => {
    const before = structuredClone(board)
    const next = setPlacement(board, A, { x: 6, y: 1, w: 3, h: 2 })
    expect(next.layout).toEqual([{ instanceId: A, x: 6, y: 1, w: 3, h: 2 }, board.layout[1], board.layout[2]])
    expect(next.instances).toBe(board.instances)
    expect(next.id).toBe(SCREEN)
    expect(board).toEqual(before)
  })

  it('copies only the rect fields of the given rect', () => {
    const next = setPlacement(board, A, { ...board.layout[1]!, x: 6 })
    expect(next.layout[0]).toEqual({ instanceId: A, x: 6, y: 0, w: 2, h: 2 })
  })
})

describe('removeInstance', () => {
  it('removes the instance with its placement and keeps the screen valid', () => {
    const before = structuredClone(board)
    const next = removeInstance(board, B)
    expect(next.instances.map((item) => item.id)).toEqual([A, C])
    expect(next.layout.map((item) => item.instanceId)).toEqual([A, C])
    expect(parseScreenBoard(next)).toEqual({ ok: true, value: next })
    expect(board).toEqual(before)
  })

  it('returns an equal screen for an unknown id', () => {
    expect(removeInstance(board, 'zzz')).toEqual(board)
  })
})

describe('isSameBoard', () => {
  it('is true for equal screens', () => {
    expect(isSameBoard(board, structuredClone(board))).toBe(true)
  })

  it('is false when the layout differs', () => {
    expect(isSameBoard(board, setPlacement(board, C, { x: 1, y: 3, w: 1, h: 1 }))).toBe(false)
  })

  it('is false when the instances differ', () => {
    const changed = structuredClone(board)
    changed.instances[0]!.config = { title: 'x' }
    expect(isSameBoard(board, changed)).toBe(false)
  })
})

describe('readingOrder', () => {
  it('sorts placements by row, then column, without mutating the input', () => {
    const before = structuredClone(board.layout)
    expect(readingOrder(board.layout).map((item) => item.instanceId)).toEqual([B, A, C])
    expect(board.layout).toEqual(before)
  })
})

describe('focusAfterRemoval', () => {
  it('picks the next widget in reading order', () => {
    expect(focusAfterRemoval(board.layout, B)).toBe(A)
  })

  it('picks the previous widget when the last one is removed', () => {
    expect(focusAfterRemoval(board.layout, C)).toBe(A)
  })

  it('returns null for the only widget and for an unknown id', () => {
    expect(focusAfterRemoval([board.layout[0]!], A)).toBeNull()
    expect(focusAfterRemoval(board.layout, 'zzz')).toBeNull()
  })
})
```

Move the catalog test out of the file that is about to be deleted — `apps/ui/test/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findManifest } from '../app/widgets/catalog'

describe('catalog', () => {
  it('describes the placeholder and nothing else', () => {
    expect(findManifest('placeholder')?.sizing).toEqual({
      default: { w: 4, h: 4 },
      min: { w: 1, h: 1 },
      max: { w: 12, h: 8 },
    })
    expect(findManifest('toString')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm -C apps/ui exec vitest run test/edit-session.test.ts test/catalog.test.ts
```

Expected: both PASS. This step is a type port, not a behaviour change: the helpers are type-agnostic at runtime, and `nuxt typecheck` does not cover `apps/ui/test`. The guard for Steps 3–5 is `pnpm -C apps/ui typecheck` in Step 6, which fails while `WidgetBoard.vue` and `edit-session.ts` still use `BoardDocument`. The load and save decisions were driven by failing tests in Task 8 (`room-sync`); this task only wires them into the component, which typecheck and the browser checks in Task 10 cover.

- [ ] **Step 3: Port `edit-session.ts` to `ScreenBoard`**

Replace `apps/ui/app/board/edit-session.ts`:

```ts
import type { ScreenBoard, WidgetPlacement } from '@lifedashboard/contracts/board'
import type { Rect } from '@lifedashboard/contracts/grid'

/** Board interaction mode: display only, the builder draft, or editing the placed widgets. */
export type BoardMode = 'view' | 'build' | 'edit'

export function setPlacement(doc: ScreenBoard, id: string, rect: Rect): ScreenBoard {
  // Only the rect fields are copied: callers may pass a placement or a rect with extra keys.
  const placement = { instanceId: id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  return { ...doc, layout: doc.layout.map((item) => (item.instanceId === id ? placement : item)) }
}

export function removeInstance(doc: ScreenBoard, id: string): ScreenBoard {
  return {
    ...doc,
    instances: doc.instances.filter((item) => item.id !== id),
    layout: doc.layout.filter((item) => item.instanceId !== id),
  }
}

// ponytail: JSON comparison is key-order sensitive; both sides come from the API response or the
// helpers above, which keep its key order. Switch to a structural compare if other sources appear.
export function isSameBoard(a: ScreenBoard, b: ScreenBoard): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Placements by row, then column. */
export function readingOrder(layout: readonly WidgetPlacement[]): WidgetPlacement[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** The widget to focus after deleting `id`: the next in reading order, else the previous one. */
export function focusAfterRemoval(layout: readonly WidgetPlacement[], id: string): string | null {
  const order = readingOrder(layout)
  const index = order.findIndex((item) => item.instanceId === id)
  if (index < 0) return null
  return (order[index + 1] ?? order[index - 1])?.instanceId ?? null
}
```

In `apps/ui/app/widgets/WidgetHost.vue` change `import type { WidgetSource } from './board-document'` to `import type { WidgetSource } from '@lifedashboard/contracts/board'`.

- [ ] **Step 4: Move `WidgetBoard.vue` to the API**

Replace the whole `<script setup>` block of `apps/ui/app/board/WidgetBoard.vue`:

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { ScreenBoard, WidgetInstance, WidgetSource } from '@lifedashboard/contracts/board'
import { GRID, findFreeRect, type Rect } from '@lifedashboard/contracts/grid'
import { api } from '../api'
import { findManifest, placeholderManifest } from '../widgets/catalog'
import WidgetHost from '../widgets/WidgetHost.vue'
import { focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setPlacement, type BoardMode } from './edit-session'
import { isFormControlTarget } from './keyboard'
import { useRoomSync } from './room-sync'
import { useActiveRect } from './use-active-rect'

const mode = defineModel<BoardMode>('mode', { required: true })
const props = defineProps<{ roomId: string; themeId: string }>()
const emit = defineEmits<{
  notice: [message: string | null]
  // 'down' after a failed save: the board stays, the header shows the API as unavailable.
  api: [status: 'ok' | 'down']
  unauthorized: []
  // A load failed: the app replaces the board with «Повторить».
  unavailable: []
}>()

const draftSource: WidgetSource = { kind: 'builtin', type: placeholderManifest.type }
const sizing = placeholderManifest.sizing
const cells = Array.from({ length: GRID.cols * GRID.rows }, (_, index) => ({
  x: index % GRID.cols,
  y: Math.floor(index / GRID.cols),
  w: 1,
  h: 1,
}))
const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}
// A card that is not active fills its grid area.
const fill = { width: '100%', height: '100%' }
const emptyScreen: ScreenBoard = { id: '', instances: [], layout: [] }

// A load that finishes while a mode is open is dropped (DATA-06); `saving` blocks input during a PUT.
const { room, saving, loaded, load: loadRoom, save: saveRoom } = useRoomSync(
  api,
  () => props.roomId,
  () => mode.value === 'view',
)
// The board shows the first screen; screens get their own UI in step 3 of GO-3.
const doc = computed<ScreenBoard>(() => room.value?.screens[0] ?? emptyScreen)
// Edit mode changes a working copy; `doc` keeps the loaded screen for the «unchanged» check.
const working = ref<ScreenBoard>(emptyScreen)
const activeId = ref<string | null>(null)
// Template ref keys must differ from setup bindings: ref="draft" would overwrite a setup binding.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')

const editing = computed(() => mode.value === 'edit')
const hasWidgets = computed(() => doc.value.layout.length > 0)

const placed = computed(() => {
  const shown = editing.value ? working.value : doc.value
  return shown.layout.flatMap((placement) => {
    const instance = shown.instances.find((item) => item.id === placement.instanceId)
    return instance ? [{ instance, placement }] : []
  })
})

function sizingOf(instance: WidgetInstance) {
  return findManifest(instance.source.type)?.sizing ?? null
}

const activeSizing = computed(() => {
  const instance = working.value.instances.find((item) => item.id === activeId.value)
  return instance ? sizingOf(instance) : null
})

const {
  rect: activeRect,
  moving,
  cardStyle,
  activate,
  deactivate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  step,
} = useActiveRect({
  gridEl,
  others: () =>
    editing.value ? working.value.layout.filter((item) => item.instanceId !== activeId.value) : doc.value.layout,
  sizing: () => (editing.value ? activeSizing.value : sizing),
})

// Every change of the edited widget's rect lands in the working copy at once.
watch(
  activeRect,
  (rect) => {
    if (editing.value && rect && activeId.value) working.value = setPlacement(working.value, activeId.value, rect)
  },
  { flush: 'sync' },
)

function rectLabel(rect: Rect) {
  return `Виджет ${rect.w}×${rect.h}, колонка ${rect.x + 1}, ряд ${rect.y + 1}`
}

const liveLabel = computed(() => (activeRect.value ? rectLabel(activeRect.value) : ''))

function area(rect: Rect) {
  return { gridColumn: `${rect.x + 1} / span ${rect.w}`, gridRow: `${rect.y + 1} / span ${rect.h}` }
}

async function load() {
  const outcome = await loadRoom()
  if (outcome === 'loaded') emit('api', 'ok')
  else if (outcome === 'unauthorized') emit('unauthorized')
  else if (outcome === 'unavailable') emit('unavailable')
}

async function save(next: ScreenBoard) {
  const outcome = await saveRoom(next)
  if (outcome === 'saved') {
    emit('api', 'ok')
    emit('notice', null)
    stop()
  } else if (outcome === 'conflict') {
    // Leaving the mode first makes the reload apply.
    stop()
    emit('notice', 'Доска изменена в другой вкладке')
    await load()
  } else if (outcome === 'unauthorized') {
    emit('unauthorized')
  } else if (outcome === 'invalid') {
    // The mode and the working copy stay: nothing unsaved is shown as saved (DATA-05).
    emit('notice', 'Не удалось сохранить: данные отклонены')
  } else if (outcome === 'unavailable') {
    emit('api', 'down')
    emit('notice', 'Не удалось сохранить, повторите')
  }
}

function start() {
  emit('notice', null)
  const others = doc.value.layout
  const rect = findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others)
  if (!rect) {
    emit('notice', 'Нет свободного места')
    mode.value = 'view'
    return
  }
  activate(rect)
  void nextTick(() => draftEl.value?.focus())
}

function enterEdit() {
  emit('notice', null)
  working.value = doc.value
  activeId.value = null
  const first = readingOrder(working.value.layout)[0]
  if (first) void nextTick(() => focusWidget(first.instanceId))
}

function stop() {
  deactivate()
  activeId.value = null
  mode.value = 'view'
}

function focusWidget(id: string) {
  gridEl.value?.querySelector<HTMLElement>(`[data-instance="${CSS.escape(id)}"]`)?.focus()
}

// Makes a widget active. Grabbing the widget that is already active keeps its visible pose.
function select(id: string) {
  if (activeId.value === id) return
  const placement = working.value.layout.find((item) => item.instanceId === id)
  if (!placement) return
  activeId.value = id
  activate(placement)
}

function grab(event: PointerEvent, id: string, how: 'move' | 'resize') {
  select(id)
  onPointerDown(event, how)
}

function removeWidget(id: string) {
  const next = focusAfterRemoval(working.value.layout, id)
  if (activeId.value === id) {
    deactivate()
    activeId.value = null
  }
  working.value = removeInstance(working.value, id)
  if (next) void nextTick(() => focusWidget(next))
}

function confirmBuild() {
  const rect = activeRect.value
  if (!rect) return
  const id = crypto.randomUUID()
  void save({
    ...doc.value,
    instances: [...doc.value.instances, { id, source: { ...draftSource }, configVersion: 1, config: {} }],
    layout: [...doc.value.layout, { instanceId: id, ...rect }],
  })
}

function confirmEdit() {
  if (isSameBoard(working.value, doc.value)) stop()
  else void save(working.value)
}

function confirm() {
  if (saving.value) return
  if (editing.value) confirmEdit()
  else confirmBuild()
}

function cancel() {
  if (!saving.value) stop()
}

function onKeydown(event: KeyboardEvent) {
  if (saving.value || mode.value === 'view' || isFormControlTarget(event.target)) return
  const arrow = arrows[event.key]
  if (arrow) {
    if (!activeRect.value) return
    event.preventDefault()
    step(arrow[0], arrow[1], event.shiftKey)
  } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
    // A focused button handles Enter itself (Готово confirms, Отмена cancels, × deletes).
    event.preventDefault()
    confirm()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  } else if (
    editing.value &&
    activeId.value &&
    (event.key === 'Delete' || event.key === 'Backspace') &&
    event.target instanceof Node &&
    gridEl.value?.contains(event.target)
  ) {
    // Only from inside the board, so Backspace on a header button never deletes a widget.
    event.preventDefault()
    removeWidget(activeId.value)
  }
}

// Picks up saves from other tabs; the API is not polled (spec «UI flow»).
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && mode.value === 'view' && !saving.value) void load()
}

watch(mode, (next) => {
  if (next === 'build' && !activeRect.value) start()
  else if (next === 'edit') enterEdit()
})

onMounted(() => {
  void load()
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

defineExpose({ confirm, cancel, hasWidgets, saving, loaded })
</script>
```

In the template of the same file change the grid opening tag so pointer and focus input stop while saving:

```vue
    <div
      ref="gridBox"
      class="board__grid"
      :class="{ 'board__grid--building': mode === 'build' }"
      :inert="saving"
    >
```

Delete the old storage files:

```bash
git rm apps/ui/app/widgets/board-document.ts apps/ui/test/board-document.test.ts
```

- [ ] **Step 5: Connect the board events in `app.vue`**

In `apps/ui/app/app.vue` add two handlers before `onMounted(check)`:

```ts
function onUnauthorized() {
  // An unsaved working copy is discarded; pairing starts over (spec «App states»).
  mode.value = 'view'
  notice.value = null
  state.value = 'pairing'
}

function onUnavailable() {
  mode.value = 'view'
  state.value = 'unavailable'
}
```

Replace the `<WidgetBoard … />` line of the template:

```vue
        <WidgetBoard
          v-else-if="roomId"
          ref="board"
          v-model:mode="mode"
          :room-id="roomId"
          :theme-id="themeId"
          @notice="notice = $event"
          @api="apiDown = $event === 'down'"
          @unauthorized="onUnauthorized"
          @unavailable="onUnavailable"
        />
```

- [ ] **Step 6: Check that no storage code is left and run the UI checks**

```bash
grep -rn "board-document\|BOARD_STORAGE_KEY\|loadBoard\|saveBoard(doc\|confirmOutcome" apps/ui/app apps/ui/test
pnpm -C apps/ui typecheck && pnpm -C apps/ui exec vitest run && pnpm -C apps/ui build
```

Expected: `grep` prints nothing; typecheck, tests and `nuxt generate` pass.

- [ ] **Step 7: Commit**

```bash
git add apps/ui/app apps/ui/test
git commit -m "feat(ui): load and save the board through the api"
```

---

### Task 10: Full verification and browser acceptance

**Files:** none changed unless a check fails (then fix in the owning task's files and commit with `fix(scope): …`).

- [ ] **Step 1: Run the whole workspace**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: all three pass for `packages/contracts`, `apps/api`, `apps/ui`. Record the summary lines (test counts) for the final report.

- [ ] **Step 2: Start the app on a throwaway data directory**

```bash
export LIFEDASHBOARD_DATA_DIR="$(mktemp -d)"
pnpm dev
```

Run it in a background terminal; note the pairing code line. Confirm `ls "$LIFEDASHBOARD_DATA_DIR"` shows `lifedashboard.db` and that `git status --short` shows no database file in the repository (acceptance 1).

- [ ] **Step 3: Browser acceptance in Orca's built-in browser**

Load the `orca-cli` skill and control Orca's built-in browser through `orca` (project rule: no external browser). Open `http://127.0.0.1:3000` and check, in order:

1. The pairing form appears; a wrong code shows «Неверный или истёкший код»; «Новый код» shows «Новый код выведен в терминал API» and a new code appears in the terminal; pressing it again at once shows «Подождите несколько секунд».
2. The current code opens the board; the header shows «API: работает»; reloading the page does not ask for a code (acceptance 2).
3. Add two widgets, move and resize one in «Изменить», delete one, «Готово». Restart `pnpm dev` (Ctrl+C, start again) and reload: the board is unchanged and no code is asked (acceptance 3, Review Focus 1).
4. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/v1/rooms -H 'Host: 127.0.0.1:3001'` prints `401`; adding `-H 'Origin: http://evil.test'` prints `403`, and `-H 'Host: evil.test:3001'` instead prints `403` (acceptance 4). The Host/Origin check runs before the session check, so no cookie is needed.
5. In the first tab enter «Изменить» and move a widget, without saving. Open a second tab, move a widget there and press «Готово». Return to the first tab (still in edit mode, so it does not reload) and press «Готово»: the notice is «Доска изменена в другой вкладке» and the first tab shows the second tab's board (acceptance 5).
6. Stop only the API (`pkill -f 'src/server.ts'`; `pnpm dev` starts it as `node --watch … src/server.ts`), switch tabs away and back: «API: недоступен» with «Повторить», no «+»/«Изменить». Start the API again (`pnpm -C apps/api dev`), press «Повторить»: the board returns (acceptance 6).
7. With the API running, enter «Изменить» and move a widget (an unchanged board does not send a `PUT`). Stop the API, press «Готово»: the mode and the moved widget stay, the notice is «Не удалось сохранить, повторите», the header shows «API: недоступен». Start the API, press «Готово» again: saved, and a reload shows the moved widget (acceptance 6).
8. Enter «Изменить» and move a widget. Pause the API process (`kill -STOP <api pid>`), press «Готово» and confirm in the browser's network panel that the `PUT` is pending and «Готово»/«Отмена» are disabled. Try arrows, Enter, Escape and dragging: nothing changes until the 5-second timeout reports «Не удалось сохранить, повторите»; then `kill -CONT <api pid>` (acceptance 7).
9. Stop `pnpm dev` (Ctrl+C) and wait for it to exit, so the database is closed and its WAL is checkpointed. Raise the schema version of a copy of the database and start the API on the copy:
   ```bash
   COPY="$(mktemp -d)"
   cp "$LIFEDASHBOARD_DATA_DIR/lifedashboard.db" "$COPY/"
   node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA user_version = 99');d.close()" "$COPY/lifedashboard.db"
   LIFEDASHBOARD_DATA_DIR="$COPY" LIFEDASHBOARD_API_PORT=3913 node apps/api/src/server.ts; echo "exit $?"
   ```
   Expected: `Database schema version 99 is newer than this LifeDashboard supports (1)…` and `exit 1` (acceptance 8).

- [ ] **Step 4: Report**

Write the final report in the session: test counts from Step 1, each browser check with pass/fail, any deviation from the spec, and anything not verified. Do not mark this task done if a check failed.
