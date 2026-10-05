# Board Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An «Изменить» header button turns on an edit mode in which placed widgets move, resize and are deleted; «Готово» saves all changes with one write, «Отмена» discards them, and the «×» delete button exists only in this mode.

**Architecture:**
- The builder draft mechanics (grid metrics, pointer move/resize, snapping, GSAP motion, arrow steps) move out of `WidgetBoard.vue` into the composable `board/use-active-rect.ts`. It drives one active rectangle among others and serves both the builder draft and the edited widget.
- Pure document operations and the «Готово» decision live in `board/edit-session.ts` (no Vue, no DOM).
- `WidgetBoard.vue` switches between `view`, `build` and `edit` through a `mode` v-model that replaces `building`. Edit mode works on a `working` copy; `doc` stays as loaded on entry and serves as the conflict-check snapshot.

**Tech Stack:** Node 24, pnpm 10.30.2, TypeScript 6.0.3 (strict, `noUncheckedIndexedAccess`), Nuxt 4.5.2 (SPA), Vue 3.5.43, GSAP 3.15.0, Vitest 5.0.3 (Node environment, no DOM). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-board-edit-mode-design.md`. It builds on `docs/superpowers/specs/2026-10-04-widget-builder-placement-design.md`. Base design: `docs/base-2026-10-04-lifegamehermes-design.md` (§7.4, DATA-06).

## Global Constraints

- **Branch.** Work on `csscoder/huchen`; never commit to `main`. Stage only the files each task names.
- **Dependencies.** None added. Drag and resize use native Pointer Events and the existing GSAP motion; no drag/resize library.
- **TypeScript.** Strict; must compile with `noUncheckedIndexedAccess`.
- **Nuxt.** `imports: { autoImport: false }` and `components: false`: import every Vue API, component and module explicitly. Local imports have no extensions (`'./edit-session'`).
- **Language.** User-facing strings are Russian, verbatim: «Изменить», «Готово», «Отмена», «Доска изменена в другой вкладке», «Виджет W×H, колонка X, ряд Y», «Удалить виджет W×H». Code, identifiers, comments and commit messages are English.
- **Styles.** `app.vue` and `board/WidgetBoard.vue` styles use theme tokens only: no colour literals (`theme-contract.test.ts` enforces this).
- **Grid rule (§7.4).** Move and resize never enter occupied cells; neighbours never shift; the operation is blocked.
- **Saving.** Edit mode writes storage only on «Готово», with one `saveBoard` call. «Отмена» and Esc never write.
- **Browser checks.** Use Orca's built-in browser through `orca-cli` (load the `orca-cli` skill); never an external browser.
- **Commits.** Short conventional subject, no attribution trailers.
- **Out of scope (do not build):** reset layout, `expectedRevision` and API routes, Rooms, undo inside the mode, multi-select, component and e2e tests, mobile layout.

## Review Focus

1. **Storage read failure or corrupt storage at «Готово».** `loadBoard` then returns an empty document with an `error`. Expected: no false conflict, the empty document is never applied, `working` is saved. Pinned by Task 1 test `a failed storage read never blocks the save`.
2. **Grabbing the active widget again while it settles.** Expected: the card continues from its visible pose and does not jump to the slot. Pinned by Task 2 test `grabbing the active rect again while it settles starts from the visible pose` (composable) and the `select()` guard in Task 3, Step 7, item 2 (manual).
3. **Clicking «×» in edit mode.** The item captures the pointer on `pointerdown`; without `@pointerdown.stop` on the button the click is retargeted to the item and the widget is grabbed instead of deleted. Expected: one click deletes. Pinned by Task 3, Step 7, item 4 (manual).
4. **Delete/Backspace with focus outside the board.** Focus on «Готово», «Отмена» or the theme `<select>`. Expected: no widget is deleted; Backspace on a header button does nothing to the board. Pinned by Task 3, Step 7, item 5 (manual).
5. **All widgets deleted, then «Отмена».** Expected: every widget returns and «Изменить» stays enabled; after «Готово» instead, the board is empty and «Изменить» is disabled. Pinned by Task 3, Step 7, item 7 (manual).

---

### Task 1: Edit session operations (`edit-session.ts`)

**Files:**
- Create: `apps/ui/app/board/edit-session.ts`
- Test: `apps/ui/test/edit-session.test.ts`

**Interfaces:**
- Consumes: `BoardDocument`, `WidgetPlacement`, `LoadError` from `apps/ui/app/widgets/board-document.ts`; `Rect` from `apps/ui/app/widgets/grid.ts`.
- Produces (`apps/ui/app/board/edit-session.ts`):
  - `type BoardMode = 'view' | 'build' | 'edit'`
  - `type ConfirmOutcome = 'unchanged' | 'conflict' | 'save'`
  - `setPlacement(doc: BoardDocument, id: string, rect: Rect): BoardDocument`
  - `removeInstance(doc: BoardDocument, id: string): BoardDocument`
  - `isSameBoard(a: BoardDocument, b: BoardDocument): boolean`
  - `readingOrder(layout: readonly WidgetPlacement[]): WidgetPlacement[]`
  - `focusAfterRemoval(layout: readonly WidgetPlacement[], id: string): string | null`
  - `confirmOutcome(working: BoardDocument, doc: BoardDocument, stored: { doc: BoardDocument; error?: LoadError } | null): ConfirmOutcome`

`readingOrder`, `focusAfterRemoval` and `confirmOutcome` are pure helpers inside the spec's `edit-session.ts` responsibility. They hold the focus rule after deletion and the «Готово» rules from the spec's Error handling table, so those rules get unit tests.

- [ ] **Step 1: Write the failing test**

`apps/ui/test/edit-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  confirmOutcome,
  focusAfterRemoval,
  isSameBoard,
  readingOrder,
  removeInstance,
  setPlacement,
} from '../app/board/edit-session'
import { emptyBoard, parseBoardDocument, type BoardDocument } from '../app/widgets/board-document'

