# Widget builder v1: placement at real size

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§5.1, §7.1, §7.3, §7.4, §7.5, §16 E2/E3b)
- **Status:** approved design, 2026-10-04

## Goal

The first, simple step of the widget builder. A «+» button in the header turns on a builder mode
over the board: a 12×8 dot grid appears, and a draft widget can be moved and resized cell by cell.
The user sees exactly how much space the widget takes on the final board. «Готово» leaves a
placeholder widget on the board; it persists until the user deletes it (like macOS desktop widgets).

The same step lays the foundations that later stages build on without rewrites: a portable,
versioned board document (future export/import), a widget manifest and catalog, an explicit renderer
registry, and one shared widget frame with theme tokens.

## Relation to the base design and stages

This is deliberate work ahead of stage order, scheduled by the product owner on 2026-10-04. It does
not unlock E1/E2 and contains nothing E0 can invalidate: no Hermes, no SQLite, no API routes.

Deviations, all temporary:

| Base design | v1 | Why / migration |
| --- | --- | --- |
| §7.4: creation starts by selecting a rectangle on the board | «+» places a default-size draft that the user moves and resizes | No board interactions exist yet; the draft gives the same result (start position and size). Rectangle selection may replace it on E2 |
| §2.3: layout lives in SQLite | One JSON document in `localStorage` | No storage layer yet. The document shape mirrors `WidgetInstance` + `RoomLayout` (§5.1), so moving to the API is mechanical |
| §5.1: `WidgetInstance` has `roomId`, `revision`, `definitionId`… | No `roomId`, `revision`; `source` is a discriminated union | No Rooms or server yet. Added by a `schemaVersion: 2` migration inside `parseBoardDocument` |
| E2: ADR for the drag/resize library | Native Pointer Events, no library (preliminary decision) | Libraries tend to push neighbours, which contradicts §7.4 «block, don't shift». The ADR is written on E2 |

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Drag/resize | Native Pointer Events + CSS Grid | No runtime dependency; snapping, bounds and collisions are a pure, testable function |
| Grid logic | Pure TS module without Vue/DOM | Unit-testable with vitest; reused by validation and later by E2 move/resize |
| Instance vs placement | Separate `instances` and `layout` arrays | Same split as `WidgetInstance` / `RoomLayout` (§5.1); the export format needs no rework later |
| Widget source | `{ kind: 'builtin'; type: string }`; later `| { kind: 'custom'; definitionId; definitionVersionId }` | Discriminated union; no redundant `builtin:` prefix in `type` |
| Manifest | `WidgetManifest { type, title, sizing }`, no Vue | Single source for default size and min/max; moves to `packages/contracts` when the API needs it |
| Renderer registry | Explicit map `type → () => import(...)` | Continues the explicit-import policy (`autoImport: false`, `components: false`); no `import.meta.glob` |
| Frame | Every widget renders inside `WidgetFrame`; widgets never draw their own chrome | One consistent look; themes change one place |
| Themes | CSS custom properties on `[data-widget-theme="<name>"]`; v1 ships `default` only | Adding a theme is a new token set, no frame changes. Future AI styling changes slot content only |
| Unknown widget type | Accepted by the parser, rendered as «Неизвестный виджет» | §7.3 and E2 acceptance: an unknown widget does not break the board; documents from newer app versions still load |
| Tests | `vitest@5.0.3` added as a devDependency of `apps/ui` (approved 2026-10-04) | Same version as `apps/api`; needed for TDD of the pure modules |

## Data

```ts
type WidgetSource = { kind: 'builtin'; type: string }

interface WidgetInstance {
  id: string                       // crypto.randomUUID()
  source: WidgetSource
  config: Record<string, unknown>  // {} for the placeholder
}

interface WidgetPlacement {
  instanceId: string
  x: number                        // 0-based column
  y: number                        // 0-based row
  w: number
  h: number
}

interface BoardDocument {
  schemaVersion: 1
  instances: WidgetInstance[]
  layout: WidgetPlacement[]
}
```

`localStorage` key: `lifedashboard.board`. A missing key means an empty board.

