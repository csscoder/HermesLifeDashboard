# Spaces and Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename rooms to spaces everywhere and let the user create, rename, recolour, delete and switch spaces, and add, delete and switch screens, as the spec describes.

**Architecture:** One SQLite migration renames the tables and adds `icon`/`color`. `apps/api/src/spaces.ts` replaces `rooms.ts` and gains revision-checked create/update/delete operations for spaces and screens. The UI keeps decisions in plain TypeScript modules (tested with Vitest, as the repo does) and keeps Vue components thin: `WidgetBoard.vue` owns the active screen and the working copy; `app.vue` owns the space list and wires the new `spaces/` components.

**Tech Stack:** TypeScript strict, Fastify, `node:sqlite`, Vue 3 / Nuxt 4 SPA, Vitest 5, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-10-21-spaces-and-screens-design.md`. Visual reference: `.superpowers/brainstorm/37531-1792606568/content/space-switcher-v15.html` (untracked mockup).

## Global Constraints

- User-facing term is «пространство»; code term is `space`. No `room`/`rooms`/`room_id`/`roomId`/`.room` left in live code, routes, schema after migration, CSS, current docs or README. Exceptions: SQL text and comments of released migrations (`MIGRATIONS[0..7]`), tests that exercise those released migrations on old schema versions, `.project-history/`, existing files in `docs/superpowers/`, and English prose where «room» means space-to-fit (e.g. `layout.ts` «room for two columns», `widget-settings.ts` `room` clamp parameter).
- Released migrations stay byte-identical. New schema changes go in a new migration appended as `MIGRATIONS[8]` (user_version 9).
- No new dependencies.
- Limits: `SPACE_LIMITS = { spaces: 20, screens: 20, title: 40 }`.
- New space title: `'Новое пространство'`. New space icon: `'⭐'`. Seeded space default icon `'🏠'`, colour `'violet'`. New screen rows: `ROWS.default` (12).
- Icons (exactly these 24, this order): `🏠 💼 🫀 📚 💰 🎸 ✈️ 👨‍👩‍👧 🧩 📖 🏃 🎧 🌿 🍳 🎮 🧘 🎨 📷 🚗 🐾 ☕ 🌙 ⭐ 🔥`.
- Colours (key → oklch hue, this order): `violet 280, blue 240, teal 200, green 150, amber 80, orange 50, red 25, pink 330`.
- Header: «LifeDashboard» heading removed; every other existing header control, the notice line and the API status stay.
- Title format: one screen → `«Дом»`; two or more → `«Дом (2)»` (space, then 1-based index in parentheses).
- No keyboard switching (no ←/→, no digits, no 1–9 badges). Fan: hover, click, Enter/Space open; Esc closes; ~300 ms close delay; stays open while the picker is open.
- Sizes in rem (`html { font-size: calc(100vw / 80) }`); motion uses `--ld-duration-*` tokens and is disabled under `prefers-reduced-motion: reduce`.
- Commit messages: project format (`feat(api): …`, `feat(ui): …`, `refactor: …`, `docs: …`), short subject, no attribution trailers.
- Browser checks use Orca's built-in browser (`orca` CLI), never an external browser.

## Review Focus

1. **Stale second tab deletes or adds.** Tab A decided on revision N, tab B saved since. Expect 409, nothing deleted, A's UI shows the conflict notice and reloads only when the user retries. Tests: Task 3 «stale delete», Task 2 «stale space delete», Task 4 `runDeleteScreen` conflict.
2. **Switch with unsaved widget edits when the save fails.** Expect: no switch, still in edit mode, working copy unchanged, notice shown, no reload. Test: Task 4 `runSwitch` failure cases.
3. **Delete the screen whose widgets were all removed in the working copy.** Saved screen still has widgets → confirmation required. Test: Task 5 `needsDeleteConfirm`.
4. **Stored last-open ids that no longer exist** (space deleted in another tab, cleared storage, malformed JSON). Expect fallback to first space / first screen, never a crash. Test: Task 5 `resolveLastOpen`.
5. **Screen positions after deleting a middle screen** must stay 0..n-1 without tripping `UNIQUE (space_id, position)`. Test: Task 3 «middle delete renumbers».

---

### Task 1: Rename room → space end to end, migration 9

Mechanical rename plus the migration; no new behaviour. All existing tests must pass afterwards.

**Files:**
- Modify: `apps/api/src/migrations.ts` (rename `SEED_ROOM_ID` → `SEED_SPACE_ID`, value unchanged; append migration 9)
- Rename: `apps/api/src/rooms.ts` → `apps/api/src/spaces.ts`; `apps/api/test/rooms.test.ts` → `apps/api/test/spaces.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/test/db.test.ts`, `apps/api/test/widget-gateway.test.ts`, `apps/api/test/widget-secrets.test.ts`, `apps/api/test/widget-packages.test.ts`, `apps/api/test/ui-static.test.ts`
- Modify: `packages/contracts/src/board.ts` (`RoomBoard` → `SpaceBoard` with `spaceId`, `RoomSummary` → `SpaceSummary`), `packages/contracts/test/board.test.ts` if it references them
- Rename: `apps/ui/app/board/room-sync.ts` → `space-sync.ts`; `apps/ui/test/room-sync.test.ts` → `space-sync.test.ts`; `useRoomSync` → `useSpaceSync` (`room` ref → `space`)
- Modify: `apps/ui/app/api.ts`, `apps/ui/app/app.vue`, `apps/ui/app/board/WidgetBoard.vue`, `apps/ui/test/api.test.ts`
- Modify CSS: `apps/ui/app/theme/styles/frame.css`, `comfort.css`, `themes/glass.css`, `themes/obsidian.css`, `themes/paper.css` (`.room` → `.space`, `.room__backdrop` → `.space__backdrop`, `.room--theme-*` → `.space--theme-*`, `.room--skin-*` → `.space--skin-*`)
- Modify: `apps/ui/app/theme/validate-theme.ts:203`, `contract.ts`, `resolve.ts` comments, `apps/ui/test/theme-contract.test.ts`, `apps/ui/test/theme-resolve.test.ts`
- Modify: `docs/theme-contract.md`, `README.md` (lines 39, 201, 290: «Spaces and screens»), `examples/widgets/hostile/src/index.vue:34` (`/api/v1/spaces`), `packages/widget-sdk/test/dev-parity.test.ts`

**Interfaces:**
- Produces: `SEED_SPACE_ID`; table `spaces(id, title, position, revision, created_at, updated_at, icon, color)`; `screens.space_id`; routes `GET /api/v1/spaces`, `GET|PUT /api/v1/spaces/:spaceId/board`; `registerSpaces(app, { db, now })`; types `SpaceBoard { spaceId: string; revision: number; screens: ScreenBoard[] }`, `SpaceSummary { id; title; position; revision }` (icon/color added in Task 2); UI `api.spaces()`, `api.board(spaceId)`, `api.saveBoard(spaceId, req)`; `useSpaceSync(client, spaceId: () => string, idle)` returning `{ space, saving, loaded, load, save }`; `connect()` returns `{ state: 'ready'; spaceId: string } | …` (Task 6 widens it).

- [ ] **Step 1: Write the failing migration test** in `apps/api/test/db.test.ts`, new `describe('migration 9: rooms become spaces')`:

```ts
it('renames rooms to spaces, keeps data and adds icon and colour', async () => {
  const v8 = await openDatabase(file, ctx(), MIGRATIONS.slice(0, 8))
  v8.exec(`
    INSERT INTO rooms (id, title, position, revision, created_at, updated_at) VALUES ('r2', 'Вторая', 1, 5, 'x', 'x');
    INSERT INTO screens (id, room_id, position) VALUES ('s2', 'r2', 0);
    INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
    VALUES ('w1', 's2', 'builtin', 'placeholder', '{}', 1, 0, 0, 2, 2);
  `)
  v8.close()
  const db = await openDatabase(file, ctx())
  expect(tables(db)).toContain('spaces')
  expect(tables(db)).not.toContain('rooms')
  expect(db.prepare('SELECT id, title, revision, icon, color FROM spaces ORDER BY position').all()).toEqual([
    { id: SEED_SPACE_ID, title: 'Главная', revision: 1, icon: '🏠', color: 'violet' },
    { id: 'r2', title: 'Вторая', revision: 5, icon: '🏠', color: 'violet' },
  ])
  expect(db.prepare('SELECT id, space_id FROM screens WHERE id = ?').get('s2')).toEqual({ id: 's2', space_id: 'r2' })
  db.exec("DELETE FROM spaces WHERE id = 'r2'")
  expect(db.prepare('SELECT count(*) AS n FROM widgets').get()).toEqual({ n: 0 })
  db.close()
})
```

Update the «creates the schema» test to expect `spaces`, `space_id`, `icon`, `color`. Tests that open `MIGRATIONS.slice(0, n)` with n ≤ 8 keep `rooms` (they exercise released SQL).

- [ ] **Step 2: Run** `pnpm -C apps/api test -- db` — Expected: FAIL (no `spaces` table).

- [ ] **Step 3: Append migration 9** to `MIGRATIONS`:

```sql
-- Spec 2026-10-21-spaces-and-screens: rooms are called spaces; each has an icon and a colour.
ALTER TABLE rooms RENAME TO spaces;
ALTER TABLE screens RENAME COLUMN room_id TO space_id;
ALTER TABLE spaces ADD COLUMN icon TEXT NOT NULL DEFAULT '🏠';
ALTER TABLE spaces ADD COLUMN color TEXT NOT NULL DEFAULT 'violet';
```

- [ ] **Step 4: Run** `pnpm -C apps/api test -- db` — Expected: PASS.

- [ ] **Step 5: Do the rename** listed under Files: identifiers, file names (`git mv`), routes, SQL in live code (`spaces`, `space_id`), error text `'Space not found'`, `'Screens do not match the space'`, CSS classes, validator expected selector `.space--theme-${slug}, .widget--theme-${slug}`, docs. Update all existing tests' expectations to the new names (`/api/v1/spaces`, `spaceId`, `.space--theme-obsidian`).

- [ ] **Step 6: Verify nothing live is left**

Run: `git grep -n -i -E "\broom" -- . ':!.project-history' ':!docs/superpowers' ':!apps/desktop/src-tauri/target'`
Expected: only hits inside `MIGRATIONS[0..7]` SQL strings and comments, old-version migration tests in `db.test.ts`, `examples/widgets/hermes-tasks/src/layout.ts:5`, `apps/ui/app/board/widget-settings.ts:32`.

- [ ] **Step 7: Run everything** `pnpm typecheck && pnpm test` — Expected: PASS.

- [ ] **Step 8: Commit** `refactor: rename rooms to spaces across schema, API, UI and theme contract`

---

### Task 2: Space operations in contracts and API

**Files:**
- Create: `packages/contracts/src/space.ts`, `packages/contracts/test/space.test.ts`
- Modify: `packages/contracts/src/board.ts` (move `SpaceSummary` to `space.ts` and re-export nothing — import sites use `@lifedashboard/contracts/space`)
- Modify: `apps/api/src/spaces.ts`, `apps/api/test/spaces.test.ts`

**Interfaces:**
- Produces in `@lifedashboard/contracts/space`:
  - `SPACE_ICONS: readonly string[]` (24, Global Constraints order), `SPACE_COLORS: Readonly<Record<SpaceColor, number>>` (key → hue), `type SpaceColor = 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'pink'`, `SPACE_LIMITS`, `NEW_SPACE_TITLE`, `NEW_SPACE_ICON`
  - `interface SpaceSummary { id: string; title: string; icon: string; color: SpaceColor; position: number; revision: number }`
  - `interface SpacePatch { title?: string; icon?: string; color?: SpaceColor }`
  - `parseSpacePatch(raw: unknown): ParseResult<SpacePatch>` — object with at least one known key, no unknown keys; title trimmed, 1..40 chars after trim (count code points); icon ∈ `SPACE_ICONS`; colour ∈ keys. Returns the trimmed title. Use `ParseResult` from `board.ts`/`parse.ts` (whichever defines it today).
  - `nextColor(used: readonly SpaceColor[]): SpaceColor` — first palette key not in `used`; if all used, `keys[used.length % 8]`.
  - `interface DeleteRequest { expectedRevision: number }`
- Produces routes:
  - `GET /api/v1/spaces` → `SpaceSummary[]` ordered by `position, created_at`
  - `POST /api/v1/spaces` body `{}` → `SpaceSummary` (201 not required; reuse `ok()` 200). Creates `NEW_SPACE_TITLE`, `NEW_SPACE_ICON`, `nextColor(existing colours)`, `position = max+1`, revision 1, one screen at position 0 with rows `ROWS.default`. At 20 spaces → `VALIDATION_ERROR` `'At most 20 spaces'`.
  - `PATCH /api/v1/spaces/:spaceId` body `SpacePatch` → `SpaceSummary`. Unknown id → 404. Does **not** change `revision`; updates `updated_at`.
  - `DELETE /api/v1/spaces/:spaceId` body `DeleteRequest` → `null`. Order inside one `BEGIN IMMEDIATE`: 404 → revision mismatch 409 `REVISION_CONFLICT` → last space 400 `'The last space cannot be deleted'` → delete (cascade) → `DELETE FROM widget_state/widget_secrets WHERE widget_id NOT IN (SELECT id FROM widgets)`.

- [ ] **Step 1: Write failing contract tests** `space.test.ts`: `parseSpacePatch({ title: '  Дом  ' })` → `{ ok: true, value: { title: 'Дом' } }`; rejects `{}`, `{ title: '   ' }`, `{ title: 'x'.repeat(41) }`, `{ icon: '🦄' }`, `{ color: 'black' }`, `{ extra: 1 }`; accepts `{ icon: '⭐', color: 'pink' }`. `nextColor([])` → `'violet'`; `nextColor(['violet','blue'])` → `'teal'`; all 8 used → `'violet'`; 9 used → `'blue'`. `SPACE_ICONS.length === 24`, `new Set(SPACE_ICONS).size === 24`.

- [ ] **Step 2: Run** `pnpm -C packages/contracts test -- space` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `space.ts` per Interfaces.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Write failing API tests** in `spaces.test.ts`:
  - list returns `{ id: SEED_SPACE_ID, title: 'Главная', icon: '🏠', color: 'violet', position: 0, revision: 1 }`
  - create twice → titles `'Новое пространство'`, colours `'blue'` then `'teal'` (seed holds violet), positions 1 and 2, each board has one empty screen with rows 12
  - create at 20 spaces → 400, count stays 20
  - patch title/icon/colour → returned and listed; revision unchanged; patch with `{ title: '' }` → 400 and no change; unknown id → 404
  - delete with current revision → 200, list without it, its widgets, `widget_state` and `widget_secrets` rows gone (seed widgets via `PUT board` then insert state/secret rows like existing tests do)
  - **stale space delete:** save board (revision becomes 2), delete with `expectedRevision: 1` → 409, space and widgets still there
  - delete the only space → 400, still listed
  - mutations without a session → 401

- [ ] **Step 6: Run** `pnpm -C apps/api test -- spaces` — Expected: FAIL.

- [ ] **Step 7: Implement** the routes in `spaces.ts` with Fastify body schemas like `SAVE_SCHEMA` (`expectedRevision: integer ≥ 1`), validation through `parseSpacePatch`.

- [ ] **Step 8: Run** `pnpm -C apps/api test && pnpm typecheck` — Expected: PASS.

- [ ] **Step 9: Commit** `feat(api): create, update and delete spaces`

---

### Task 3: Screen operations in the API

**Files:**
- Modify: `apps/api/src/spaces.ts`, `apps/api/test/spaces.test.ts`, `packages/contracts/src/space.ts` (`AddScreenRequest = DeleteRequest`)

**Interfaces:**
- Produces:
  - `POST /api/v1/spaces/:spaceId/screens` body `{ expectedRevision }` → `SpaceBoard`. 404 → 409 → at 20 screens 400 `'At most 20 screens per space'` → insert screen (`randomUUID()`, position = count, rows 12) → revision + 1.
  - `DELETE /api/v1/spaces/:spaceId/screens/:screenId` body `{ expectedRevision }` → `SpaceBoard`. 404 space → 404 screen not in this space → 409 → only screen 400 `'The last screen cannot be deleted; delete the space'` → delete screen (cascade widgets) → orphan cleanup of `widget_state`/`widget_secrets` → renumber → revision + 1.
  - Renumber without tripping the unique index, in this order:

```sql
UPDATE screens SET position = -position - 1 WHERE space_id = ? AND position > ?;
UPDATE screens SET position = -position - 2 WHERE space_id = ? AND position < 0;
```

- [ ] **Step 1: Write failing tests:** add → board has 2 screens, new one empty with rows 12, revision 2; add at 20 → 400; **stale add** (revision mismatch) → 409, still 1 screen; delete second of two → 1 screen, revision bumped, its widgets/state/secrets gone, first screen's widgets intact; **middle delete renumbers**: with 3 screens delete the middle → `SELECT position FROM screens WHERE space_id = ? ORDER BY position` = `[0, 1]` and board order is [first, third]; delete only screen → 400; **stale delete**: tab B saves widgets on screen 2 (revision 3), delete with revision 2 → 409, widgets still there; screen id from another space → 404; after add, `PUT board` with the new screen list succeeds (expected ids follow).

- [ ] **Step 2: Run** `pnpm -C apps/api test -- spaces` — Expected: FAIL.

- [ ] **Step 3: Implement** in `spaces.ts`; extract the orphan cleanup used by `saveBoard`, delete space and delete screen into `dropOrphanWidgetData(db: DatabaseSync): void`.

- [ ] **Step 4: Run** `pnpm -C apps/api test && pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): add and delete screens with revision checks`

---

### Task 4: UI client, space sync and edit-mode flows

**Files:**
- Modify: `apps/ui/app/api.ts` (add `'PATCH'` to the method union), `apps/ui/test/api.test.ts`
- Modify: `apps/ui/app/board/space-sync.ts`, `apps/ui/test/space-sync.test.ts`
- Create: `apps/ui/app/board/switch-flow.ts`, `apps/ui/test/switch-flow.test.ts`

**Interfaces:**
- Produces in `api`:
  `spaces()`, `createSpace() → SpaceSummary` (body `{}`), `updateSpace(id, patch: SpacePatch) → SpaceSummary` (PATCH), `deleteSpace(id, expectedRevision) → null`, `board(spaceId)`, `saveBoard(spaceId, req)`, `addScreen(spaceId, expectedRevision) → SpaceBoard`, `deleteScreen(spaceId, screenId, expectedRevision) → SpaceBoard`.
- Produces in `space-sync.ts`:
  - `useSpaceSync(client, spaceId: () => string, idle)` adds:
    - `saveAndStay(next: ScreenBoard): Promise<SaveOutcome>` — same PUT as `save`, updates `space` on success; callers must not leave edit mode on `'saved'`.
    - `switchSpace(): Promise<LoadOutcome>` — loads `spaceId()` ignoring the idle gate (`'loaded' | 'unauthorized' | 'unavailable'`); used only after the working copy is saved or discarded.
    - `addScreen(): Promise<{ outcome: SaveOutcome; screenId?: string }>` — sends `space.revision`; on success replaces `space` and returns the new last screen id.
    - `deleteScreen(screenId: string): Promise<SaveOutcome>` — sends `space.revision`; on success replaces `space`.
  - `afterStaySave(outcome: SaveOutcome): Reaction` — never `leaveMode`, never `reload`: `saved` → `{ notice: null, api: 'ok' }`; `conflict` → `{ notice: 'Доска изменена в другой вкладке' }`; `invalid` → `{ notice: 'Не удалось сохранить: данные отклонены' }`; `unavailable` → `{ notice: 'Не удалось сохранить, повторите', api: 'down' }`; `unauthorized` → `{ leaveMode: true, app: 'pairing' }` (pairing discards anyway, as today); `skipped` → `{}`.
  - `afterManage(outcome: SaveOutcome): Reaction` for space/screen operations: same as `afterStaySave` but `conflict` notice `'Пространство изменено в другой вкладке'`, `invalid` notice `'Не удалось выполнить действие'`.
- Produces in `switch-flow.ts` (pure orchestration over injected functions, no Vue):

```ts
export interface FlowDeps {
  editing: boolean
  dirty: boolean // working copy differs from the saved screen
  saveAndStay(): Promise<SaveOutcome>
}
export type FlowResult = { ok: true } | { ok: false; reaction: Reaction }
/** Saves pending edits when editing and dirty; ok only when nothing is pending afterwards. */
export function runPreSave(deps: FlowDeps): Promise<FlowResult>
/** ✕ on the active screen: never pre-saves; `ask` runs only when `needsConfirm`. */
export function runDeleteScreen(deps: { needsConfirm: boolean; ask(): Promise<boolean>; remove(): Promise<SaveOutcome> }): Promise<FlowResult | { ok: false; cancelled: true }>
```

- [ ] **Step 1: Write failing tests** (existing fake-client style in `space-sync.test.ts`):
  - `saveAndStay` sends `expectedRevision` of the loaded space and replaces `space` on success
  - `switchSpace` loads even when `idle()` is false
  - `addScreen` sends the current revision, returns the new screen id, replaces `space`; on `conflict` leaves `space` unchanged
  - `deleteScreen` same pattern
  - `afterStaySave('conflict')` has no `leaveMode` and no `reload`
  - `api.test.ts`: `updateSpace` uses `PATCH /api/v1/spaces/<id>` with the JSON body; `deleteScreen` path is `/spaces/<id>/screens/<screenId>` with `{ expectedRevision }`
  - `switch-flow.test.ts`: not editing → ok without calling save; editing and clean → ok without save; editing and dirty, save `'saved'` → ok; save `'conflict' | 'invalid' | 'unavailable'` → `{ ok: false }` with the `afterStaySave` reaction and save called once; `runDeleteScreen` with `needsConfirm` and `ask → false` → cancelled, `remove` not called; `remove → 'conflict'` → `{ ok: false }`, no `leaveMode`

- [ ] **Step 2: Run** `pnpm -C apps/ui test -- space-sync switch-flow api` — Expected: FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run** `pnpm -C apps/ui test && pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ui): space and screen operations in the client and sync`

---

### Task 5: Pure UI helpers: fan geometry, navigation, last-open memory

**Files:**
- Create: `apps/ui/app/spaces/fan-layout.ts`, `apps/ui/app/spaces/nav.ts`, `apps/ui/app/spaces/last-open.ts`
- Create: `apps/ui/test/fan-layout.test.ts`, `apps/ui/test/space-nav.test.ts`, `apps/ui/test/last-open.test.ts`

**Interfaces:**
- `fanLayout(count: number, geometry: { r0: number; step: number; size: number; gap: number }): { ring: number; angle: number }[]` — angles in degrees from the top edge (0) to the right edge (90). Algorithm (from the approved mockup): ring k has radius `r0 + k*step`; capacity `fit = max(2, floor((π/2 · r) / (size + gap)) + 1)`; take `min(fit, remaining)`; spacing `74 / (fit - 1)`; start `45 - spacing·(take-1)/2`; angle `start + i·spacing`. Callers convert to x/y. Default geometry in rem: `{ r0: 9.125, step: 6.75, size: 5, gap: 1.5 }` (146/108/80/24 px at 16 px).
- `headerTitle(title: string, index: number, count: number): string` — Global Constraints format.
- `afterDelete(ids: readonly string[], deletedId: string): string | null` — previous id, or the next when the first is deleted; `null` when it was the only one.
- `needsDeleteConfirm(saved: ScreenBoard | undefined, working: ScreenBoard | null): boolean` — true when either has ≥ 1 instance.
- `LAST_OPEN_STORAGE_KEY = 'lifedashboard.lastOpen'`; `interface LastOpen { schemaVersion: 1; spaceId: string | null; screens: Record<string, string> }`; `loadLastOpen(): LastOpen` and `saveLastOpen(value): boolean` never throw (pattern of `theme/appearance.ts`); `resolveLastOpen(stored: LastOpen, spaces: readonly SpaceSummary[]): string | null` — stored space id if listed, else first space id, else null; `screenFor(stored: LastOpen, spaceId: string, screenIds: readonly string[]): string | null` — stored screen if present in `screenIds`, else first, else null.

- [ ] **Step 1: Write failing tests:**
  - with the default geometry: `fanLayout(3, g)` → ring 0, angles `[8, 45, 82]` (±0.01); `fanLayout(6, g)` → rings `[0,0,0,1,1,1]`, ring-1 angles `[20.33, 45, 69.67]` (±0.01); `fanLayout(1, g)` → `[{ ring: 0, angle: 45 }]`; `fanLayout(21, g)` → 21 items, rings hold 3, 4, 6, 8, max ring 3; every angle within `[8, 82]`
  - `headerTitle('Дом', 0, 1)` → `'Дом'`; `headerTitle('Дом', 1, 3)` → `'Дом (2)'`; `headerTitle('Дом', 0, 2)` → `'Дом (1)'`
  - `afterDelete(['a','b','c'], 'b')` → `'a'`; `(… , 'a')` → `'b'`; `(['a'], 'a')` → `null`
  - `needsDeleteConfirm(savedWithWidgets, emptyWorking)` → true; `(emptySaved, workingWithWidgets)` → true; `(emptySaved, null)` → false
  - `loadLastOpen()` with malformed JSON, wrong schema, or a throwing `localStorage` → defaults; round-trip through `saveLastOpen`; `resolveLastOpen` with a deleted stored id → first space; with `[]` → null; `screenFor` with a stale screen id → first

- [ ] **Step 2: Run** `pnpm -C apps/ui test -- fan-layout space-nav last-open` — Expected: FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ui): fan geometry, header title and last-open memory`