const placeholder = { kind: 'builtin', type: 'placeholder' } as const

// Layout order differs from reading order on purpose: b (0,0), a (4,0), c (0,3).
const board: BoardDocument = {
  schemaVersion: 1,
  instances: [
    { id: 'a', source: { ...placeholder }, config: {} },
    { id: 'b', source: { ...placeholder }, config: {} },
    { id: 'c', source: { ...placeholder }, config: {} },
  ],
  layout: [
    { instanceId: 'a', x: 4, y: 0, w: 2, h: 2 },
    { instanceId: 'b', x: 0, y: 0, w: 2, h: 2 },
    { instanceId: 'c', x: 0, y: 3, w: 1, h: 1 },
  ],
}

describe('setPlacement', () => {
  it('changes only the target placement and does not mutate its input', () => {
    const before = structuredClone(board)
    const next = setPlacement(board, 'a', { x: 6, y: 1, w: 3, h: 2 })
    expect(next.layout).toEqual([{ instanceId: 'a', x: 6, y: 1, w: 3, h: 2 }, board.layout[1], board.layout[2]])
    expect(next.instances).toBe(board.instances)
    expect(board).toEqual(before)
  })

  it('copies only the rect fields of the given rect', () => {
    const next = setPlacement(board, 'a', { ...board.layout[1]!, x: 6 })
    expect(next.layout[0]).toEqual({ instanceId: 'a', x: 6, y: 0, w: 2, h: 2 })
  })
})

describe('removeInstance', () => {
  it('removes the instance with its placement and keeps the document valid', () => {
    const before = structuredClone(board)
    const next = removeInstance(board, 'b')
    expect(next.instances.map((item) => item.id)).toEqual(['a', 'c'])
    expect(next.layout.map((item) => item.instanceId)).toEqual(['a', 'c'])
    expect(parseBoardDocument(next)).toEqual({ ok: true, doc: next })
    expect(board).toEqual(before)
  })

  it('returns an equal document for an unknown id', () => {
    expect(removeInstance(board, 'zzz')).toEqual(board)
  })
})

describe('isSameBoard', () => {
  it('is true for equal documents', () => {
    expect(isSameBoard(board, structuredClone(board))).toBe(true)
  })

  it('is false when the layout differs', () => {
    expect(isSameBoard(board, setPlacement(board, 'c', { x: 1, y: 3, w: 1, h: 1 }))).toBe(false)
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
    expect(readingOrder(board.layout).map((item) => item.instanceId)).toEqual(['b', 'a', 'c'])
    expect(board.layout).toEqual(before)
  })
})

describe('focusAfterRemoval', () => {
  it('picks the next widget in reading order', () => {
    expect(focusAfterRemoval(board.layout, 'b')).toBe('a')
  })

  it('picks the previous widget when the last one is removed', () => {
    expect(focusAfterRemoval(board.layout, 'c')).toBe('a')
  })

  it('returns null for the only widget and for an unknown id', () => {
    expect(focusAfterRemoval([board.layout[0]!], 'a')).toBeNull()
    expect(focusAfterRemoval(board.layout, 'zzz')).toBeNull()
  })
})

