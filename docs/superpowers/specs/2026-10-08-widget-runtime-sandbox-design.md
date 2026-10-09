# Widget runtime: installable widget packages in a sandbox

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (ARCH-08, §4.1, §7.1, §7.7, §7.8, §13.3, §13.6, §18.1)
- **Builds on:** `docs/superpowers/specs/2026-10-05-db-storage-and-pairing-design.md`
- **Status:** approved design, 2026-10-08

## Goal

Widgets written by other developers (usually with AI help) run inside `widget__body` as ordinary
Vue code, isolated from the dashboard. Built-in widgets shipped with the app keep running
in-process. Both kinds use one SDK, `useWidget()`, and reach data only through a widget gateway in
Fastify that checks per-widget permissions.

Success:

- a developer builds a Vue SFC into a `*.ldwidget.json` package with one command;
- the user installs the package from a file after a permissions screen and places it on the board;
- an installed widget cannot read the dashboard's cookies, DOM or storage, cannot call the API
  directly, and cannot call a gateway operation it holds no grant for;
- an exception in an installed widget puts only its frame into `error`;
- the same `useWidget()` code works in a built-in widget and in an installed package.

## Delivery decomposition

The widget platform is delivered as four sub-projects, each with its own spec, plan and
implementation:

| Sub-project | Delivers |
| --- | --- |
| 1 (this spec) | Package format, install flow, `useWidget()` SDK, in-process and sandbox hosts, RPC bridge, theme and size, minimal gateway slice (`state`, `notifications`) |
| 2 | Gateway operations: data sources, `http.get` through the proxy (§7.8), secret substitution |
| 3 | Admin: grants, secrets, revocation, audit log view |
| 4 | Developer experience: project template, hot reload on the board, Hermes-generated packages |

## Brief

Stated by the user:

- base widgets are shipped by the product owner; other developers write their own widgets with AI;
- `widget__body` is filled with executable, isolated code;
- widgets reach APIs through a shared gateway; access and tokens are managed in a Fastify-side admin;
- packages are exchanged between people as files (no central catalog);
- the dashboard will be packaged with Tauri; widgets may ask for system notifications.

Agreed in the design dialogue:

- hybrid runtime: in-process only for widgets compiled into the app build; every installed package,
  including the owner's own, runs in a sandbox;
- the sandbox is an iframe document served by Fastify (option A), not `srcdoc` and not Worker +
  remote-dom;
- a package is one JSON file; no zip dependency.

## Research summary

Perplexity research (2026-10-08) on Module Federation 2.0, Vue custom elements, sandboxed iframes,
ShadowRealm, SES, QuickJS-WASM, Worker + remote-dom and MCP Apps (SEP-1865):

- Module Federation and Shadow DOM are delivery and style-encapsulation tools; federated or
  custom-element code runs with full page authority.
- A sandboxed iframe without `allow-same-origin` has an opaque origin: no access to the host's DOM,
  cookies or storage. CSP in the frame document restricts its network. MCP Apps, VS Code webviews and
  the UI part of Figma plugins use this model with a `postMessage` / `MessagePort` bridge.
- No option except Worker or QuickJS isolation can stop an infinite loop; both break ordinary Vue
  and DOM libraries. ShadowRealm is Stage 2.7 and not a usable baseline.
- Keeping tokens on the server is not enough: the gateway must authorize each operation against a
  host-bound widget identity, never against an id the widget sends.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Trust boundary | In-process only for widgets in the app build; installed packages always sandboxed | No trust flag, no signing; one wrong click cannot hand Tauri IPC to foreign code |
| Sandbox | `<iframe sandbox="allow-scripts">` loading a Fastify-served document per package version | Opaque origin; CSP as an HTTP header; cacheable, debuggable documents |
| Sandbox document scope | One document per package version (`/sandbox/packages/<hash>/`), no instance data inside | Config, theme and size arrive over the port; the document needs no cookie and can be served with `Access-Control-Allow-Origin: *` |
| Bridge | Handshake checked by `event.source`, then a transferred `MessagePort` | The only identity check that works for an opaque origin; no global listener after bootstrap |
| Widget identity | Host-created widget session bound to the dashboard session, instance, package version and grants | The widget never states who it is |
| Package format | One `*.ldwidget.json` file with a manifest and text files | No archive dependency; validated by hand-written code like `contracts/board.ts` |
| Package storage | SQLite only, files keyed by sha256 | Backups already cover them; no filesystem layout |
| Grants | Per package, from manifest permissions accepted at install | A new version with new permissions shows the permissions screen again |
| SDK shape | All methods async in both hosts | A widget moves between in-process and sandbox without changes |
| Vue runtime in sandbox | `vue/dist/vue.runtime.esm-browser.prod.js` from the lockfile version, mapped by import map | One Vue version; packages build with `vue` external |
| Notifications | Gateway authorizes, host displays (toast in web mode; Tauri plugin at E7) | The widget gets no native API |

