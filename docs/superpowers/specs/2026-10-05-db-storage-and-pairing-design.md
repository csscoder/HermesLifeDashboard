# Board storage in SQLite behind a paired API

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§3.3, §4.1, §5.4, §7.4, §11, §12, §13.1)
- **Builds on:** `docs/superpowers/specs/2026-10-05-board-edit-mode-design.md`
- **Linear:** GO-3 «Организация хранения в БД», step 1 of 3
- **Status:** approved design, 2026-10-05

## Goal

The board moves from `localStorage` to SQLite owned by the Fastify API. The UI reaches the API
only after a one-time pairing with a code printed in the API terminal. The schema already knows
rooms and screens, so steps 2 and 3 add UI and routes, not a storage redesign.

Success:

- a clean start creates the database with one room «Главная» and one screen;
- a browser pairs once with the terminal code and stays signed in while the gap between two uses
  never exceeds 29 days (sliding 30-day expiry renewed at most once a day, see Security);
- added, moved and deleted widgets survive an API restart and a browser reload;
- a request without a session gets `401`; a request with a foreign `Origin` or `Host` gets `403`;
- two tabs never silently overwrite each other: the stale save gets `409` and a notice.

## GO-3 decomposition

GO-3 is delivered in three steps, each with its own spec, plan and implementation:

| Step | Delivers |
| --- | --- |
| 1 (this spec) | SQLite, migrations, pairing and sessions, room board API, UI on the API |
| 2 | Rooms UI: unlimited rooms, create, rename, reorder, switch, archive |
| 3 | Screens in a room: dot pager, screen thumbnails with «+» in build and edit modes, moving a widget to another screen |

## Brief

Stated by the user:

- widgets are stored in a database through Fastify instead of `localStorage`;
- the UI ↔ API connection is secure from the start, using pairing per §13.1;
- the schema supports rooms and screens from the start;
- the current `localStorage` board is not migrated;
- sessions use a sliding 30-day expiry without an absolute limit.

Assumptions accepted by the user:

- local mode only: the API listens on `127.0.0.1`;
- no offline mode: with the API unavailable the board shows an error and the modes are disabled;
- the theme stays in `localStorage` until step 2;
- tabs coordinate through the room `revision` (DATA-06).

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| SQLite driver | Built-in `node:sqlite` (`DatabaseSync`), hand-written SQL | No new dependency and no native addon. Verified on Node 24.21.0 (SQLite 3.53.4) without a flag; Node 24 docs mark the module Release Candidate since v24.15.0 and provide `backup()`, transactions and PRAGMA |
| Migrations | Numbered SQL strings in `migrations.ts`, applied by `PRAGMA user_version` | No migration tool. SQL lives in a TS module, so `tsc` output needs no copied assets |
| Revision scope | One `revision` per room, covering all its screens | Step 3 moves widgets between screens; that must be one atomic save |
| Placement storage | `x, y, w, h` columns on the widget row | A widget has exactly one place; a separate layout table adds a join and nothing else |
| Grid bounds and overlap | Validated in `packages/contracts`, not by SQL `CHECK` | The row count N may still change (§7.4); a constraint would need a migration for it |
| Write API | One `PUT /api/v1/rooms/:roomId/board` replaces the room's widgets | Build and edit are already batch replacements guarded by a snapshot; this maps them 1:1 |
| Shared code | New workspace package `packages/contracts` | API and UI validate the board with the same code (§4.1) |
| Auth | Pairing code → HttpOnly session cookie, sessions in SQLite | §13.1; sessions survive API restarts |
| Session expiry | Sliding 30 days, renewed at most once a day | No re-pairing while the dashboard is used at least once in 29 days; at most one session write per day |
| CSRF | No CSRF token; `SameSite=Strict` + required allowlisted `Origin` + required `Content-Type: application/json` | See deviations |
| Cookies and rate limits | Hand-written cookie parsing and in-memory counters | A few lines each; no `@fastify/cookie` or `@fastify/rate-limit` |
| `localStorage` board | Not read anymore; no import | It holds only placeholder widgets |
| Cross-tab refresh | Reload the board on `visibilitychange` to visible outside edit mode | Replaces the `storage` event, which does not exist for server data |