---

### Task 6: Screens on the board: dots, arrows, add, delete, slide

**Files:**
- Create: `apps/ui/app/spaces/ScreenDots.vue`, `apps/ui/app/spaces/ConfirmDelete.vue`, `apps/ui/app/spaces/confirm-delete.ts`, `apps/ui/test/confirm-delete.test.ts`
- Modify: `apps/ui/app/board/WidgetBoard.vue`, `apps/ui/app/app.vue`

**Interfaces:**
- Consumes: Task 4 `useSpaceSync` additions, `runPreSave`, `runDeleteScreen`, `afterStaySave`, `afterManage`; Task 5 `headerTitle`, `needsDeleteConfirm`, `afterDelete`, `screenFor`.
- `confirm-delete.ts`: `askDelete(message: string): Promise<boolean>` and `pendingDelete = ref<{ message: string; answer(ok: boolean): void } | null>`; a second call while one is pending resolves the first with `false`. `ConfirmDelete.vue` renders it in a native `<dialog>` (`showModal`), buttons «Удалить» and «Отмена», focus on «Отмена», Esc = «Отмена». (Not `ConfirmDialog.vue`: that dialog is bound to widget-gateway confirmations.)
- `WidgetBoard.vue`:
  - props: `themeId`, `draftSource`; `v-model:spaceId` (`string`) and `v-model:screenId` (`string | null`). `useSpaceSync` reads the space id from the model, so `switchSpace` can set it, load, and revert it if the load fails. The app never changes `spaceId` itself after mount; it calls `switchSpace`.
  - `doc` = the screen with `screenId` (fallback first)
  - exposes, in addition to today's: `screens: ComputedRef<string[]>` (ids in order), `revision: ComputedRef<number | null>`, `switchScreen(id: string): Promise<boolean>`, `switchSpace(spaceId: string, screenId: string | null, opts?: { discard: boolean }): Promise<boolean>`, `addScreen(): Promise<boolean>`, `saveIfDirty(): Promise<boolean>` (`runPreSave` alone), `removeScreen(): Promise<'deleted' | 'last' | 'cancelled' | 'failed'>`, `dirty: ComputedRef<boolean>`
  - `switchScreen`/`addScreen`/`switchSpace` run `runPreSave` first (skipped with `discard`); on success set `screenId`, and if editing set `working = doc` (stay in edit mode); on failure `apply(reaction)` and return false
  - `removeScreen`: if `screens.length === 1` return `'last'` (app deletes the space); else `runDeleteScreen` with `needsDeleteConfirm(savedScreen, editing ? working : null)` and message `'Удалить экран? Виджеты на нём будут удалены.'`; on success move to `afterDelete(...)` and reset `working` when editing
  - slide: the board grid gets class `board__grid--enter-next|prev` for one frame on switch; CSS transform `translateX(±2.5rem)` + opacity, `--ld-duration-slow`; none under reduced motion
  - only the active screen's widgets render (already true once `doc` is per screen)
