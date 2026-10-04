# Widget Builder v1 (Placement at Real Size) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A «+» button opens a builder mode with a 12×8 dot grid where a placeholder widget is moved and resized cell by cell at real size; «Готово» leaves it on the board, persisted in `localStorage` until deleted.

**Architecture:** Pure TS modules (`grid.ts`, `catalog.ts`, `board-document.ts`) hold all placement, validation and storage logic and are unit-tested with Vitest. Vue components render every widget through `WidgetHost` → `WidgetFrame` (shared frame, theme tokens) → renderer from an explicit registry. `WidgetBoard.vue` owns the board document, builder mode, pointer and keyboard handling; `app.vue` owns the header.

**Tech Stack:** Node 24, pnpm 10.30.2, TypeScript 6.0.3, Nuxt 4.5.2 (SPA), Vue 3.5.43, Vitest 5.0.3 (new devDependency of `apps/ui`).

**Spec:** `docs/superpowers/specs/2026-10-04-widget-builder-placement-design.md`. Base design: `docs/base-2026-10-04-lifegamehermes-design.md` (§5.1, §7.3, §7.4, §7.5).

## Global Constraints

- Work on branch `csscoder/opah`; never commit to `main`.
- Exact dependency versions, no `^`/`~`. The only new dependency: `vitest@5.0.3` as devDependency of `apps/ui`. No runtime dependencies are added.
- TypeScript strict; code must compile with `noUncheckedIndexedAccess` (indexing returns `T | undefined`).
- Nuxt has `imports: { autoImport: false }` and `components: false`: import every Vue API, component and module explicitly.
- App code imports local modules without extensions (`'./grid'`), as Nuxt/Vite resolve them.
- User-facing strings in Russian; code, identifiers, comments and commits in English.
- Commit messages: short conventional subject, no attribution trailers.
- Grid: `GRID = { cols: 12, rows: 8 }`. Tokens: cell `4rem`, gap `0.75rem`, header `3.5rem`, board padding `1rem`.
- Root scale, verbatim: `html { font-size: max(16px, min(1vw, calc(100dvh / 43.75))) }`.
- Below 1280 px viewport width the UI shows «Окно слишком узкое».
- `localStorage` key `lifedashboard.board`; document `schemaVersion: 1`; every stored or imported value passes through `parseBoardDocument`.
- Placeholder manifest: `type: 'placeholder'`, `title: 'Заглушка'`, `sizing: { default: {w:4,h:4}, min: {w:1,h:1}, max: {w:12,h:8} }`.
- Out of scope (do not build): export/import buttons, theme selection, moving/resizing placed widgets, Hermes, API routes, SQLite, Rooms, `packages/contracts`, component/e2e tests.

## Deviations from the spec (for review)

1. **Header buttons.** While building, the header replaces «+» with «Готово» and «Отмена» (the spec says «+» is disabled and does not place the buttons). `WidgetBoard` exposes `confirm()` and `cancel()` through `defineExpose`.
2. **Narrow window.** Below 1280 px the whole UI (header and board) is replaced by «Окно слишком узкое», following base design §7.4 («UI показывает сообщение»), so a usable «+» never sits next to a hidden board.
3. **Two tabs.** `WidgetBoard` reloads the document on the `storage` event. «Готово» and «×» first re-read the stored document (when it loads without error) and apply the change to it; «Готово» then re-checks `isFree`, and a taken place shows «Место занято, переместите виджет». This synchronises sequential changes only: two tabs writing at the same moment are not atomic.
4. **Theme CSS registration.** `widget-theme.css` is registered through `css` in `nuxt.config.ts`.
5. **Theme attribute.** `WidgetFrame` hardcodes `data-widget-theme="default"`; a theme prop arrives with theme selection.
6. **Messages.** `WidgetBoard` emits `notice` (`string | null`); the header renders it in an always-present `role="status"` element.

## Review Focus

1. Pointer leaving the grid or a blocked step during drag/resize → the draft keeps its last valid position, never leaves the grid or overlaps (Task 1, `moveTo`/`resizeTo` unchanged-rect tests; Task 3, Step 9).
2. A second tab changes the board → this tab reloads it; confirming a draft over a place taken meanwhile shows «Место занято, переместите виджет», and neither «Готово» nor «×» drops the other tab's widget (Task 3, Step 9).
3. Enter while «Отмена» has focus → cancels, never confirms; Enter on «Готово» confirms once (Task 3, Step 9).
4. Stored document with extra fields or numbers as strings → extra fields are dropped, string numbers are rejected (Task 2 tests).
5. A saved document loads back identical (the same document becomes the export format) (Task 2, round-trip test).

---

### Task 1: Vitest in `apps/ui` and grid logic