## Deviations from the base design

| Base design | This step | Why |
| --- | --- | --- |
| §3.3: `better-sqlite3` + Drizzle | `node:sqlite`, hand-written SQL | No native addon to package for Tauri, no new dependencies; five tables do not need an ORM |
| §11.2: `POST /rooms/:id/widgets`, `PATCH`/`DELETE /widgets/:id`, `PUT /rooms/:id/layout` | One `PUT /rooms/:roomId/board` | The UI saves whole edit sessions with a revision check; per-widget routes would need their own concurrency story |
| §13.1: CSRF token on state-changing requests | No token | A cross-site request must defeat `SameSite=Strict`, an allowlisted `Origin` and a JSON content type that forces a CORS preflight with no CORS allowed. The token would add state and code without closing another path |
| §7.4: «Если места не хватает, пользователь создаёт ещё одну Room» | Rooms get screens (step 3) | GO-3 asks for multiple screens per room; the schema prepares for it now |
| §5.1: `WidgetInstance` and `RoomLayout` as separate entities | Placement columns on the widget row | One place per widget; the API still returns `instances` and `layout` separately |
| §5.1: `Workspace`, `WorkspaceState` | Not created | Nothing reads them yet |

## Data

### Location and connection

The database is `lifedashboard.db` in `LIFEDASHBOARD_DATA_DIR`. Without the variable the API uses
the OS data directory: `~/Library/Application Support/LifeDashboard` on macOS,
`$XDG_DATA_HOME/lifedashboard` (fallback `~/.local/share/lifedashboard`) on Linux,
`%APPDATA%\LifeDashboard` on Windows. The directory is created if missing. The repository is
never the default (§12.1).

Connection settings: `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`,
`synchronous = FULL`.

### Schema (migration 1)

```sql
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
```

- Ids are UUIDs (DATA-01); timestamps are UTC ISO 8601 strings (DATA-02).
- `config` is a JSON object serialized as text; `config_version` is its schema version (§12.2),
  `1` for every widget type in this step. Conversions between versions arrive with the first
  widget type that changes its config; until then the API stores and returns the value unchanged.
- Versions are separate by purpose: `PRAGMA user_version` versions the storage schema, the
  `/api/v1` prefix versions the HTTP contract, `config_version` versions each widget's config.
- `sessions.token_hash` is the hex SHA-256 of the session token; the token itself is never stored.
- Migration 1 also seeds one room (`title = 'Главная'`, `position = 0`, `revision = 1`) with one
  screen (`position = 0`).

### Migrations

`migrations.ts` exports an ordered array of SQL strings; migration `n` sets `user_version = n`.
On start `db.ts`:

1. reads `user_version`;
2. stops with a clear error if it is greater than the number of known migrations (§12.2);
3. if it is lower and greater than 0, writes a backup with `backup()` to
   `lifedashboard.db.bak-v<user_version>` in the data directory;
4. applies each pending migration in its own transaction together with the new `user_version`.

The API serves requests only after this completes.

## Contracts (`packages/contracts`)

Pure TypeScript without dependencies, consumed by `apps/api` and `apps/ui` as a workspace
package.

| File | Content |
| --- | --- |
| `src/grid.ts` | Moved from `apps/ui/app/widgets/grid.ts` without changes |
| `src/board.ts` | `WidgetSource`, `WidgetInstance`, `WidgetPlacement`, `ScreenBoard`, `RoomBoard`, `parseScreenBoard` |
| `src/api.ts` | Error codes and the success/error envelope types |

```ts
interface ScreenBoard {
  id: string
  instances: WidgetInstance[]
  layout: WidgetPlacement[]
}

interface RoomBoard {
  roomId: string
  revision: number
  screens: ScreenBoard[] // ordered by position
}
```

`parseScreenBoard(raw: unknown)` keeps the checks of today's `parseBoardDocument`: object shape,
non-empty unique instance ids, `builtin` source with a non-empty type, object config, every
placement refers to a known instance exactly once, integer rect inside the grid, no overlap, every
instance placed. It drops the document-level `schemaVersion`: the board is no longer stored as one
JSON document. `WidgetInstance` gains `configVersion: number` (positive integer, required).
Instance ids must also be UUIDs.