- `ScreenDots.vue`: props `count: number`, `index: number`, `editing: boolean`, `disabled: boolean`, `canAdd: boolean`; emits `go(index)`, `add()`, `remove()`. Visible when `count > 1 || editing`. Active dot elongated with `--ld-accent`; arrows disabled at the ends; «+» only when `editing` (disabled with `title="Не больше 20 экранов"` when `!canAdd`); ✕ only on the active dot, only when `editing`, shown on hover and on keyboard focus of that dot; buttons have `aria-label` «Экран N», active has `aria-current="true"`.
- `app.vue`: remove `<h1 class="app__title">`; header gets the title slot (plain `headerTitle(...)` text for now, Task 7 replaces it), `ScreenDots` absolutely centred, existing controls right-aligned with a reserved corner slot of `3.5rem`. Build mode → `ScreenDots` `disabled`. `removeScreen() === 'last'` is handled in Task 7; until then show nothing.

- [ ] **Step 1: Write failing test** `confirm-delete.test.ts`: `askDelete('x')` exposes `pendingDelete`; `answer(true)` resolves true and clears it; a second `askDelete` resolves the first with false.

- [ ] **Step 2: Run** `pnpm -C apps/ui test -- confirm-delete` — Expected: FAIL.

- [ ] **Step 3: Implement** `confirm-delete.ts`, `ConfirmDelete.vue`, `ScreenDots.vue`, the `WidgetBoard.vue` and `app.vue` changes.

