# Hermes Tasks widget and the network gateway

- **Builds on:** `.project-history/features/2026-10-09-widget-runtime-sandbox/spec.md` (gateway, grants,
  confirmation), `docs/superpowers/specs/2026-10-10-widget-package-v2-design.md` (package format v2)
- **External service:** Hermes Tasks (`/Users/csscoder/Development/LOCAL_PRJ_AI/27_HermesLightTodoist`),
  a Docker container on `127.0.0.1:8787` with a REST API under `/api/v1`
- **Status:** approved design, 2026-10-11

## Goal

The user sees and manages the tasks that Hermes Agent keeps in Hermes Tasks from a LifeDashboard widget:

- current tasks by view (Today with overdue, Upcoming, Inbox, All open) and by tag;
- complete, skip and reopen an occurrence; reschedule it; edit a task; quick-add a task;
- the widget is an installable sandboxed package, needs nothing from the Hermes Tasks web UI and follows
  the board theme.

Success: the built widget installs through «Виджеты» with the review showing «Доступ к сети:
http://127.0.0.1:8787»; on the board it lists the live tasks, a change made in the widget appears in the
Hermes Tasks web UI, and a change made through Hermes appears in the widget within about 10 seconds.

## Delivery decomposition

One spec, two parts delivered in order:

1. **Network gateway** (platform): `network` permission, per-package origin allowlist, `http.get` and
   `http.send` operations proxied by the API. This starts sub-project 2 of the widget platform
   (`http.get` through the proxy) without secrets.
2. **Hermes Tasks widget**: `examples/widgets/hermes-tasks`.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Transport | The API calls the service with Node `fetch`; the widget calls the gateway | The sandbox has an opaque origin. Hermes Tasks answers `Origin: null` with `403 ORIGIN_NOT_ALLOWED` (checked 2026-10-11), and allowing `null` would admit every sandboxed page. A server-side request sends no Origin. Works the same in the Tauri build, where the API is the sidecar |
| Scope of the proxy | Generic HTTP with an exact-origin allowlist per package (user choice B) | Reusable by other widgets; the allowlist is reviewed at install |
| Origin format | `scheme://host[:port]`, scheme `http` or `https`, no path, query, fragment, credentials or wildcard; stored normalized by `new URL(x).origin` | Exact matching, no pattern language to audit |
| Loopback and private hosts | Allowed when listed and approved | The main use case is a local service; the user approves each origin |
| Approval of origins | Stored per package in `widget_network_origins`; an origin the package has not been granted is shown at install like a new permission | A new version must not widen network access silently |
| Operations | `http.get` with `confirm: 'never'`; `http.send` (`POST`, `PUT`, `PATCH`, `DELETE`) with `confirm: 'optional'` | Polling every 10 s must never open a dialog; writes follow the grant mode (`ask` confirms each write) |
| Upstream status | Any HTTP status, 3xx included, is a successful gateway call returning `{ status, contentType, body }` | The widget handles service errors such as `409 VERSION_CONFLICT` itself |
| Redirects | Not followed (`redirect: 'manual'`) | A redirect could leave the allowlist |
| Secrets | None in this spec | Hermes Tasks on localhost needs no token; secrets are sub-project 3 |
| Date change | Reschedule the current occurrence, not the series schedule | «Перенести» moves this repeat; the series rule stays |
| Recurrence rules | Shown read-only; changed through Hermes | A rule editor is out of scope |
| Widget tests | Vitest in the widget package for pure modules | Same framework as the rest of the monorepo; `vitest` is already a workspace dependency |

## Part 1. Network gateway

### Manifest

`widget.json` gains an optional `network` array and the permission `network`:

```json
{
  "permissions": ["state", "network"],
  "network": ["http://127.0.0.1:8787"]
}
```

`packages/contracts/src/widget-package.ts`:

- `WIDGET_PERMISSIONS` adds `'network'`; `MANIFEST_KEYS` adds `'network'`;
- `WidgetPackageManifest.network: string[]` (empty when absent);
- validation fails when `network` is present but not an array of 1–16 valid origins, when an origin is
  not already in normalized form, on duplicates, when `network` is non-empty without the `network`
  permission, or when the `network` permission has no origins;
- `PackageInspection.newOrigins: string[]` lists manifest origins the package does not hold yet.

`ld-widget build` copies the manifest through the same validator, so no CLI change beyond what the
contract enforces.

### Storage

