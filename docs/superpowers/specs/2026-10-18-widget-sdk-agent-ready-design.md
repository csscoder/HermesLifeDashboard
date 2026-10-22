# Agent-ready Widget SDK — design

Date: 2026-10-18. Status: approved (implemented by plans 2026-10-18-widget-sdk-platform-gaps, 2026-10-19-widget-sdk-dev-shell, 2026-10-19-widget-sdk-package).

## Intent

LifeDashboard widgets should be created by AI coding agents on behalf of people with little or no programming experience. Today an agent can build a widget only inside this monorepo, and only by reading platform sources: `packages/contracts`, `apps/api/src/sandbox.ts`, `apps/ui/app/widgets/*`. The SDK has no README, no scaffold, no preview, and its public API promises things the platform does not deliver (`context.config` is always `{}`).

This rework turns the Widget SDK into a self-contained product. An agent working in an empty folder of the user's own repository must understand from the installed package alone what a widget can do, what the runtime forbids, how to check its work, and how to produce a folder that any LifeDashboard installation imports.

## Success and failure

- **Success (user's words):** the agent builds a working widget on the first attempt without reading dashboard sources.
- **Failure (user's words):** the agent opens dashboard sources. Everything else being correct does not compensate.
- **Acceptance run (my call):** a fresh agent session, an empty folder outside the monorepo, the SDK installed from `pnpm pack` tarballs (before anything is published), and a one-sentence task. Pass: `ld-widget check` and `ld-widget build` succeed, the built folder imports through «Виджеты → Выбрать папку» in the desktop app and works. The agent may read the generated `AGENTS.md`, files under `node_modules/@lifedashboard/*/docs/`, the skill and `.d.ts` files. Opening any other platform file, including compiled runtime JS in `node_modules`, counts as failure and points to a gap in the docs or types. Run it at least for three tasks: a static/decorative widget (clock with animation), a state + settings widget (counter/notes with a configurable title), an HTTP widget (public JSON API polled on an interval), and a secret widget (HTTP with a secret in a header against a local loopback echo server: the run checks entering the secret in the UI, injection, `UNAVAILABLE` before the secret is set, and `[REDACTED]` in the echoed response).
- **Bootstrapping (my call):** the task sentence is what a user would copy from the dashboard: after publishing it names `npm create @lifedashboard/widget <name>`, and the agent runs it. Before publishing, `npm create` cannot resolve `@lifedashboard/create-widget`, so the acceptance run starts the scaffold from its tarball (for example `npm exec --package=<create-widget tarball> -- create-widget <name> --sdk <sdk tarball>`); the builder fixes and tests the exact command, and the acceptance task sentence names it. `create` is non-interactive by default, accepts an SDK source option (version, tarball or path) and ends by printing a pointer to `AGENTS.md`. The dashboard's import dialog shows the copyable starter prompt with the published command.
- **Shareable projects (my call):** a project created with a tarball or path SDK source is for the acceptance run only and is not shareable. A normal project depends on a published SDK version, so a shared project installs on any machine.

## Decisions made by the user

1. Widgets are developed in the user's own repository, without LifeDashboard sources.
2. Development is ordinary SPA development in a browser, inside a dev shell that imitates the dashboard: the grid frame and the built-in themes.
3. Delivery is a built folder. The dashboard imports it with its existing folder import («Виджеты → Выбрать папку»). There is **no** install command and no link between the CLI and a running dashboard. Built folders and whole projects are shared between people and must import on any OS.
4. A widget is a finished application inside the dashboard frame, with defined levers for reading information and for acting (notifications, writes).
5. The capability gaps are fixed in this rework: settings through `config` with a schema and a settings screen, typed HTTP, and a frame/frameless signal.
6. Minimum macOS is 15.7 (Sequoia).
7. The desktop app will ship for macOS, Windows and Linux, but Windows and Linux builds are a **separate project**. This rework only defines the runtime baseline that covers all three engines.
8. No Playwright: `ld-widget check` works without a headless browser.
9. Secret settings are in scope: the host injects a user-entered secret into HTTP requests and the widget is never given it (the limit for servers that echo it back is in section 3).
10. Dev hot reload wins over strict parity: the dev shell may differ from production in a declared, tested list.
11. The work ends at publishable tarballs; the user publishes to npm.

## Goals

- One entry point for agents, created with the project, pointing at version-matched docs inside the installed package.
- An honest, complete, typed list of levers. What is not in the list does not exist.
- Limits, error codes and runtime restrictions documented from the same constants the platform enforces.
- A dev shell and dev gateway that behave like production: same sandbox, CSP, limits and error codes.
- A self-check command that lets the agent find failures before a human looks.
- Platform gaps closed: settings schema + settings UI, secret settings, typed `http`, frame signal.

## Non-goals

- Installing widgets from the CLI or any CLI ↔ running-dashboard connection (decision 3).
- Windows and Linux desktop builds (decision 7).
- MCP server, marketplace, package signing, package updates/discovery.
- Publishing to npm and a release pipeline (decision 11).
- Headless browser automation (decision 8).
- Frameworks other than Vue 3.
- Hot reload inside the installed dashboard.
- New gateway capabilities (data sources, device actions, Hermes). The model must allow adding them later as new permissions without breaking existing widgets.

## Anti-goals

- Docs that drift from code: a limit written by hand in Markdown that differs from the enforced constant.
- A dev environment that accepts what production rejects ("works in dev, breaks in the dashboard").
- Public API surface that is declared but not delivered.
- A built folder that depends on the author's OS, paths or installed codecs.

## Current state (facts from the repo)

- `packages/widget-sdk/package.json`: `"private": true`, exports `./src/index.ts`, bin `./src/cli.ts`, depends on `@lifedashboard/contracts` via `workspace:*`. Node 24 refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, checked locally on v24.21.0), so the package cannot be consumed outside the workspace as is.
- Widget code imports `vue` and `@lifedashboard/widget-sdk` as externals; the sandbox import map resolves them to the **app's** runtime files (`apps/api/src/sandbox.ts`, `RUNTIME_FILES`). The npm SDK version is not the runtime version.
- `widget.call(op, input)` is untyped; `GatewayInputs` exists in `contracts/src/widget-gateway.ts` but is unused by the SDK.
- `context.config` is always `{}`: new instances get `config: {}` (`apps/ui/app/board/WidgetBoard.vue:284`), the manifest has no settings field and there is no settings UI. Instances already persist `config` and `configVersion`.
- Frameless is the theme `builtin:bare` (`BARE_THEME_ID`, `contracts/src/board.ts`); the widget is not told about it explicitly.
- Limits live in three places: `contracts` (`STATE_MAX_BYTES`, `HTTP_LIMITS`, `BRIDGE_LIMITS`, `PACKAGE_LIMITS`), `apps/api/src/widget-gateway.ts` (`RATE_LIMITS`), and `apps/api/src/sandbox.ts` (CSP).
- The sandbox iframe is `sandbox="allow-scripts"` (`apps/ui/app/widgets/SandboxWidget.vue:107`): opaque origin, so `localStorage`, `IndexedDB` and cookies do not work.
- `README.md` «Security and privacy» says only `state` and `notifications` exist; `network` is implemented.
- `apps/desktop/src-tauri/tauri.conf.json` sets no `minimumSystemVersion`.
- Manifest parsing rejects unknown keys (`parseManifest`), and `sdk` must equal `1`.

## Design

### 1. Package shape and distribution

- **Public npm (recommended by me, accepted by the user, who publishes it — decision 11):** `@lifedashboard/widget-sdk` (runtime API, types, CLI `ld-widget`, docs, skill) and a tiny `@lifedashboard/create-widget` so that `npm create @lifedashboard/widget <name>` works. Agents already know the `npm create` convention. Bundling the SDK into the app was rejected: it only wins offline use and needs a per-OS CLI install into `PATH`.
- Published as compiled JS plus `.d.ts`. `@lifedashboard/contracts` stays private and is bundled into the SDK build (my call; publishing it would add a second public contract to version).
- `vue` is a peer dependency. The host provides the Vue runtime; the docs state the version range and that widgets must not bundle their own Vue. `vite` and `@vitejs/plugin-vue` become regular dependencies of the SDK (they are already the build toolchain).
- Third-party npm libraries in widgets are allowed and bundled, subject to the 10 MB code limit and the runtime baseline (browser ESM only, no Node APIs). The docs say so.
- The monorepo examples keep using the workspace link for development; the acceptance run uses tarballs.
- Deliverable: `pnpm pack`-able packages with correct `files`, `exports`, `bin`, types and versions. Assumption: the user secures the `@lifedashboard` npm scope. If it is unavailable, renaming the package and the import-map specifier is a follow-up, not part of this rework.

### 2. Compatibility between widgets and dashboards (my call)

Widgets compile against the npm SDK but run against the SDK runtime shipped inside the dashboard. A widget that uses `settings`, `widget.http` or the frame signal must not be imported into a dashboard that lacks them.

- The manifest `sdk` becomes the runtime protocol level. This rework introduces `sdk: 2`. The dashboard accepts `1` and `2`; an older dashboard already rejects `2` with `manifest.sdk must be 1`. Improve that message in the new parser so future levels say "this widget needs a newer LifeDashboard".
- `ld-widget build` writes the level the SDK targets. The SDK API documents per member the level it needs (all new members are level 2).
- Future additive capabilities bump the level again; no capability-flag negotiation.

### 3. Platform gaps

**Settings.**
- `widget.json` gets an optional `settings` field: a self-contained JSON Schema subset, the same idea as VS Code `contributes.configuration`: `{ "type": "object", "properties": { … }, "required": [ … ] }`. Allowed per property: `type` (`string`, `number`, `integer`, `boolean`), `title`, `description`, `default` (mandatory), `enum` (strings), `minimum`, `maximum`, `maxLength`. The `default` must satisfy the property's type and every constraint it declares (`enum`, `minimum`, `maximum`, `maxLength`); a manifest with an invalid `default` is rejected. Secret properties are a separate type, described below. No `$ref`, nesting, arrays or formats in this rework. Parsed by hand-written parsers in `contracts`, like the rest of the manifest — no new validator dependency.
- The dashboard renders a settings form per widget instance from the schema and saves to the instance `config`. Where the form lives in the UI is left to the builder.
- The host always hands the widget a complete, valid `config`: defaults filled in, invalid or unknown keys dropped. Importing a new version does not change placed instances, which stay on their version. When the user switches an instance to another version, the host rebuilds its `config` by that version's schema with the same rule (my call).
- `ld-widget dev`/`check`/`build` generate a declaration file in the project (Raycast `raycast-env.d.ts` pattern) that types `widget.context.config` from the schema, so the agent gets compile-time feedback. File name left to the builder.

**Secret settings (decision 9).**
- A secret is a separate property type `secret`: no `default` and no other constraints declared by the widget. The host requires a minimum length of 16 characters for an entered secret so that redaction (below) rarely hits ordinary data; the docs describe the remaining risk of false redaction. In `context.config` and in the generated declaration it is a `boolean` that says whether the secret is set.
- A secret property is bound to one origin from the manifest `network` list and one injection point: a request header (for example `Authorization` with a prefix such as `Bearer `) or a query parameter. Exact manifest syntax is left to the builder. The bound origin must be `https:`; `http:` is allowed only for loopback hosts (`127.0.0.1`, `localhost`, `[::1]`). A manifest that binds a secret to another `http:` origin is rejected.
- The widget is never given the value: `context.config` carries only whether the secret is set. On every `http.get`/`http.send` to the bound origin, the API adds the secret at the declared injection point. Requests to other origins never carry it. A widget cannot set the bound header itself: the gateway input parser keeps rejecting that header from the widget, and only the API adds it when it sends the request out. If the injection point is a query parameter and the widget's URL already contains that parameter, the call is rejected with `INVALID_INPUT`. If the secret is not set, the request is not sent and the call is rejected with `UNAVAILABLE` and a message naming the missing setting.
- The import review shows each secret binding ("sends your <title> to <origin>"); a new or changed binding in a new version is reviewed like a new origin.
- The secret is entered in the settings form, stored by the API per widget instance outside `config`, never sent to the UI after saving (write-only field with a "set/replace/clear" control; the UI receives only a per-instance flag per secret saying whether it is set), never logged, never part of a board export or a built folder. Storage is the existing SQLite data directory (my call; an OS keychain is a later upgrade).
- The secret is keyed by the stable widget instance ID, not by a database row: it survives board saves that rewrite instance rows (today `PUT` of a board deletes and re-inserts every `widgets` row) and is deleted only when the instance is absent from a successfully saved board.
- Dev: secrets come from a local `.env`-style file in the widget project; `.env*` is already excluded from `source/`. The dev proxy uses the same shared injection and redaction code as production, and the dev log never contains a secret value (redaction runs before logging).
- This changes the security model: the API now adds a credential to outgoing requests. The headers a widget may pass in stay as today (`accept`, `content-type`).
- A server on the bound origin may echo the secret back. Before returning a response to the widget, the API replaces every literal occurrence of the secret value in the body and headers with the fixed marker `[REDACTED]` (my call). Transformed echoes (encoded or split) are out of the host's control. The guarantee is therefore narrowed: the widget is never given the secret and literal echoes are redacted, but a server that transforms the secret can still leak it to the widget. The import review shows this risk next to each binding, and the docs say so.

**Typed gateway.**
- `widget.http.get(url, options?)` and `widget.http.send({ url, method, headers?, body? })`, returning `HttpOutput`.
- `widget.call` becomes typed by `GatewayOp`/`GatewayInputs`, or is removed from the public API if every operation has a named method; builder's choice, but no untyped string API remains public. The runtime keeps `widget.call` working for installed `sdk: 1` widgets either way.
- Every public member has JSDoc stating its permission, limits, possible error codes and required `sdk` level.

**Frame signal.**
- `WidgetContext` gets an explicit frame field (framed vs frameless), derived from `BARE_THEME_ID`. Name left to the builder.
- Pixel size is not added: the iframe viewport is the widget box, so `100vw/100vh`, `window.innerWidth` and container queries cover it. The docs say this explicitly.

**Other platform changes.**
- `minimumSystemVersion: "15.7"` in `apps/desktop/src-tauri/tauri.conf.json`.
- `RATE_LIMITS` move to `contracts` so the dev gateway and docs read the same values.
- `README.md`: fix the permissions list; point the SDK section at the package docs.

### 4. Dev shell and dev gateway

- `ld-widget dev` starts a Vite dev server with hot reload and a shell page: the widget in a frame sized in grid cells, resizable between the manifest `min` and `max`, theme switcher (the built-in themes), framed/frameless toggle, settings form generated from the schema, a log of gateway calls and errors.
- The widget runs in the same sandbox as production: an iframe with `sandbox="allow-scripts"`, the same import map shape and the same CSP, except a declared dev-only list (decision 10): the Vue development build (needed for HMR; the production runtime has no `__VUE_HMR_RUNTIME__`), Vite's client and its HMR WebSocket in `connect-src`. The dev Vue runtime is generated into the package at SDK build time from the app's Vue version, like the theme tokens, and is part of the divergence test (my call).
- Dev gateway: `state` in memory or on disk with revisions and the 64 KB limit; notifications shown as toasts; `http.get/send` through a dev proxy restricted to the manifest `network` origins with the production limits, timeouts and header rules; rate limits and the confirm policy (`DECLINED`) reproducible from the shell.
- **Parity constraint:** the shell must not re-implement production rules. The CSP/sandbox document builder (`sandboxDocument`) and input parsing move to, or are shared through, `contracts`; built-in theme token values are generated into the package at SDK build time from `apps/ui/app/theme/styles/themes/*.css`. How exactly is left to the builder; a test must fail when dev and production diverge beyond the declared dev-only list.
- Runtime feedback without a headless browser (my call): the shell reports uncaught errors, Vue errors, `securitypolicyviolation` events, gateway errors and content overflowing the frame to the dev server, which prints them in the terminal and appends them to a log file in the project. Shell state (size, theme, frame) is in the URL, so an agent with its own browser tool can open each combination and read the log.

### 5. Self-check: `ld-widget check` (static, decision 8)

`check` runs without a browser and reports in plain text plus a machine-readable JSON file:

- manifest, settings schema and secret bindings valid for the targeted `sdk` level;
- type check of the project against the SDK types and the generated config declaration, run with the project's own `vue-tsc`; `create` adds `typescript` and `vue-tsc` to the project's devDependencies at the versions the monorepo already uses, and `check` prints a directed error when they are missing;
- use of APIs that do not work in the sandbox or the baseline (`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `Notification`, `requestIdleCallback`, `scheduler.postTask`, `navigator.gpu` without a guard), detected in the source — the detection method is left to the builder;
- HTTP URL literals whose origin is not in the manifest `network` list;
- media in `assets/` with no cross-engine format: an MP4 used without a WebM source is an error, not a warning; audio without an Opus source (Ogg or WebM) is an error; media imported into code. This is a container check only; `check` does not verify codecs. The docs require WebM with VP9 + Opus, and a widget with media is checked for playback in the target engines;
- the build itself and the 10 MB code limit.

Runtime problems are reported by `ld-widget dev` (section 4). The docs tell the agent to run `check`, then open the dev shell at `min`/`default`/`max` × themes × framed/frameless and read the dev log before handing the folder over. Final engine checks are Safari on macOS and GNOME Web (Epiphany) on Linux.

### 6. Agent knowledge

Coding agents load the project's root `AGENTS.md`/`CLAUDE.md` automatically but do not discover files inside `node_modules` on their own (sources below). So:

- `npm create @lifedashboard/widget` scaffolds `widget.json`, `src/index.vue`, `package.json`, `tsconfig.json`, a root `AGENTS.md` (short: what this project is, the rules that cause most failures, where the docs are) and `CLAUDE.md` containing `@AGENTS.md`. One minimal template.
- Full docs ship in the package (`node_modules/@lifedashboard/widget-sdk/docs/`), version-matched:
  - **Levers:** the complete list of API members, context fields and gateway operations with permissions and limits.
  - **Runtime restrictions:** sandbox and CSP in plain words (no storage APIs → use `state`; no Web Notifications → use `notify`; files only from the widget folder; media only by URL from `assets/`; workers from `blob:` only).
  - **Runtime baseline** (section 7).
  - **Error codes:** every `WidgetErrorCode`, when it happens, what the widget should do.
  - **Design:** theme tokens (from `docs/theme-contract.md`), sizing in grid cells, framed vs frameless, `rem` scaling.
  - **Settings:** schema subset with examples.
  - **Recipes:** polling HTTP with backoff, revision conflicts, adapting to size classes, visibility-aware animation.
  - **Workflow:** `dev` → `check` → `build` → hand the folder to the user for import; sharing a project vs a folder.
- An Agent Skill (`SKILL.md`) ships in the package; `create` installs it into the project for Claude Code. Other agents' skill locations are left to the builder to verify; `AGENTS.md` is the cross-agent baseline.
- Every number in the docs (limits, rate limits, CSP list, token names, grid size) is generated from the platform constants at SDK build time; a test fails when the docs are stale.
- CLI and gateway error messages name the rule and the fix, so an agent can act without a human (for example the existing `reference media by URL: assets/x.mp4`).
- No MCP server.

### 7. Runtime baseline (all three desktop engines)

| OS | Tauri webview | Note |
| --- | --- | --- |
| macOS 15.7+ | WKWebView, WebKit 18.6 out of the box | Safari 26 is an optional update that also updates WKWebView |
| Windows | WebView2 (evergreen Chromium) | least constrained |
| Linux | WebKitGTK, distro-dependent | 2.50+ on Ubuntu 22.04 / Debian 12 (security updates); media through GStreamer |

Rule for widgets: target the intersection of WebKit 18.6 and WebKitGTK 2.50. Anything newer only behind feature detection with a fallback. Specifically:

- Media: WebM (VP9 + Opus) for video and Opus (Ogg or WebM) for audio as the baseline; H.264/MP4, MP3 and AAC may not play on Linux without GStreamer plugins. The `hello` example's `bg.mp4` should get a WebM source.
- 3D: WebGL 2; WebGPU only as an enhancement.
- `backdrop-filter`: enhancement only, critical UI must not depend on it.
- Not available or not reliable: `requestIdleCallback`, `scheduler.postTask`, Web Notifications, CSS anchor positioning (Safari 26+ only).
- No storage APIs in the sandbox (opaque origin).

### 8. Portable built folder

**Safe `source/` (my call).** Built folders are shared, so `source/` must not carry credentials. Today `ld-widget build` copies the whole project into `source/` except `node_modules/`, `dist/`, `assets/`, `.git/`, `.env*` and `.DS_Store`, so a file such as `.npmrc` with a token would be shared. `source/` switches to an allow-list: `widget.json`, `package.json`, lockfiles, `tsconfig*.json`, `AGENTS.md`, `CLAUDE.md`, `README*`, and the `src/` and `test/` directories; dotfiles are never included at any depth. The exact list is left to the builder, but it is an allow-list, and `build` prints what went into `source/`. `--no-source` stays.

The built folder must import and behave the same on macOS, Windows and Linux: relative URLs only, everything bundled, cross-engine media formats, no OS assumptions. `parseWidgetFolder` already enforces path rules and case-insensitive collisions; `check` fails on MP4-only media.

## Constraints

- Hard stops from the user's rules apply: any new dependency needs explicit approval. Playwright was declined.
- TypeScript strict, Node 24, pnpm 10 in the monorepo; widget projects may use npm or pnpm.
- Existing installed widgets (`sdk: 1`) keep working.
- Permissions, network origins and secret bindings are declared in the manifest and approved by the user at import. Apart from secret injection (section 3), nothing in this rework widens what a widget can reach.

## Left to the builder

- Settings form placement and look in the dashboard; declaration file name; frame field name; API endpoints for saving and clearing secrets.
- How shared sandbox/CSP code and theme tokens get from `apps/` into the package, as long as a divergence test exists.
- Whether `widget.call` stays (typed) or goes.
- Template contents beyond the minimum; docs file layout; skill wording.
- Implementation split into plans. Suggested order: platform gaps and compatibility (including secret settings) → SDK as a package (build, publish shape, `create`, `dev`, `check`) → agent knowledge → acceptance run.
- Detection method for forbidden APIs in `check`; secret manifest syntax; dev log file name.

## Research record (checked 2026-10-18, via Perplexity search unless noted)

- Agents read the project's root/nested `AGENTS.md`; package-local files in `node_modules` are not auto-discovered. Next.js ships version-matched docs in `node_modules/next/dist/docs` and points to them from a managed root `AGENTS.md`: https://nextjs.org/docs/app/guides/ai-agents. TanStack Intent ships `SKILL.md` inside npm packages and wires them in with an install step: https://tanstack.com/intent/latest.
- Manifest settings as a self-contained JSON Schema subset (no `$ref`): VS Code `contributes.configuration`, https://code.visualstudio.com/api/references/contribution-points. Typed preferences list with generated `raycast-env.d.ts`: https://developers.raycast.com/information/manifest.
- macOS 15.7 ships Safari 18.6; Safari 26 is a separate update that also updates WKWebView: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/.
- Sandboxed documents without `allow-same-origin` get an opaque origin with no `localStorage`/cookies: https://html.spec.whatwg.org/multipage/browsers.html.
- Tauri webview per OS: https://v2.tauri.app/reference/webview-versions/ (its WebKitGTK table is outdated per search).
- `libwebkit2gtk-4.1-0` versions checked directly on 2026-10-18: Ubuntu 22.04 `jammy-updates` 2.50.4 (https://packages.ubuntu.com/jammy-updates/libwebkit2gtk-4.1-0), Debian 12 `bookworm` 2.50.6 (https://packages.debian.org/bookworm/libwebkit2gtk-4.1-0), Ubuntu 24.04 `noble-updates` 2.52.6. Debian 13 and Fedora 43 (2.52.x) — Perplexity only.
- `requestIdleCallback` disabled by default in Safari, `scheduler.postTask` unsupported — caniuse per search; not fetched directly (caniuse blocks curl). Verify on MDN when writing the docs.
- Node 24 type stripping refuses files under `node_modules` — checked locally (v24.21.0).