- [ ] **Step 4: Run** `pnpm -C apps/ui test && pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Browser check in Orca** (`pnpm dev`, open the UI in Orca's browser): in edit mode add two screens; dots and arrows appear, title shows «Главная (3)»; arrows disabled at ends; slide on switch; move a widget, switch screen → change saved, still in edit mode; stop the API, move a widget, switch → notice shown, still on the screen, edit kept; ✕ on a screen with widgets asks; ✕ on an empty screen deletes at once; «Отмена» after a switch keeps the saved change. Record findings in the task report.

- [ ] **Step 6: Commit** `feat(ui): switch, add and delete screens`

---

### Task 7: Space switcher, picker, rename, delete, tint and memory

**Files:**
- Create: `apps/ui/app/spaces/SpaceSwitcher.vue`, `apps/ui/app/spaces/SpacePicker.vue`, `apps/ui/app/spaces/SpaceTitle.vue`
- Modify: `apps/ui/app/app.vue`, `apps/ui/app/board/space-sync.ts` (`connect` returns `{ state: 'ready'; spaces: SpaceSummary[] }`), `apps/ui/test/space-sync.test.ts`, `apps/ui/app/theme/styles/frame.css` (tint layer), `README.md` (Current state row: spaces and screens are manageable)

**Interfaces:**
- Consumes: Task 4 `api.*`, `afterManage`; Task 5 `fanLayout`, `resolveLastOpen`, `screenFor`, `loadLastOpen`, `saveLastOpen`, `headerTitle`, `afterDelete`; Task 6 board exposes and `askDelete`; Task 2 `SPACE_ICONS`, `SPACE_COLORS`, `SPACE_LIMITS`, `SpaceSummary`, `SpacePatch`.
- `SpaceSwitcher.vue`: props `spaces: SpaceSummary[]`, `currentId: string`, `editing: boolean`, `disabled: boolean`; emits `select(id)`, `create()`, `edit(id, patch: SpacePatch)`. Corner button shows the current icon on its colour; fan motion uses `--ld-duration-*` and is instant under reduced motion; fan per spec «Fan» using `fanLayout`; scrim dims and blurs (`backdrop-filter`) a radial area around the corner; bubble = `<button aria-label=title>` with icon, colour tint, accent ring and `aria-current` on the current one, hover label above neighbours (`z-index`); in edit mode a ✎ badge per bubble opens `SpacePicker` to the left of the fan, and the last bubble is «+» (disabled with title `'Не больше 20 пространств'` at the limit). Focus moves to the current bubble when opened from the keyboard.
- `SpacePicker.vue`: props `space: SpaceSummary`; emits `pick(patch: SpacePatch)`, `close()`. Grid 8×3 of `SPACE_ICONS`, row of 8 colour swatches from `SPACE_COLORS`; selected items marked; Esc and outside click close.
- `SpaceTitle.vue`: props `title: string`, `suffix: string` (the `« (2)»` part), `editing: boolean`, `startRename: boolean`; emits `rename(title)`. In edit mode hover/focus shows ✎; click → `<input maxlength=40>` with the title selected; Enter/blur commit a trimmed non-empty changed value, Esc cancels.
- `app.vue` flow:
  - startup: `connect` → `spaces`; current = `resolveLastOpen(loadLastOpen(), spaces)`; board `screenId = screenFor(...)` once the board loads; every switch calls `saveLastOpen`
  - `select(id)` → `boardRef.switchSpace(id, screenFor(...))`; current changes only on true
  - `create()` → `await boardRef.saveIfDirty()` (stop on false) → `api.createSpace()`; on success append and `boardRef.switchSpace(newId, null)` (nothing pending, so no second save), then `SpaceTitle startRename`; on failure `afterManage`
  - `edit(id, patch)` / `rename` → `api.updateSpace`; replace the summary only on success; failure → `afterManage` notice (no optimistic update, so nothing to revert)
  - screen ✕ returning `'last'`: if `spaces.length === 1`, the ✕ is disabled (`ScreenDots` prop) with title `'Последнее пространство удалить нельзя'`; else `askDelete('Удалить пространство «…» вместе с экраном и виджетами?')` → `api.deleteSpace(id, boardRef.revision)` → on success remove it and `switchSpace(afterDelete(...), …, { discard: true })`; on failure `afterManage`
  - `disabled` for switcher and dots while `mode === 'build'` or `boardRef.saving`
- Tint: `.space__tint` fixed layer above `.space__backdrop`, `background: radial-gradient(circle at 20% 10%, oklch(0.6 0.12 var(--space-hue) / 0.18), transparent 60%)`; `--space-hue` set from `SPACE_COLORS[current.color]`.

- [ ] **Step 1: Write failing test** in `space-sync.test.ts`: `connect` returns `{ state: 'ready', spaces }` with the full list; empty list → `unavailable`.

- [ ] **Step 2: Run** `pnpm -C apps/ui test -- space-sync` — Expected: FAIL.

- [ ] **Step 3: Implement** the components, `app.vue` flow, tint, README row.

- [ ] **Step 4: Run** `pnpm typecheck && pnpm test` — Expected: PASS.

- [ ] **Step 5: Browser check in Orca, all three themes** («Стекло», «Обсидиан», «Бумага»): fan opens on hover and by keyboard, closes after leaving and on Esc; labels above neighbours; create space in edit mode → switches, rename field open; rename via ✎; icon and colour via picker (fan stays open meanwhile); tint changes; switch spaces with pending widget edits saves them; ✕ on the only screen asks and deletes the space, lands on the neighbour; last space cannot be deleted; reload restores the last space and screen; build mode disables switching; 1280 px width has no overlap in the header. Compare with the mockup.

- [ ] **Step 6: Commit** `feat(ui): space switcher with create, rename, icon, colour and delete`

---

## Deviations from the spec (for the reviewer)

- The spec names the existing `ConfirmDialog` for confirmations. That component is bound to widget-gateway confirmations (`op`, `widgetId`), so Task 6 adds a small native-`<dialog>` `ConfirmDelete` instead. Behaviour matches the spec.
- Tests of released migrations on old schema versions keep `rooms`, alongside the spec's released-SQL exception.