- `loadBoard(): { doc: BoardDocument; error?: { kind: 'storage' | 'invalid-document'; message: string } }`
  never throws. An exception from `localStorage` access or `getItem` yields an empty document and
  `kind: 'storage'`; a `JSON.parse` failure or a parser error yields an empty document and
  `kind: 'invalid-document'`. The consumer shows «Хранилище недоступно» in the header for
  `storage` and calls `console.warn` for `invalid-document`.
- `saveBoard(doc: BoardDocument): boolean` never throws; it returns `false` when `localStorage`
  access or `setItem` throws.

### `parseBoardDocument(raw: unknown)`

The single validation point for every external input: `localStorage` now, file import later.
Returns `{ ok: true; doc: BoardDocument } | { ok: false; error: string }`. Rules:

- `raw` is an object with `schemaVersion === 1` (another version → error naming the version);
- `instances` and `layout` are arrays;
- each instance has a non-empty string `id`, `source.kind === 'builtin'`, a non-empty string
  `source.type`, and an object `config`;
- instance ids are unique;
- every placement references an existing instance, and every instance has exactly one placement;
- `x, y, w, h` are integers, `w, h ≥ 1`, and the rectangle lies inside 12×8;
- placements do not overlap;
- an unknown `source.type` is accepted (rendered by the fallback).

A future format version is handled by a migration branch on `schemaVersion` inside this function.

### Future export/import (not in v1)

- Export: `JSON.stringify(doc)` downloaded as a file.
- Import: `parseBoardDocument(JSON.parse(text))`, user confirmation, then `saveBoard`. An invalid
  file is rejected with the parser error.
- The future API must install a widget atomically: one transaction validates size and free cells,
  creates the `WidgetInstance` and updates `RoomLayout`, so a layout conflict never leaves an
  orphan instance.

## Structure

All paths are in `apps/ui/`.

| File | Responsibility |
| --- | --- |
| `app/widgets/grid.ts` | `GRID = { cols: 12, rows: 8 }`, `Rect { x, y, w, h }`, `Size { w, h }`; `isFree(rect, others)`: inside the grid and no overlap; `findFreeRect(size, others)`: first free position scanning rows top-down, columns left-right, else `null`; `moveTo(rect, x, y, others)` and `resizeTo(rect, w, h, sizing, others)`: return the new `Rect` or the unchanged one when the move is not allowed |
| `app/widgets/catalog.ts` | `WidgetManifest`, `WidgetSizing { default, min, max }`, placeholder manifest (`type: 'placeholder'`, `title: 'Заглушка'`, `sizing: { default: 4×4, min: 1×1, max: 12×8 }`), `builtinWidgetCatalog`, `findManifest(type)` |
| `app/widgets/board-document.ts` | Document types, `parseBoardDocument`, `loadBoard()`, `saveBoard(doc)` (never throw, see Data) |
| `app/widgets/registry.ts` | `builtinWidgetRenderers: Record<string, () => Promise<Component>>` |
| `app/widgets/WidgetHost.vue` | Wraps content in `WidgetFrame`; resolves the renderer from the registry; fallback «Неизвестный виджет» |
| `app/widgets/WidgetFrame.vue` | Background, blur, radius, border, text colour, inner padding, `<slot>`; reads only theme tokens |
| `app/widgets/widget-theme.css` | `default` theme tokens: `--widget-bg`, `--widget-blur`, `--widget-radius`, `--widget-border`, `--widget-text`, `--widget-padding` |
| `app/widgets/builtin/PlaceholderWidget.vue` | Placeholder content: size label (`4×4`) |
| `app/board/WidgetBoard.vue` | Board grid, placed widgets via `WidgetHost`, builder mode with the draft, pointer and keyboard handling, delete |
| `app/app.vue` | Header with «+», the existing API status, save error message; `WidgetBoard` with `v-model:building` |
| `test/grid.test.ts`, `test/board-document.test.ts` | Vitest unit tests |

`package.json` gets `"test": "vitest run"`; the root `pnpm test` already runs it via
`pnpm -r --if-present run test`.

