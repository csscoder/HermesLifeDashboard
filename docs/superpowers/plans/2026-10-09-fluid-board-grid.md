# Fluid Board Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board grid becomes 24 square-celled columns that fill the window width, with a per-screen row count (4..100) edited in edit mode, a red zone for widgets below the configured rows, and a migration that resets existing 12-column layouts.

**Architecture:** Pure grid rules live in `packages/contracts/src/grid.ts` (`limit = max(rows, current bottom)`), `ScreenBoard` gains `rows`, the API stores it in `screens.rows` (migration 3). The UI sizes cells with CSS container units, holds the rendered row count during pointer operations, follows grid resizes with a `ResizeObserver`, and edits `rows` in the edit-mode header.

**Tech Stack:** TypeScript (strict), Vue 3.5 / Nuxt 4 (`ssr: false`), Fastify 5, `node:sqlite`, Vitest 5, GSAP 3.

**Spec:** `docs/superpowers/specs/2026-10-09-fluid-board-grid-design.md`

## Global Constraints

- Columns: `GRID_COLS = 24`, never configurable.
- Rows: `ROWS = { min: 4, max: 100, default: 12 }`; `ROWS.max` is also the hard bound of every placement.
- Red-zone rule: a move or resize may not end below `max(rows, current.y + current.h)` of the rect before the step; enforced in the UI only, the API checks `24 × 100`, bounds and overlaps.
- Scale: `html { font-size: calc(100vw / 80) }`; the narrow-window rule (< 1280 px) stays.
- Board: `container-type: inline-size; overflow-y: auto; scrollbar-gutter: stable`; cell `--ld-cell: calc((100cqw - 23 * 0.5rem) / 24)`; gap `0.5rem`.
- Dots: `var(--ld-success)` for `y < rows`, `var(--ld-danger)` below; only in `build` and `edit` modes.
- Migration 3 is irreversible for placed widgets and `widget_state`; packages, versions, grants and `widget_audit` survive. `openDatabase` already backs the file up to `<file>.bak-v2` before applying it.
- No new dependencies. Native Pointer Events, `ResizeObserver`, CSS container units only.
- Copy: field label «Ряды»; existing notices unchanged («Нет свободного места»).
- Commits: conventional `type(scope): subject`, one or two lines, no attribution trailers. Branch `csscoder/searobin`.
- Tasks 1–4 change shared contracts before their consumers: until Task 5, `pnpm -r typecheck` and suites outside each task's scope may fail (`GRID` is removed in Task 1; `WidgetBoard.vue` adopts the new API in Task 5). Every task runs its own scoped suites; Task 5 runs everything.

**Deviation from the spec (refinement, same intent):** the spec's migration bumps every room's revision. That would also bump the fresh seed room (revision 1 → 2) and break every API fixture without protecting anything: an empty room has no layout to overwrite, and a pre-migration tab sends screens without `rows`, which the API now rejects with `400`. Migration 3 therefore bumps only rooms that had widgets.

## Review Focus

1. A widget type whose `sizing.min.h` exceeds the screen's rows (e.g. min height 14 with 12 rows): building must show «Нет свободного места», never place it in the red zone — `findFreeRect` returns `null` (Task 1).
2. The rows field receives `""`, `4.5`, `3`, `101`, `4`, `100`: only integers 4..100 change the working copy; everything else leaves it untouched (Task 5, `withRows`).
3. The window is resized while a pointer drag is in progress: the drag continues and keeps snapping; the card is not yanked back to its slot mid-drag (Task 4).
4. A red widget moving up into a cell occupied by a green widget: the overlap rule still blocks it; the red-zone rule never overrides collisions (Task 1).
5. An empty screen where only `rows` changed: «Готово» saves one PUT, the revision bumps and the rows read back (Task 3).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/contracts/src/grid.ts` | Grid constants, bounds, zones, move/resize/find rules | 1 |
| `packages/contracts/src/board.ts` | `ScreenBoard.rows`, its validation, `24x100` messages | 2 |
| `packages/contracts/src/widget-package.ts` | Manifest sizing bound `24 × 100` and message | 2 |
| `packages/contracts/src/builtin-widgets.ts` | Placeholder sizing `max 24×100` | 2 |
| `apps/api/src/migrations.ts` | Migration 3 | 3 |
| `apps/api/src/rooms.ts` | Read and save `screens.rows` | 3 |
| `apps/ui/app/board/use-active-rect.ts` | `rows` / `gridRows` options, clamp to limit, `dragging`, `ResizeObserver` | 4 |
| `apps/ui/app/board/edit-session.ts` | `withRows(doc, rows)` | 5 |
| `apps/ui/app/board/WidgetBoard.vue` | Fluid CSS grid, rendered rows, coloured dots, `rows` / `setRows` | 5 |
| `apps/ui/app/app.vue` | Scale, rows field, «Изменить» on a loaded empty board | 5 |

---

### Task 1: Grid rules in contracts

**Files:**
- Modify: `packages/contracts/src/grid.ts` (whole file)
- Test: `packages/contracts/test/grid.test.ts` (whole file)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `GRID_COLS: 24`
  - `ROWS: { readonly min: 4; readonly max: 100; readonly default: 12 }`
  - `inBounds(rect: Rect): boolean` — hard bound `24 × ROWS.max`
  - `occupiedRows(layout: readonly Rect[]): number`
  - `gridRows(rows: number, layout: readonly Rect[]): number`
  - `isFree(rect: Rect, others: readonly Rect[], limit: number): boolean`
  - `findFreeRect(size: Size, others: readonly Rect[], rows: number): Rect | null`
  - `moveTo(rect: Rect, x: number, y: number, others: readonly Rect[], rows: number): Rect`
  - `resizeTo(rect: Rect, w: number, h: number, limits: SizeLimits, others: readonly Rect[], rows: number): Rect`
  - `GRID` is removed.

- [ ] **Step 1: Write the failing tests**

Replace `packages/contracts/test/grid.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import {
  findFreeRect,
  GRID_COLS,
  gridRows,
  isFree,
  moveTo,
  occupiedRows,
  resizeTo,
  ROWS,
  type Rect,
} from '../src/grid.ts'

const limits = { min: { w: 1, h: 1 }, max: { w: GRID_COLS, h: ROWS.max } }
const block: Rect = { x: 4, y: 0, w: 4, h: 4 }

describe('grid constants', () => {
  it('has 24 columns and 4..100 rows, 12 by default', () => {
    expect(GRID_COLS).toBe(24)
    expect(ROWS).toEqual({ min: 4, max: 100, default: 12 })
  })
})

describe('occupiedRows and gridRows', () => {
  it('uses the configured rows for an empty layout', () => {
    expect(occupiedRows([])).toBe(0)
    expect(gridRows(10, [])).toBe(10)
  })

  it('extends the grid down to the lowest widget below the configured rows', () => {
    const layout: Rect[] = [block, { x: 20, y: 26, w: 4, h: 4 }]
    expect(occupiedRows(layout)).toBe(30)
    expect(gridRows(10, layout)).toBe(30)
    expect(gridRows(40, layout)).toBe(40)
  })
})