## Deviations from the base design

| Base design | This spec | Why |
| --- | --- | --- |
| ARCH-08, §13.6: custom `component` widgets run in-process without isolation as an accepted risk | Installed packages run in a sandboxed iframe; only build-time widgets run in-process | §13.6 names widget exchange between people as the trigger for isolation; exchange is now a requirement |
| §7.7: Fastify compiles generated SFC with `vue/compiler-sfc` at save time | Developers build packages with `ld-widget build`; Fastify validates and stores built files | Server-side compilation needs a bundler for imports and CSS; the sandbox makes runtime trust independent of who compiled |
| §7.7: `hermes.ask`, `http.get`, `data.query` in the SDK | `w.call(op, input)` for gateway operations; this slice ships `state` and `notifications` only | Data, HTTP and Hermes operations come with sub-project 2 |
| §4.1: `widget-sdk` appears at E6 | Created now | Both hosts need it |
| §7.1: package widgets are `custom` definitions with `kind: declarative \| component` | Adds `WidgetSource { kind: 'package' }`; declarative definitions are unchanged and not built here | Packages and declarative definitions are separate sources |

The base design is edited as a plan task: ARCH-08 and §13.6 point to this spec and keep the residual
risk (hang); §7.7 describes packages; §13.3 permission rows change; the isolation item leaves §18.1;
§4.1 drops the E6 note on `widget-sdk`.

## Package format

File `*.ldwidget.json`, at most 1 MB:

```jsonc
{
  "format": 1,
  "manifest": {
    "id": "dev.alex.pomodoro",
    "version": "1.2.0",
    "title": "Pomodoro",
    "author": "alex",
    "sdk": 1,
    "entry": "index.js",
    "styles": ["style.css"],
    "sizing": { "default": { "w": 3, "h": 3 }, "min": { "w": 2, "h": 2 }, "max": { "w": 6, "h": 6 } },
    "permissions": ["state", "notifications"]
  },
  "files": { "index.js": "…", "style.css": "…" }
}
```

Validation rules (`packages/contracts/src/widget-package.ts`):

- unknown top-level or manifest fields are rejected;
- `format` is `1`; `sdk` is a supported major version (`1`);
- `id` matches `^[a-z0-9]+(\.[a-z0-9-]+)+$`, at most 100 characters;
- `version` matches `^\d+\.\d+\.\d+$`;
- `title` 1–60 characters, `author` 1–60 characters, plain text;
- `sizing` follows the existing grid contract (`packages/contracts/src/grid.ts`): `min ≤ default ≤ max`, all within the 12×8 grid;
- `permissions` is a subset of the closed list `state`, `notifications`, without duplicates;
- file names match `^[a-z0-9][a-z0-9._-]*$` (flat, no directories, no `..`); at most 20 files;
- `entry` exists and ends with `.js`; every `styles` item exists and ends with `.css`;
- files are strings; other extensions are not allowed in format 1 (images go in as `data:` URIs inside JS or CSS);
- the whole file is at most 1 MB.

The package hash is sha256 over a canonical serialization of `manifest` and `files`
(`node:crypto`). SDK version 1 means the Vue 3.5 runtime and the `useWidget()` contract below.

Format 1 has no `configSchema`: package instances keep `config: {}` until an instance settings UI
exists.

## Data

Migration 2:

```sql
CREATE TABLE widget_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE widget_package_versions (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL,
  files TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version)
);

CREATE TABLE widget_grants (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (package_id, permission)
);

ALTER TABLE widgets ADD COLUMN source_version TEXT;

CREATE TABLE widget_state (
  widget_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE widget_audit (
  at TEXT NOT NULL,
  widget_id TEXT NOT NULL,
  package_id TEXT,
  op TEXT NOT NULL,
  outcome TEXT NOT NULL
);
```

