# Board edit mode: move, resize and delete placed widgets

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§7.4 «Редактирование», DATA-06)
- **Builds on:** `docs/superpowers/specs/2026-10-04-widget-builder-placement-design.md`
- **Status:** approved design, 2026-10-05

## Goal

An «Изменить» button in the header turns on an edit mode for the widgets already placed on the
current board. In the mode the user moves and resizes widgets cell by cell and deletes them.
Changes are collected in memory: «Готово» saves them with one write, «Отмена» discards all of
them, including deletions. Outside the mode the board is display-only: the hover «×» delete button
exists only in edit mode.

Success: outside the mode a widget cannot be deleted by accident; in the mode any widget can be
moved to free cells, resized within its sizing limits and deleted; the saved result survives
reload; a cancelled session leaves the board unchanged.

## Relation to the base design

There are no Rooms yet, so «current room» is the single board. §7.4 describes the edit mode as
move, resize within `sizing.min/max`, delete, reset layout and save with `expectedRevision`. This
step delivers move, resize and delete with a local snapshot check instead of `expectedRevision`.

| Base design | This step | Why / migration |
| --- | --- | --- |
| §7.4: save with `expectedRevision` | Snapshot comparison against `localStorage` on «Готово» | No API yet. The snapshot plays the role of the revision; the API version sends `expectedRevision` and handles `409` the same way |
| §7.4: reset layout | Not included | Not requested; added later as a separate action |
| §7.4: drag/resize library chosen by ADR (`grid-layout-plus` candidate) | Native Pointer Events, reusing the builder mechanics | Libraries tend to push neighbours, contradicting §7.4 «block, don't shift». No new dependency |

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Scope | Move, resize and delete | Resize costs little: `resizeTo` and the draft handle already exist; matches §7.4 |
| Saving | Batch: «Готово» writes once, «Отмена» discards everything | Cancel protects against accidental deletion; same header UX as the builder; maps to a future single `PUT /rooms/:id/layout` |
| Mechanics reuse | Extract the builder draft mechanics into one composable used by both modes | One implementation of drag, resize, keyboard and motion; `WidgetBoard.vue` stops growing |
| Mode state | `type BoardMode = 'view' \| 'build' \| 'edit'` replaces `building: boolean` | The modes are mutually exclusive; one value cannot express an impossible combination |
| Cross-tab conflict | Compare the stored document with the entry snapshot on «Готово»; on mismatch do not write | DATA-06: never silently overwrite another tab's changes |
| Widget content in edit mode | `pointer-events: none` on the content | Dragging never conflicts with future interactive widgets |

## Structure

All paths are in `apps/ui/`.

| File | Responsibility |
| --- | --- |
| `app/board/use-active-rect.ts` (new) | Mechanics of one active rectangle among others: grid metrics, pointer move and resize, cell snapping, GSAP motion via `useDraftMotion`, arrow-key steps. Moved out of `WidgetBoard.vue` without behaviour changes |
| `app/board/edit-session.ts` (new) | Pure TS, no Vue or DOM: `setPlacement(doc, id, rect)`, `removeInstance(doc, id)`, `isSameBoard(a, b)`. Each returns a new value and never mutates its input |
| `app/board/WidgetBoard.vue` | Orchestrates the `view`, `build` and `edit` modes; uses the two modules above; `remove` moves to `removeInstance` |
| `app/app.vue` | `mode` ref instead of `building`; header buttons per mode |
| `test/edit-session.test.ts`, `test/use-active-rect.test.ts` (new) | Vitest unit tests |

Dependency direction: `grid.ts` ← `edit-session.ts` ← `WidgetBoard.vue`;
`draft-motion.ts` ← `use-active-rect.ts` ← `WidgetBoard.vue`.

### `useActiveRect`

```ts
function useActiveRect(options: {
  gridEl: Readonly<Ref<HTMLElement | null>>
  others: () => readonly Rect[]
  sizing: () => SizeLimits | null // null: resize is disabled
}): {
  rect: Ref<Rect | null>
  moving: Ref<boolean>
  cardStyle: ComputedRef<Record<string, string>>
  activate(rect: Rect): void // reads metrics, resets motion to the slot
  deactivate(): void
  onPointerDown(event: PointerEvent, mode: 'move' | 'resize'): void
  onPointerMove(event: PointerEvent): void
  onPointerUp(): void
  step(dx: number, dy: number, resize: boolean): void // arrow keys; animates moves like the builder
}
```

Snapping, bounds, collisions and sizing limits stay in `grid.ts` (`moveTo`, `resizeTo`). With
`sizing() === null`, resize by pointer and by `step` leaves the rectangle unchanged.

## Modes

### Header (`app.vue`)

- `view`: «+» (→ `build`) and «Изменить» (→ `edit`). «Изменить» is disabled when the board has no
  widgets.
- `build` and `edit`: «Готово» and «Отмена» call the exposed `confirm()` and `cancel()`;
  `WidgetBoard` handles them according to the current mode.

### `build`

Unchanged behaviour. The active rectangle is the new draft, `others` is `doc.layout`, `sizing` is
the placeholder manifest's sizing. Placed widgets stay dimmed and have no «×».