## API

All application routes use `/api/v1` and the §11.1 envelopes: `{ data, meta: { requestId } }` on
success and `{ error: { code, message, requestId, retryable } }` on failure, without stack traces.
`GET /health` stays public and unchanged.

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/v1/auth/pair-code` | none | Prints a new pairing code to the API log; invalidates the previous one |
| `POST /api/v1/auth/pair` | none | Exchanges `{ code }` for a session cookie |
| `GET /api/v1/rooms` | session | `[{ id, title, position, revision }]` ordered by position |
| `GET /api/v1/rooms/:roomId/board` | session | `RoomBoard` |
| `PUT /api/v1/rooms/:roomId/board` | session | Body `{ expectedRevision, screens }`; returns the saved `RoomBoard` |

### `PUT /rooms/:roomId/board`

In one transaction:

1. unknown room → `404 NOT_FOUND`;
2. `expectedRevision` differs from the stored revision → `409 REVISION_CONFLICT`, nothing written;
3. every screen passes `parseScreenBoard`, the screen ids equal the room's screen ids, and
   instance ids are unique across the room; otherwise `400 VALIDATION_ERROR`, nothing written;
4. delete the room's widgets, insert the new ones, increment `revision`, set `updated_at`.

An instance id that already belongs to another room fails the primary key; the transaction is
rolled back and the route returns `400 VALIDATION_ERROR`. Step 3 extends the route to create and
delete screens.

### Errors

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body or params fail the schema or `parseScreenBoard`; instance id used by another room |
| 401 | `UNAUTHORIZED` | No, unknown or expired session; wrong or expired pairing code |
| 403 | `FORBIDDEN` | Host, Origin or content type check failed |
| 404 | `NOT_FOUND` | Unknown room or route |
| 409 | `REVISION_CONFLICT` | Stale `expectedRevision` |
| 429 | `RATE_LIMITED` | Pairing limits exceeded |
| 500 | `INTERNAL_ERROR` | Anything else; details only in the API log |

## Security

### Pairing

- On start the API creates a 6-digit code from `crypto.randomInt` and logs it with its expiry. The
  code is valid for 10 minutes and for one successful use.
- `POST /auth/pair-code` replaces the code and logs the new one. It never returns the code. Limit:
  one call per 10 seconds, otherwise `429`.
- `POST /auth/pair` compares with `timingSafeEqual`. A wrong code returns `401`; the fifth wrong
  attempt against the same code invalidates it. Without a valid code every attempt returns `401`
  until a new code is requested.
- Success creates a 32-byte random token (base64url), stores its SHA-256 with
  `expires_at = now + 30 days`, invalidates the code and sets
  `ld_session=<token>; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000`. `Secure` is not set:
  the loopback connection is plain HTTP (§13.1 local mode).

### Session check and sliding renewal

For every `/api/v1` route except the two pairing routes, an `onRequest` hook hashes the cookie
token and looks the session up. A missing or expired session returns `401`; an expired row is
deleted. When `expires_at < now + 29 days`, the hook sets `expires_at = now + 30 days` and
re-sends the cookie with a fresh `Max-Age`. There is no absolute session limit.

A session therefore expires 30 days after its last renewal, not after its last request: a request
made less than a day after a renewal does not move `expires_at`. The guaranteed idle gap is 29
days; it is up to 30 days depending on the time of the last renewal. Renewing on every request
would make it exactly 30 days at the cost of a write per request.

### Request checks

The same hook runs before the session check, for all `/api` requests:

- `Host` must be `127.0.0.1:<port>` or `localhost:<port>` of the API (DNS rebinding);
- `Origin`, when present, must be in `LIFEDASHBOARD_UI_ORIGINS`;
- `POST`, `PUT`, `PATCH`, `DELETE` must carry an allowlisted `Origin` and
  `Content-Type: application/json`;
- the API sends no CORS headers; the browser reaches it same-origin through the dev proxy.

### Configuration

| Variable | Default | Validation |
| --- | --- | --- |
| `LIFEDASHBOARD_API_PORT` | `3001` | Existing |
| `LIFEDASHBOARD_DATA_DIR` | OS data directory | Absolute path |
| `LIFEDASHBOARD_UI_ORIGINS` | `http://127.0.0.1:3000` | Comma-separated `http(s)://host:port` origins without path |