- A package widget row has `source_kind = 'package'`, `source_type = <package id>`,
  `source_version = <version>`; built-in rows keep `source_version` NULL.
- A version is immutable: installing an existing `(id, version)` with a different hash is rejected;
  with the same hash it is a no-op.
- `PUT /rooms/:roomId/board` rejects a package widget whose `(id, version)` is not installed.
- A package with placed widgets cannot be deleted (`409 PACKAGE_IN_USE`).
- `widget_state` has no foreign key: a board save deletes and re-inserts the room's widget rows, so
  a cascade would erase state on every save. The board save transaction instead deletes state rows
  whose `widget_id` no longer exists in `widgets`.
- `widget_audit` rows older than 30 days are deleted at API start.

## Contracts (`packages/contracts`)

- `board.ts`: `WidgetSource` becomes
  `{ kind: 'builtin'; type: string } | { kind: 'package'; packageId: string; version: string }`;
  board parsing accepts both.
- `widget-package.ts` (new): package and manifest types, `parseWidgetPackage()`, permission list,
  limits.
- `widget-gateway.ts` (new): operation names, input/output types and parsers for `state.get`,
  `state.set`, `notifications.send`; RPC message types shared by the host broker and the sandbox
  client.
- `builtin-widgets.ts` (new): the built-in widget manifests (`type`, `title`, `sizing`,
  `permissions`), moved from `apps/ui/app/widgets/catalog.ts`. The API reads grants for built-in
  widgets from here; the UI catalog re-exports it. One trusted list, no copy in each app.

## API

All routes live under `/api/v1`, use the existing session, Origin and Host checks, and the existing
error envelope.

| Route | Behavior |
| --- | --- |
| `POST /widget-packages/inspect` | Validate a package body; return manifest summary, hash, new permissions relative to current grants, and whether this version is already installed. Writes nothing |
| `POST /widget-packages` | Validate again, store package, version and grants in one transaction; return the summary |
| `GET /widget-packages` | Installed packages with versions and grants |
| `DELETE /widget-packages/:id` | Delete a package with all versions and grants; `409 PACKAGE_IN_USE` if placed |
| `POST /widget-sessions` | Body `{ widgetId }`; resolve the saved widget, its source and grants; return `{ widgetSession, grants }`. Unknown widget, unknown built-in type or uninstalled package version → `404` |
| `DELETE /widget-sessions/:widgetSession` | End a session (host unmount) |
| `POST /widget-gateway/:op` | Header `x-widget-session`; body is the operation input |

Package bodies use the same JSON content type rule as other routes; the body limit for package
routes is 1 MB.

### Widget sessions

- In memory, random 32-byte tokens; lost on API restart.
- Bound to the dashboard session token hash that created them; a gateway call must carry the same
  dashboard cookie.
- Idle expiry 1 hour, renewed on use; at most 200 live sessions, the oldest is evicted.
- Built-in widgets get sessions too; their grants come from `contracts/builtin-widgets.ts`, without
  an install screen.
- An expired widget session is not a lost dashboard session. The API answers
  `401 SESSION_EXPIRED`; `apps/ui/app/api.ts` maps that code to its own failure kind, so it never
  sends the app to pairing. A session failure happens before the operation runs, so the broker
  creates a new session once and repeats the call; if that fails too, only the widget frame shows
  `error` with «Повторить», which recreates the session and the bridge.

### Gateway pipeline

For each `POST /widget-gateway/:op`:

1. Authenticate the dashboard session (existing hook).
2. Resolve `x-widget-session`; missing, unknown or bound to another dashboard session →
   `401 SESSION_EXPIRED`.
3. Look up `op`; unknown → `404 UNKNOWN_OP`.
4. Check the operation's permission in the session grants → `403 PERMISSION_DENIED`.
5. Parse the input with the operation parser → `400 INVALID_INPUT`.
6. Apply the rate limit for `(widgetId, op)` → `429 RATE_LIMITED`. Counters are in memory and keyed
   by widget, not session, so a new session does not reset them.
7. Execute with context `{ widgetId, packageId, grants }`.
8. Append an audit row with outcome `ok` or the error code. Calls rejected at step 2 have no trusted
   widget identity and are not audited.

Operations in this slice:

