# Fluid board grid: 24 columns across the window, rows per screen

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§7.4 «Layout»)
- **Builds on:** `docs/superpowers/specs/2026-10-05-board-edit-mode-design.md`,
  `docs/superpowers/specs/2026-10-05-db-storage-and-pairing-design.md`
- **Status:** approved design, 2026-10-09

## Goal

The board grid stops having a fixed size. It always has 24 columns that fill the window width;
cells are square, so the row pitch equals the column pitch. The grid height is `rows × pitch`; when
it does not fit the window, the board scrolls vertically. Widgets scale with the cell.

The number of columns is fixed. The number of rows is a per-screen setting from 4 to 100, changed in
edit mode. Lowering it never hides or moves widgets: a widget below the new limit stays where it is,
and the grid keeps enough rows to show it. In edit and build modes the dots inside the configured
rows are green and the dots below them are red. A widget in the red zone can only be brought out of
it: no move or resize may lower its bottom edge.

Success: at any width ≥ 1280 px the grid fills the width with square cells and a widget looks like a
scaled copy of itself; a 30-row screen scrolls; after changing 30 → 10 rows the widget in the bottom
corner stays visible over red dots, can be moved up into the green zone, cannot be moved back down,
and the red zone disappears once nothing is below row 10.

## Relation to the base design

| Base design §7.4 | This change | Why |
| --- | --- | --- |
| 12 columns × N rows | 24 columns × `rows`, `rows` stored per screen, 4..100, default 12 | Finer placement; height is the user's choice |
| The board fits the screen without vertical scroll | The board scrolls vertically when `rows × pitch` exceeds the window | Width-driven cells make the height depend on the window ratio |
| `html` font size fixed up to 1600 px, then grows | `html { font-size: calc(100vw / 80) }` (16 px at 1280) | Text, gaps and cells scale by the same factor, so proportions never drift |
| Minimum width 1280 px, «Окно слишком узкое» | Unchanged | — |