**Files:**
- Modify: `apps/ui/package.json` (devDependency `vitest`, script `test`), `pnpm-lock.yaml`
- Create: `apps/ui/app/widgets/grid.ts`
- Test: `apps/ui/test/grid.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`apps/ui/app/widgets/grid.ts`):
  - `const GRID: { readonly cols: 12; readonly rows: 8 }`
  - `interface Size { w: number; h: number }`, `interface Rect extends Size { x: number; y: number }`, `interface SizeLimits { min: Size; max: Size }`
  - `inBounds(rect: Rect): boolean` — `w, h ≥ 1` and fully inside the grid (no integer check)
  - `overlaps(a: Rect, b: Rect): boolean`
  - `isFree(rect: Rect, others: readonly Rect[]): boolean`
  - `findFreeRect(size: Size, others: readonly Rect[]): Rect | null`
  - `moveTo(rect: Rect, x: number, y: number, others: readonly Rect[]): Rect`
  - `resizeTo(rect: Rect, w: number, h: number, limits: SizeLimits, others: readonly Rect[]): Rect`

- [ ] **Step 1: Install workspace dependencies**

Run from the repository root: `pnpm install --frozen-lockfile`
Expected: completes; `apps/ui/.nuxt/` is generated by the `postinstall` (`nuxt prepare`).

- [ ] **Step 2: Add Vitest to `apps/ui`**

Run: `pnpm --filter @lifedashboard/ui add -D vitest@5.0.3`
Expected: `apps/ui/package.json` gets `"vitest": "5.0.3"` under `devDependencies` (exact, `saveExact: true` in `pnpm-workspace.yaml`).

Then add the script to `apps/ui/package.json` so `scripts` reads:

```json
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt generate",
    "typecheck": "nuxt typecheck",
    "test": "vitest run",
    "postinstall": "nuxt prepare"
  },
```

- [ ] **Step 3: Write the failing grid tests**

Create `apps/ui/test/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  findFreeRect,
  isFree,
  moveTo,
  resizeTo,
  type Rect,
} from '../app/widgets/grid'

const limits = { min: { w: 1, h: 1 }, max: { w: 12, h: 8 } }
const block: Rect = { x: 4, y: 0, w: 4, h: 4 }

describe('isFree', () => {
  it('accepts a rect inside an empty grid', () => {
    expect(isFree({ x: 0, y: 0, w: 12, h: 8 }, [])).toBe(true)
  })

  it('rejects a rect leaving the grid', () => {
    expect(isFree({ x: 9, y: 0, w: 4, h: 1 }, [])).toBe(false)
    expect(isFree({ x: 0, y: 5, w: 1, h: 4 }, [])).toBe(false)
    expect(isFree({ x: -1, y: 0, w: 1, h: 1 }, [])).toBe(false)
    expect(isFree({ x: 0, y: 0, w: 0, h: 1 }, [])).toBe(false)
  })

  it('rejects an overlap', () => {
    expect(isFree({ x: 6, y: 2, w: 4, h: 4 }, [block])).toBe(false)
  })

  it('accepts a rect touching an edge of another', () => {
    expect(isFree({ x: 0, y: 0, w: 4, h: 4 }, [block])).toBe(true)
    expect(isFree({ x: 4, y: 4, w: 4, h: 4 }, [block])).toBe(true)
  })
})

describe('findFreeRect', () => {
  it('returns the top-left corner on an empty grid', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [])).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })

  it('scans rows top-down, columns left-right, skipping occupied cells', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 10, h: 4 }])).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('returns null when the size does not fit', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 12, h: 5 }])).toBeNull()
  })

  it('finds the last free 1x1 cell', () => {
    const others: Rect[] = [
      { x: 0, y: 0, w: 12, h: 7 },
      { x: 0, y: 7, w: 11, h: 1 },
    ]
    expect(findFreeRect({ w: 1, h: 1 }, others)).toEqual({ x: 11, y: 7, w: 1, h: 1 })
  })
})