Dependency direction: `grid.ts` ← `catalog.ts`, `board-document.ts` ← `WidgetBoard.vue`.
`WidgetFrame.vue` depends on nothing but theme tokens. `WidgetBoard` renders widgets only through
`WidgetHost`; adding a builtin widget means a manifest in `catalog.ts`, a renderer file and one
registry line, with no board changes.

## Layout

One scale for everything, as in §7.4: every size (cells, gaps, paddings, header, typography, frame
tokens) is a `rem` token, and only the root font size changes with the viewport.

- Tokens (preliminary; §7.4 fixes the exact values after the E2 prototype): cell `4rem`, gap
  `0.75rem`, header `3.5rem`, board padding `1rem`. Board height:
  `3.5 + 2·1 + 8·4 + 7·0.75 = 42.75rem` (684 px at 16 px); board width `12·4 + 11·0.75 + 2·1 =
  58.25rem` (932 px). Both fit the 1280×700 base viewport.
- Root scale: `html { font-size: max(16px, min(1vw, calc(100dvh / 43.75))) }` (`1vw` = 16 px at
  1600 px width, `100dvh / 43.75` = 16 px at 700 px height). Up to
  1600 px width the font size stays 16 px; above it grows proportionally, capped by the viewport
  height so the board never exceeds the screen. Example: 1920×1080 → 19.2 px.
- The board is `display: grid` with `grid-template: repeat(8, 4rem) / repeat(12, 4rem)` and
  `gap: 0.75rem`, centred below a fixed-height header. The board padding belongs to a wrapper
  element, not to the grid, so the grid's bounding rect starts at the first cell. A 4×4 widget is always square, and text,
  paddings and cells keep their ratios at every resolution.
- Viewport width below 1280 px: the board is replaced by the message «Окно слишком узкое» (§7.4).
  Viewport height below 700 px is outside the base viewport; the page may scroll vertically.
- A widget occupies `grid-column: x+1 / span w; grid-row: y+1 / span h`.

## Builder mode

- «+» computes `findFreeRect(sizing.default, layout)`, then `findFreeRect(sizing.min, layout)` when
  the default size does not fit. If both are `null`, the header shows «Нет свободного места» and
  the mode does not start. While the mode is on, «+» is disabled.
- The overlay shows a dot in the centre of each of the 96 cells; placed widgets stay visible, dimmed.
- The draft renders through `WidgetHost`, so it looks exactly like the final widget.
- **Move:** drag the draft body. `pointerdown` calls `setPointerCapture` and stores the pointer and
  the card's visible pose in px. The card follows the pointer freely in px (clamped to the grid),
  eased and deformed by `board/draft-motion.ts` (GSAP, ported from HermesPersonalOS weather motion;
  `prefers-reduced-motion` disables it). The cell pitch `cell + gap` comes from the grid element's
  `getBoundingClientRect()` (no padding or border on the grid) and computed gaps. Each
  `pointermove` snaps the card's px position to the nearest cell, `round(px / pitch)`, and applies
  `moveTo`; the result is the landing slot, shown dashed while dragging. An invalid candidate keeps
  the last valid slot. The floating card may pass over placed widgets; only the slot is committed.
  On release the card springs into the slot. Arrow-key moves animate the same way.
- **Resize:** a handle in the bottom-right corner; `resizeTo` enforces `sizing.min/max`, grid bounds
  and occupied cells. Other corners and edges are out of scope.
- **Keyboard:** the draft receives focus on start. Arrows move by one cell, Shift+arrows resize,
  Enter = «Готово», Esc = «Отмена». The draft has an `aria-label` with size and position; changes
  are announced through an `aria-live` region.
- «Готово» adds `{ instance, placement }` to the document and calls `saveBoard`. «Отмена» discards
  the draft. Both leave builder mode.

## Placed widgets

Each placed widget shows a «×» button on hover and focus. It deletes the widget immediately, without
confirmation (placeholders hold no data), and calls `saveBoard`. Moving and resizing placed widgets
is out of scope.

## Error handling