describe('confirmOutcome', () => {
  const moved = setPlacement(board, 'c', { x: 1, y: 3, w: 1, h: 1 })
  const otherTab = removeInstance(board, 'a')

  it('is unchanged when the working copy equals the session start, whatever storage holds', () => {
    expect(confirmOutcome(structuredClone(board), board, { doc: otherTab })).toBe('unchanged')
  })

  it('saves when storage still holds the session start', () => {
    expect(confirmOutcome(moved, board, { doc: structuredClone(board) })).toBe('save')
  })

  it('reports a conflict when another tab saved since the session started', () => {
    expect(confirmOutcome(moved, board, { doc: otherTab })).toBe('conflict')
  })

  it('a failed storage read never blocks the save', () => {
    const failed = { doc: emptyBoard(), error: { kind: 'storage', message: 'denied' } } as const
    const corrupt = { doc: emptyBoard(), error: { kind: 'invalid-document', message: 'bad json' } } as const
    expect(confirmOutcome(moved, board, failed)).toBe('save')
    expect(confirmOutcome(moved, board, corrupt)).toBe('save')
  })

  it('saves without a check when memory is newer than storage (stored is null)', () => {
    expect(confirmOutcome(moved, board, null)).toBe('save')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/edit-session.test.ts`
Expected: FAIL — `Failed to resolve import "../app/board/edit-session"`.

- [ ] **Step 3: Write the implementation**

`apps/ui/app/board/edit-session.ts`:

```ts
import type { BoardDocument, LoadError, WidgetPlacement } from '../widgets/board-document'
import type { Rect } from '../widgets/grid'

/** Board interaction mode: display only, the builder draft, or editing the placed widgets. */
export type BoardMode = 'view' | 'build' | 'edit'

/** What «Готово» does with an edit session. */
export type ConfirmOutcome = 'unchanged' | 'conflict' | 'save'

export function setPlacement(doc: BoardDocument, id: string, rect: Rect): BoardDocument {
  // Only the rect fields are copied: callers may pass a placement or a rect with extra keys.
  const placement = { instanceId: id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  return { ...doc, layout: doc.layout.map((item) => (item.instanceId === id ? placement : item)) }
}

export function removeInstance(doc: BoardDocument, id: string): BoardDocument {
  return {
    ...doc,
    instances: doc.instances.filter((item) => item.id !== id),
    layout: doc.layout.filter((item) => item.instanceId !== id),
  }
}

// ponytail: JSON comparison is key-order sensitive; every document comes from parseBoardDocument or
// the helpers above, which keep one key order. Switch to a structural compare if other sources appear.
export function isSameBoard(a: BoardDocument, b: BoardDocument): boolean {
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

/**
 * Decides «Готово» for an edit session. `doc` is the document the session started from; `stored`
 * is a fresh storage read, or null when an earlier save failed and memory is newer than storage
 * (known limitation: another tab's save made meanwhile is then overwritten). A failed read cannot
 * prove a conflict, so it never blocks the save — the builder's refresh() rule.
 */
export function confirmOutcome(
  working: BoardDocument,
  doc: BoardDocument,
  stored: { doc: BoardDocument; error?: LoadError } | null,
): ConfirmOutcome {
  if (isSameBoard(working, doc)) return 'unchanged'
  if (stored && !stored.error && !isSameBoard(stored.doc, doc)) return 'conflict'
  return 'save'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/edit-session.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/board/edit-session.ts apps/ui/test/edit-session.test.ts
git commit -m "feat(board): edit session document operations"
```

---

### Task 2: Active rectangle composable and builder refactor

Moves the draft mechanics out of `WidgetBoard.vue` without behaviour changes. The builder must behave exactly as before.

**Files:**
- Create: `apps/ui/app/board/use-active-rect.ts`
- Modify: `apps/ui/app/board/WidgetBoard.vue` (the `<script setup>` block only; template and styles unchanged)
- Test: `apps/ui/test/use-active-rect.test.ts`

**Interfaces:**
- Consumes: `GRID`, `moveTo`, `resizeTo`, `Rect`, `SizeLimits` from `apps/ui/app/widgets/grid.ts`; `useDraftMotion` from `apps/ui/app/board/draft-motion.ts`.
- Produces (`apps/ui/app/board/use-active-rect.ts`):
  - `interface ActiveRectOptions { gridEl: Readonly<Ref<HTMLElement | null>>; others: () => readonly Rect[]; sizing: () => SizeLimits | null }`
  - `useActiveRect(options: ActiveRectOptions)` returning:
    - `rect: Ref<Rect | null>`: the snapped landing slot, always a plain `{ x, y, w, h }`;
    - `moving: Ref<boolean>`: true while a pointer move drag is held;
    - `cardStyle: ComputedRef<Record<string, string>>`: `width`, `height`, `transform` of the card, `{}` without a rect;
    - `activate(rect: Rect): void`: drops a held drag, sets the rect, reads metrics, snaps the card to the slot without animation. Call it only when the active widget changes;
    - `deactivate(): void`;
    - `onPointerDown(event: PointerEvent, mode: 'move' | 'resize'): void`, `onPointerMove(event: PointerEvent): void`, `onPointerUp(): void`;
    - `step(dx: number, dy: number, resize: boolean): void`: arrow keys; moves animate into the slot.
  - With `sizing()` returning `null`, pointer and step resize leave the rect unchanged.

- [ ] **Step 1: Write the failing test**

`apps/ui/test/use-active-rect.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'
import { gsap } from 'gsap'
import { useActiveRect } from '../app/board/use-active-rect'
import type { Rect, SizeLimits } from '../app/widgets/grid'

// A 12×8 grid of 64 px cells with 12 px gaps: the pitch is 76 px on both axes.
const PITCH = 76
const box = { left: 0, top: 0, width: 12 * 64 + 11 * 12, height: 8 * 64 + 7 * 12 }
const limits: SizeLimits = { min: { w: 1, h: 1 }, max: { w: 3, h: 3 } }
let time = 0
const scopes: ReturnType<typeof effectScope>[] = []

function setup(others: Rect[] = [], sizing: SizeLimits | null = limits) {
  const gridEl = shallowRef<HTMLElement | null>({ getBoundingClientRect: () => box } as unknown as HTMLElement)
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useActiveRect({ gridEl, others: () => others, sizing: () => sizing }))!
}

// Vitest runs in Node: a pointer event is a plain object with a capturing target.
function pointer(clientX: number, clientY: number) {
  return {
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    preventDefault() {},
    currentTarget: { setPointerCapture() {} },
  } as unknown as PointerEvent
}

// Drives GSAP manually so the tests control every frame (as in draft-motion.test.ts).
function advance(ms: number, interval = 1000 / 60) {
  const end = time + ms
  while (time < end) {
    time = Math.min(time + interval, end)
    gsap.updateRoot(time / 1000)
    gsap.ticker.sleep()
  }
}

// The card's absolute x in px: its offset from the slot plus the slot origin.
function cardX(active: ReturnType<typeof setup>) {
  const offset = /translate3d\(([^p]+)px/.exec(active.cardStyle.value.transform ?? '')
  return Number(offset![1]) + active.rect.value!.x * PITCH
}

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ columnGap: '12px', rowGap: '12px' }))
  gsap.ticker.remove(gsap.updateRoot)
  gsap.globalTimeline.clear()
  gsap.updateRoot(0)
  gsap.ticker.sleep()
  time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
})

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  gsap.globalTimeline.clear()
  gsap.ticker.add(gsap.updateRoot)
  gsap.ticker.sleep()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useActiveRect', () => {
  it('activate keeps a plain rect and snaps the card to the slot', () => {
    const active = setup()
    active.activate({ instanceId: 'a', x: 2, y: 1, w: 2, h: 2 } as Rect)
    expect(active.rect.value).toEqual({ x: 2, y: 1, w: 2, h: 2 })
    expect(active.cardStyle.value).toMatchObject({ width: `${2 * PITCH - 12}px`, height: `${2 * PITCH - 12}px` })
    expect(active.cardStyle.value.transform).toMatch(/^translate3d\(0px, 0px, 0\)/)
  })

  it('deactivate clears the rect and the card style', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.deactivate()
    expect(active.rect.value).toBeNull()
    expect(active.cardStyle.value).toEqual({})
  })

  it('steps by one cell and is blocked by occupied cells and grid bounds', () => {
    const active = setup([{ x: 2, y: 0, w: 1, h: 1 }])
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.step(1, 0, false)
    expect(active.rect.value).toEqual({ x: 1, y: 0, w: 1, h: 1 })
    active.step(1, 0, false)
    expect(active.rect.value).toEqual({ x: 1, y: 0, w: 1, h: 1 })
    active.step(0, -1, false)
    expect(active.rect.value).toEqual({ x: 1, y: 0, w: 1, h: 1 })
  })

  it('resizes by steps within the sizing limits', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 2, h: 2 })
    active.step(1, 0, true)
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
    active.step(1, 0, true)
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
  })

  it('does not resize without sizing limits', () => {
    const active = setup([], null)
    active.activate({ x: 0, y: 0, w: 2, h: 2 })
    active.step(1, 1, true)
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 2, h: 2 })
    active.onPointerDown(pointer(100, 100), 'resize')
    active.onPointerMove(pointer(5 * PITCH + 1, 5 * PITCH + 1))
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })

  it('snaps a pointer move to the nearest free cell and keeps the last valid slot', () => {
    const active = setup([{ x: 6, y: 1, w: 1, h: 1 }])
    active.activate({ x: 0, y: 0, w: 2, h: 2 })
    active.onPointerDown(pointer(10, 10), 'move')
    expect(active.moving.value).toBe(true)
    // Free position 248 px, 106 px → cell 3, 1.
    active.onPointerMove(pointer(10 + 3 * PITCH + 20, 10 + PITCH + 30))
    expect(active.rect.value).toEqual({ x: 3, y: 1, w: 2, h: 2 })
    // Cell 5, 1 would overlap the widget at 6, 1.
    active.onPointerMove(pointer(10 + 5 * PITCH, 10 + PITCH))
    expect(active.rect.value).toEqual({ x: 3, y: 1, w: 2, h: 2 })
    active.onPointerUp()
    expect(active.moving.value).toBe(false)
  })

  it('limits a pointer resize to the sizing limits', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.onPointerDown(pointer(50, 50), 'resize')
    active.onPointerMove(pointer(2 * PITCH + 5, PITCH + 5))
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
    active.onPointerMove(pointer(5 * PITCH + 5, PITCH + 5))
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
  })

  it('grabbing the active rect again while it settles starts from the visible pose', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.onPointerDown(pointer(0, 0), 'move')
    active.onPointerMove(pointer(300, 0))
    advance(80)
    active.onPointerUp()
    advance(80)
    const settling = active.cardStyle.value.transform
    const visibleX = cardX(active)
    // Still on its way to the slot at x = 4 (304 px), so the slot and the visible pose differ.
    expect(Math.abs(visibleX - 4 * PITCH)).toBeGreaterThan(1)
    active.onPointerDown(pointer(0, 0), 'move')
    expect(active.cardStyle.value.transform).toBe(settling)
    // A move without pointer offset holds the card where it was grabbed, not at the slot.
    active.onPointerMove(pointer(0, 0))
    advance(2400)
    expect(cardX(active)).toBeCloseTo(visibleX, 0)
  })

  it('switching the active rect during a drag ignores the old drag', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.onPointerDown(pointer(0, 0), 'move')
    active.activate({ x: 5, y: 5, w: 1, h: 1 })
    expect(active.moving.value).toBe(false)
    active.onPointerMove(pointer(3 * PITCH, 0))
    expect(active.rect.value).toEqual({ x: 5, y: 5, w: 1, h: 1 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/use-active-rect.test.ts`
Expected: FAIL — `Failed to resolve import "../app/board/use-active-rect"`.

- [ ] **Step 3: Write the composable**

`apps/ui/app/board/use-active-rect.ts` (the logic is moved from `WidgetBoard.vue`; only `activate`, `deactivate`, `step` and the `sizing() === null` guard are new; `activate` also drops a held drag):

```ts
import { computed, ref, type Ref } from 'vue'
import { GRID, moveTo, resizeTo, type Rect, type SizeLimits } from '../widgets/grid'
import { useDraftMotion } from './draft-motion'

export interface ActiveRectOptions {
  gridEl: Readonly<Ref<HTMLElement | null>>
  others: () => readonly Rect[]
  // null disables resize: a widget type without a manifest keeps its size.
  sizing: () => SizeLimits | null
}

type Drag = { mode: 'move'; pointerX: number; pointerY: number; cardX: number; cardY: number } | { mode: 'resize' }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * One active rectangle on the board grid: the builder draft or the widget being edited. The card
 * moves freely in px from its visible pose; `rect` is the snapped landing slot. Bounds, collisions
 * and sizing limits stay in grid.ts.
 */
export function useActiveRect({ gridEl, others, sizing }: ActiveRectOptions) {
  const rect = ref<Rect | null>(null)
  const moving = ref(false)
  // Cell + gap pitch in px, read from the grid on activation and when a drag begins.
  const metrics = ref({ pitchX: 0, pitchY: 0, colGap: 0, rowGap: 0 })
  const motion = useDraftMotion({ x: 0, y: 0 })
  let drag: Drag | null = null

  const cardStyle = computed<Record<string, string>>(() => {
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
    metrics.value = {
      pitchX: (box.width - colGap * (GRID.cols - 1)) / GRID.cols + colGap,
      pitchY: (box.height - rowGap * (GRID.rows - 1)) / GRID.rows + rowGap,
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
    return limits ? resizeTo(current, w, h, limits, others()) : current
  }

  /** Call only when the active widget changes: it places the card on the slot without animation. */
  function activate(next: Rect) {
    // A drag still held on the previous rect must not move the new one.
    drag = null
    moving.value = false
    rect.value = { x: next.x, y: next.y, w: next.w, h: next.h }
    readMetrics()
    motion.reset(slotPx(next))
  }

  function deactivate() {
    rect.value = null
    drag = null
    moving.value = false
  }

  function onPointerDown(event: PointerEvent, mode: 'move' | 'resize') {
    if (!rect.value || event.button !== 0 || !readMetrics()) return
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
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
    const free = {
      x: clamp(drag.cardX + event.clientX - drag.pointerX, 0, (GRID.cols - current.w) * pitchX),
      y: clamp(drag.cardY + event.clientY - drag.pointerY, 0, (GRID.rows - current.h) * pitchY),
    }
    motion.moveTo(free, true)
    // The slot snaps to the nearest cell; an occupied candidate keeps the last valid slot.
    rect.value = moveTo(current, Math.round(free.x / pitchX), Math.round(free.y / pitchY), others())
  }

  function onPointerUp() {
    if (drag?.mode === 'move') settle()
    drag = null
    moving.value = false
  }

  function step(dx: number, dy: number, resize: boolean) {
    const current = rect.value
    if (!current) return
    if (resize) {
      rect.value = resized(current, current.w + dx, current.h + dy)
    } else {
      rect.value = moveTo(current, current.x + dx, current.y + dy, others())
      settle()
    }
  }

  return { rect, moving, cardStyle, activate, deactivate, onPointerDown, onPointerMove, onPointerUp, step }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/use-active-rect.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Switch the builder to the composable**

Replace the whole `<script setup lang="ts">…</script>` block of `apps/ui/app/board/WidgetBoard.vue` with the block below. The template and styles stay unchanged: they already bind `draft`, `moving`, `cardStyle`, `draftLabel`, `onPointerDown`, `onPointerMove`, `onPointerUp` and `remove`.

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
import { GRID, findFreeRect, isFree, type Rect } from '../widgets/grid'
import WidgetHost from '../widgets/WidgetHost.vue'
import { isFormControlTarget } from './keyboard'
import { useActiveRect } from './use-active-rect'

const building = defineModel<boolean>('building', { required: true })
const emit = defineEmits<{ notice: [message: string | null] }>()
defineProps<{ themeId: string }>()

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
// Template ref keys must differ from setup bindings: ref="draft" would overwrite the draft rect.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')
const {
  rect: draft,
  moving,
  cardStyle,
  activate,
  deactivate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  step,
} = useActiveRect({ gridEl, others: () => doc.value.layout, sizing: () => sizing })
// True after a failed save: the in-memory document is then newer than storage and must not be replaced.
let unsaved = false
let persistenceNotice: string | null = null
let placementNotice: string | null = null

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

function emitNotice() {
  emit('notice', [persistenceNotice, placementNotice].filter(Boolean).join(' · ') || null)
}

function applyLoad(result: ReturnType<typeof loadBoard>) {
  doc.value = result.doc
  persistenceNotice = result.error?.kind === 'storage' ? 'Хранилище недоступно' : null
  emitNotice()
  if (result.error?.kind === 'invalid-document') console.warn(`Board document ignored: ${result.error.message}`)
}

function persist() {
  unsaved = !saveBoard(doc.value)
  persistenceNotice = unsaved ? 'Не удалось сохранить доску' : null
  placementNotice = null
  emitNotice()
}

function start() {
  placementNotice = null
  emitNotice()
  const others = doc.value.layout
  const rect = findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others)
  if (!rect) {
    placementNotice = 'Нет свободного места'
    emitNotice()
    building.value = false
    return
  }
  activate(rect)
  void nextTick(() => draftEl.value?.focus())
}

function stop() {
  deactivate()
  building.value = false
}

// Applies changes to the latest stored document so another tab's saved widgets are kept.
// Sequential changes only: simultaneous writes from two tabs are not atomic.
function refresh() {
  const result = loadBoard()
  if (!unsaved && !result.error) applyLoad(result)
}

function confirm() {
  const rect = draft.value
  if (!rect) return
  refresh()
  // Another tab may have taken the place since the draft was positioned.
  if (!isFree(rect, doc.value.layout)) {
    placementNotice = 'Место занято, переместите виджет'
    emitNotice()
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

function onKeydown(event: KeyboardEvent) {
  if (!draft.value || isFormControlTarget(event.target)) return
  const arrow = arrows[event.key]
  if (arrow) {
    event.preventDefault()
    step(arrow[0], arrow[1], event.shiftKey)
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
  if (!unsaved && (event.key === BOARD_STORAGE_KEY || event.key === null)) applyLoad(loadBoard())
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
```

- [ ] **Step 6: Run the full suite and the typecheck**

Run: `pnpm --filter @lifedashboard/ui exec vitest run && pnpm --filter @lifedashboard/ui typecheck`
Expected: all test files pass (the existing 164 tests plus Task 1 and Task 2 tests); typecheck exits 0.

- [ ] **Step 7: Check the builder in Orca's built-in browser**

Start the dev servers from the repository root with `pnpm dev` (UI at `http://127.0.0.1:3000`). Open the UI in Orca's built-in browser through `orca-cli` and confirm the builder is unchanged:
1. «+» shows the dot grid and a 4×4 draft that has focus.
2. Dragging moves the card smoothly and snaps the dashed slot to cells; release springs the card into the slot.
3. The corner handle resizes within limits; the draft never enters an occupied cell.
4. Arrows move, Shift+arrows resize, Enter places the widget, Esc cancels.

Record the results for the task report. Stop the dev servers afterwards.

- [ ] **Step 8: Commit**

```bash
git add apps/ui/app/board/use-active-rect.ts apps/ui/app/board/WidgetBoard.vue apps/ui/test/use-active-rect.test.ts
git commit -m "refactor(board): extract active rect mechanics into a composable"
```

---

### Task 3: Edit mode in the board and the header

**Files:**
- Modify: `apps/ui/app/board/WidgetBoard.vue` (whole file)
- Modify: `apps/ui/app/app.vue` (script lines with `building`, the header template, the `WidgetBoard` usage, one style rule)

**Interfaces:**
- Consumes: everything Task 1 produces (`BoardMode`, `setPlacement`, `removeInstance`, `readingOrder`, `focusAfterRemoval`, `confirmOutcome`); `useActiveRect` from Task 2; `findManifest` from `apps/ui/app/widgets/catalog.ts`.
- Produces:
  - `WidgetBoard` props/model: `v-model:mode` of type `BoardMode` (replaces `v-model:building`), prop `themeId: string`, event `notice: [message: string | null]`.
  - `WidgetBoard` exposed API: `confirm(): void`, `cancel(): void`, `hasWidgets: boolean` (true when the saved board has at least one widget).

This task changes Vue components only. Component tests are out of scope in the spec, so the unit-testable rules live in Tasks 1 and 2, and this task ends with the manual browser check from the spec. Run the existing suite before editing to have a green baseline.

- [ ] **Step 1: Confirm the baseline**

Run: `pnpm --filter @lifedashboard/ui exec vitest run`
Expected: all tests pass.

- [ ] **Step 2: Replace `WidgetBoard.vue`**

Replace the whole content of `apps/ui/app/board/WidgetBoard.vue` with:

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import {
  BOARD_STORAGE_KEY,
  emptyBoard,
  loadBoard,
  saveBoard,
  type BoardDocument,
  type WidgetInstance,
  type WidgetSource,
} from '../widgets/board-document'
import { findManifest, placeholderManifest } from '../widgets/catalog'
import { GRID, findFreeRect, isFree, type Rect } from '../widgets/grid'
import WidgetHost from '../widgets/WidgetHost.vue'
import {
  confirmOutcome,
  focusAfterRemoval,
  readingOrder,
  removeInstance,
  setPlacement,
  type BoardMode,
} from './edit-session'
import { isFormControlTarget } from './keyboard'
import { useActiveRect } from './use-active-rect'

const mode = defineModel<BoardMode>('mode', { required: true })
const emit = defineEmits<{ notice: [message: string | null] }>()
defineProps<{ themeId: string }>()

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

const doc = ref<BoardDocument>(emptyBoard())
// Edit mode changes a working copy. `doc` keeps the document loaded on entry (storage events are
// ignored meanwhile), so it is also the snapshot for the conflict check on «Готово».
const working = ref<BoardDocument>(emptyBoard())
const activeId = ref<string | null>(null)
// Template ref keys must differ from setup bindings: ref="draft" would overwrite a setup binding.
const gridEl = useTemplateRef<HTMLElement>('gridBox')
const draftEl = useTemplateRef<HTMLElement>('draftBox')
// True after a failed save: the in-memory document is then newer than storage and must not be replaced.
let unsaved = false
let persistenceNotice: string | null = null
let placementNotice: string | null = null

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

function emitNotice() {
  emit('notice', [persistenceNotice, placementNotice].filter(Boolean).join(' · ') || null)
}

function applyLoad(result: ReturnType<typeof loadBoard>) {
  doc.value = result.doc
  persistenceNotice = result.error?.kind === 'storage' ? 'Хранилище недоступно' : null
  emitNotice()
  if (result.error?.kind === 'invalid-document') console.warn(`Board document ignored: ${result.error.message}`)
}

function persist() {
  unsaved = !saveBoard(doc.value)
  persistenceNotice = unsaved ? 'Не удалось сохранить доску' : null
  placementNotice = null
  emitNotice()
}

// Applies changes to the latest stored document so another tab's saved widgets are kept.
// Sequential changes only: simultaneous writes from two tabs are not atomic.
function refresh() {
  const result = loadBoard()
  if (!unsaved && !result.error) applyLoad(result)
}

function start() {
  placementNotice = null
  emitNotice()
  const others = doc.value.layout
  const rect = findFreeRect(sizing.default, others) ?? findFreeRect(sizing.min, others)
  if (!rect) {
    placementNotice = 'Нет свободного места'
    emitNotice()
    mode.value = 'view'
    return
  }
  activate(rect)
  void nextTick(() => draftEl.value?.focus())
}

function enterEdit() {
  placementNotice = null
  emitNotice()
  refresh()
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
  refresh()
  // Another tab may have taken the place since the draft was positioned.
  if (!isFree(rect, doc.value.layout)) {
    placementNotice = 'Место занято, переместите виджет'
    emitNotice()
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

function confirmEdit() {
  // After a failed save memory is newer than storage, so there is nothing to compare against.
  const stored = unsaved ? null : loadBoard()
  const outcome = confirmOutcome(working.value, doc.value, stored)
  if (outcome === 'unchanged') {
    refresh()
  } else if (outcome === 'conflict' && stored) {
    applyLoad(stored)
    placementNotice = 'Доска изменена в другой вкладке'
    emitNotice()
  } else {
    doc.value = working.value
    persist()
  }
  stop()
}

function confirm() {
  if (editing.value) confirmEdit()
  else confirmBuild()
}

function cancel() {
  // Picks up saves from other tabs whose storage events were ignored during the edit session.
  if (editing.value) refresh()
  stop()
}

function onKeydown(event: KeyboardEvent) {
  if (mode.value === 'view' || isFormControlTarget(event.target)) return
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

function onStorage(event: StorageEvent) {
  if (!editing.value && !unsaved && (event.key === BOARD_STORAGE_KEY || event.key === null)) applyLoad(loadBoard())
}

watch(mode, (next) => {
  if (next === 'build' && !activeRect.value) start()
  else if (next === 'edit') enterEdit()
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

defineExpose({ confirm, cancel, hasWidgets })
</script>

<template>
  <div class="board">
    <div ref="gridBox" class="board__grid" :class="{ 'board__grid--building': mode === 'build' }">
      <template v-if="mode !== 'view'">
        <span v-for="cell in cells" :key="`${cell.x}-${cell.y}`" class="board__dot" :style="area(cell)" />
      </template>
      <div
        v-for="{ instance, placement } in placed"
        :key="instance.id"
        class="board__item"
        :class="{
          'board__item--editable': editing,
          'board__item--active': editing && instance.id === activeId,
          'board__item--moving': editing && moving && instance.id === activeId,
        }"
        :style="area(placement)"
        :data-instance="editing ? instance.id : undefined"
        :role="editing ? 'group' : undefined"
        :tabindex="editing ? 0 : undefined"
        :aria-label="editing ? rectLabel(placement) : undefined"
        @focusin="editing && select(instance.id)"
        @pointerdown="editing && grab($event, instance.id, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="board__card" :style="editing && instance.id === activeId ? cardStyle : fill">
          <WidgetHost class="board__content" :source="instance.source" :size="placement" :theme-id="themeId" />
          <span
            v-if="editing && sizingOf(instance)"
            class="board__resize"
            aria-hidden="true"
            @pointerdown.stop="grab($event, instance.id, 'resize')"
          />
        </div>
        <button
          v-if="editing"
          type="button"
          class="board__remove"
          :aria-label="`Удалить виджет ${placement.w}×${placement.h}`"
          @pointerdown.stop
          @click="removeWidget(instance.id)"
        >
          ×
        </button>
      </div>
      <div
        v-if="mode === 'build' && activeRect"
        ref="draftBox"
        class="board__item board__draft"
        :class="{ 'board__item--moving': moving }"
        role="group"
        tabindex="0"
        :aria-label="liveLabel"
        :style="area(activeRect)"
        @pointerdown="onPointerDown($event, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="board__card" :style="cardStyle">
          <WidgetHost :source="draftSource" :size="activeRect" :theme-id="themeId" />
          <span class="board__resize" aria-hidden="true" @pointerdown.stop="onPointerDown($event, 'resize')" />
        </div>
      </div>
    </div>
    <p class="board__live" aria-live="polite">{{ liveLabel }}</p>
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
  background: var(--ld-border-strong);
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

.board__draft,
.board__item--editable {
  cursor: grab;
  touch-action: none;
  outline-offset: 0.25rem;
}

.board__draft:active,
.board__item--editable:active {
  cursor: grabbing;
}

/* The moving card floats above its neighbours. */
.board__draft,
.board__item--active {
  z-index: 1;
}

.board__draft:focus-visible,
.board__item--editable:focus-visible,
.board__remove:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
}

.board__remove:focus-visible {
  outline-offset: 0.125rem;
}

/* Widget content stays inert while widgets are edited, so a drag never reaches it. */
.board__item--editable .board__content {
  pointer-events: none;
}

/* Landing slot shown while the card floats under the pointer. */
.board__item--moving::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 0.125rem dashed var(--ld-border-strong);
  border-radius: var(--ld-radius-widget);
}

/* Explicit px size (not the grid area) so resize can transition; the transform is driven by GSAP. */
.board__card {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  transition:
    width 0.15s ease-out,
    height 0.15s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .board__card {
    transition: none;
  }
}

.board__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1rem;
  height: 1rem;
  border-right: 0.1875rem solid var(--ld-text-primary);
  border-bottom: 0.1875rem solid var(--ld-text-primary);
  border-bottom-right-radius: var(--ld-radius-widget);
  cursor: nwse-resize;
}

.board__remove {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: 50%;
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}

.board__item:hover .board__remove,
.board__item:focus-within .board__remove {
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

- [ ] **Step 3: Update `app.vue`**

In `apps/ui/app/app.vue`:

1. Add the import after `import WidgetBoard from './board/WidgetBoard.vue'`:

```ts
import type { BoardMode } from './board/edit-session'
```

2. Replace `const building = ref(false)` with:

```ts
const mode = ref<BoardMode>('view')
```

3. Replace the header buttons block

```vue
        <template v-if="building">
          <button type="button" class="app__button" @click="boardRef?.confirm()">Готово</button>
          <button type="button" class="app__button" @click="boardRef?.cancel()">Отмена</button>
        </template>
        <button v-else type="button" class="app__button" aria-label="Добавить виджет" @click="building = true">+</button>
```

with

```vue
        <template v-if="mode !== 'view'">
          <button type="button" class="app__button" @click="boardRef?.confirm()">Готово</button>
          <button type="button" class="app__button" @click="boardRef?.cancel()">Отмена</button>
        </template>
        <template v-else>
          <button type="button" class="app__button" aria-label="Добавить виджет" @click="mode = 'build'">+</button>
          <button type="button" class="app__button" :disabled="!boardRef?.hasWidgets" @click="mode = 'edit'">
            Изменить
          </button>
        </template>
```

4. Replace `v-model:building="building"` on `<WidgetBoard …>` with `v-model:mode="mode"`.

5. Add after the `.app__button:focus-visible` rule:

```css
.app__button:disabled {
  cursor: default;
  opacity: 0.5;
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `pnpm --filter @lifedashboard/ui exec vitest run && pnpm --filter @lifedashboard/ui typecheck`
Expected: all tests pass (including `theme-contract.test.ts` › `app.vue styles use theme tokens only` and `board/WidgetBoard.vue styles use theme tokens only`); typecheck exits 0.

- [ ] **Step 5: Run the root checks**

Run: `pnpm typecheck && pnpm test`
Expected: both exit 0 for all packages.

- [ ] **Step 6: Start the app in Orca's built-in browser**

From the repository root run `pnpm dev` (UI at `http://127.0.0.1:3000`). Open the UI in Orca's built-in browser through `orca-cli`. Clear the board first: in the page console run `localStorage.removeItem('lifedashboard.board')` and reload. Place three placeholders with «+» (resize two of them smaller so free space remains). Then install a write counter for the board key in the console:

```js
window.__writes = 0
const setItem = Storage.prototype.setItem
Storage.prototype.setItem = function (key, value) {
  if (key === 'lifedashboard.board') window.__writes++
  return setItem.call(this, key, value)
}
```

The counter resets on reload; reinstall it after each reload that a check depends on.

- [ ] **Step 7: Run the manual check and record each result**

1. **View mode.** Hovering a widget shows no «×»; widgets cannot be dragged. «Изменить» is enabled with widgets and disabled on an empty board (check after step 7).
2. **Move and re-grab.** «Изменить» shows the dot grid and focuses the first widget (top row, leftmost). Drag a widget: the card follows smoothly, the dashed slot snaps to free cells and never enters an occupied cell; release springs it into the slot. Drag and release, then grab the same widget again while it is still settling: it continues from where it is, without jumping (Review Focus 2).
3. **Resize.** The corner handle resizes within the placeholder limits and never into occupied cells.
4. **Delete by click.** Hover a widget: «×» appears; one click deletes it (no drag starts) (Review Focus 3).
5. **Keyboard.** Tab to a widget: arrows move, Shift+arrows resize, the live region announces «Виджет W×H, колонка X, ряд Y». Delete removes the focused widget and focus moves to the next widget. Focus «Готово» in the header and press Backspace: nothing is deleted. Open the theme select and press Delete/arrows: the board does not react (Review Focus 4).
6. **Cancel and save.** Set `window.__writes = 0`. Move one widget and delete another: `__writes` stays 0 while editing. «Отмена» (and separately Esc): the board returns to its state before the mode and `__writes` is still 0. Repeat and press «Готово» (and separately Enter on a focused widget): the changes stay and `__writes` grows by exactly 1 per confirm; reload the page: they persist. Enter the mode and press «Готово» without changes: `__writes` does not grow.
7. **Delete all.** Delete every widget, then «Отмена»: all widgets return and «Изменить» is enabled. Delete every widget again, then «Готово»: the board is empty and «Изменить» is disabled (Review Focus 5).
8. **Two-tab conflict.** Open a second tab with the UI. In tab 1 press «Изменить» and move a widget. In tab 2 delete a widget through its own edit mode and press «Готово». In tab 1 press «Готово»: the header shows «Доска изменена в другой вкладке», tab 1 shows tab 2's board, and tab 2's change is not overwritten (reload tab 2 to confirm).
9. **Missed storage events.** In tab 1 press «Изменить»; in tab 2 make and save a change; in tab 1 press «Отмена»: tab 1 now shows tab 2's change.
10. **Builder regression.** «+» still works as in Task 2, Step 7; during the builder «Изменить» is hidden and placed widgets have no «×».
11. **Storage failures.**
    - *Read fails at «Готово».* Press «Изменить» and move a widget. Then run `const getItem = Storage.prototype.getItem; Storage.prototype.getItem = function () { throw new Error('denied') }` and press «Готово»: the board shows the moved layout (never an empty board) and the write counter grows by 1. Run `Storage.prototype.getItem = getItem` and reload: the moved layout persists.
    - *Save fails.* Run `const savedSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('quota') }`. Press «Изменить», move a widget, press «Готово»: the header shows «Не удалось сохранить доску», the moved layout stays on screen and the mode closes. Press «Изменить»: the moved layout is shown (not the stored one); press «Отмена»: the moved layout still stays. Run `Storage.prototype.setItem = savedSetItem` and reload: the layout from before the failed save is shown, because nothing was written.
12. **Unknown widget type.** Run `localStorage.setItem('lifedashboard.board', JSON.stringify({ schemaVersion: 1, instances: [{ id: 'u1', source: { kind: 'builtin', type: 'weather' }, config: {} }], layout: [{ instanceId: 'u1', x: 0, y: 0, w: 2, h: 2 }] }))` and reload: the board shows «Неизвестный виджет». Press «Изменить»: the widget has no resize handle; it moves by pointer and by arrows; Shift+arrows do not change its size; Delete removes it; «Отмена» brings it back.

Stop the dev servers afterwards. Record every result (pass/fail with a note) in the task report.

- [ ] **Step 8: Commit**

```bash
git add apps/ui/app/board/WidgetBoard.vue apps/ui/app/app.vue
git commit -m "feat(board): edit mode to move, resize and delete placed widgets"
```