describe('moveTo', () => {
  const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }

  it('moves to a free target', () => {
    expect(moveTo(rect, 0, 4, [block])).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('returns the unchanged rect for an out-of-bounds target', () => {
    expect(moveTo(rect, 9, 0, [])).toBe(rect)
    expect(moveTo(rect, -1, 0, [])).toBe(rect)
  })

  it('returns the unchanged rect for an occupied target', () => {
    expect(moveTo(rect, 1, 0, [block])).toBe(rect)
  })
})

describe('resizeTo', () => {
  it('grows into free cells', () => {
    expect(resizeTo({ x: 0, y: 0, w: 2, h: 2 }, 3, 3, limits, [])).toEqual({ x: 0, y: 0, w: 3, h: 3 })
  })

  it('respects min and max', () => {
    const rect: Rect = { x: 0, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 0, 2, limits, [])).toBe(rect)
    expect(resizeTo(rect, 3, 2, { min: { w: 1, h: 1 }, max: { w: 2, h: 2 } }, [])).toBe(rect)
  })

  it('does not leave the grid', () => {
    const rect: Rect = { x: 10, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 3, 2, limits, [])).toBe(rect)
  })

  it('does not enter occupied cells', () => {
    const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }
    expect(resizeTo(rect, 5, 4, limits, [block])).toBe(rect)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @lifedashboard/ui test`
Expected: FAIL — `Failed to resolve import "../app/widgets/grid"` (or "Cannot find module").

- [ ] **Step 5: Implement `grid.ts`**

Create `apps/ui/app/widgets/grid.ts`:

```ts
export const GRID = { cols: 12, rows: 8 } as const

export interface Size {
  w: number
  h: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export interface SizeLimits {
  min: Size
  max: Size
}

export function inBounds(rect: Rect): boolean {
  return (
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= GRID.cols &&
    rect.y + rect.h <= GRID.rows
  )
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function isFree(rect: Rect, others: readonly Rect[]): boolean {
  return inBounds(rect) && others.every((other) => !overlaps(rect, other))
}

export function findFreeRect(size: Size, others: readonly Rect[]): Rect | null {
  for (let y = 0; y + size.h <= GRID.rows; y++) {
    for (let x = 0; x + size.w <= GRID.cols; x++) {
      const candidate = { x, y, w: size.w, h: size.h }
      if (isFree(candidate, others)) return candidate
    }
  }
  return null
}

export function moveTo(rect: Rect, x: number, y: number, others: readonly Rect[]): Rect {
  const next = { ...rect, x, y }
  return isFree(next, others) ? next : rect
}

export function resizeTo(rect: Rect, w: number, h: number, limits: SizeLimits, others: readonly Rect[]): Rect {
  if (w < limits.min.w || w > limits.max.w || h < limits.min.h || h > limits.max.h) return rect
  const next = { ...rect, w, h }
  return isFree(next, others) ? next : rect
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @lifedashboard/ui test`
Expected: PASS, all `grid.test.ts` tests green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @lifedashboard/ui typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/ui/package.json pnpm-lock.yaml apps/ui/app/widgets/grid.ts apps/ui/test/grid.test.ts
git commit -m "feat(ui): add widget grid placement logic with vitest"
```

---

### Task 2: Widget catalog and board document

**Files:**
- Create: `apps/ui/app/widgets/catalog.ts`, `apps/ui/app/widgets/board-document.ts`
- Test: `apps/ui/test/board-document.test.ts`

**Interfaces:**
- Consumes (Task 1): `GRID`, `Size`, `Rect`, `SizeLimits`, `inBounds`, `overlaps` from `./grid`.
- Produces:
  - `apps/ui/app/widgets/catalog.ts`:
    - `interface WidgetSizing extends SizeLimits { default: Size }`
    - `interface WidgetManifest { type: string; title: string; sizing: WidgetSizing }`
    - `const placeholderManifest: WidgetManifest`
    - `const builtinWidgetCatalog: readonly WidgetManifest[]`
    - `findManifest(type: string): WidgetManifest | undefined`
  - `apps/ui/app/widgets/board-document.ts`:
    - `type WidgetSource = { kind: 'builtin'; type: string }`
    - `interface WidgetInstance { id: string; source: WidgetSource; config: Record<string, unknown> }`
    - `interface WidgetPlacement extends Rect { instanceId: string }`
    - `interface BoardDocument { schemaVersion: 1; instances: WidgetInstance[]; layout: WidgetPlacement[] }`
    - `type ParseResult = { ok: true; doc: BoardDocument } | { ok: false; error: string }`
    - `interface LoadError { kind: 'storage' | 'invalid-document'; message: string }`
    - `const BOARD_STORAGE_KEY = 'lifedashboard.board'`
    - `emptyBoard(): BoardDocument`
    - `parseBoardDocument(raw: unknown): ParseResult`
    - `loadBoard(): { doc: BoardDocument; error?: LoadError }` — never throws
    - `saveBoard(doc: BoardDocument): boolean` — never throws

- [ ] **Step 1: Write the failing tests**

Create `apps/ui/test/board-document.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOARD_STORAGE_KEY,
  emptyBoard,
  loadBoard,
  parseBoardDocument,
  saveBoard,
  type BoardDocument,
} from '../app/widgets/board-document'
import { findManifest } from '../app/widgets/catalog'

const valid: BoardDocument = {
  schemaVersion: 1,
  instances: [
    { id: 'a', source: { kind: 'builtin', type: 'placeholder' }, config: {} },
    { id: 'b', source: { kind: 'builtin', type: 'placeholder' }, config: {} },
  ],
  layout: [
    { instanceId: 'a', x: 0, y: 0, w: 4, h: 4 },
    { instanceId: 'b', x: 4, y: 0, w: 2, h: 2 },
  ],
}

// Tests mutate a deep copy freely; the parser receives it as unknown input.
function mutated(change: (doc: any) => void): unknown {
  const doc = structuredClone(valid)
  change(doc)
  return doc
}

describe('parseBoardDocument', () => {
  it('accepts a valid document', () => {
    expect(parseBoardDocument(structuredClone(valid))).toEqual({ ok: true, doc: valid })
  })

  it('accepts an unknown source.type', () => {
    const result = parseBoardDocument(mutated((d) => { d.instances[0].source.type = 'weather' }))
    expect(result.ok).toBe(true)
  })

  it('drops unknown fields', () => {
    const result = parseBoardDocument(mutated((d) => {
      d.extra = 1
      d.instances[0].extra = 1
      d.layout[0].extra = 1
    }))
    expect(result).toEqual({ ok: true, doc: valid })
  })

  it.each([
    ['null', null, /must be an object/],
    ['an array', [], /must be an object/],
    ['a wrong schemaVersion', mutated((d) => { d.schemaVersion = 2 }), /unsupported schemaVersion: 2/],
    ['non-array instances', mutated((d) => { d.instances = {} }), /must be arrays/],
    ['an empty id', mutated((d) => { d.instances[0].id = '' }), /id must be a non-empty string/],
    ['a duplicate id', mutated((d) => { d.instances[1].id = 'a' }), /duplicate id "a"/],
    ['a custom source', mutated((d) => { d.instances[0].source = { kind: 'custom' } }), /invalid source/],
    ['a missing config', mutated((d) => { delete d.instances[0].config }), /config must be an object/],
    ['a placement without an instance', mutated((d) => { d.layout[1].instanceId = 'zzz' }), /unknown instanceId "zzz"/],
    ['an instance without a placement', mutated((d) => { d.layout.pop() }), /instance "b" has no placement/],
    ['two placements of one instance', mutated((d) => { d.layout[1].instanceId = 'a' }), /placed twice/],
    ['an out-of-bounds placement', mutated((d) => { d.layout[1].x = 11 }), /inside the 12x8 grid/],
    ['a non-integer coordinate', mutated((d) => { d.layout[1].x = 1.5 }), /inside the 12x8 grid/],
    ['a string coordinate', mutated((d) => { d.layout[1].x = '4' }), /inside the 12x8 grid/],
    ['a zero width', mutated((d) => { d.layout[1].w = 0 }), /inside the 12x8 grid/],
    ['a zero height', mutated((d) => { d.layout[1].h = 0 }), /inside the 12x8 grid/],
    ['overlapping placements', mutated((d) => { d.layout[1] = { instanceId: 'b', x: 2, y: 2, w: 2, h: 2 } }), /overlaps/],
  ])('rejects %s', (_name, raw, message) => {
    const result = parseBoardDocument(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})

describe('loadBoard and saveBoard', () => {
  function memoryStorage(initial?: string) {
    const data = new Map<string, string>()
    if (initial !== undefined) data.set(BOARD_STORAGE_KEY, initial)
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an empty board when nothing is stored', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadBoard()).toEqual({ doc: emptyBoard() })
  })

  it('loads back exactly what was saved', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(saveBoard(valid)).toBe(true)
    expect(loadBoard()).toEqual({ doc: valid })
  })

  it('reports a storage error when getItem throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(loadBoard()).toMatchObject({ doc: emptyBoard(), error: { kind: 'storage' } })
  })

  it('reports a storage error when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadBoard()).toMatchObject({ doc: emptyBoard(), error: { kind: 'storage' } })
  })

  it('reports an invalid document for invalid JSON', () => {
    vi.stubGlobal('localStorage', memoryStorage('{'))
    expect(loadBoard()).toMatchObject({ doc: emptyBoard(), error: { kind: 'invalid-document' } })
  })

  it('reports an invalid document for JSON the parser rejects', () => {
    vi.stubGlobal('localStorage', memoryStorage('{"schemaVersion":2}'))
    expect(loadBoard()).toMatchObject({
      doc: emptyBoard(),
      error: { kind: 'invalid-document', message: expect.stringMatching(/unsupported schemaVersion/) },
    })
  })

  it('returns false when setItem throws', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(saveBoard(valid)).toBe(false)
  })
})

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifedashboard/ui test`
Expected: FAIL — `Failed to resolve import "../app/widgets/board-document"`; `grid.test.ts` still passes.

- [ ] **Step 3: Implement `catalog.ts`**

Create `apps/ui/app/widgets/catalog.ts`:

```ts
import type { Size, SizeLimits } from './grid'

export interface WidgetSizing extends SizeLimits {
  default: Size
}

// Describes a widget type without its Vue renderer; moves to packages/contracts once the API needs it.
export interface WidgetManifest {
  type: string
  title: string
  sizing: WidgetSizing
}

export const placeholderManifest: WidgetManifest = {
  type: 'placeholder',
  title: 'Заглушка',
  sizing: { default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 12, h: 8 } },
}

export const builtinWidgetCatalog: readonly WidgetManifest[] = [placeholderManifest]

export function findManifest(type: string): WidgetManifest | undefined {
  return builtinWidgetCatalog.find((manifest) => manifest.type === type)
}
```

- [ ] **Step 4: Implement `board-document.ts`**

Create `apps/ui/app/widgets/board-document.ts`:

```ts
import { GRID, inBounds, overlaps, type Rect } from './grid'

export type WidgetSource = { kind: 'builtin'; type: string }

export interface WidgetInstance {
  id: string
  source: WidgetSource
  config: Record<string, unknown>
}

export interface WidgetPlacement extends Rect {
  instanceId: string
}

// The stored document is also the future export/import format.
export interface BoardDocument {
  schemaVersion: 1
  instances: WidgetInstance[]
  layout: WidgetPlacement[]
}

export type ParseResult = { ok: true; doc: BoardDocument } | { ok: false; error: string }

export interface LoadError {
  kind: 'storage' | 'invalid-document'
  message: string
}

export const BOARD_STORAGE_KEY = 'lifedashboard.board'

export function emptyBoard(): BoardDocument {
  return { schemaVersion: 1, instances: [], layout: [] }
}

// Single validation point for every external input: localStorage now, file import later.
// A future schemaVersion gets a migration branch here.
export function parseBoardDocument(raw: unknown): ParseResult {
  if (!isRecord(raw)) return fail('document must be an object')
  if (raw.schemaVersion !== 1) return fail(`unsupported schemaVersion: ${JSON.stringify(raw.schemaVersion)}`)
  if (!Array.isArray(raw.instances) || !Array.isArray(raw.layout)) return fail('instances and layout must be arrays')

  const instances: WidgetInstance[] = []
  const ids = new Set<string>()
  for (const [index, item] of raw.instances.entries()) {
    if (!isRecord(item) || !isNonEmptyString(item.id)) return fail(`instances[${index}]: id must be a non-empty string`)
    if (ids.has(item.id)) return fail(`instances[${index}]: duplicate id "${item.id}"`)
    const source = item.source
    if (!isRecord(source) || source.kind !== 'builtin' || !isNonEmptyString(source.type)) {
      return fail(`instances[${index}]: invalid source`)
    }
    if (!isRecord(item.config)) return fail(`instances[${index}]: config must be an object`)
    ids.add(item.id)
    instances.push({ id: item.id, source: { kind: 'builtin', type: source.type }, config: item.config })
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

  return { ok: true, doc: { schemaVersion: 1, instances, layout } }
}

export function loadBoard(): { doc: BoardDocument; error?: LoadError } {
  let text: string | null
  try {
    text = localStorage.getItem(BOARD_STORAGE_KEY)
  } catch (error) {
    return { doc: emptyBoard(), error: { kind: 'storage', message: String(error) } }
  }
  if (text === null) return { doc: emptyBoard() }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { doc: emptyBoard(), error: { kind: 'invalid-document', message: `invalid JSON: ${String(error)}` } }
  }
  const result = parseBoardDocument(raw)
  return result.ok
    ? { doc: result.doc }
    : { doc: emptyBoard(), error: { kind: 'invalid-document', message: result.error } }
}

export function saveBoard(doc: BoardDocument): boolean {
  try {
    localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(doc))
    return true
  } catch {
    return false
  }
}

function fail(error: string): ParseResult {
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lifedashboard/ui test`
Expected: PASS, `grid.test.ts` and `board-document.test.ts` green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @lifedashboard/ui typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/ui/app/widgets/catalog.ts apps/ui/app/widgets/board-document.ts apps/ui/test/board-document.test.ts
git commit -m "feat(ui): add widget catalog and versioned board document"
```

---

### Task 3: Widget frame, host, board and header

**Files:**
- Create: `apps/ui/app/widgets/widget-theme.css`, `apps/ui/app/widgets/WidgetFrame.vue`, `apps/ui/app/widgets/builtin/PlaceholderWidget.vue`, `apps/ui/app/widgets/registry.ts`, `apps/ui/app/widgets/WidgetHost.vue`, `apps/ui/app/board/WidgetBoard.vue`
- Modify: `apps/ui/app/app.vue` (whole file), `apps/ui/nuxt.config.ts` (add `css`)

**Interfaces:**
- Consumes:
  - Task 1: `GRID`, `Rect`, `Size`, `isFree`, `findFreeRect`, `moveTo`, `resizeTo` from `../widgets/grid`.
  - Task 2: `placeholderManifest` from `../widgets/catalog`; `BOARD_STORAGE_KEY`, `BoardDocument`, `WidgetSource`, `emptyBoard`, `loadBoard`, `saveBoard` from `../widgets/board-document`.
- Produces:
  - Renderer contract: a widget renderer receives the prop `size: Size`.
  - `builtinWidgetRenderers: ReadonlyMap<string, Component>` in `apps/ui/app/widgets/registry.ts`.
  - `WidgetHost` props `{ source: WidgetSource; size: Size }`.
  - `WidgetBoard`: `v-model:building` (`boolean`), event `notice: [message: string | null]`, exposed `confirm(): void`, `cancel(): void`.

This task has no unit tests: component tests need new dependencies (out of scope). Verification is typecheck, build and the manual browser check in Step 9.

- [ ] **Step 1: Theme tokens and their registration**

Create `apps/ui/app/widgets/widget-theme.css`:

```css
/* A theme is a set of frame tokens. Widgets never style their own frame. */
[data-widget-theme='default'] {
  --widget-bg: rgb(255 255 255 / 0.08);
  --widget-blur: 1rem;
  --widget-border: 0.0625rem solid rgb(255 255 255 / 0.18);
  --widget-radius: 1rem;
  --widget-text: #f4f4f8;
  --widget-padding: 0.75rem;
}
```

In `apps/ui/nuxt.config.ts` add `css` right after `components: false,`:

```ts
  components: false,
  css: ['~/widgets/widget-theme.css'],
```

- [ ] **Step 2: `WidgetFrame.vue`**

Create `apps/ui/app/widgets/WidgetFrame.vue`:

```vue
<template>
  <div class="widget-frame" data-widget-theme="default">
    <div class="widget-frame__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.widget-frame {
  box-sizing: border-box;
  height: 100%;
  overflow: hidden;
  border: var(--widget-border);
  border-radius: var(--widget-radius);
  background: var(--widget-bg);
  backdrop-filter: blur(var(--widget-blur));
  color: var(--widget-text);
}

.widget-frame__content {
  box-sizing: border-box;
  height: 100%;
  padding: var(--widget-padding);
}
</style>
```

- [ ] **Step 3: Placeholder renderer and registry**

Create `apps/ui/app/widgets/builtin/PlaceholderWidget.vue`:

```vue
<script setup lang="ts">
import type { Size } from '../grid'

defineProps<{ size: Size }>()
</script>

<template>
  <div class="placeholder">{{ size.w }}×{{ size.h }}</div>
</template>

<style scoped>
.placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 1.5rem;
  font-weight: 600;
  opacity: 0.85;
}
</style>
```

Create `apps/ui/app/widgets/registry.ts`:

```ts
import { defineAsyncComponent, type Component } from 'vue'

// Explicit list: only renderers registered here are executable widget UI.
// A Map (not an object) so types like "toString" never resolve to prototype members.
export const builtinWidgetRenderers: ReadonlyMap<string, Component> = new Map<string, Component>([
  ['placeholder', defineAsyncComponent(() => import('./builtin/PlaceholderWidget.vue'))],
])
```

- [ ] **Step 4: `WidgetHost.vue`**

Create `apps/ui/app/widgets/WidgetHost.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { WidgetSource } from './board-document'
import type { Size } from './grid'
import { builtinWidgetRenderers } from './registry'
import WidgetFrame from './WidgetFrame.vue'

const props = defineProps<{ source: WidgetSource; size: Size }>()

const renderer = computed(() => builtinWidgetRenderers.get(props.source.type))
</script>

<template>
  <WidgetFrame>
    <component :is="renderer" v-if="renderer" :size="size" />
    <div v-else class="widget-host__unknown">Неизвестный виджет</div>
  </WidgetFrame>
</template>

<style scoped>
.widget-host__unknown {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 0.875rem;
  opacity: 0.7;
  text-align: center;
}
</style>
```

- [ ] **Step 5: `WidgetBoard.vue`**

Create `apps/ui/app/board/WidgetBoard.vue`:

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import {
  BOARD_STORAGE_KEY,
  emptyBoard,
  loadBoard,
  saveBoard,
  type BoardDocument,
  type WidgetSource,
} from '../widgets/board-document'
import { placeholderManifest } from '../widgets/catalog'
import { GRID, findFreeRect, isFree, moveTo, resizeTo, type Rect } from '../widgets/grid'
import WidgetHost from '../widgets/WidgetHost.vue'

const building = defineModel<boolean>('building', { required: true })
const emit = defineEmits<{ notice: [message: string | null] }>()

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

const doc = ref<BoardDocument>(emptyBoard())
const draft = ref<Rect | null>(null)
// Template ref keys must differ from setup bindings: ref="draft" would overwrite the draft rect.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')
let drag: { mode: 'move' | 'resize'; grabX: number; grabY: number } | null = null

const placed = computed(() =>
  doc.value.layout.flatMap((placement) => {
    const instance = doc.value.instances.find((item) => item.id === placement.instanceId)
    return instance ? [{ instance, placement }] : []
  }),
)

const draftLabel = computed(() => {
  const rect = draft.value
  return rect ? `Виджет ${rect.w}×${rect.h}, колонка ${rect.x + 1}, ряд ${rect.y + 1}` : ''
})

function area(rect: Rect) {
  return { gridColumn: `${rect.x + 1} / span ${rect.w}`, gridRow: `${rect.y + 1} / span ${rect.h}` }
}

function applyLoad(result: ReturnType<typeof loadBoard>) {
  doc.value = result.doc
  if (result.error?.kind === 'storage') emit('notice', 'Хранилище недоступно')
  else if (result.error) console.warn(`Board document ignored: ${result.error.message}`)
}

function persist() {
  emit('notice', saveBoard(doc.value) ? null : 'Не удалось сохранить доску')
}

function start() {
  emit('notice', null)
  const others = doc.value.layout
  const rect = findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others)
  if (!rect) {
    emit('notice', 'Нет свободного места')
    building.value = false
    return
  }
  draft.value = rect
  void nextTick(() => draftEl.value?.focus())
}

function stop() {
  draft.value = null
  drag = null
  building.value = false
}

// Applies changes to the latest stored document so another tab's saved widgets are kept.
// Sequential changes only: simultaneous writes from two tabs are not atomic.
function refresh() {
  const result = loadBoard()
  if (!result.error) doc.value = result.doc
}

function confirm() {
  const rect = draft.value
  if (!rect) return
  refresh()
  // Another tab may have taken the place since the draft was positioned.
  if (!isFree(rect, doc.value.layout)) {
    emit('notice', 'Место занято, переместите виджет')
    return
  }
  const id = crypto.randomUUID()
  doc.value = {
    schemaVersion: 1,
    instances: [...doc.value.instances, { id, source: { ...draftSource }, config: {} }],
    layout: [...doc.value.layout, { instanceId: id, ...rect }],
  }
  persist()
  stop()
}

function remove(id: string) {
  refresh()
  doc.value = {
    schemaVersion: 1,
    instances: doc.value.instances.filter((item) => item.id !== id),
    layout: doc.value.layout.filter((item) => item.instanceId !== id),
  }
  persist()
}

// Cell under the pointer; the grid has no padding or border, so its box starts at the first cell.
function pointerCell(event: PointerEvent) {
  const el = gridEl.value
  if (!el) return null
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const colGap = parseFloat(style.columnGap)
  const rowGap = parseFloat(style.rowGap)
  const cellW = (box.width - colGap * (GRID.cols - 1)) / GRID.cols
  const cellH = (box.height - rowGap * (GRID.rows - 1)) / GRID.rows
  return {
    x: Math.floor((event.clientX - box.left) / (cellW + colGap)),
    y: Math.floor((event.clientY - box.top) / (cellH + rowGap)),
  }
}

function onPointerDown(event: PointerEvent, mode: 'move' | 'resize') {
  const rect = draft.value
  const cell = pointerCell(event)
  if (!rect || !cell || event.button !== 0) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { mode, grabX: cell.x - rect.x, grabY: cell.y - rect.y }
}

function onPointerMove(event: PointerEvent) {
  const rect = draft.value
  const cell = pointerCell(event)
  if (!drag || !rect || !cell) return
  draft.value =
    drag.mode === 'move'
      ? moveTo(rect, cell.x - drag.grabX, cell.y - drag.grabY, doc.value.layout)
      : resizeTo(rect, cell.x - rect.x + 1, cell.y - rect.y + 1, sizing, doc.value.layout)
}

function onPointerUp() {
  drag = null
}

function onKeydown(event: KeyboardEvent) {
  const rect = draft.value
  if (!rect) return
  const step = arrows[event.key]
  if (step) {
    event.preventDefault()
    const [dx, dy] = step
    draft.value = event.shiftKey
      ? resizeTo(rect, rect.w + dx, rect.h + dy, sizing, doc.value.layout)
      : moveTo(rect, rect.x + dx, rect.y + dy, doc.value.layout)
  } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
    // A focused header button handles Enter itself (Готово confirms, Отмена cancels).
    event.preventDefault()
    confirm()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    stop()
  }
}

function onStorage(event: StorageEvent) {
  if (event.key === BOARD_STORAGE_KEY || event.key === null) applyLoad(loadBoard())
}

watch(building, (on) => {
  if (on && !draft.value) start()
})

onMounted(() => {
  applyLoad(loadBoard())
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('storage', onStorage)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('storage', onStorage)
})

defineExpose({ confirm, cancel: stop })
</script>

<template>
  <div class="board">
    <div ref="gridBox" class="board__grid" :class="{ 'board__grid--building': draft }">
      <template v-if="draft">
        <span v-for="cell in cells" :key="`${cell.x}-${cell.y}`" class="board__dot" :style="area(cell)" />
      </template>
      <div v-for="{ instance, placement } in placed" :key="instance.id" class="board__item" :style="area(placement)">
        <WidgetHost :source="instance.source" :size="placement" />
        <button
          v-if="!draft"
          type="button"
          class="board__remove"
          :aria-label="`Удалить виджет ${placement.w}×${placement.h}`"
          @click="remove(instance.id)"
        >
          ×
        </button>
      </div>
      <div
        v-if="draft"
        ref="draftBox"
        class="board__item board__draft"
        role="group"
        tabindex="0"
        :aria-label="draftLabel"
        :style="area(draft)"
        @pointerdown="onPointerDown($event, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <WidgetHost :source="draftSource" :size="draft" />
        <span class="board__resize" aria-hidden="true" @pointerdown.stop="onPointerDown($event, 'resize')" />
      </div>
    </div>
    <p class="board__live" aria-live="polite">{{ draftLabel }}</p>
  </div>
</template>

<style scoped>
/* The padding lives here, not on the grid, so pointer math starts at the first cell. */
.board {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  height: 100%;
  padding: 1rem;
}

.board__grid {
  display: grid;
  grid-template: repeat(8, 4rem) / repeat(12, 4rem);
  gap: 0.75rem;
}

.board__dot {
  place-self: center;
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.35);
  pointer-events: none;
}

.board__item {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.board__grid--building .board__item:not(.board__draft) {
  opacity: 0.4;
}

.board__draft {
  z-index: 1;
  cursor: grab;
  touch-action: none;
  outline-offset: 0.25rem;
}

.board__draft:active {
  cursor: grabbing;
}

.board__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1rem;
  height: 1rem;
  border-right: 0.1875rem solid #fff;
  border-bottom: 0.1875rem solid #fff;
  border-bottom-right-radius: 1rem;
  cursor: nwse-resize;
}

.board__remove {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  border: none;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  font: inherit;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}

.board__item:hover .board__remove,
.board__remove:focus-visible {
  opacity: 1;
}

.board__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
```

- [ ] **Step 6: `app.vue`**

Replace `apps/ui/app/app.vue` with:

```vue
<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'
import WidgetBoard from './board/WidgetBoard.vue'

type ApiState = 'checking' | 'ok' | 'unavailable'

const labels: Record<ApiState, string> = {
  checking: 'API: проверка…',
  ok: 'API: работает',
  unavailable: 'API: недоступен',
}

const apiState = ref<ApiState>('checking')
const building = ref(false)
const notice = ref<string | null>(null)
const boardRef = useTemplateRef('board')

const HEALTH_TIMEOUT_MS = 5000

async function isApiHealthy(): Promise<boolean> {
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    const response = await fetch('/health', { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    if (response.status !== 200) return false
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}

onMounted(async () => {
  apiState.value = (await isApiHealthy()) ? 'ok' : 'unavailable'
})
</script>

<template>
  <div class="app">
    <header class="app__header">
      <h1 class="app__title">LifeDashboard</h1>
      <template v-if="building">
        <button type="button" class="app__button" @click="boardRef?.confirm()">Готово</button>
        <button type="button" class="app__button" @click="boardRef?.cancel()">Отмена</button>
      </template>
      <button v-else type="button" class="app__button" aria-label="Добавить виджет" @click="building = true">+</button>
      <p class="app__notice" role="status">{{ notice }}</p>
      <p class="app__api">{{ labels[apiState] }}</p>
    </header>
    <main class="app__main">
      <WidgetBoard ref="board" v-model:building="building" @notice="notice = $event" />
    </main>
  </div>
  <p class="app__narrow">Окно слишком узкое</p>
</template>

<style>
/* One scale for the whole UI (base design §7.4): every size is rem, only the root font size changes. */
html {
  font-size: max(16px, min(1vw, calc(100dvh / 43.75)));
}

body {
  margin: 0;
  background: radial-gradient(circle at 20% 10%, #3a3f6b, #12131c 60%) fixed;
  color: #f4f4f8;
  font-family: system-ui, sans-serif;
}

.app {
  display: grid;
  grid-template-rows: 3.5rem 1fr;
  height: 100dvh;
}

.app__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 1rem;
}

.app__title {
  margin: 0;
  font-size: 1.125rem;
}

.app__button {
  height: 2.25rem;
  min-width: 2.25rem;
  padding: 0 0.875rem;
  border: 0.0625rem solid rgb(255 255 255 / 0.25);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.app__notice {
  margin: 0;
  color: #ffb4b4;
  font-size: 0.875rem;
}

.app__api {
  margin: 0 0 0 auto;
  font-size: 0.875rem;
  opacity: 0.7;
}

.app__main {
  min-height: 0;
}

.app__narrow {
  display: none;
}

@media (max-width: 1279.98px) {
  .app {
    display: none;
  }

  .app__narrow {
    display: grid;
    place-items: center;
    height: 100dvh;
    margin: 0;
  }
}
</style>
```

- [ ] **Step 7: Typecheck, tests and build**

Run: `pnpm --filter @lifedashboard/ui typecheck && pnpm --filter @lifedashboard/ui test && pnpm --filter @lifedashboard/ui build`
Expected: all three exit 0; `nuxt generate` writes the static build.

If `typecheck` reports `useTemplateRef('board')` as `unknown` for `confirm`/`cancel`, type it explicitly: `useTemplateRef<InstanceType<typeof WidgetBoard>>('board')`.

- [ ] **Step 8: Start the app**

Run from the repository root: `pnpm dev`
Expected: UI on `http://127.0.0.1:3000`, API on `127.0.0.1:3001`; the page shows the header, «API: работает» and an empty board area.

- [ ] **Step 9: Manual browser check**

Open `http://127.0.0.1:3000` at 1280×700, run `localStorage.removeItem('lifedashboard.board')` in the console and reload. Check and record each result:

1. «+» shows 96 dots and a 4×4 draft at the top-left; the draft has focus; the header shows «Готово» and «Отмена».
2. Dragging the draft body moves it cell by cell; with the pointer outside the board or over a placed widget the draft stays at its last valid position and never overlaps.
3. The bottom-right handle resizes cell by cell, never below 1×1, never into a placed widget or past the board edge.
4. Arrows move the draft, Shift+arrows resize it; Esc cancels; Enter confirms. Tab to «Отмена» and press Enter: the draft is discarded and nothing is placed. Tab to «Готово» and press Enter: exactly one widget is placed.
5. «Готово» leaves a placeholder labelled with its size; reload keeps it; «×» (visible on hover and on Tab focus) deletes it, and reload keeps the deletion.
6. Fill the board until no 4×4 fits but a 1×1 does: «+» starts a 1×1 draft. Fill the board completely: «+» shows «Нет свободного места» and no draft appears.
7. Two tabs: start a draft in tab A; in tab B place a widget on the same spot; in tab A the placed widget appears; «Готово» in tab A shows «Место занято, переместите виджет» and places nothing until the draft is moved. Then place a widget in tab B and, before switching, delete another widget in tab A: tab B's new widget survives in both tabs.
8. In the console: `localStorage.setItem('lifedashboard.board', '{')` and reload → empty board, console warning `Board document ignored: invalid JSON…`. Then set `{"schemaVersion":1,"instances":[{"id":"x","source":{"kind":"builtin","type":"toString"},"config":{}}],"layout":[{"instanceId":"x","x":0,"y":0,"w":3,"h":3}]}` and reload → a 3×3 frame showing «Неизвестный виджет».
9. No page scroll at 1280×700 and 1920×1080; a 4×4 widget is square at both sizes, and its label and padding keep the same ratio to the widget (the root font size is 16 px and 19.2 px respectively).
10. Narrow the window below 1280 px: the whole UI is replaced by «Окно слишком узкое»; widening restores it.

Expected: all ten pass. Fix any failure before committing.

- [ ] **Step 10: Commit**

```bash
git add apps/ui/nuxt.config.ts apps/ui/app/app.vue apps/ui/app/board/WidgetBoard.vue apps/ui/app/widgets/widget-theme.css apps/ui/app/widgets/WidgetFrame.vue apps/ui/app/widgets/WidgetHost.vue apps/ui/app/widgets/registry.ts apps/ui/app/widgets/builtin/PlaceholderWidget.vue
git commit -m "feat(ui): add widget builder with real-size placement board"
```

---

### Task 4: Repository-wide verification and report

**Files:** none changed (unless a check fails and needs a fix in the owning task's files).

**Interfaces:**
- Consumes: everything above.
- Produces: the task report in the final message.

- [ ] **Step 1: Run the root checks**

Run from the repository root: `pnpm typecheck && pnpm test && pnpm build`
Expected: all exit 0; `pnpm test` runs both `@lifedashboard/api` and `@lifedashboard/ui` suites.

- [ ] **Step 2: Confirm the dependency change**

Run: `git diff main -- apps/ui/package.json`
Expected: only `"vitest": "5.0.3"` in `devDependencies` and the `"test": "vitest run"` script.

- [ ] **Step 3: Report**

Report in the final message: commits, the outputs of Step 1, the ten manual results from Task 3 Step 9 (pass/fail each, with the viewport used), the deviations listed at the top of this plan, and the known limitation that test files are not covered by `nuxt typecheck`.