| op | Permission | Input | Behavior | Limit |
| --- | --- | --- | --- | --- |
| `state.get` | `state` | `{}` | Return `{ data, revision }`; `{ data: null, revision: 0 }` when nothing is stored | 120/min |
| `state.set` | `state` | `{ data, expectedRevision }` | Store JSON, at most 64 KB serialized, when `expectedRevision` equals the stored revision (0 for none); return `{ revision }`. Otherwise `409 CONFLICT` (DATA-06) | 60/min |
| `notifications.send` | `notifications` | `{ title, body }` | Plain text; title 1–80, body 0–300 characters; returns `{ ok: true }`; the host displays it | 10/hour |

Handlers receive the context object so sub-project 2 adds a secret resolver without changing the
pipeline.

### Operation confirmation

A gateway operation can also require the user's confirmation of the exact call: `GATEWAY_OPS` gives
each op a `confirm` policy and each package grant has a mode (`allow` / `ask`). The pipeline then issues
and checks a single-use, input-bound confirmation id, and the host asks the user in a dialog outside the
frame. See `docs/superpowers/specs/2026-10-09-widget-op-confirmation-design.md`.

## Sandbox serving

Routes outside `/api` (the session cookie has `Path=/api`, so these requests carry no session):

| Route | Content |
| --- | --- |
| `GET /sandbox/runtime/vue.js` | `vue/dist/vue.runtime.esm-browser.prod.js` from the API's `vue` dependency |
| `GET /sandbox/runtime/sdk.js` | Sandbox build of `@lifedashboard/widget-sdk` (bootstrap + RPC client + `useWidget`) |
| `GET /sandbox/packages/:hash/` | Sandbox HTML document for that package version |
| `GET /sandbox/packages/:hash/:file` | A package file with its content type |

Rules:

- Host header is checked as for the API; requests with `Origin: null` are allowed on these GET
  routes.
- All responses carry `Access-Control-Allow-Origin: *` (module scripts from an opaque origin are
  CORS requests) and `X-Content-Type-Options: nosniff`.
- Package files and the document are `Cache-Control: public, max-age=31536000, immutable`; runtime
  files are cached by the SDK version path segment or served `no-cache`.
- The document contains no instance or user data.

Document:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script type="importmap">{ "imports": {
    "vue": "<base>/sandbox/runtime/vue.js",
    "@lifedashboard/widget-sdk": "<base>/sandbox/runtime/sdk.js",
    "@lifedashboard/widget-entry": "<base>/sandbox/packages/<hash>/<manifest.entry>"
  } }</script>
  <link rel="stylesheet" href="<base>/sandbox/packages/<hash>/<manifest.styles[i]>">
  <script type="module" src="<base>/sandbox/runtime/sdk.js"></script>
</head>
<body><div id="app"></div></body>
</html>
```

`<base>` is the scheme and validated Host of the request. The document has one `<link>` per
`styles` entry (none when the list is empty). CSP header:

```text
default-src 'none';
script-src <base>/sandbox/runtime/ <base>/sandbox/packages/<hash>/ 'sha256-<importmap hash>';
style-src <base>/sandbox/packages/<hash>/ 'unsafe-inline';
img-src data:;
connect-src 'none';
font-src 'none';
frame-src 'none';
worker-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none'
```

Sources are explicit URLs, not `'self'`, because `'self'` handling differs for opaque-origin
documents across engines.

The Nuxt dev proxy adds `/sandbox` next to `/api` and `/health`.

## SDK (`packages/widget-sdk`)

A package's entry module exports a Vue component as `default`. The runtime mounts it; the widget
does not call `createApp`.

```ts
interface WidgetContext {
  size: { w: number; h: number }
  sizeClass: 'xs' | 's' | 'm' | 'l' | 'xl'
  theme: { id: string; scheme: 'light' | 'dark'; tokens: Record<string, string> }
  rootFontSize: number                             // px of the dashboard's html font-size
  config: Record<string, unknown>
  locale: string
  visible: boolean
}

interface Widget {
  context: Readonly<WidgetContext>                 // reactive
  state: {
    get<T>(): Promise<{ data: T | null; revision: number }>
    set(data: unknown, expectedRevision: number): Promise<{ revision: number }>  // CONFLICT on a stale revision
  }
  notify(message: { title: string; body?: string }): Promise<void>
  call<T>(op: string, input: unknown): Promise<T>  // other gateway operations
}