### `view`

Display only. No «×», no drag, no resize handle.

### `edit`

**Entry.** Refresh the document from storage under the same rule as the builder's `refresh()`.
Set `working` to a copy of `doc`, `snapshot` to `JSON.stringify(doc)`, `activeId` to `null`. Show the
dot grid. Focus the first widget in reading order (row, then column).

**Rendering.** All placements of `working` render without dimming. Each widget has `cursor: grab`,
a bottom-right resize handle when its sizing is not `null`, and a «×» button visible on hover and
`focus-within`. Widget content has `pointer-events: none`. The active widget renders as the moving
card with the GSAP transform; while it is dragged, the landing slot is shown dashed, as for the
builder draft.

**Active widget.** The widget last grabbed with the pointer or focused with the keyboard.
`activate(rect)` makes it active. Every change of the active rectangle is written to `working`
with `setPlacement`. `others` is `working.layout` without the active placement. `sizing` is
`findManifest(source.type)?.sizing ?? null`, so an unknown widget type can move but not resize.

**Pointer.** `pointerdown` on the body or the resize handle of any widget activates it and starts
move or resize at once. Occupied cells and grid bounds block the operation; neighbours never shift.

**Keyboard.**

- Each widget is `role="group"`, `tabindex="0"` with `aria-label` «Виджет W×H, колонка X, ряд Y».
  Focus activates the widget.
- Arrows move by one cell, Shift+arrows resize. Changes are announced through the existing
  `aria-live` region.
- Delete or Backspace deletes the active widget; focus moves to the next widget in reading order, or
  to the previous one when the last was deleted.
- Enter = «Готово», Esc = «Отмена». Focused header buttons and form controls keep their own keys
  (`isFormControlTarget`, as today).

**Delete.** «×» or Delete calls `removeInstance(working, id)`. When the deleted widget was active,
`deactivate()` runs.

**«Готово».** When `isSameBoard(working, doc)`, leave the mode without writing. Otherwise run the
conflict check (see Error handling), then set `doc = working`, call `persist()` and leave the mode.

**«Отмена» / Esc.** Discard `working` and leave the mode without writing.

**Storage events.** While the mode is `edit`, `storage` events from other tabs do not replace any
state. In `view` and `build` they apply as today.

## Error handling

| Condition | Behaviour |
| --- | --- |
| On «Готово» the stored document differs from `snapshot` (another tab saved) | `working` is not written. Header shows «Доска изменена в другой вкладке»; the fresh document is loaded; the mode closes |
| An earlier save failed (`unsaved`): memory is newer than storage | The conflict check is skipped; `working` is saved directly |
| `saveBoard` returns `false` | «Не удалось сохранить доску»; `doc = working` stays in memory; the mode closes |
| Storage unavailable on entry | The mode works on the in-memory document |
| Unknown `source.type` | Move and delete work; resize is disabled |
| All widgets deleted in the mode | The mode stays on until «Готово» or «Отмена»; afterwards «Изменить» is disabled |

## Testing

TDD (RED → GREEN → REFACTOR) with vitest.

- **`test/edit-session.test.ts`:** `setPlacement` changes only the target placement and does not
  mutate its input; `removeInstance` removes the instance with its placement and the result passes
  `parseBoardDocument`; `isSameBoard` is true for equal documents and false for different layout or
  instances.
- **`test/use-active-rect.test.ts`:** the composable runs in an `effectScope` as in
  `draft-motion.test.ts`, with a stubbed grid element and `getComputedStyle`. `step` moves the
  rectangle and is blocked by occupied cells and bounds; Shift-resize respects `sizing` and does
  nothing with `sizing = null`; pointer move snaps to cells; pointer resize is limited.
- Existing tests stay green: they guard the builder refactor.
- `pnpm typecheck` and `pnpm test` pass.
- **Manual check in Orca's built-in browser (recorded in the task report):** no «×» outside the
  mode; in the mode drag, resize, keyboard move/resize and Delete work; «Отмена» restores moved and
  deleted widgets; «Готово» saves and the result survives reload; a two-tab conflict shows the
  message and the other tab's changes are not overwritten; the builder behaves as before;
  «Изменить» is disabled on an empty board.

## Acceptance criteria

- The header shows «Изменить» only in `view`; it is disabled on an empty board.
- In edit mode every placed widget moves and resizes cell by cell with the pointer and the keyboard,
  never overlapping other widgets, leaving the grid or breaking its `sizing.min/max`; an unknown
  widget type moves but does not resize.
- The «×» delete button and Delete-key deletion exist only in edit mode.
- «Готово» saves all changes with one write; they survive reload. «Отмена» and Esc discard all
  changes, including deletions.
- A conflicting save from another tab is never overwritten; the user sees «Доска изменена в другой
  вкладке».
- The builder (`build`) behaves as specified in the widget builder spec.
- `pnpm typecheck` and `pnpm test` pass.

## Out of scope

Reset layout, `expectedRevision` and API routes, Rooms and moving widgets between rooms, undo
inside the mode (only cancelling the whole session), multi-select, component and e2e tests, mobile
layout.