Invalid values stop the API on start with a message naming the variable, like the port today.

## Structure

| File | Responsibility |
| --- | --- |
| `pnpm-workspace.yaml` | Add `packages/*` |
| `packages/contracts/` (new) | `package.json`, `tsconfig.json`, `src/grid.ts`, `src/board.ts`, `src/api.ts`, `test/` |
| `apps/api/src/config.ts` | `dataDir`, `uiOrigins` |
| `apps/api/src/db.ts` (new) | Open the database, PRAGMA, migrations, backup |
| `apps/api/src/migrations.ts` (new) | Migration SQL |
| `apps/api/src/errors.ts` (new) | `ApiError`, error handler, `requestId` |
| `apps/api/src/auth.ts` (new) | Pairing, sessions, request-check hook, pairing routes |
| `apps/api/src/rooms.ts` (new) | Room list and board routes |
| `apps/api/src/app.ts` | `buildApp({ db, config, logger })` wires the modules; tests pass an in-memory database |
| `apps/api/src/server.ts` | Opens the database before `buildApp` |
| `apps/ui/app/api.ts` (new) | `fetch` wrapper: envelopes, typed failures `unauthorized`, `conflict`, `unavailable`, `invalid`; 5000 ms timeout per request |
| `apps/ui/app/PairingForm.vue` (new) | Code input, «Войти», «Новый код» |
| `apps/ui/app/app.vue` | States `checking → pairing → ready \| unavailable` |
| `apps/ui/app/board/WidgetBoard.vue` | Load and save through `api.ts` |
| `apps/ui/app/board/edit-session.ts` | Drop the local conflict check from `confirmOutcome` |
| `apps/ui/app/widgets/board-document.ts` | Removed; types and parsing live in contracts |
| `apps/ui/app/widgets/grid.ts` | Removed; imports switch to contracts |

Dependency direction: `contracts` ← `apps/api`, `contracts` ← `apps/ui`. Contracts import
nothing from either app.

Known risk, checked first in the plan: the API runs TypeScript through Node type stripping and
builds with `tsc`. Importing `.ts` sources from the workspace package must work in `pnpm dev`,
`pnpm build` and `pnpm start`; Node resolves the symlink to `packages/contracts`, outside
`node_modules`, where type stripping is allowed.

## UI flow

### App states (`app.vue`)

- `checking`: `GET /api/v1/rooms`.
- `pairing`: the request returned `401`. `PairingForm` accepts the code; success returns to
  `checking`. «Новый код» calls `pair-code` and says «Новый код выведен в терминал API». `429`
  shows «Подождите несколько секунд».
- `ready`: the board of the first room is shown.
- `unavailable`: a load request (`GET`) failed with a network error, timeout or `5xx`. The header
  shows «API: недоступен», the board shows an error with «Повторить»; «+» and «Изменить» are
  disabled. «Повторить» returns to `checking`.

A `401` from any later request switches to `pairing`; an unsaved working copy is discarded.

Every request in `api.ts` uses `AbortSignal.timeout(5000)`, which also covers reading the body,
like today's `/health` check. A timeout is an `unavailable` failure.

The UI notices that the API stopped only on its next request: start, «Повторить», a
`visibilitychange` reload or «Готово». There is no polling.

### Board (`WidgetBoard.vue`)