function useWidget(): Widget                        // inject; throws outside a widget host
```

Errors reject with `WidgetError { code }`, using the gateway codes plus `TIMEOUT` and
`BRIDGE_CLOSED`.

The package exports:

- `useWidget` and types (for widget code, resolved to `/sandbox/runtime/sdk.js` in the sandbox);
- `provideInProcessWidget(app or component scope, deps)` used by `WidgetHost` for built-in widgets;
- the sandbox bootstrap, built as `dist/sandbox.js`;
- the `ld-widget` CLI.

`sizeClass` thresholds reuse the base design's `xs | s | m | l | xl` rule; the plan fixes the exact
cell thresholds in one function shared by both hosts.

### In-process host (built-in widgets)

`WidgetHost.vue` gets `widgetId` and `config` props next to `source`, `size` and `themeId`;
`WidgetBoard.vue` passes them for placed widgets. With a `widgetId`, the host creates a widget
session and provides a `Widget` whose `state`, `notify` and `call` go through the same broker client
as the sandbox, with `context` from props. Built-in widgets keep inherited theme CSS and the UnoCSS
vocabulary.

The build draft (the selected rectangle before «Готово») has no saved widget and no `widgetId`. It
renders a static card with the widget title for both kinds, without a session or a sandbox. The
runtime starts after the board save succeeds.

### Sandbox host (package widgets)

`SandboxWidget.vue` inside `widget__body`:

1. Creates a widget session (`POST /widget-sessions`).
2. Renders `<iframe sandbox="allow-scripts" src="/sandbox/packages/<hash>/" title="<widget title>">`
   filling the body, with a transparent background.
3. Shows `loading` until the handshake; no `hello` within 10 s → `error`.
4. On unmount or restart: closes the port, deletes the session, removes the iframe.

## RPC bridge

1. Sandbox bootstrap sends `parent.postMessage({ t: 'ld:hello', sdk: 1 }, '*')`.
2. The host's single bootstrap listener accepts it only when `event.source` is a known widget
   iframe's `contentWindow` and that iframe has not completed a handshake. It creates a
   `MessageChannel` and posts `{ t: 'ld:init', context }` with `port2` to that window.
3. All further traffic uses the port:
   - request `{ t: 'req', id, op, input }` → response `{ t: 'res', id, ok: true, value }` or
     `{ t: 'res', id, ok: false, error: { code, message } }`;
   - host push `{ t: 'context', patch }` on resize, theme change and visibility change;
   - sandbox report `{ t: 'error', message }` from `app.config.errorHandler`, `onerror` and
     `onunhandledrejection`.
4. Limits on the host side: message at most 128 KB serialized (state data is capped at 64 KB, so
   the envelope always fits); at most 16 requests in flight per
   widget (`RATE_LIMITED`); 10 s timeout per request (`TIMEOUT`); malformed messages are dropped
   and counted, and 20 malformed messages close the bridge.
5. The host broker validates `op` and input with the shared contracts before calling the API; the
   API validates again.
6. A second `load` event of the iframe (the frame navigated itself) tears the frame down and shows
   `error`. It is not audited in this slice: the API has no host-event route.

## Theme and size

- The host sends `context.theme.tokens`: the resolved CSS custom properties of the theme contract
  (`docs/theme-contract.md`) for the widget's resolved theme id. The bootstrap sets them on the
  document root with `style.setProperty` and sets `color-scheme`; the document background is
  transparent so the frame skin shows through.
- A frame does not inherit the dashboard's viewport-scaled `html { font-size }` (`app.vue`). The host
  sends the computed value as `context.rootFontSize` and pushes it again on window resize; the
  bootstrap sets it on the frame's root, so `rem` in a package matches the board (§7.4).
- Package CSS uses the `var(--…)` tokens; the UnoCSS vocabulary is not available in the sandbox.
- The board owns the size. The iframe fills `widget__body`; the widget reads cell size from
  `context.size`, pixels from its own viewport and container queries. There is no resize request.
- During drag and resize in edit mode, the iframes get `pointer-events: none`.

## UI flow

- Header gets «Виджеты»: a dialog listing installed packages (title, author, versions, grants) with
  «Удалить» and «Установить из файла».
- «Установить из файла» reads the file, calls `inspect` and shows the permissions screen: title,
  author, version, size limits, each permission in plain language, the warning «Это код стороннего
  автора», and the new permissions when updating. «Установить» calls `POST /widget-packages`.
- The «Добавить виджет» picker lists built-in widgets and the latest installed version of each
  package. A placed package widget stays on its version.
- `notify` shows a toast with the widget title as its source label.

## Security notes

- The iframe never gets `allow-same-origin`, `allow-top-navigation*`, `allow-popups`,
  `allow-forms` or `allow-downloads`.
- The widget session token stays in the host broker; the frame never sees it.
- A request from the frame to `/api` carries `Origin: null` and no `SameSite=Strict` cookie, and
  `connect-src 'none'` blocks it before that.
- Package files are public on the loopback listener by hash. They contain code, not user data.
- **Residual risks (documented in the base design §13.6):**
  - an infinite loop or heavy computation in a frame can freeze the dashboard when the WebView runs
    the frame in the same process;
  - a frame can navigate itself once to an external URL and leak data it holds; the host detects
    the second `load` and removes the frame, but the request has left. In this slice a widget holds
    only its own state and config.
- **Tauri (E7, required check):** guest frames must not reach Tauri IPC. The E7 plan verifies
  `invoke` is unavailable from a package frame on macOS and Windows and that app capabilities are
  scoped to the main window.

## Structure

| File | Responsibility |
| --- | --- |
| `pnpm-workspace.yaml` | Add `examples/widgets/*` |
| `packages/contracts/src/board.ts` | `WidgetSource` union, parsing |
| `packages/contracts/src/widget-package.ts` (new) | Package format, limits, `parseWidgetPackage()` |
| `packages/contracts/src/widget-gateway.ts` (new) | Operations, inputs, RPC message types |
| `packages/contracts/src/builtin-widgets.ts` (new) | Built-in manifests with `permissions`, shared by API and UI |
| `packages/widget-sdk/` (new) | `useWidget`, in-process adapter, broker client, sandbox bootstrap, `ld-widget` CLI |
| `apps/api/src/migrations.ts` | Migration 2 |
| `apps/api/src/widget-packages.ts` (new) | Inspect, install, list, delete |
| `apps/api/src/widget-gateway.ts` (new) | Widget sessions, gateway pipeline, `state`, `notifications`, audit |
| `apps/api/src/sandbox.ts` (new) | `/sandbox/*` routes, document and CSP |
| `apps/api/src/rooms.ts` | Accept and check package widget sources |
| `apps/api/src/app.ts` | Register the new modules |
| `apps/ui/nuxt.config.ts` | `/sandbox` dev proxy |
| `apps/ui/app/widgets/WidgetHost.vue` | `widgetId`/`config` props, session, in-process provider, sandbox branch, static draft card |
| `apps/ui/app/board/WidgetBoard.vue` | Pass `widgetId` and `config`; iframe `pointer-events` during edit |
| `apps/ui/app/api.ts` | Map `SESSION_EXPIRED` to its own failure kind, not `unauthorized` |
| `apps/ui/app/widgets/SandboxWidget.vue` (new) | Iframe lifecycle and states |
| `apps/ui/app/widgets/broker.ts` (new) | Handshake, port, limits, API calls |
| `apps/ui/app/widgets/PackagesDialog.vue` (new) | Installed list, install with permissions screen, delete |
| `apps/ui/app/widgets/catalog.ts` | Re-export built-in manifests from contracts; picker includes packages |
| `examples/widgets/hello/` (new) | Example package: counter in `state`, «Напомнить» button with `notify` |
| `examples/widgets/hostile/` (new) | Test package that probes the sandbox boundary |
| `docs/base-2026-10-04-lifegamehermes-design.md` | Edits listed in Deviations |
| `README.md` | Building and installing a widget package |

New dependencies (approved with this spec):

- `vite` and `@vitejs/plugin-vue` as direct devDependencies of `packages/widget-sdk`, pinned to the
  versions Nuxt already resolves in the lockfile;
- `vue` as a dependency of `apps/api` (same version as `apps/ui`) to serve the runtime file.

### `ld-widget build`

Run in a widget project directory containing `widget.json` (the manifest without `files`) and
`src/index.vue`:

1. Vite library build, ES format, entry `src/index.vue`, `vue` and `@lifedashboard/widget-sdk`
   external, CSS extracted to `style.css`.
2. Read the outputs, assemble `{ format: 1, manifest, files }`, validate with
   `parseWidgetPackage()`.
3. Write `dist/<id>-<version>.ldwidget.json`.

## Testing

Vitest, following existing conventions:

- `contracts`: every package validation rule; board parsing of both source kinds; gateway input
  parsers.
- `api` (`inject`):
  - migration 1 → 2 on a database with saved widgets and sessions: the backup stays at version 1,
    widgets and sessions survive, built-in rows get `source_version` NULL, a second start changes
    nothing;
  - inspect writes nothing; install stores version, hash and grants; repeat install of the same
    hash is a no-op; same version with another hash is rejected; delete with placed widgets returns
    `409`;
  - a package whose `entry` is `main.js` (no `index.js`) installs and its document maps
    `main.js`;
  - board save rejects an uninstalled package version;
  - `state` survives a board save that keeps the widget and is removed by a save that drops it;
  - sandbox routes: CSP header content, import map hash, `Access-Control-Allow-Origin`, Host check,
    `Origin: null` accepted, document has no user data, unknown hash returns `404`;
  - widget sessions: unknown widget, unknown built-in type, binding to the dashboard session, idle
    expiry, eviction; built-in grants come from `builtin-widgets.ts`;
  - gateway pipeline: no cookie `401`, foreign or expired widget session `401 SESSION_EXPIRED`,
    unknown op, missing grant `403`, invalid input `400`, rate limit `429`, audit rows for success
    and failure after step 2, no audit row for a rejected session;
  - `state` at exactly 64 KB is stored and read back, 64 KB + 1 is rejected; a stale
    `expectedRevision` gets `409 CONFLICT`;
  - `notifications` text limits; the hourly limit holds across a new widget session for the same
    widget.
- `widget-sdk` and `ui`:
  - broker with `MessageChannel`: rejects `hello` from an unknown source and a second handshake,
    enforces message size, in-flight cap, timeout, malformed-message cutoff, `UNKNOWN_OP`; a
    64 KB `state.set` passes the bridge; on `SESSION_EXPIRED` it creates a new session once and
    repeats the call, and a second failure reports `error` without pairing;
  - `api.ts` maps `401 SESSION_EXPIRED` apart from `unauthorized`;
  - in-process adapter and sandbox client expose the same `Widget` contract (one shared test
    suite run against both).

Browser acceptance in Orca's built-in browser through `orca-cli`:

- build `examples/widgets/hello` → install with the permissions screen → place → counter survives a
  reload → «Напомнить» shows a toast;
- install `examples/widgets/hostile`, which tries `document.cookie`, `parent.document`,
  `localStorage`, `fetch('/api/v1/rooms')`, a gateway op without a grant, a thrown exception, and a
  self-navigation; expected: empty cookie, access errors, CSP block, `PERMISSION_DENIED`, `error`
  only in its frame, frame removed after navigation; the board and other widgets keep working;
- at 1280×700 and 1920×1080 the `hello` widget's `rem` text matches a built-in widget's scale;
- the build draft of a package widget shows the static title card; the frame starts after «Готово».

## Acceptance criteria

1. `ld-widget build` in `examples/widgets/hello` produces a valid `*.ldwidget.json`.
2. Installing shows the permissions screen; the installed package survives an API restart.
3. A placed package widget renders in its frame with the current theme and `rem` scale and updates on
   theme change, resize and window resize.
4. `state` survives a page reload and an API restart, and a stale write from a second tab gets a
   conflict; `notify` shows a toast labeled with the widget title; an API restart does not send the
   app to pairing.
5. The hostile package gets no cookie, DOM, storage or direct API access, gets `PERMISSION_DENIED`
   for an ungranted op, and its failures affect only its own frame.
6. A built-in widget uses `useWidget()` through the in-process host with the same contract.
7. A package with placed widgets cannot be deleted; an unplaced one can.
8. `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
9. README describes building and installing a package; the base design reflects the deviations.

## Out of scope

- Admin UI, secrets, grant revocation, audit log view (sub-project 3).
- Data sources, `http.get`, Hermes operations (sub-project 2).
- Project template, hot reload, Hermes generation of packages (sub-project 4).
- Switching a placed widget to another installed version; instance config UI and `configSchema`.
- Package signing, install from URL or git, a catalog.
- Worker or QuickJS execution, hang protection.
- Tauri notification plugin and the Tauri IPC check (E7); background or scheduled notifications.
- MCP Apps compatibility.
- Serving the built UI from Fastify in production.