New migration:

```sql
CREATE TABLE widget_network_origins (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (package_id, origin)
);
```

Install inserts the version's origins with `INSERT OR IGNORE` in the same transaction as the grants.
`InstalledPackage` gains `origins: string[]`.

### Operations

`packages/contracts/src/widget-gateway.ts`:

```ts
'http.get':  { permission: 'network', confirm: 'never' },
'http.send': { permission: 'network', confirm: 'optional' },

interface HttpGetInput  { url: string; headers?: { accept?: string } }
interface HttpSendInput { url: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
                          headers?: { accept?: string; 'content-type'?: string }; body?: string }
interface HttpOutput    { status: number; contentType: string | null; body: string }
```

Input validation (host broker and API, as for the other operations):

- `url` is an absolute `http:` or `https:` URL of at most 2048 characters without credentials;
- header names are lower-case and only `accept` and `content-type`; values at most 200 characters,
  no control characters;
- `body` is a string of at most 64 KB (UTF-8); `http.get` has no body and no `method`;
- unknown keys are rejected.

API handler (`apps/api/src/widget-gateway.ts`, handler gets the origins through `GatewayContext`):

1. `new URL(url).origin` must be in both the manifest `network` of the instance's package version and
   `widget_network_origins` of the package; otherwise `PERMISSION_DENIED`. Built-in widgets have no
   origins.
2. `fetch(url, { method, headers, body, redirect: 'manual', credentials: 'omit',
   signal: AbortSignal.timeout(8000) })`. Node sets `host`; no `origin`, `cookie` or `authorization`
   header is ever sent.
3. The response body is read as text up to 100 KB; a longer body aborts the read.
4. Answer `{ status, contentType, body }`.
5. Connection failure, timeout or an oversized body is the new API error `UPSTREAM_ERROR` (502) with a
   message naming the cause; the host broker maps it to widget code `UNAVAILABLE` with that message.

Rate limits: `http.get` 120 per minute, `http.send` 60 per minute, per widget session as for the other
operations. The audit row records op, origin, method and upstream status or error code; never the URL
path, query or bodies.

The 100 KB response cap keeps a whole answer inside `BRIDGE_LIMITS.maxMessageBytes` (128 KB). The 8 s
timeout stays under `requestTimeoutMs` (10 s) for `http.get`; `http.send` uses `confirmTimeoutMs`.

Known limit: a listed hostname is resolved at request time, so DNS for that name decides the address.
Listing IP literals (as Hermes Tasks does) avoids this.

### UI

- `PackagesDialog.vue`: label `network: 'Доступ к сети'` and the list of origins under it, both for a
  new install (`newOrigins`) and for an installed package (`origins`).
- `ConfirmDialog.vue`: `http.send` asks «Отправить запрос: PATCH http://127.0.0.1:8787/api/v1/tasks/…»
  with the method and the URL; the body is not shown.
- `broker.ts`: validates the new inputs and maps `UPSTREAM_ERROR`.

### SDK

`widget.call('http.get' | 'http.send', input)` is typed by the contract types. README «Widget SDK» lists
the new operations and the `network` field.

### Tests (Vitest)

- contracts: origin validation and normalization, `network`/permission consistency, input parsers for
  both operations;
- API gateway against a local `node:http` test server: allowed origin passes, unlisted or unapproved
  origin is `PERMISSION_DENIED`, a 302 is returned unfollowed, timeout and oversized body give
  `UPSTREAM_ERROR`, forbidden headers are rejected, `http.send` needs confirmation in `ask` mode;
- install: origins are stored; a new version with a new origin lists it in `newOrigins`.

## Part 2. Hermes Tasks widget

### Package

`examples/widgets/hermes-tasks/`:

```text
widget.json      id dev.lifedashboard.hermes-tasks, permissions state + network,
                 network ["http://127.0.0.1:8787"], default 8×8, min 3×4, max 16×16
package.json     build: ld-widget build; test: vitest run
src/index.vue    root: layout switch, polling, toasts, banner
src/api.ts       Hermes Tasks client over widget.call
src/quick-add.ts quick-add parser
src/layout.ts    size → layout
src/*.vue        TaskList, TaskRow, DetailPanel, Rail, ViewTabs
test/*.test.ts   api, quick-add, layout
```

### Layout

- Width of at least 7 cells: **rail layout**. Left rail with views and tags (tag counts from
  `/workspace`), list on the right. The detail panel replaces the list column.