- Load: `GET /rooms/:roomId/board`; the board edits `screens[0]`.
- «Готово» in build and edit modes sends `PUT` with the loaded `revision` and the working copy.
  While the request runs, a `saving` flag disables the header buttons, makes the board `inert`
  (no pointer or focus interaction) and makes the keydown handler ignore every key, so the working
  copy cannot change before the response arrives.
  - `200`: the response becomes the document; the mode ends.
  - `409`: reload the board, end the mode, show «Доска изменена в другой вкладке».
  - `400`: keep the mode and the working copy, show «Не удалось сохранить: данные отклонены»;
    the API log has the details.
  - network error, timeout or `5xx`: keep the mode and the working copy, show «Не удалось
    сохранить, повторите» and «API: недоступен» in the header. The user can press «Готово» again
    or «Отмена»; the app does not switch to the `unavailable` state while a mode is active.
  The UI never shows an unsaved change as saved (DATA-05).
- Build mode no longer checks free space against a fresh read before saving; the server decides
  through the revision.
- Outside edit and build modes the board reloads on `visibilitychange` when the tab becomes
  visible.
- Removed: `loadBoard`, `saveBoard`, `BOARD_STORAGE_KEY`, the `storage` listener, the `unsaved`
  flag and «Хранилище недоступно».

## Testing

TDD with Vitest: a failing test precedes each behaviour change.

- `packages/contracts`: `grid.test.ts` and the board parsing tests move from `apps/ui/test`;
  `parseScreenBoard` keeps their cases and adds the UUID check.
- `apps/api` (Fastify `inject`, `:memory:` database per test, temporary directory for file cases):
  - `db`: a fresh database gets the schema and the seed; a second open changes nothing; a newer
    `user_version` fails with a clear error; migrating an existing database writes the backup
    first;
  - `auth`: a valid code sets the cookie with the expected attributes; a code works once; an
    expired code and a code burnt by five wrong attempts fail; `pair-code` is rate limited and
    invalidates the previous code; no cookie gives `401`; foreign `Host` or `Origin` gives `403`;
    a mutation without `Origin` or with a non-JSON content type gives `403`; renewal happens after
    a day and not before; an expired session gives `401`; boundary: after pairing at `t` and a request
    at `t + 12 h` (no renewal), a request at `t + 29 d 23 h` succeeds and renews, while in a
    separate run a request at `t + 30 d 1 h` gives `401`;
  - `rooms`: the seed board is returned; `PUT` with the current revision saves and increments it;
    a stale revision gives `409` and changes nothing; overlap, out-of-grid rect, duplicate id and a
    mismatched screen set give `400` and change nothing; an unknown room gives `404`;
  - `config`: `dataDir` and `uiOrigins` defaults and invalid values.
- `apps/ui`: `api.ts` with a stubbed `fetch` maps envelopes and `401`, `409`, `400`, network
  errors, and a response whose headers or body never arrive to `unavailable` after the timeout;
  `edit-session.test.ts` follows the `confirmOutcome` change.
- Manual check in Orca's built-in browser with `pnpm dev`: pairing, add/move/delete surviving an
  API restart and reload, `409` notice with two tabs, API stopped before load and during «Готово», keys and pointer
  ignored while a save is pending (throttled network).

## Acceptance criteria

1. A clean start creates `lifedashboard.db` in the data directory with room «Главная» and one
   screen; the repository gets no database file.
2. The API log shows a pairing code; entering it in the UI opens the board; reloading the page
   does not ask again.
3. Widgets added, moved, resized and deleted survive an API restart and a browser reload.
4. A request without a session returns `401`; with a foreign `Origin` or `Host`, `403`.
5. Saving from a tab with a stale revision shows «Доска изменена в другой вкладке» and loses no
   data of the other tab.
6. With the API stopped, the next request makes the UI show «API: недоступен»: a failed load
   disables «+» and «Изменить»; a failed «Готово» keeps the mode and the working copy for a retry.
7. While a save is pending, keyboard and pointer input does not change the board.
8. A database with a newer schema stops the API with a clear error and stays unchanged.
9. `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
10. README and `.env.example` describe the new variables and pairing.

## Out of scope

- Rooms UI and room routes beyond the list (step 2).
- Screens UI, pager, thumbnails, creating and deleting screens (step 3).
- Logout, session list and Settings.
- Serving the generated UI from Fastify; production origin configuration beyond the allowlist.
- Moving the theme to the database.
- `Secure` cookies, HTTPS, remote Core.
- Domain events, idempotency receipts, SSE.