describe('isFree', () => {
  it('accepts a rect inside the limit', () => {
    expect(isFree({ x: 0, y: 0, w: 24, h: 8 }, [], 8)).toBe(true)
  })

  it('rejects a rect leaving the columns, the limit or the hard bound', () => {
    expect(isFree({ x: 21, y: 0, w: 4, h: 1 }, [], 8)).toBe(false)
    expect(isFree({ x: 0, y: 5, w: 1, h: 4 }, [], 8)).toBe(false)
    expect(isFree({ x: 0, y: 97, w: 1, h: 4 }, [], 200)).toBe(false)
    expect(isFree({ x: -1, y: 0, w: 1, h: 1 }, [], 8)).toBe(false)
    expect(isFree({ x: 0, y: 0, w: 0, h: 1 }, [], 8)).toBe(false)
  })

  it('rejects an overlap and accepts touching edges', () => {
    expect(isFree({ x: 6, y: 2, w: 4, h: 4 }, [block], 8)).toBe(false)
    expect(isFree({ x: 0, y: 0, w: 4, h: 4 }, [block], 8)).toBe(true)
    expect(isFree({ x: 4, y: 4, w: 4, h: 4 }, [block], 8)).toBe(true)
  })
})

describe('findFreeRect', () => {
  it('returns the top-left corner on an empty grid', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [], 8)).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })

  it('scans rows top-down, columns left-right, skipping occupied cells', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 22, h: 4 }], 8)).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('never places into the red zone, even when rows below are empty', () => {
    expect(findFreeRect({ w: 4, h: 4 }, [{ x: 0, y: 0, w: 24, h: 5 }], 8)).toBeNull()
    expect(findFreeRect({ w: 1, h: 1 }, [{ x: 0, y: 0, w: 24, h: 8 }], 8)).toBeNull()
  })

  it('returns null for a size taller than the configured rows', () => {
    expect(findFreeRect({ w: 2, h: 14 }, [], 12)).toBeNull()
  })

  it('finds the last free 1x1 cell', () => {
    const others: Rect[] = [
      { x: 0, y: 0, w: 24, h: 7 },
      { x: 0, y: 7, w: 23, h: 1 },
    ]
    expect(findFreeRect({ w: 1, h: 1 }, others, 8)).toEqual({ x: 23, y: 7, w: 1, h: 1 })
  })
})

describe('moveTo in the green zone', () => {
  const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }

  it('moves to a free target', () => {
    expect(moveTo(rect, 0, 4, [block], 8)).toEqual({ x: 0, y: 4, w: 4, h: 4 })
  })

  it('stops at the configured rows', () => {
    expect(moveTo(rect, 0, 5, [], 8)).toBe(rect)
  })

  it('returns the unchanged rect outside the columns or on an occupied target', () => {
    expect(moveTo(rect, 21, 0, [], 8)).toBe(rect)
    expect(moveTo(rect, -1, 0, [], 8)).toBe(rect)
    expect(moveTo(rect, 1, 0, [block], 8)).toBe(rect)
  })
})

describe('resizeTo in the green zone', () => {
  it('grows into free cells', () => {
    expect(resizeTo({ x: 0, y: 0, w: 2, h: 2 }, 3, 3, limits, [], 8)).toEqual({ x: 0, y: 0, w: 3, h: 3 })
  })

  it('respects min and max', () => {
    const rect: Rect = { x: 0, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 0, 2, limits, [], 8)).toBe(rect)
    expect(resizeTo(rect, 3, 2, { min: { w: 1, h: 1 }, max: { w: 2, h: 2 } }, [], 8)).toBe(rect)
  })

  it('stays inside the columns and the configured rows', () => {
    const right: Rect = { x: 22, y: 0, w: 2, h: 2 }
    expect(resizeTo(right, 3, 2, limits, [], 8)).toBe(right)
    const rect: Rect = { x: 0, y: 0, w: 2, h: 2 }
    expect(resizeTo(rect, 2, 9, limits, [], 8)).toBe(rect)
  })

  it('does not enter occupied cells', () => {
    const rect: Rect = { x: 0, y: 0, w: 4, h: 4 }
    expect(resizeTo(rect, 5, 4, limits, [block], 8)).toBe(rect)
  })
})