- Narrower: **stacked layout**. View tabs, a horizontally scrolling row of tag chips, the list. The detail
  panel slides in from the right over 82 % of the width.

### Views and filter

| View | Request |
| --- | --- |
| Сегодня | `GET /tasks?due=overdue` (group «Просрочено») and `GET /tasks?due=today` |
| Скоро | `GET /tasks?due=upcoming` |
| Входящие | `GET /tasks?projectId=inbox` |
| Все | `GET /tasks?status=open` |

A single selected tag adds `tags=<name>`. Lists use `limit=100`; «Показать ещё» follows `nextCursor`.
The selected view and tag persist in `widget.state`.

### Actions

- **Complete / skip** (skip only for recurring tasks): from the row and the panel. The row leaves the list
  at once; a toast «Выполнено · Вернуть» (or «Пропущено · Вернуть») for 5 s calls reopen.
- **Reschedule:** chips «Сегодня», «Завтра», «След. неделя» (next Monday), `<input type="date">` and an
  optional `<input type="time">`; `POST /occurrences/:id/reschedule` with `schedule` `date` or
  `datetime`.
- **Edit** in the detail panel: title, tags (chips, input with a `datalist` of existing tags), priority
  (none, low, medium, high), project (`<select>` from `GET /projects`), description. Each field saves on
  change or blur with `PATCH /tasks/:id` and `expectedVersion` = `taskVersion`. The recurrence rule shows
  read-only text when the task is recurring.
- **Quick add:** one input at the bottom of the list. `#tag` tokens become tags, the words «сегодня» and
  «завтра» set the date, the rest is the title. With no date word the date follows the view: Сегодня →
  today, Скоро → tomorrow, Входящие and Все → none. A selected tag is added. `POST /tasks`.

### Client (`api.ts`)

- Every call goes through `widget.call`; a non-2xx status or `ok: false` envelope becomes a typed error
  with the Hermes Tasks `code`.
- `workspaceEpoch` is taken from the latest `meta`; `today` from `/workspace`.
- One `idempotencyKey` per intention, made from `crypto.getRandomValues` (`randomUUID` needs a secure
  context, which an opaque-origin frame may not be). A retry after `UNAVAILABLE` or `503` reuses the key
  and the body.

### Refresh

Every 10 s while `context.visible` is true: `GET /workspace` and the current view's requests. Hidden
widgets do not poll; becoming visible refreshes at once. Every mutation refreshes after its answer.

### Errors

| Case | Behaviour |
| --- | --- |
| `VERSION_CONFLICT` | Re-read; toast «Задача изменилась в Hermes, данные обновлены» |
| `WORKSPACE_EPOCH_MISMATCH` | Re-read `/workspace`; toast that data may have been restored from a backup |
| Gateway `UNAVAILABLE`, status 503 | Banner «Hermes Tasks недоступен» with «Повторить»; a failed mutation keeps its key for the retry |
| Gateway `DECLINED` (`ask` mode, user refused) | The change is reverted in the UI, no toast |
| Gateway `RATE_LIMITED` | Skip polling for 30 s |
| Validation error from the service | Toast with the service message; the field keeps the user's input |

### Style

Only theme tokens (`--ld-*`), so Glass, Obsidian and Paper apply without changes. Panel and toast
motion use `--ld-duration-*` and `--ld-ease-*` and are disabled under `prefers-reduced-motion`. Priority
shows as the colour of the check circle (high `--ld-danger`, medium `--ld-warning`, low `--ld-info`).
Overdue dates use `--ld-danger-text`. Text is Russian. Controls are buttons and inputs with labels and
visible focus, usable from the keyboard.

### Tests

- Vitest: `api.ts` (envelope parsing, epoch tracking, key reuse on retry, conflict codes),
  `quick-add.ts`, `layout.ts`;
- manual acceptance in Orca's browser against the live Hermes Tasks: install, each view, tag filter,
  complete and undo, skip, reschedule, every edit field, quick add, a change made through Hermes
  appearing, the banner with the container stopped, both layouts, three themes.

## Out of scope

- Secrets and token substitution for HTTP requests.
- Streaming, binary bodies, response headers other than `content-type`.
- Counters for views in the rail (each would cost a request per refresh).
- Recurrence editing, archive and restore, project management, several tags at once, completed list.
- Configuring the Hermes Tasks address: changing it means rebuilding the widget with another origin.