§7.4 is rewritten in the same commit as this spec.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Cell sizing | Pure CSS: the board is an `inline-size` container, `--ld-cell = (100cqw - 23 × gap) / 24` | Native; follows the board's own scrollbar; no measuring code |
| Rows scope | Column `rows` on `screens`, field `rows` on `ScreenBoard` | The grid is a property of one board; saved with the layout under `expectedRevision` |
| Existing layouts | Migration deletes all placed widgets and their state | Requested by the user; 12-column coordinates are not carried over |
| Red zone | A rect may not end below `max(rows, current bottom)` | One rule gives «only bring it out»; see «Grid rules». Widening a red widget is allowed: it does not lower the bottom edge (the user's chosen rule) |
| Board scrollbar | `scrollbar-gutter: stable` | No layout jump when the scrollbar appears; a classic scrollbar costs < 1% of proportionality, macOS overlay scrollbars cost nothing |
| Red zone on the server | Not enforced; the API checks the hard `24 × 100` bound only | The server does not know where a widget stood before the session |
| Rows field | `<input type="number">` in the edit-mode header, part of the working copy | One PUT; «Отмена» reverts it; the dots react immediately |
| Scale | `calc(100vw / 80)` without a cap | Sandbox frames already take `rootFontSize` from the host (`widget-gateway.ts`), so they follow |
| `sizeClass` | Thresholds unchanged (in cells) | A 4×4 widget is now physically small; `m` still fits it |

## Contracts (`packages/contracts`)

### `grid.ts`

`GRID` is removed. New exports:

```ts
export const GRID_COLS = 24
export const ROWS = { min: 4, max: 100, default: 12 } as const

/** Bottom edge of the lowest placement, 0 for an empty layout. */
export function occupiedRows(layout: readonly Rect[]): number
/** Rows the board renders: the configured rows, or more when a widget lies below them. */
export function gridRows(rows: number, layout: readonly Rect[]): number
```

- `inBounds(rect)` checks the hard bound: `w, h ≥ 1`, `x, y ≥ 0`, `x + w ≤ GRID_COLS`,
  `y + h ≤ ROWS.max`.
- `isFree(rect, others, limit)`: `inBounds(rect)`, `rect.y + rect.h ≤ limit`, no overlap.
- `findFreeRect(size, others, rows)` scans `y + h ≤ rows`, `x + w ≤ GRID_COLS`, rows top-down,
  columns left-right, and checks `isFree(candidate, others, rows)`.
- `moveTo(rect, x, y, others, rows)` and `resizeTo(rect, w, h, limits, others, rows)` compute
  `limit = max(rows, rect.y + rect.h)` from the rect before the step and return the new rect only
  when `isFree(next, others, limit)` (and, for resize, `limits` hold); otherwise the unchanged rect.

### `board.ts`

- `ScreenBoard` gets `rows: number`.
- `parseScreenBoard` fails with `rows must be an integer 4..100` unless `rows` is an integer in
  `ROWS.min..ROWS.max`. It returns `rows` in the value.
- Placements are checked with `inBounds` (hard `24 × 100`), not against `rows`. The error text names
  the `24x100` grid.

### `widget-package.ts` and `builtin-widgets.ts`

- `parseSizing` accepts `max.w ≤ GRID_COLS` and `max.h ≤ ROWS.max`. The `parseManifest` error
  `manifest.sizing must have … inside the 12x8 grid` names the `24x100` grid.
- The placeholder sizing becomes `default 4×4, min 1×1, max 24×100`.
- Installed packages keep their stored sizing (≤ 12×8); it stays valid.

## Data and API (`apps/api`)

### Migration 3 (`migrations.ts`)

```sql
ALTER TABLE screens ADD COLUMN rows INTEGER NOT NULL DEFAULT 12 CHECK (rows BETWEEN 4 AND 100);
DELETE FROM widget_state;
DELETE FROM widgets;
UPDATE rooms SET revision = revision + 1;
```

- **Irreversible:** every placed widget and its state is deleted. Packages, versions, grants and
  `widget_audit` stay.
- The revision bump makes a tab opened before the migration get `409` on save and reload, instead of
  writing a 12-column layout back.

### `rooms.ts`

- `readBoard` returns `rows` for each screen (`SELECT id, rows FROM screens … ORDER BY position`).
- `saveBoard` runs `UPDATE screens SET rows = ? WHERE id = ?` for each validated screen inside the
  existing transaction, after validation and before the revision bump.

## Grid rules

Zones on a screen with `rows` configured rows:

- green: rows `0 .. rows - 1`;
- red: rows `rows .. gridRows(rows, layout) - 1`.

Every move and resize, by pointer or keyboard, goes through `moveTo` / `resizeTo` with the screen's
`rows`. Because `limit = max(rows, current bottom)`:

- a widget in the green zone cannot move or grow past `rows`;
- a widget in the red zone accepts any move or resize that does not lower its bottom edge: up,
  sideways, shrinking, widening;
- once a widget moves up, its limit follows it, so it cannot go back down; once it is fully green,
  `limit = rows`;
- the builder draft starts inside `rows` (`findFreeRect`), so the same rule keeps it green.

Changing the rows field changes `working.rows` only; no widget moves. Lowering it can turn occupied
rows red; raising it turns them green.

«Готово» is always available; widgets may be saved in the red zone.

## UI (`apps/ui`)

### Scale (`app/app.vue`)

```css
html { font-size: calc(100vw / 80); }
```

The `dvh` term is removed. The narrow-window rule (< 1280 px) is unchanged.

### Board (`app/board/WidgetBoard.vue`)

```css
.board {
  container-type: inline-size;
  overflow-y: auto;
  scrollbar-gutter: stable;
  height: 100%;
  padding: 1rem;
}

.board__grid {
  --ld-cell: calc((100cqw - 23 * 0.5rem) / 24);
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  grid-template-rows: repeat(var(--grid-rows), var(--ld-cell));
  gap: 0.5rem;
}
```

- `place-items: center` is removed: the grid starts at the top and spans the width.
- The gap shrinks from `0.75rem` to `0.5rem`: cells are about half the old size (≈ 43 px at 1280).
- `--grid-rows` is an inline style with the rendered row count (below).
- The grid keeps no padding or border, so pointer math still starts at the first cell.

Shown screen: `working` in edit mode, `doc` otherwise. Rendered rows:
`gridRows(shown.rows, shown.layout)`, except that while any pointer operation, move or resize, is in
progress (`dragging === true`) the value is held at what it was when the operation started. It is
recomputed on `pointerup` / `pointercancel` and after each keyboard step. This avoids the content jumping under the pointer when the
grid shrinks while the board is scrolled to the bottom.

### Dots

- The existing per-cell `span` dots stay, in `build` and `edit` modes only, one per cell of the
  rendered grid (at most 2400).
- A dot with `y < rows` uses `var(--ld-success)`; otherwise `var(--ld-danger)`. Both tokens exist in
  the theme contract.

### Rows field (`app/app.vue` + `WidgetBoard.vue`)

- «Изменить» is enabled once the board is loaded (`boardRef.loaded`), not only when it has widgets:
  after migration 3 every board is empty, and its rows must be settable before the first widget.
  Edit mode on an empty board shows the dots and the rows field; nothing else changes.
- In `edit` mode the header shows `<label>Ряды <input type="number" required min="4" max="100" step="1"></label>`
  next to «Готово» and «Отмена». It is not shown in `build` mode.
- `WidgetBoard` exposes `rows` (the working value) and `setRows(n: number)`. `setRows` applies only
  an integer in `ROWS.min..ROWS.max`; any other input leaves `working.rows` unchanged, and the native
  constraint validation marks the field.
- The field is disabled while saving, like the header buttons.
- `isSameBoard` already compares whole screens, so a change of `rows` alone is a change to save.

### Pointer mechanics (`app/board/use-active-rect.ts`)

New options:

```ts
rows: () => number      // configured rows of the shown screen
gridRows: () => number  // rendered rows
```

- `readMetrics` derives `pitchY` from `gridRows()` instead of the constant.
- `moveTo` / `resizeTo` receive `rows()`.
- The free card is clamped to `x ≤ (GRID_COLS - w) × pitchX` and
  `y ≤ (max(rows(), current.y + current.h) - h) × pitchY`, so it never floats into the red zone.
- A new `dragging` ref is `true` from `pointerdown` (move or resize) until `pointerup` /
  `pointercancel`. `WidgetBoard` holds the rendered rows while it is `true`. `moving` keeps its
  current meaning (move only: landing slot, grab cursor).
- A `ResizeObserver` on the grid element re-reads the metrics when the grid size changes (window
  resize, scale change). When no pointer operation is in progress it also places the card on its slot
  without animation (`motion.reset`), so the active card always matches the current cell size. It
  disconnects when the composable's scope is disposed.

## Error handling

| Situation | Behaviour |
| --- | --- |
| PUT with `rows` missing, not an integer, or outside 4..100 | `400 VALIDATION_ERROR` `screens[i]: rows must be an integer 4..100` |
| Placement outside `24 × 100` | `400 VALIDATION_ERROR` naming the `24x100` grid |
| Placement below `rows` but within 100 | Accepted (red zone) |
| Rows field gets an empty, non-integer or out-of-range value | Not applied; `working.rows` unchanged; native validation marks the field |
| No free place for a new widget within `rows` | «Нет свободного места», as now |
| Tab opened before migration 3 saves | Revision mismatch → `409` → existing reload path in `room-sync` |

## Testing

Vitest, test first (RED → GREEN → REFACTOR).

- `packages/contracts/test/grid.test.ts`: `occupiedRows` / `gridRows` for an empty layout and a
  layout below `rows`; `moveTo` and `resizeTo` stop a green widget at `rows`; a red widget moves up
  and sideways, shrinks and widens, but cannot move down or grow down; after moving up the limit
  follows;
  `findFreeRect` stays within `rows`; the 24-column bound.
- `packages/contracts/test/board.test.ts`: `rows` required; 3, 101 and 4.5 rejected; a placement in
  the red zone accepted; `y + h > 100` rejected.
- `packages/contracts/test/widget-package.test.ts`: `max.w = 24`, `max.h = 100` accepted; 25 and 101
  rejected, and the error names the `24x100` grid. `builtin-widgets.test.ts`: the new placeholder
  sizing.
- `apps/api/test/db.test.ts`: migration 3 on a database with widgets and widget state yields
  `rows = 12`, no widgets, no widget state, a bumped revision, and keeps packages and grants.
- `apps/api/test/rooms.test.ts`: GET returns `rows`; PUT stores `rows`; `409` leaves `rows` unchanged;
  invalid `rows` → `400`.
- `apps/ui/test/use-active-rect.test.ts`: `pitchY` from `gridRows`; pointer move clamped to the
  limit; keyboard step down from the red zone blocked, up allowed; `dragging` is `true` during a
  pointer resize and a pointer move and `false` after `pointerup`; a stubbed `ResizeObserver`
  callback with a new grid width updates `cardStyle` width and the slot position.
- `apps/ui/test/edit-session.test.ts`: a change of `rows` alone makes `isSameBoard` false.
- **Manual check in Orca's built-in browser (recorded in the task report):** the grid fills the width
  with square cells at 1280 and 1920 px; a 30-row screen scrolls; after 30 → 10 the bottom widget sits
  over red dots, moves up into green, cannot move back down, and the red zone disappears; shrinking
  the bottom widget by pointer while scrolled to the end does not jump; resizing the window from
  1280 to 1920 with an active widget keeps the card on its slot at the new size; «Изменить» works on
  an empty board and `rows` saves without widgets; clearing the rows field marks it invalid and
  keeps the previous value; «Отмена» reverts the rows; a package widget in a sandbox frame scales
  with the board.

## Acceptance criteria

- The grid has 24 columns filling the board width; cells are square; the board scrolls vertically
  when the grid is taller than the window.
- Text, gaps and cells scale by `100vw / 80`; a widget looks the same, only larger, at any width
  ≥ 1280 px. This is exact with overlay scrollbars; with a classic scrollbar the fixed gutter width
  is an accepted deviation below 1%.
- Each screen stores `rows` (4..100, default 12); the edit-mode field changes it, also on an empty
  board; «Готово» saves it with the layout in one PUT; «Отмена» reverts it.
- The active card follows the cell size when the window is resized.
- Lowering `rows` never moves or hides a widget; the grid renders down to the lowest widget.
- In `build` and `edit` modes dots inside `rows` are green and dots below are red.
- No widget can move or grow into the red zone; no move or resize lowers the bottom edge of a widget
  in the red zone; a new widget is placed only inside `rows`.
- After migration 3 every screen has `rows = 12` and no widgets; packages and grants are intact.

## Out of scope

Auto-scroll while dragging near the board edge (wheel scrolling during a drag offsets the card;
keyboard moves work), configurable column count, larger `sizeClass` thresholds, server-side
enforcement of the red-zone rule, mobile layout.