describe('the red zone (rows = 10, a widget on rows 26..29)', () => {
  const red: Rect = { x: 20, y: 26, w: 4, h: 4 }

  it('moves up and sideways', () => {
    expect(moveTo(red, 20, 20, [], 10)).toEqual({ x: 20, y: 20, w: 4, h: 4 })
    expect(moveTo(red, 10, 26, [], 10)).toEqual({ x: 10, y: 26, w: 4, h: 4 })
  })

  it('never moves down', () => {
    expect(moveTo(red, 20, 27, [], 10)).toBe(red)
  })

  it('moves the limit up with the widget, down to the configured rows', () => {
    const raised = moveTo(red, 20, 20, [], 10)
    expect(moveTo(raised, 20, 22, [], 10)).toBe(raised)
    const green = moveTo(raised, 20, 0, [], 10)
    expect(moveTo(green, 20, 7, [], 10)).toBe(green)
    expect(moveTo(green, 20, 6, [], 10)).toEqual({ x: 20, y: 6, w: 4, h: 4 })
  })

  it('shrinks and widens but never grows down', () => {
    const wide: Rect = { x: 0, y: 26, w: 4, h: 4 }
    expect(resizeTo(wide, 3, 3, limits, [], 10)).toEqual({ x: 0, y: 26, w: 3, h: 3 })
    expect(resizeTo(wide, 5, 4, limits, [], 10)).toEqual({ x: 0, y: 26, w: 5, h: 4 })
    expect(resizeTo(wide, 4, 5, limits, [], 10)).toBe(wide)
  })

  it('is still blocked by other widgets', () => {
    expect(moveTo(red, 20, 0, [{ x: 18, y: 0, w: 4, h: 4 }], 10)).toBe(red)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifedashboard/contracts exec vitest run test/grid.test.ts`
Expected: FAIL — `GRID_COLS`, `ROWS`, `occupiedRows`, `gridRows` are not exported; 12-column bounds reject 24-column rects.

- [ ] **Step 3: Write the implementation**

Replace `packages/contracts/src/grid.ts` with:

```ts
export const GRID_COLS = 24
/** Rows a screen may configure; `max` is also the hard bound of every placement. */
export const ROWS = { min: 4, max: 100, default: 12 } as const

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

/** A widget type's size contract in cells (base design §7.4). */
export interface WidgetSizing extends SizeLimits {
  default: Size
}

/** The hard bound: 24 columns × ROWS.max rows. The configured rows are checked by the rules below. */
export function inBounds(rect: Rect): boolean {
  return (
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= GRID_COLS &&
    rect.y + rect.h <= ROWS.max
  )
}

/** Bottom edge of the lowest placement, 0 for an empty layout. */
export function occupiedRows(layout: readonly Rect[]): number {
  return layout.reduce((rows, rect) => Math.max(rows, rect.y + rect.h), 0)
}

/** Rows the board renders: the configured rows, or more when a widget lies below them. */
export function gridRows(rows: number, layout: readonly Rect[]): number {
  return Math.max(rows, occupiedRows(layout))
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Inside the hard bound, not ending below `limit` rows, and clear of `others`. */
export function isFree(rect: Rect, others: readonly Rect[], limit: number): boolean {
  return inBounds(rect) && rect.y + rect.h <= limit && others.every((other) => !overlaps(rect, other))
}

// A step may not end below the configured rows or, for a widget in the red zone, below its own
// bottom edge: such a widget can only be brought out of the red zone (spec «Grid rules»).
function limitFor(rect: Rect, rows: number): number {
  return Math.max(rows, rect.y + rect.h)
}

export function findFreeRect(size: Size, others: readonly Rect[], rows: number): Rect | null {
  for (let y = 0; y + size.h <= rows; y++) {
    for (let x = 0; x + size.w <= GRID_COLS; x++) {
      const candidate = { x, y, w: size.w, h: size.h }
      if (isFree(candidate, others, rows)) return candidate
    }
  }
  return null
}

export function moveTo(rect: Rect, x: number, y: number, others: readonly Rect[], rows: number): Rect {
  const next = { ...rect, x, y }
  return isFree(next, others, limitFor(rect, rows)) ? next : rect
}

export function resizeTo(
  rect: Rect,
  w: number,
  h: number,
  limits: SizeLimits,
  others: readonly Rect[],
  rows: number,
): Rect {
  if (w < limits.min.w || w > limits.max.w || h < limits.min.h || h > limits.max.h) return rect
  const next = { ...rect, w, h }
  return isFree(next, others, limitFor(rect, rows)) ? next : rect
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lifedashboard/contracts exec vitest run test/grid.test.ts`
Expected: PASS (all `grid.test.ts` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/grid.ts packages/contracts/test/grid.test.ts
git commit -m "feat(contracts): 24-column grid rules with configurable rows and a red zone"
```

---

### Task 2: `ScreenBoard.rows` and 24×100 sizing

**Files:**
- Modify: `packages/contracts/src/board.ts:1`, `:23-27` (`ScreenBoard`), `:56-99` (`parseScreenBoard`)
- Modify: `packages/contracts/src/widget-package.ts:1`, `:94`, `:120`
- Modify: `packages/contracts/src/builtin-widgets.ts:16`
- Test: `packages/contracts/test/board.test.ts`, `packages/contracts/test/widget-package.test.ts`, `packages/contracts/test/builtin-widgets.test.ts`, `apps/ui/test/catalog.test.ts:40`
- Fixtures: `apps/ui/test/edit-session.test.ts:12-25`, `apps/ui/test/room-sync.test.ts:10-20`

**Interfaces:**
- Consumes: `GRID_COLS`, `ROWS`, `inBounds`, `overlaps` from Task 1.
- Produces:
  - `interface ScreenBoard { id: string; rows: number; instances: WidgetInstance[]; layout: WidgetPlacement[] }` — key order `id, rows, instances, layout` everywhere (the API echoes it and `isSameBoard` compares JSON).
  - `parseScreenBoard` errors: `rows must be an integer 4..100`; `layout[i]: x, y, w, h must be integers with w, h >= 1 inside the 24x100 grid`.
  - Manifest error: `manifest.sizing must have integer sizes with min ≤ default ≤ max inside the 24x100 grid`.
  - Placeholder sizing `{ default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 24, h: 100 } }`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/test/board.test.ts`:

Change the fixture so `valid` has rows and room for a red placement:

```ts
const valid: ScreenBoard = {
  id: SCREEN,
  rows: 10,
  instances: [
    { id: A, source: { ...placeholder }, configVersion: 1, config: {} },
    { id: B, source: { ...placeholder }, configVersion: 1, config: { title: 'x', nested: { n: 1 } } },
  ],
  layout: [
    { instanceId: A, x: 0, y: 0, w: 4, h: 4 },
    { instanceId: B, x: 4, y: 0, w: 2, h: 2 },
  ],
}
```

Add after the `'accepts a package source'` test:

```ts
  it('accepts a placement below the configured rows (red zone)', () => {
    const raw = mutated((d) => { d.layout[1] = { instanceId: B, x: 20, y: 40, w: 2, h: 2 } })
    expect(parseScreenBoard(raw).ok).toBe(true)
  })

  it('accepts the row bounds 4 and 100', () => {
    expect(parseScreenBoard(mutated((d) => { d.rows = 4 })).ok).toBe(true)
    expect(parseScreenBoard(mutated((d) => { d.rows = 100 })).ok).toBe(true)
  })
```

In the `it.each` rejection table, replace the five rows matching `/inside the 12x8 grid/` with the rows below, and add the rows cases:

```ts
    ['missing rows', mutated((d) => { delete d.rows }), /rows must be an integer 4\.\.100/],
    ['rows below 4', mutated((d) => { d.rows = 3 }), /rows must be an integer 4\.\.100/],
    ['rows above 100', mutated((d) => { d.rows = 101 }), /rows must be an integer 4\.\.100/],
    ['fractional rows', mutated((d) => { d.rows = 4.5 }), /rows must be an integer 4\.\.100/],
    ['string rows', mutated((d) => { d.rows = '12' }), /rows must be an integer 4\.\.100/],
    ['an out-of-bounds placement', mutated((d) => { d.layout[1].x = 23 }), /inside the 24x100 grid/],
    ['a placement below row 100', mutated((d) => { d.layout[1].y = 99 }), /inside the 24x100 grid/],
    ['a non-integer coordinate', mutated((d) => { d.layout[1].x = 1.5 }), /inside the 24x100 grid/],
    ['a string coordinate', mutated((d) => { d.layout[1].x = '4' }), /inside the 24x100 grid/],
    ['a zero width', mutated((d) => { d.layout[1].w = 0 }), /inside the 24x100 grid/],
```

In `packages/contracts/test/widget-package.test.ts`, replace the `'max wider than the grid'` row of the rejection table with:

```ts
    ['max wider than the grid', mutated((d) => { d.manifest.sizing.max.w = 25 }), /manifest\.sizing.*inside the 24x100 grid/],
    ['max taller than the grid', mutated((d) => { d.manifest.sizing.max.h = 101 }), /manifest\.sizing.*inside the 24x100 grid/],
```

and add a test next to the other accepting tests (inside the same `describe` as the table):

```ts
  it('accepts sizing up to the 24x100 grid', () => {
    const raw = mutated((d) => { d.manifest.sizing.max = { w: 24, h: 100 } })
    expect(parseWidgetPackage(raw).ok).toBe(true)
  })
```

In `packages/contracts/test/builtin-widgets.test.ts:10` and `apps/ui/test/catalog.test.ts:40`, change `max: { w: 12, h: 8 }` to `max: { w: 24, h: 100 }`.

Add `rows: 12` to the UI fixtures that build screens, right after `id`:
- `apps/ui/test/edit-session.test.ts`, the `board` constant: `id: SCREEN, rows: 12,`
- `apps/ui/test/room-sync.test.ts`, `screen()`: `id: SCREEN, rows: 12,`; and in `board()`: `{ id: OTHER_SCREEN, rows: 12, instances: [], layout: [] }`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifedashboard/contracts exec vitest run test/board.test.ts test/widget-package.test.ts test/builtin-widgets.test.ts`
Expected: FAIL — `rows` is dropped/not validated, messages still say `12x8`, placeholder `max` is `12×8`.

- [ ] **Step 3: Write the implementation**

`packages/contracts/src/board.ts`:

```ts
import { GRID_COLS, ROWS, inBounds, overlaps, type Rect } from './grid.ts'
```

```ts
export interface ScreenBoard {
  id: string
  // Configured rows (ROWS.min..ROWS.max); placements may lie below them (base design §7.4).
  rows: number
  instances: WidgetInstance[]
  layout: WidgetPlacement[]
}
```

In `parseScreenBoard`, after the `screen id must be a UUID` check:

```ts
  const rows = raw.rows
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < ROWS.min || rows > ROWS.max) {
    return fail(`rows must be an integer ${ROWS.min}..${ROWS.max}`)
  }
```

Change the placement error to:

```ts
      return fail(`layout[${index}]: x, y, w, h must be integers with w, h >= 1 inside the ${GRID_COLS}x${ROWS.max} grid`)
```

and the success value to:

```ts
  return { ok: true, value: { id: raw.id, rows, instances, layout } }
```

`packages/contracts/src/widget-package.ts`:

```ts
import { GRID_COLS, ROWS, type Size, type WidgetSizing } from './grid.ts'
```

```ts
  return ordered && max.w <= GRID_COLS && max.h <= ROWS.max ? { default: preferred, min, max } : null
```

```ts
  if (!sizing) {
    return fail(`manifest.sizing must have integer sizes with min ≤ default ≤ max inside the ${GRID_COLS}x${ROWS.max} grid`)
  }
```

`packages/contracts/src/builtin-widgets.ts`:

```ts
    sizing: { default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 24, h: 100 } },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lifedashboard/contracts test`
Expected: PASS (whole contracts suite).

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/catalog.test.ts test/edit-session.test.ts test/room-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/board.ts packages/contracts/src/widget-package.ts packages/contracts/src/builtin-widgets.ts packages/contracts/test/board.test.ts packages/contracts/test/widget-package.test.ts packages/contracts/test/builtin-widgets.test.ts apps/ui/test/catalog.test.ts apps/ui/test/edit-session.test.ts apps/ui/test/room-sync.test.ts
git commit -m "feat(contracts): rows on ScreenBoard and 24x100 sizing bounds"
```

---

### Task 3: Migration 3 and `screens.rows` in the API

**Files:**
- Modify: `apps/api/src/migrations.ts` (append to `MIGRATIONS`)
- Modify: `apps/api/src/rooms.ts:73-97` (`readBoard`), `:114-162` (`saveBoard`)
- Test: `apps/api/test/db.test.ts`, `apps/api/test/rooms.test.ts`
- Fixtures: `apps/api/test/widget-packages.test.ts:183-187`, `apps/api/test/widget-gateway.test.ts:18-27`

**Interfaces:**
- Consumes: `ScreenBoard.rows`, `parseScreenBoard` (Task 2).
- Produces: `GET /api/v1/rooms/:roomId/board` screens `{ id, rows, instances, layout }`; `PUT` stores `rows` per screen in the same transaction.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/db.test.ts`:

In `'creates the schema and the seed room with one screen'`, replace the screens assertion with:

```ts
    expect(db.prepare('SELECT id, room_id, position, rows FROM screens').all()).toEqual([
      { id: SEED_SCREEN_ID, room_id: SEED_ROOM_ID, position: 0, rows: 12 },
    ])
```

The v1 → v2 test must stop at version 2, otherwise migration 3 deletes its widget. Pass the first two migrations to both opens:

```ts
    const db = await openDatabase(file, MIGRATIONS.slice(0, 2))
```

```ts
    const again = await openDatabase(file, MIGRATIONS.slice(0, 2))
```

Add after that test:

```ts
  it('migrates a version 2 database to version 3: rows 12, layouts reset, packages kept', async () => {
    const v2 = await openDatabase(file, MIGRATIONS.slice(0, 2))
    v2.exec(`
      INSERT INTO widget_packages (id, title, author, created_at) VALUES ('dev.test.hello', 'Hello', 'test', 'x');
      INSERT INTO widget_package_versions (package_id, version, hash, manifest, files, installed_at)
      VALUES ('dev.test.hello', '1.0.0', '${'a'.repeat(64)}', '{}', '{}', 'x');
      INSERT INTO widget_grants (package_id, permission, granted_at) VALUES ('dev.test.hello', 'state', 'x');
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('w1', '${SEED_SCREEN_ID}', 'builtin', 'placeholder', '{}', 1, 0, 0, 2, 2);
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('w1', '{}', 1, 'x');
      INSERT INTO rooms (id, title, position, revision, created_at, updated_at) VALUES ('r2', 'Пустая', 1, 5, 'x', 'x');
    `)
    v2.close()

    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(3)
    expect(db.prepare('SELECT id, rows FROM screens').all()).toEqual([{ id: SEED_SCREEN_ID, rows: 12 }])
    expect(db.prepare('SELECT count(*) AS n FROM widgets').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM widget_state').get()).toEqual({ n: 0 })
    // Only a room that lost widgets gets a new revision: a stale tab of it must reload.
    expect(db.prepare('SELECT id, revision FROM rooms ORDER BY position').all()).toEqual([
      { id: SEED_ROOM_ID, revision: 2 },
      { id: 'r2', revision: 5 },
    ])
    expect(db.prepare('SELECT count(*) AS n FROM widget_package_versions').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT count(*) AS n FROM widget_grants').get()).toEqual({ n: 1 })
    expect(() => db.exec(`UPDATE screens SET rows = 3`)).toThrow()
    expect(() => db.exec(`UPDATE screens SET rows = 101`)).toThrow()
    db.close()
  })
```

`apps/api/test/rooms.test.ts`:

```ts
const EMPTY_SCREEN = { id: SEED_SCREEN_ID, rows: 12, instances: [], layout: [] }
```

Add `rows: 12,` right after `id: SEED_SCREEN_ID,` in the `screen` and `withPackage` fixtures, and in `onlyB` / `onlyA`:

```ts
    const onlyB: ScreenBoard = { id: SEED_SCREEN_ID, rows: 12, instances: [screen.instances[0]!], layout: [screen.layout[0]!] }
```

```ts
    const onlyA: ScreenBoard = { id: SEED_SCREEN_ID, rows: 12, instances: [withPackage.instances[0]!], layout: [withPackage.layout[0]!] }
```

Replace the inline `{ id: SEED_SCREEN_ID, instances: [], layout: [] }` objects (GET seed test at line 61, `const empty` at line 91) with `EMPTY_SCREEN`.

Change the 409 test payload so it would also change `rows`:

```ts
    const response = await put({ expectedRevision: 1, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
```

Change `outside` to stay outside the 24-column grid:

```ts
  outside.layout[0] = { instanceId: B, x: 23, y: 0, w: 2, h: 2 }
```

Add rows cases to the 400 table:

```ts
  const withoutRows = { id: screen.id, instances: screen.instances, layout: screen.layout }
```

```ts
    ['missing rows', { expectedRevision: 2, screens: [withoutRows] }],
    ['rows below 4', { expectedRevision: 2, screens: [{ ...screen, rows: 3 }] }],
    ['rows above 100', { expectedRevision: 2, screens: [{ ...screen, rows: 101 }] }],
```

Add inside `describe('PUT /api/v1/rooms/:roomId/board')`:

```ts
  it('stores rows and reads them back, also on an empty screen', async () => {
    const response = await put({ expectedRevision: 1, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ roomId: SEED_ROOM_ID, revision: 2, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
    expect(await getBoard()).toEqual({ roomId: SEED_ROOM_ID, revision: 2, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
  })

  it('accepts a placement below the configured rows', async () => {
    const red = { ...screen, rows: 4, layout: [{ instanceId: B, x: 4, y: 20, w: 2, h: 2 }, screen.layout[1]!] }
    const response = await put({ expectedRevision: 1, screens: [red] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens).toEqual([red])
  })
```

Fixtures in other API tests: add `rows: 12,` right after `id: SEED_SCREEN_ID,` in the `screen` objects of `apps/api/test/widget-packages.test.ts` (`'answers 409 PACKAGE_IN_USE…'`) and `apps/api/test/widget-gateway.test.ts` (setup).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifedashboard/api exec vitest run test/db.test.ts test/rooms.test.ts`
Expected: FAIL — no `rows` column, GET omits `rows`, PUT does not store it.

- [ ] **Step 3: Write the implementation**

`apps/api/src/migrations.ts` — append a third entry to `MIGRATIONS` (after the second template literal, before `]`):

```ts
  `
ALTER TABLE screens ADD COLUMN rows INTEGER NOT NULL DEFAULT 12 CHECK (rows BETWEEN 4 AND 100);

-- The 24-column grid does not carry 12-column layouts over (spec 2026-10-09-fluid-board-grid).
-- A room that loses widgets gets a new revision, so a tab opened before the migration reloads.
UPDATE rooms SET revision = revision + 1
WHERE id IN (SELECT s.room_id FROM screens s JOIN widgets w ON w.screen_id = s.id);
DELETE FROM widget_state;
DELETE FROM widgets;
`,
```

`apps/api/src/rooms.ts` — `readBoard`:

```ts
function readBoard(db: DatabaseSync, roomId: string): RoomBoard {
  const revision = roomRevision(db, roomId)
  // rowid keeps the insertion order: instances read back in the sent order, the layout follows them.
  const widgets = db
    .prepare('SELECT w.* FROM widgets w JOIN screens s ON s.id = w.screen_id WHERE s.room_id = ? ORDER BY w.rowid')
    .all(roomId) as unknown as WidgetRow[]
  const screens = db
    .prepare('SELECT id, rows FROM screens WHERE room_id = ? ORDER BY position')
    .all(roomId) as unknown as { id: string; rows: number }[]
  return {
    roomId,
    revision,
    screens: screens.map(({ id, rows }) => {
      const placed = widgets.filter((row) => row.screen_id === id)
      return {
        id,
        rows,
        instances: placed.map((row) => ({
          id: row.id,
          source: sourceOf(row),
          configVersion: row.config_version,
          config: JSON.parse(row.config) as Record<string, unknown>,
        })),
        layout: placed.map((row) => ({ instanceId: row.id, x: row.x, y: row.y, w: row.w, h: row.h })),
      }
    }),
  }
}
```

`saveBoard` — right after `checkPackagesInstalled(db, screens)`:

```ts
    const setRows = db.prepare('UPDATE screens SET rows = ? WHERE id = ?')
    for (const screen of screens) setRows.run(screen.rows, screen.id)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lifedashboard/api test`
Expected: PASS (whole API suite).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migrations.ts apps/api/src/rooms.ts apps/api/test/db.test.ts apps/api/test/rooms.test.ts apps/api/test/widget-packages.test.ts apps/api/test/widget-gateway.test.ts
git commit -m "feat(api): store rows per screen; migration 3 resets 12-column layouts"
```

---

### Task 4: Pointer mechanics follow rows, rendered rows and grid resizes

**Files:**
- Modify: `apps/ui/app/board/use-active-rect.ts` (whole file)
- Test: `apps/ui/test/use-active-rect.test.ts`

**Interfaces:**
- Consumes: `GRID_COLS`, `moveTo(…, rows)`, `resizeTo(…, rows)` (Task 1).
- Produces: `useActiveRect(options: ActiveRectOptions)` with

```ts
export interface ActiveRectOptions {
  gridEl: Readonly<Ref<HTMLElement | null>>
  others: () => readonly Rect[]
  sizing: () => SizeLimits | null
  rows: () => number      // configured rows of the shown screen
  gridRows: () => number  // rendered rows
}
```

returning `{ rect, moving, dragging, cardStyle, activate, deactivate, onPointerDown, onPointerMove, onPointerUp, step }`; `dragging: Ref<boolean>` is `true` from `pointerdown` (move or resize) until `pointerup` / `pointercancel` / `activate` / `deactivate`.

- [ ] **Step 1: Write the failing tests**

In `apps/ui/test/use-active-rect.test.ts`, replace the header constants and `setup` with:

```ts
// A 24-column grid of 64 px cells with 12 px gaps: the pitch is 76 px on both axes.
const PITCH = 76
const limits: SizeLimits = { min: { w: 1, h: 1 }, max: { w: 3, h: 3 } }
let time = 0
const scopes: ReturnType<typeof effectScope>[] = []

// Vitest runs in Node: a fake ResizeObserver lets a test report a new grid size.
let resizeGrid: () => void = () => {}
let disconnected = 0
class FakeResizeObserver {
  constructor(callback: () => void) {
    resizeGrid = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {
    disconnected++
  }
}

function gridBox(rows: number, cell = 64) {
  return { left: 0, top: 0, width: 24 * cell + 23 * 12, height: rows * cell + (rows - 1) * 12 }
}

function setup(others: Rect[] = [], sizing: SizeLimits | null = limits, rows = 8, rendered = rows) {
  const box = gridBox(rendered)
  const gridEl = shallowRef<HTMLElement | null>({ getBoundingClientRect: () => box } as unknown as HTMLElement)
  const scope = effectScope()
  scopes.push(scope)
  const active = scope.run(() =>
    useActiveRect({ gridEl, others: () => others, sizing: () => sizing, rows: () => rows, gridRows: () => rendered }),
  )!
  return { ...active, box, scope }
}
```

In `beforeEach`, add after the `getComputedStyle` stub:

```ts
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  disconnected = 0
```

Add these tests at the end of `describe('useActiveRect')`:

```ts
  it('derives the vertical pitch from the rendered rows', () => {
    const active = setup([], limits, 10, 30)
    active.activate({ x: 0, y: 26, w: 2, h: 2 })
    expect(active.cardStyle.value).toMatchObject({ height: `${2 * PITCH - 12}px` })
  })

  it('clamps a pointer move to the configured rows', () => {
    const active = setup([], limits, 8)
    active.activate({ x: 0, y: 0, w: 2, h: 2 })
    active.onPointerDown(pointer(10, 10), 'move')
    active.onPointerMove(pointer(10, 10 + 7 * PITCH))
    expect(active.rect.value).toEqual({ x: 0, y: 6, w: 2, h: 2 })
  })

  it('lets a red widget move up by pointer but never down', () => {
    const active = setup([], limits, 8, 30)
    active.activate({ x: 0, y: 26, w: 2, h: 2 })
    active.onPointerDown(pointer(10, 10), 'move')
    active.onPointerMove(pointer(10, 10 + 2 * PITCH))
    expect(active.rect.value).toEqual({ x: 0, y: 26, w: 2, h: 2 })
    active.onPointerMove(pointer(10, 10 - 10 * PITCH))
    expect(active.rect.value).toEqual({ x: 0, y: 16, w: 2, h: 2 })
  })

  it('steps a red widget up by keyboard but never down', () => {
    const active = setup([], limits, 8, 30)
    active.activate({ x: 0, y: 26, w: 2, h: 2 })
    active.step(0, 1, false)
    expect(active.rect.value).toEqual({ x: 0, y: 26, w: 2, h: 2 })
    active.step(0, -1, false)
    expect(active.rect.value).toEqual({ x: 0, y: 25, w: 2, h: 2 })
    active.step(0, 1, false)
    expect(active.rect.value).toEqual({ x: 0, y: 25, w: 2, h: 2 })
  })

  it('reports dragging for pointer resize and move until pointerup', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    expect(active.dragging.value).toBe(false)
    active.onPointerDown(pointer(10, 10), 'resize')
    expect(active.dragging.value).toBe(true)
    expect(active.moving.value).toBe(false)
    active.onPointerUp()
    expect(active.dragging.value).toBe(false)
    active.onPointerDown(pointer(10, 10), 'move')
    expect(active.dragging.value).toBe(true)
    active.onPointerUp()
    expect(active.dragging.value).toBe(false)
  })

  it('follows a new grid size: the card takes the new cell size on its slot', () => {
    const active = setup()
    active.activate({ x: 2, y: 1, w: 2, h: 2 })
    Object.assign(active.box, gridBox(8, 96))
    resizeGrid()
    // 96 px cells + 12 px gaps: the pitch is 108 px.
    expect(active.cardStyle.value).toMatchObject({ width: `${2 * 108 - 12}px`, height: `${2 * 108 - 12}px` })
    expect(active.cardStyle.value.transform).toMatch(/^translate3d\(0px, 0px, 0\)/)
  })

  it('keeps a pointer drag going when the grid resizes during it', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.onPointerDown(pointer(0, 0), 'move')
    active.onPointerMove(pointer(3 * PITCH, 0))
    resizeGrid()
    expect(active.dragging.value).toBe(true)
    active.onPointerMove(pointer(5 * PITCH, 0))
    expect(active.rect.value).toEqual({ x: 5, y: 0, w: 1, h: 1 })
  })

  it('disconnects the observer with its scope', () => {
    const active = setup()
    active.scope.stop()
    expect(disconnected).toBe(1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/use-active-rect.test.ts`
Expected: FAIL — `GRID` is undefined (removed in Task 1), no `dragging`, no observer.

- [ ] **Step 3: Write the implementation**

Replace `apps/ui/app/board/use-active-rect.ts` with:

```ts
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { GRID_COLS, moveTo, resizeTo, type Rect, type SizeLimits } from '@lifedashboard/contracts/grid'
import { useDraftMotion } from './draft-motion'

export interface ActiveRectOptions {
  gridEl: Readonly<Ref<HTMLElement | null>>
  others: () => readonly Rect[]
  // null disables resize: a widget type without a manifest keeps its size.
  sizing: () => SizeLimits | null
  // Configured rows of the shown screen: the limit of moves and resizes (grid.ts).
  rows: () => number
  // Rows the grid renders, for the vertical pitch.
  gridRows: () => number
}

type Drag = { mode: 'move'; pointerX: number; pointerY: number; cardX: number; cardY: number } | { mode: 'resize' }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * One active rectangle on the board grid: the builder draft or the widget being edited. The card
 * moves freely in px from its visible pose; `rect` is the snapped landing slot. Bounds, collisions,
 * the red zone and sizing limits stay in grid.ts.
 */
export function useActiveRect({ gridEl, others, sizing, rows, gridRows }: ActiveRectOptions) {
  const rect = ref<Rect | null>(null)
  const moving = ref(false)
  // Any pointer operation, move or resize: the board holds its rendered rows meanwhile.
  const dragging = ref(false)
  // Cell + gap pitch in px, read from the grid on activation, when a drag begins and on resize.
  const metrics = ref({ pitchX: 0, pitchY: 0, colGap: 0, rowGap: 0 })
  const motion = useDraftMotion({ x: 0, y: 0 })
  let drag: Drag | null = null

  const cardStyle = computed((): Record<string, string> => {
    const current = rect.value
    if (!current) return {}
    const { pitchX, pitchY, colGap, rowGap } = metrics.value
    const p = motion.pose.value
    // The card is positioned relative to its slot, so the offset is the pose minus the slot origin.
    return {
      width: `${current.w * pitchX - colGap}px`,
      height: `${current.h * pitchY - rowGap}px`,
      transform:
        `translate3d(${p.x - current.x * pitchX}px, ${p.y - current.y * pitchY}px, 0) rotate(${p.rotate}deg) ` +
        `skew(${p.skewX}deg, ${p.skewY}deg) scale(${p.scaleX}, ${p.scaleY})`,
    }
  })

  // The grid has no padding or border, so its box starts at the first cell.
  function readMetrics() {
    const el = gridEl.value
    if (!el) return null
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const colGap = parseFloat(style.columnGap)
    const rowGap = parseFloat(style.rowGap)
    const lines = gridRows()
    metrics.value = {
      pitchX: (box.width - colGap * (GRID_COLS - 1)) / GRID_COLS + colGap,
      pitchY: (box.height - rowGap * (lines - 1)) / lines + rowGap,
      colGap,
      rowGap,
    }
    return box
  }

  function slotPx(target: Rect) {
    return { x: target.x * metrics.value.pitchX, y: target.y * metrics.value.pitchY }
  }

  function settle() {
    if (rect.value) motion.moveTo(slotPx(rect.value), false)
  }

  function resized(current: Rect, w: number, h: number): Rect {
    const limits = sizing()
    return limits ? resizeTo(current, w, h, limits, others(), rows()) : current
  }

  // Window resizes and scale changes resize the grid: the card follows the new cell size. A drag in
  // progress keeps its pose; the next pointermove uses the new pitch.
  const observer = new ResizeObserver(() => {
    if (!readMetrics()) return
    if (rect.value && !drag) motion.reset(slotPx(rect.value))
  })
  watch(
    gridEl,
    (el, _previous, onCleanup) => {
      if (!el) return
      observer.observe(el)
      onCleanup(() => observer.unobserve(el))
    },
    { immediate: true },
  )
  onScopeDispose(() => observer.disconnect())

  /** Call only when the active widget changes: it places the card on the slot without animation. */
  function activate(next: Rect) {
    // A drag still held on the previous rect must not move the new one.
    drag = null
    moving.value = false
    dragging.value = false
    rect.value = { x: next.x, y: next.y, w: next.w, h: next.h }
    readMetrics()
    motion.reset(slotPx(next))
  }

  function deactivate() {
    rect.value = null
    drag = null
    moving.value = false
    dragging.value = false
  }

  function onPointerDown(event: PointerEvent, mode: 'move' | 'resize') {
    if (!rect.value || event.button !== 0 || !readMetrics()) return
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    dragging.value = true
    if (mode === 'resize') {
      drag = { mode }
      return
    }
    // Grabbing a settling card starts from its visible pose, so it does not jump.
    const { x, y } = motion.pose.value
    drag = { mode, pointerX: event.clientX, pointerY: event.clientY, cardX: x, cardY: y }
    moving.value = true
    motion.moveTo({ x, y }, true)
  }

  function onPointerMove(event: PointerEvent) {
    const current = rect.value
    if (!drag || !current) return
    const { pitchX, pitchY } = metrics.value
    if (drag.mode === 'resize') {
      const box = gridEl.value?.getBoundingClientRect()
      if (!box) return
      const cellX = Math.floor((event.clientX - box.left) / pitchX)
      const cellY = Math.floor((event.clientY - box.top) / pitchY)
      rect.value = resized(current, cellX - current.x + 1, cellY - current.y + 1)
      return
    }
    // The free card never floats below the limit of the red-zone rule (grid.ts).
    const limit = Math.max(rows(), current.y + current.h)
    const free = {
      x: clamp(drag.cardX + event.clientX - drag.pointerX, 0, (GRID_COLS - current.w) * pitchX),
      y: clamp(drag.cardY + event.clientY - drag.pointerY, 0, (limit - current.h) * pitchY),
    }
    motion.moveTo(free, true)
    // The slot snaps to the nearest cell; an occupied candidate keeps the last valid slot.
    rect.value = moveTo(current, Math.round(free.x / pitchX), Math.round(free.y / pitchY), others(), rows())
  }

  function onPointerUp() {
    if (drag?.mode === 'move') settle()
    drag = null
    moving.value = false
    dragging.value = false
  }

  function step(dx: number, dy: number, resize: boolean) {
    const current = rect.value
    if (!current) return
    if (resize) {
      rect.value = resized(current, current.w + dx, current.h + dy)
    } else {
      rect.value = moveTo(current, current.x + dx, current.y + dy, others(), rows())
      settle()
    }
  }

  return { rect, moving, dragging, cardStyle, activate, deactivate, onPointerDown, onPointerMove, onPointerUp, step }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/use-active-rect.test.ts test/draft-motion.test.ts`
Expected: PASS (existing and new tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/board/use-active-rect.ts apps/ui/test/use-active-rect.test.ts
git commit -m "feat(ui): active rect follows configured rows, rendered rows and grid resizes"
```

---

### Task 5: Fluid board, coloured dots, rows field and scale

**Files:**
- Modify: `apps/ui/app/board/edit-session.ts` (add `withRows`)
- Modify: `apps/ui/app/board/WidgetBoard.vue` (script and styles as below)
- Modify: `apps/ui/app/app.vue` (header, `html` font size, styles)
- Test: `apps/ui/test/edit-session.test.ts`

**Interfaces:**
- Consumes: `GRID_COLS`, `ROWS`, `gridRows`, `findFreeRect(…, rows)` (Task 1); `ScreenBoard.rows` (Task 2); `useActiveRect` options `rows`, `gridRows` and `dragging` (Task 4).
- Produces:
  - `withRows(doc: ScreenBoard, rows: number): ScreenBoard` — a copy with `rows` when it is an integer in `ROWS.min..ROWS.max`, otherwise `doc` itself.
  - `WidgetBoard` exposes `{ confirm, cancel, saving, loaded, rows, setRows }`; `rows: number` is the shown screen's configured rows; `setRows(value: number): void` changes the working copy in edit mode only. `hasWidgets` is removed (no longer used).

- [ ] **Step 1: Write the failing tests**

In `apps/ui/test/edit-session.test.ts`, extend the import:

```ts
import { focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setPlacement, withRows } from '../app/board/edit-session'
```

Add:

```ts
describe('withRows', () => {
  it('sets an integer in 4..100 and does not mutate its input', () => {
    const before = structuredClone(board)
    expect(withRows(board, 4)).toEqual({ ...board, rows: 4 })
    expect(withRows(board, 100)).toEqual({ ...board, rows: 100 })
    expect(board).toEqual(before)
  })

  it.each([Number.NaN, 4.5, 3, 101, 0, -12])('returns the same board for %s', (value) => {
    expect(withRows(board, value)).toBe(board)
  })

  it('makes a board with only changed rows differ', () => {
    expect(isSameBoard(withRows(board, 13), board)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/edit-session.test.ts`
Expected: FAIL — `withRows` is not exported.

- [ ] **Step 3: Implement `withRows`**

In `apps/ui/app/board/edit-session.ts`, add to the imports and after `removeInstance`:

```ts
import { ROWS, type Rect } from '@lifedashboard/contracts/grid'
```

```ts
/** The board with new configured rows; anything but an integer in ROWS.min..ROWS.max changes nothing. */
export function withRows(doc: ScreenBoard, rows: number): ScreenBoard {
  return Number.isInteger(rows) && rows >= ROWS.min && rows <= ROWS.max ? { ...doc, rows } : doc
}
```

(Replace the existing `import type { Rect } from '@lifedashboard/contracts/grid'` line with the import above.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/edit-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `WidgetBoard.vue` script**

Imports:

```ts
import { GRID_COLS, ROWS, findFreeRect, gridRows, type Rect } from '@lifedashboard/contracts/grid'
```

```ts
import { focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setPlacement, withRows, type BoardMode } from './edit-session'
```

Delete the static `cells` constant (lines 24-29). Change `emptyScreen`:

```ts
const emptyScreen: ScreenBoard = { id: '', rows: ROWS.default, instances: [], layout: [] }
```

Replace `hasWidgets` and the start of `placed` with a shared `shown`:

```ts
const editing = computed(() => mode.value === 'edit')
// The screen on display: the working copy in edit mode, the loaded screen otherwise.
const shown = computed(() => (editing.value ? working.value : doc.value))

const placed = computed(() =>
  shown.value.layout.flatMap((placement) => {
    const instance = shown.value.instances.find((item) => item.id === placement.instanceId)
    return instance ? [{ instance, placement }] : []
  }),
)
```

Before the `useActiveRect` call, add the rendered rows:

```ts
// Held during a pointer operation, so the grid never shrinks under the pointer (spec «Board»).
const heldRows = ref<number | null>(null)
const renderedRows = computed(() => heldRows.value ?? gridRows(shown.value.rows, shown.value.layout))
const cells = computed(() =>
  Array.from({ length: GRID_COLS * renderedRows.value }, (_, index) => ({
    x: index % GRID_COLS,
    y: Math.floor(index / GRID_COLS),
    w: 1,
    h: 1,
  })),
)
```

Change the `useActiveRect` call: add `dragging` to the destructuring and the two options:

```ts
const {
  rect: activeRect,
  moving,
  dragging,
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
  sizing: () => (editing.value ? activeSizing.value : draftSizing.value),
  rows: () => shown.value.rows,
  gridRows: () => renderedRows.value,
})

watch(
  dragging,
  (active) => {
    heldRows.value = active ? gridRows(shown.value.rows, shown.value.layout) : null
  },
  { flush: 'sync' },
)
```

In `start()`, pass the configured rows:

```ts
  const rect =
    sizing &&
    (findFreeRect(sizing.default, others, doc.value.rows) ?? findFreeRect(sizing.min, others, doc.value.rows))
```

Add the rows API before `defineExpose`:

```ts
const rows = computed(() => shown.value.rows)

function setRows(value: number) {
  if (editing.value && !saving.value) working.value = withRows(working.value, value)
}

defineExpose({ confirm, cancel, saving, loaded, rows, setRows })
```

(Remove the old `defineExpose` line and the `hasWidgets` computed.)

- [ ] **Step 6: Update `WidgetBoard.vue` template and styles**

Grid element — add the rendered rows as a custom property:

```vue
    <div
      ref="gridBox"
      class="board__grid"
      :class="{ 'board__grid--building': mode === 'build' }"
      :style="{ '--grid-rows': renderedRows }"
      :inert="saving"
    >
      <template v-if="mode !== 'view'">
        <span
          v-for="cell in cells"
          :key="`${cell.x}-${cell.y}`"
          class="board__dot"
          :class="{ 'board__dot--out': cell.y >= shown.rows }"
          :style="area(cell)"
        />
      </template>
```

Styles — replace the `.board`, `.board__grid` and `.board__dot` rules with:

```css
/* The padding lives here, not on the grid, so pointer math starts at the first cell. The board is the
   size container: 24 square cells fill its content width, and it scrolls when the grid is taller. */
.board {
  box-sizing: border-box;
  container-type: inline-size;
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 1rem;
}

.board__grid {
  --ld-cell: calc((100cqw - 23 * 0.5rem) / 24);
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  grid-template-rows: repeat(var(--grid-rows), var(--ld-cell));
  gap: 0.5rem;
}

.board__dot {
  place-self: center;
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 50%;
  background: var(--ld-success);
  pointer-events: none;
}

/* Rows below the configured rows: widgets there can only be brought out (spec «Grid rules»). */
.board__dot--out {
  background: var(--ld-danger);
}
```

- [ ] **Step 7: Update `app.vue`**

Script — add the import and handler:

```ts
import { ROWS } from '@lifedashboard/contracts/grid'
```

```ts
// An empty or out-of-range value leaves the working copy unchanged; :invalid marks the field.
function setRows(event: Event) {
  boardRef.value?.setRows((event.target as HTMLInputElement).valueAsNumber)
}
```

Header — inside `<template v-if="mode !== 'view'">`, after the «Отмена» button:

```vue
            <label v-if="mode === 'edit'" class="app__theme">
              Ряды
              <input
                class="app__select app__rows"
                type="number"
                required
                :min="ROWS.min"
                :max="ROWS.max"
                step="1"
                :value="boardRef?.rows"
                :disabled="boardRef?.saving"
                @input="setRows"
              />
            </label>
```

«Изменить» — enabled on any loaded board (after migration 3 every board is empty):

```vue
            <button type="button" class="app__button" :disabled="!boardRef?.loaded" @click="mode = 'edit'">
              Изменить
            </button>
```

Styles:

```css
/* One scale for the whole UI (base design §7.4): every size is rem, only the root font size changes. */
html {
  font-size: calc(100vw / 80);
}
```

and add after the `.app__select` rules:

```css
.app__rows {
  width: 4.5rem;
}

.app__rows:invalid {
  outline: 0.125rem solid var(--ld-danger);
}
```

- [ ] **Step 8: Run the full verification**

Run: `pnpm -r typecheck`
Expected: exit 0 for every package.

Run: `pnpm test`
Expected: PASS for contracts, api, ui and widget-sdk.

- [ ] **Step 9: Manual check in Orca's built-in browser**

Use the `orca-cli` skill for the browser. Start `pnpm dev` from the repository root. The API applies migration 3 to the local database on start, which deletes the placed widgets (backup at `<db file>.bak-v2`). Pair with the code printed by the API, open `http://127.0.0.1:3000`, and record each result in the task report:

1. 1280 px and 1920 px wide windows: the grid fills the width, cells are square, text and gaps grow in proportion.
2. «Изменить» works on the empty board. The rows field shows 12. Set 30, then «Готово». The board scrolls vertically, and after a reload it still has 30 rows.
3. Add a placeholder and move it into the bottom-right corner. Save, then set rows to 10. The widget stays where it is, over red dots, with green dots above row 10.
4. Move the widget up: it moves. Try to move it back down: it does not. Once it is above row 10, the red zone disappears.
5. Shrink a red widget with the pointer while the board is scrolled to the end: the grid does not jump.
6. Resize the window from 1280 to 1920 while a widget is active: its card stays on its slot at the new size.
7. Clear the rows field: it is marked invalid and the dots do not change. Type 3, then 101: same result. «Отмена» restores the saved rows.
8. A package widget (`examples/widgets/hello`) scales with the board when the window is resized.

- [ ] **Step 10: Commit**

```bash
git add apps/ui/app/board/edit-session.ts apps/ui/app/board/WidgetBoard.vue apps/ui/app/app.vue apps/ui/test/edit-session.test.ts
git commit -m "feat(ui): fluid 24-column board with per-screen rows and red-zone dots"
```