| Condition | Behavior |
| --- | --- |
| `localStorage` value fails `JSON.parse` or `parseBoardDocument` | Empty board, `console.warn` with the error. The stored value is not erased on load; the first board change overwrites it (accepted trade-off) |
| `localStorage` access or `getItem` throws on load | Empty in-memory board; header shows «Хранилище недоступно»; the board stays usable for the session |
| `saveBoard` returns `false` (quota, storage disabled) | Header shows «Не удалось сохранить доску»; in-memory state stays |
| Unknown `source.type` | «Неизвестный виджет» inside the frame; the board keeps working |
| No free cell even for `sizing.min` | «Нет свободного места»; builder mode does not start |

## Testing

TDD (RED → GREEN → REFACTOR) for the pure modules.

- **`test/grid.test.ts`:** `isFree` for inside / out of bounds / overlap / touching edges;
  `findFreeRect` on an empty grid, a partly filled grid and a full grid (`null`); `moveTo` accepts a
  free target and returns the unchanged rect for out-of-bounds and occupied targets; `resizeTo`
  respects `min`, `max`, bounds and occupied cells.
- **`test/board-document.test.ts`:** a valid document passes; errors for a non-object, a wrong
  `schemaVersion`, duplicate ids, a placement without an instance, an instance without a placement,
  two non-overlapping placements of one instance,
  out-of-bounds and non-integer coordinates, `w`/`h` below 1, overlapping placements; an unknown
  `source.type` passes. `loadBoard` returns an empty document with `error.kind: 'storage'` when
  `localStorage` access or `getItem` throws, and with `error.kind: 'invalid-document'` for invalid
  JSON and for valid JSON that `parseBoardDocument` rejects; `saveBoard` returns `false` when `setItem`
  throws (stubbed `localStorage`).
- `pnpm --filter @lifedashboard/ui typecheck` and `pnpm test` pass.
- **Manual browser check (recorded in the task report):** «+» shows the dot grid and a 4×4 draft;
  drag snaps to cells; resize respects min/max; the draft never enters occupied cells or leaves the
  board; keyboard move/resize/Enter/Esc work; «Готово» places a placeholder that survives reload;
  «×» deletes it and the deletion survives reload; a full board shows «Нет свободного места»;
  a board without room for 4×4 still starts with a 1×1 draft; a corrupted `localStorage` value gives an empty board and a console warning; the board has no
  scroll at 1280×700 and 1920×1080, and a 4×4 widget's text and padding keep the same ratio to
  the widget at both sizes; a window narrower than 1280 px shows «Окно слишком узкое».

Limitation: test files are run by vitest but not covered by `nuxt typecheck`.

## Acceptance criteria

- «+» opens builder mode with a 12×8 dot grid and a draft of the placeholder's `sizing.default`
  size when it fits, otherwise `sizing.min`; when even `sizing.min` does not fit, the mode does not
  open and «Нет свободного места» is shown.
- The board fits 1280×700 and larger viewports without scrolling and scales through the root font
  size only; below 1280 px width «Окно слишком узкое» is shown.
- The draft moves and resizes cell by cell with the mouse and the keyboard, never overlapping placed
  widgets, leaving the grid, or breaking `sizing.min/max`.
- «Готово» leaves a placeholder on the board; it survives reload until deleted with «×».
- All widgets, including the draft, render through `WidgetHost` and `WidgetFrame` using the
  `default` theme tokens.
- Stored data passes through `parseBoardDocument`; corrupted data or unavailable storage does not
  break the page.
- `pnpm typecheck` and `pnpm test` pass.

## Out of scope

Export/import buttons, theme selection and additional themes, moving/resizing placed widgets,
rectangle selection, widget gallery, prompt/description step, Hermes generation, declarative and
component widgets, `useWidgetRuntime` and data sources, API routes and SQLite, Rooms,
`packages/contracts`, component and e2e tests, mobile layout.

## Proposals for the base design (not decided here)

- §7.6: select declarative view variants by `min { w, h }` (the richest variant that fits) instead
  of `sizeClass` only; keep `sizeClass` for CSS.
- §7.7/§7.8: route all widget data through a shared widget runtime (`useWidgetRuntime`), which later
  becomes the public Widget SDK; widgets never call `fetch` directly.
- §11.2: replace separate `POST /rooms/:id/widgets` + `PUT /rooms/:id/layout` with one atomic
  install use case.
