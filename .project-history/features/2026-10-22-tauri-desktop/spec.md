# Tauri desktop wrapper for macOS (local trial build)

- **Builds on:** `docs/superpowers/specs/2026-10-10-widget-package-v2-design.md` (folder install,
  sandbox serving), `.project-history/features/2026-10-09-go-3-step-1-db-storage-and-pairing/spec.md`
  (pairing, data directory)
- **Status:** approved design, 2026-10-11

## Goal

LifeDashboard installs on the developer's own Mac as a regular `.app` and runs without a terminal,
so the existing widgets can be tried in a desktop window:

- one build command produces `LifeDashboard.app` and a `.dmg`;
- the app starts from `/Applications` by double click, shows the pairing code in a native dialog
  and then the same board UI as the web version;
- installable widgets install through «Выбрать папку» and by dropping a folder, render in the
  sandbox and keep their state across restarts.

Success: the manual acceptance checklist in [Acceptance criteria](#acceptance-criteria) passes in
the Tauri window on this Mac.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Audience | Local trial build for the developer's Mac: arm64 only, ad-hoc signed, no notarization | Distribution (Developer ID, notarization, universal binary) is a separate task |
| Origin | The window loads `http://127.0.0.1:3101/`; Fastify serves the generated UI | One origin keeps the `SameSite=Strict; Path=/api` session cookie, the Host/Origin allowlists, relative `fetch('/api/v1…')` and relative sandbox iframe URLs unchanged. A `tauri://` origin would break auth in several places |
| Port | Fixed `3101` | A random port changes the origin and resets WebKit localStorage on every launch; `3101` does not collide with the dev API (`3001`) |
| API runtime | Node 24 arm64 binary shipped as a Tauri sidecar (`externalBin`) | Works when started from Finder (no nvm `PATH`); same API code as dev |
| API packaging | The API is bundled into one ESM file with Vite 8 (rolldown) | `@lifedashboard/contracts` exports `.ts` sources; Node refuses type stripping under `node_modules`, so a copied `node_modules` would not start |
| Data directory | `~/Library/Application Support/LifeDashboard Desktop`, separate from dev | `db.ts` assumes one process owns the database; a newer dev schema would stop the app. The user reinstalls widgets in the app |
| Pairing | The wrapper reads the code from the API's stdout and shows it in a native dialog | Security model unchanged |
| Pairing at start | The API issues a code at start only when no unexpired session exists | Otherwise the desktop app shows the dialog on every launch |
| Static UI serving | Small handler in the API, no `@fastify/static` | Reuses the file-serving pattern and path guards already in `apps/api` |
| Child process | `std::process::Command`, no `tauri-plugin-shell` | The sidecar path is known; the page needs no shell access |
| Shutdown signal | `/bin/kill -TERM <pid>` | `std::process::Child::kill` sends SIGKILL; avoids a `libc`/`nix` dependency |
| Dev loop | No `tauri dev` | UI and API keep developing through `pnpm dev`; the wrapper is only built |

## New dependencies

Approved with this spec:

- npm: `@tauri-apps/cli` (devDependency of `apps/desktop`); `vite` `8.3.2` (devDependency of
  `apps/api`, the version already in the lockfile).
- Rust: `tauri`, `tauri-build`, `tauri-plugin-dialog` (Tauri 2.x; exact versions are picked from a
  live source when the plan is written).

Nothing else. Adding any other crate or package needs a new approval.

## App layout

```text
LifeDashboard.app/Contents
├── MacOS/lifedashboard          Rust wrapper (Tauri), one window
├── MacOS/node                   Node 24 arm64 sidecar
└── Resources/
    ├── api/server.mjs           bundled API
    ├── api/runtime/vue.js       vue.runtime.esm-browser.prod.js
    ├── api/runtime/sdk.js       packages/widget-sdk/dist/sandbox.js
    └── ui/                      apps/ui/.output/public
```

Exact resource paths follow Tauri's `bundle.resources` mapping; the wrapper resolves them with
`app.path().resource_dir()`.

## API changes (`apps/api`)

Development behavior does not change unless noted.

### Configuration (`config.ts`)

`ApiConfig` gains two optional fields:

| Variable | Field | Rule |
| --- | --- | --- |
| `LIFEDASHBOARD_UI_DIR` | `uiDir?: string` | Absolute path, else startup error `Invalid LIFEDASHBOARD_UI_DIR` |
| `LIFEDASHBOARD_RUNTIME_DIR` | `runtimeDir?: string` | Absolute path, else startup error `Invalid LIFEDASHBOARD_RUNTIME_DIR` |

Unset means the current behavior.

### Static UI (`ui-static.ts`, registered in `app.ts` only when `uiDir` is set)

- Handles `GET` and `HEAD` for every path except `/api/*`, `/sandbox/*` and `/health`.
- Applies the same Host allowlist as `auth.ts` (`allowedHosts`); a foreign Host gets `403 FORBIDDEN`.
- Resolves the path inside `uiDir` with the existing `resolveInside` guard; `..`, encoded traversal
  and absolute paths never leave `uiDir`.
- An existing regular file is served with its content type and `x-content-type-options: nosniff`.
  Files under `/_nuxt/` get `cache-control: public, max-age=31536000, immutable`; `index.html` gets
  `cache-control: no-cache`.
- A missing path without a file extension returns `index.html` (SPA fallback). A missing path with an
  extension returns `404 NOT_FOUND`.
- Content types come from a small map covering what `nuxt generate` emits (`html`, `js`, `mjs`,
  `css`, `json`, `svg`, `png`, `jpg`, `webp`, `ico`, `woff`, `woff2`, `txt`); reuse
  `SERVED_TYPES` from `@lifedashboard/contracts/widget-package` where it already covers a type.

### Sandbox runtime (`sandbox.ts`)

When `runtimeDir` is set, `/sandbox/runtime/vue.js` and `/sandbox/runtime/sdk.js` are read from
`<runtimeDir>/vue.js` and `<runtimeDir>/sdk.js` instead of `require.resolve`. The rest of the
sandbox serving stays the same.

### Pairing at start (`auth.ts`)

`registerAuth` issues the startup code only when the `sessions` table has no row with
`expires_at` later than `now()`. `POST /api/v1/auth/pair-code` and `POST /api/v1/auth/pair` keep
their behavior. Consequence in dev: a new browser without a cookie, while another session is valid,
needs «Новый код».

### Ready line (`server.ts`)

After `app.listen` resolves, `server.ts` prints `LifeDashboard API listening on
http://127.0.0.1:<port>` on its own stdout line. The desktop wrapper treats this line from its own
child as the readiness signal; a `/health` answer could come from another process that holds the
port.

### Bundle (`build:bundle` script)

- `vite build -c vite.bundle.config.ts`. The config file has its own name so Vitest does not pick
  it up.
- SSR build of `src/server.ts` with `ssr.noExternal: true`; Node built-ins stay external; target
  Node 24; output `apps/api/dist-bundle/server.mjs`.
- The script copies `vue/dist/vue.runtime.esm-browser.prod.js` to `dist-bundle/runtime/vue.js` and
  `packages/widget-sdk/dist/sandbox.js` to `dist-bundle/runtime/sdk.js`.
- `apps/api/dist-bundle/` is git-ignored.

## UI change (`apps/ui`)

`PairingForm.vue`:

- the field label «Код из терминала API» becomes «Код сопряжения»;
- «Новый код выведен в терминал API» becomes «Новый код выведен в терминал API или в окно
  приложения».

## Desktop package (`apps/desktop`)

```text
apps/desktop/
├── package.json             script `package` (not `build`/`dev`, see below)
├── scripts/prepare-node.mjs copies the Node binary for the sidecar
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── icons/               generated by `tauri icon` from icons/source.svg
    └── src/main.rs
```

The package has no `build`, `dev`, `typecheck` or `test` npm scripts: the root `pnpm build` would
recurse into `tauri build`, whose `beforeBuildCommand` runs the root build, and `pnpm dev` would
start it.

### Build (`pnpm -C apps/desktop package`)

1. `beforeBuildCommand`: root `pnpm build` (widget SDK `sandbox.js`, `nuxt generate`, API `tsc`),
   then `pnpm -C apps/api build:bundle`, then `node scripts/prepare-node.mjs`.
2. `prepare-node.mjs` fails with a clear message unless `process.version` is v24 and `process.arch`
   is `arm64`; then copies `process.execPath` to
   `src-tauri/binaries/node-aarch64-apple-darwin` (Tauri's target-triple naming).
3. `tauri build` writes `LifeDashboard.app` and `LifeDashboard_<version>_aarch64.dmg` to
   `src-tauri/target/release/bundle/`, ad-hoc signed (`bundle.macOS.signingIdentity: "-"`).
4. Install by dragging the app from the `.dmg` to `/Applications`. A locally built `.dmg` has no
   quarantine attribute, so Gatekeeper does not block it.

Git-ignored: `src-tauri/target/`, `src-tauri/binaries/`, `src-tauri/gen/`.

### `tauri.conf.json`

- `productName: "LifeDashboard"`, `identifier: "dev.lifedashboard.desktop"`, version `0.1.0`.
- `bundle.targets: ["app", "dmg"]`, `bundle.externalBin: ["binaries/node"]`, `bundle.resources`
  mapping `apps/api/dist-bundle` → `api/` and `apps/ui/.output/public` → `ui/`.
- No windows in the config; `main.rs` creates the window. No capabilities: the remote page gets no
  IPC access.

### Wrapper (`main.rs`)

1. Compute `dataDir = <path().data_dir()>/LifeDashboard Desktop`, create it and `dataDir/logs/`.
2. Spawn `<exe dir>/node <resources>/api/server.mjs` with stdout and stderr piped and env:
   `LIFEDASHBOARD_API_PORT=3101`, `LIFEDASHBOARD_DATA_DIR=<dataDir>`,
   `LIFEDASHBOARD_UI_ORIGINS=http://127.0.0.1:3101`, `LIFEDASHBOARD_UI_DIR=<resources>/ui`,
   `LIFEDASHBOARD_RUNTIME_DIR=<resources>/api/runtime`.
3. Two reader threads write every line to `dataDir/logs/api.log` (truncated per launch) and keep
   the last 20 lines in memory. A stdout line matching
   `LifeDashboard pairing code: <6 digits> (valid until <time>)` opens a dialog
   «Код сопряжения LifeDashboard: 123456 — действует до <time>».
4. Wait up to 15 s for the ready line (see [Ready line](#ready-line-serverts)) on the child's
   stdout. Then create the window: URL `http://127.0.0.1:3101/`, title `LifeDashboard`,
   size 1440×900, min width 1280, `drag_drop_enabled(false)` so HTML5 folder drops reach
   `PackagesDialog.vue`.
5. Closing the window or Cmd+Q exits the app. On exit: mark shutdown, `/bin/kill -TERM <pid>`, wait
   up to 5 s, then `Child::kill`.

The pairing-line and ready-line parsers are pure functions with unit tests.

### Errors

| Situation | Behavior |
| --- | --- |
| API exits or no ready line within 15 s (port busy, newer DB schema, bundle failure) | Error dialog with the last log lines and the log path; app exits |
| API exits while running and shutdown was not requested | Same dialog; app exits. No automatic restart |
| Second launch | macOS activates the running app; no single-instance plugin |

## Docs

- `README.md`: a «Desktop app (macOS, local build)» section with the build and install steps, the
  data directory and the log path; update the «Desktop app» row in «What works today» and the
  architecture note.
- `AGENTS.md`: add `apps/desktop` to the repository table and the `package` command.

## Testing

TDD for every behavior change: a failing test first.

Vitest (`apps/api/test`):

- `config`: both variables parse as absolute paths; relative values fail; unset keeps `undefined`.
- Static UI via `app.inject` with a temporary `uiDir`: `/` returns `index.html`; an asset returns the
  right content type and cache header; an unknown extensionless path falls back to `index.html`; an
  unknown `.js` path returns 404; `/api/v1/...`, `/sandbox/...` and `/health` are not shadowed;
  `/../`, `%2e%2e` traversal stays inside; a foreign Host gets 403; without `uiDir` `/` is 404.
- Sandbox runtime: with `runtimeDir` set, `/sandbox/runtime/sdk.js` returns the file from that
  directory.
- Pairing at start: no sessions → `onPairingCode` called once; an unexpired session → not called;
  only expired sessions → called; `pair-code` still issues a code.

Rust: `cargo test` for the pairing-line parser (valid line, wrong digit count, other log lines) and
the ready-line parser (exact line with port 3101, another port, other log lines).

Bundle smoke check (script, run during verification): start `node dist-bundle/server.mjs` with a
temporary data dir, `LIFEDASHBOARD_UI_DIR` and `LIFEDASHBOARD_RUNTIME_DIR`; expect the ready line on
stdout and `200` from `/health`, `/` and `/sandbox/runtime/sdk.js`; stop it.

Existing `pnpm typecheck` and `pnpm test` stay green.

## Acceptance criteria

Manual, in the Tauri window (WebKit; Orca's browser does not replace this check). Results go to
`outcome.md`; failed or skipped items are listed explicitly.

1. `pnpm -C apps/desktop package` produces the `.app` and `.dmg`.
2. Installed to `/Applications` and started from Finder: the pairing dialog appears; pairing works.
3. Restart: no pairing dialog; the board is there.
4. Add the built-in clock, move and resize it; the layout survives a restart.
5. «Выбрать папку» opens a folder picker; `examples/widgets/hello` built folder installs.
6. Remove the package and install it again by dropping the folder on the dialog.
7. `hello` renders: the background video from `assets/` plays, state and notifications work, state
   survives a restart.
8. `hostile` stays contained in its iframe.
9. Cmd+Q leaves no `node` process (`pgrep -f server.mjs`).
10. With port 3101 held by another HTTP server that answers `200` on `/health`, the app shows the
    error dialog, exits and never opens a window on that server.

## Risks

- **Bundling Fastify/pino:** dynamic requires may break the bundle. The smoke check catches it
  before packaging.
- **Sidecar signing:** the copied Node binary carries its own signature; the ad-hoc bundle signature
  must not break V8 JIT. Verified by acceptance item 2.
- **WebKit differences:** `webkitdirectory`, folder drop and sandboxed module scripts under WKWebView
  are only proven by acceptance items 5–8.

## Out of scope

Developer ID signing, notarization, universal or Intel builds, Windows and Linux, auto-update,
tray, autostart, automatic API restart, `tauri dev`, a native menu beyond Tauri's default, and
moving data from the dev data directory.
