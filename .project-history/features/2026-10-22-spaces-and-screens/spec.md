# Spaces and screens: creation and switching — design

Date: 2026-10-21. Status: approved (2026-10-22).

Interactive mockup used in the conversation (throwaway, not committed): `.superpowers/brainstorm/37531-1792606568/content/space-switcher-v15.html`. It is the visual reference for geometry, motion and states; the implementation uses the app's theme tokens and rem scale, not the mockup's hard-coded values.

## Intent

The data model already has several top-level containers with several screens each, but the UI shows only the first room and its first screen (README, «Current state»). This feature makes the workspace multi-surface: the user creates **spaces** (the user's term, replacing «rooms» everywhere), gives each a name, icon and colour, adds screens to a space, and switches between spaces and screens.

A space is a top-level area of life or work («Дом», «Работа», «Здоровье»). A screen is one board of widgets inside a space. Screens have no names.

## Decisions made by the user (this conversation)

1. **Term.** «Пространство» / `space` replaces «комната» / `room` in the UI **and in all code, API, database, CSS classes and docs** in this feature. No mixed naming remains.
2. **Space switcher.** A round button in the top-right corner shows the current space. Hovering it opens a fan of space bubbles around the corner, laid out on quarter-circle arcs: the first arc holds 3–4 bubbles, further spaces go to arcs farther from the corner. The rest of the screen dims and blurs. Clicking a bubble switches space and closes the fan. The current space has an accent ring. The bubble's name label appears on hover and is drawn above neighbouring bubbles. Bubbles are 80 px in the mockup (the user asked for bigger than 64 px).
3. **Screen indicator.** When a space has two or more screens, dots are shown at the top centre of the header, slider-style: the active dot is elongated and accent-coloured. Arrows ‹ › sit on either side; the arrow at an end is disabled (no wrap-around). Clicking a dot or arrow switches screen; the incoming board slides in from the side. No hover labels on dots.
4. **Header title.** The «LifeDashboard» heading is removed. The header starts with the space name. With two or more screens the active screen number follows: «Дом (2)». With one screen: «Дом».
5. **Edit mode («Изменить») gates all management.** Outside edit mode the user can only switch. In edit mode:
   - the fan shows a «+» bubble (last) that creates a space;
   - hovering a space bubble shows a ✎ badge that opens an icon-and-colour picker;
   - hovering the space name in the header shows a ✎ pencil; clicking it turns the name into an inline input;
   - a «+» next to the dots adds a screen;
   - dots are always visible, even for a single screen (one active dot);
   - hovering the **active** screen's dot (only the active one) shows a ✕ that deletes that screen.
6. **Delete space.** A space always has at least one screen. ✕ on the only screen deletes the whole space, after a confirmation. There is no other delete-space control.
7. **Icon and colour.** Every space has an icon and a colour, chosen in the picker from point 5. The icon is shown on the corner button and the bubble; the colour tints the bubble, the corner button and the board backdrop.
8. **Saving.** Space and screen operations (create, delete, rename, icon, colour, add or delete screen) are saved immediately. «Готово» / «Отмена» keep their current meaning and apply only to widget layout edits. Switching screen or space while in edit mode first saves the pending widget edits, so nothing is lost.
9. **Not now:** ordering of spaces and screens, screen names, ←/→ keyboard switching of screens.

## Goals

- Create, rename, recolour/re-icon and delete spaces; add and delete screens; switch between both, as in «Decisions».
- One consistent name, `space`, across UI, contracts, API, database and theme CSS.
- Existing data (the seeded space, its screen, widgets, widget state and secrets) survives the upgrade unchanged.

## Non-goals

- Reordering spaces or screens (positions exist in the data; no UI to change them).
- Screen names; per-space themes (the theme chain comment in `app.vue` stays a future step, renamed to «space»).
- Keyboard shortcuts for switching (←/→, digits), touch/swipe gestures, narrow or mobile layouts (minimum stays 1280 px).
- Import/export, presets, templates of spaces.

## Anti-goals (failure even if it works)

- Widget edits lost when switching screen or space in edit mode.
- A space or a screen with widgets deleted without a confirmation.
- The fan staying open or blocking the board when the pointer is not over it.
- Half-renamed code: `room` left in identifiers, routes, tables, CSS classes or current docs (archives excepted, see «Rename»).
- A switcher that only works with a mouse.

## Behaviour details

### Fan

- Opens on hover over the corner button (and on click / Enter / Space for keyboard and pointer users who click). Closes when the pointer leaves the corner button, the fan and the picker for about 300 ms, on Esc, or after a switch.
- While the icon-and-colour picker is open, the fan stays open.
- Layout: concentric quarter-arcs around the button; each arc holds as many bubbles as its length fits at the bubble size plus gap, filled from the inside out; a partial outer arc keeps the same spacing, centred on the diagonal. The «+» bubble (edit mode only) is the last item.
- The picker opens beside the fan (to its left) so it never covers bubbles.
- Bubbles are buttons with the space name as accessible name; the current one has `aria-current`. Focus moves into the fan when it opens from the keyboard.
- Bubble numbering badges (1–9) from the mockup are dropped together with digit shortcuts (my call; see «Calls made by the designer»).

### Screens

- Each space remembers which screen was open last (see «Persistence»).
- Deleting the active screen moves to the previous screen, or to the next one when the first was deleted.
- Deleting a space moves to the previous space in order, or the next one when the first was deleted.
- The last remaining space cannot be deleted: its only-screen ✕ is disabled with a tooltip.
- Only the active screen's widgets are mounted. Widgets of other screens are not running.

### Edit mode interplay

- Build mode (a new widget draft being placed) blocks switching: the fan and the screen controls are disabled until the draft is confirmed or cancelled.
- In edit mode, switching screen or space saves the pending widget edits of the current screen and stays in edit mode on the target. Today a successful save leaves edit mode (`afterSave`), so this needs a «save and stay» path.
- If that pre-switch save fails (conflict, validation, offline), the switch does not happen, the user stays on the current screen in edit mode **with the working copy intact**, and the error is shown in the existing notice line. The existing conflict reaction (leave edit mode and reload) is **not** applied automatically here; the working copy is discarded only by an explicit user action («Отмена»).
- «+ screen» and «+ space» are switches too: they first save the pending widget edits the same way (same failure rule), then create and switch. Adding a screen switches to the new, empty screen. Creating a space switches to it, with one empty screen, and opens the inline rename on its name.
- «✕» on the active screen does **not** save the pending edits first. The working copy is kept until the delete succeeds; then it is dropped together with the screen and editing continues on the screen chosen by the «after delete» rule. If the delete fails, the user stays on the screen with the working copy intact.
- Delete confirmation for a screen is required when **either** the saved screen **or** the working copy has at least one widget (covers both unsaved additions and unsaved removal of all widgets).
- After any intermediate save, «Отмена» reverts to the last saved state, not to the state when edit mode was entered.
- Changing a space's title, icon or colour does not touch the board and does not bump its revision, so it never conflicts with a widget working copy. Adding or deleting a screen bumps the revision; the client then continues editing on the fresh board returned by the operation.

### Failure of management operations

One rule for create, update (title, icon, colour), delete and add/delete screen: the UI applies the result only after the server confirms it. On failure the UI keeps the current space, screen and working copy, reverts any optimistic display of title/icon/colour, and shows the error in the existing notice line (or the existing unauthorized/unavailable handling for those outcomes). A successful pre-switch save that preceded a failed operation stays the new base for «Отмена».

### Confirmations

- Delete a space: always confirmed (existing `ConfirmDialog`), naming the space.
- Delete a screen that has widgets: confirmed. An empty screen is deleted without a question.

## Data and API

### Database

A new migration (released migrations stay byte-identical, per `apps/api/src/migrations.ts`):

- `rooms` → `spaces`; `screens.room_id` → `screens.space_id` (SQLite `ALTER TABLE … RENAME`; verified on the project's Node 24.21.0 / SQLite 3.53.4 on 2026-10-21: the foreign key and the `UNIQUE (space_id, position)` constraint follow the rename).
- `spaces.icon` and `spaces.color`, `NOT NULL`, with defaults for the existing seeded space.

Screen positions stay contiguous from 0 after a delete; the rewrite must not trip the `UNIQUE (space_id, position)` constraint mid-statement.

Deleting a screen or space removes its widgets (cascade) and also their `widget_state` and `widget_secrets` rows, which have no foreign key — the same cleanup the board save already does.

### Contracts (`packages/contracts`)

- `RoomBoard` → `SpaceBoard` (`roomId` → `spaceId`), `RoomSummary` → `SpaceSummary` with `icon` and `color`.
- The fixed icon set and colour palette live in contracts, shared by API validation and the UI picker.
- Title: trimmed, non-empty, length-limited; icon and colour must be members of the fixed sets.

### API

- All `/api/v1/rooms…` routes move to `/api/v1/spaces…`. No `rooms` alias (UI and API ship together; the only other caller is the `hostile` example probe, which is updated).
- New operations: create space (with one screen), update title / icon / colour, delete space (refused for the last one), add screen, delete screen (refused for the last screen of a space — the UI deletes the space instead).
- Operations that change a space's screens bump that space's revision, like a board save, so open tabs with a stale board get the existing conflict handling.
- **Deletes are revision-checked.** Delete screen and delete space take the `expectedRevision` the client's decision was based on and check it inside the transaction before deleting anything, like the board save. On mismatch nothing is deleted and the API returns the existing revision-conflict error; the UI reloads the space and asks again only if the user repeats the action, re-evaluating whether a confirmation is needed on the fresh data. Add screen also takes `expectedRevision`.
- Exact route shapes and status codes are the builder's, following the conventions of the existing routes and `errors.ts`.

### Limits (my call)

At most 20 spaces and 20 screens per space, enforced by the API. Twenty spaces still fit the fan on a 1280 px screen.

## Rename

In scope: identifiers, file names (`rooms.ts`, `room-sync.ts`, their tests), contract types, API paths, `SEED_ROOM_ID`, CSS classes `.room`, `.room__backdrop`, `.room--theme-*`, `.room--skin-*` → `.space…`, the theme validator, `docs/theme-contract.md`, `README.md`, code comments, the `hostile` example probe, and the widget-sdk `dev-parity` test.

The theme contract selector changes from `.room--theme-<slug>` to `.space--theme-<slug>`. No user themes are stored anywhere yet (no themes table; built-in themes live in the repo), so no data migration is needed. The contract version stays 1 (my call).

Out of scope: `.project-history/` archives, existing documents in `docs/superpowers/` (historical records), and the SQL text and comments of **released migrations**, which must stay byte-identical and therefore keep `rooms` / `room_id`. The rename requirement applies to the resulting schema (after the new migration) and to all live code; the only `room` names left in the repository's live code are inside released migration SQL strings. The constant `SEED_ROOM_ID` is renamed in TypeScript; its value and the SQL it produces stay unchanged. Ordinary English uses of «room» (for example «room for two columns») are not the entity and stay.

## Persistence

- Spaces, screens, titles, icons, colours: server (above).
- The last open space and, per space, the last open screen: browser `localStorage`, per device (my call). Missing or stale ids fall back to the first space and its first screen.

## Visual

- Header: only the «LifeDashboard» heading goes. Every other existing header control stays and keeps its behaviour: «Готово», «Отмена», «Ряды», «Добавить виджет…», «Изменить», «Виджеты», «Тема», the notice line (save conflicts and errors) and the API status. Layout: space name (with ✎ in edit mode) on the left; dots, arrows and «+» absolutely centred; the existing controls right-aligned, ending before the corner button's reserved slot. The mockup omitted these controls only to stay simple.
- Follows the mockup, built from the theme tokens (`--ld-*`) so it works in all three built-in themes, including the light «Бумага».
- The colour tint on the board backdrop is a subtle layer over the theme backdrop, not a replacement of `--ld-backdrop`.
- Sizes in rem, following the app's single-scale rule (`html { font-size: calc(100vw / 80) }`).
- Motion uses the theme duration tokens; respects `prefers-reduced-motion`.

## Testing

- API (Vitest, existing patterns): every new operation, the last-space and last-screen guards, limits, validation of title/icon/colour, revision bump, revision check on add/delete with nothing deleted on mismatch (stale-tab scenario: tab B adds widgets, tab A's delete with the old revision fails), cleanup of widget state and secrets, contiguous positions after delete; the migration on a database holding the old schema with data.
- UI edit-mode flows (unit tests on the sync/session logic, existing test style): switch and «+ screen»/«+ space» with pending edits save and stay in edit mode on a fresh working copy; a failed pre-switch save blocks the switch and keeps the working copy (no leave/reload); «Отмена» after an intermediate save reverts to that save; ✕ with pending edits does not save first, keeps the working copy on failure, and asks for confirmation when the saved screen or the working copy has widgets; failed management operations keep the current state and revert optimistic metadata.
- UI: pure logic in testable modules (fan arc layout, header title formatting, which space/screen becomes active after a delete, persistence fallback) with unit tests; existing `room-sync` tests renamed and extended.
- Manual check in Orca's built-in browser against the mockup, in all three themes.

## Calls made by the designer (not discussed with the user)

1. Digit shortcuts and the 1–9 badges on bubbles are dropped, consistent with the user deferring keyboard switching.
2. Icons are system emoji from a fixed set of 24; the palette has 8 colours. No icon library.
3. A new space is named «Новое пространство», gets the first palette colour not yet used (cycling when all are used) and a default icon.
4. The picker can edit any space, not only the current one.
5. Limits: 20 spaces, 20 screens per space.
6. Last open space and screen are remembered in `localStorage`, per device.
7. Build mode blocks switching; edit mode survives a switch.
8. No `rooms` API alias; theme contract stays version 1.
9. Historical docs and archives keep «room».
10. All existing header controls, the notice line and the API status stay; only the «LifeDashboard» heading is removed.
11. «+ screen» and «+ space» save pending widget edits first, like a switch; a failed pre-switch save blocks the switch and keeps the working copy; «✕» on the active screen does not save first and drops its pending edits only after the delete succeeds; «Отмена» reverts to the last saved state.
12. Title, icon and colour changes do not bump the board revision.
13. At the 20-space or 20-screen limit the matching «+» is disabled with a tooltip; a new screen gets `ROWS.default` rows.

## Left to the builder

- Route shapes, status codes and error texts within the existing conventions.
- Component split in `apps/ui`, and how the fan, dots and picker share state with `app.vue` and `WidgetBoard.vue`.
- Exact geometry and timing, as long as the result matches the mockup's look and the decisions above.
- Default icon of a new space and of the seeded space.
