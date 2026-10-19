# Widget SDK Dev Shell Implementation Plan (plan 2b of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ld-widget dev` serves a shell page that imitates the dashboard: grid-sized frame, built-in themes, framed/frameless, settings, and a dev gateway. The widget runs in the production sandbox with hot reload. Every runtime problem lands in the terminal and in `.ld-widget/dev.log`.

**Architecture:** Production rules live in shared code, and both hosts call it: the sandbox document and CSP, gateway call checks, HTTP proxying with secret injection and redaction, rate limits, the error mapping, and the host bridge. The dev server is Vite with the project under base `/@ld/pkg/`. Vue and the SDK resolve to the runtime files through the import map, as in production. A prebuilt Vue shell app is the parent page. A dev-only probe script inside the frame reports CSP violations and overflow.

**Tech Stack:** TypeScript 6.0.3, Node 24, Vite 8.3.2, `@vitejs/plugin-vue` 6.0.9, Vue 3.5.43, Vitest 5.0.3.

**Spec:** `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md`, section 4, plus the dev part of «Secret settings».

**Depends on:** plan 2a (`docs/superpowers/plans/2026-10-19-widget-sdk-package.md`):
- `scripts/build.ts` and the `dist/` layout;
- `packageRoot()`;
- the `cli.ts` `commands` record;
- `writeConfigDeclaration`;
- the `create-widget` template.

## Global Constraints

- **Everything in plan 2a's Global Constraints applies**, in particular:
  - no new dependencies;
  - `dist/sandbox.js` stays where it is;
  - no listening sockets in the Codex sandbox (tests marked *controller-run*);
  - directed error messages.
- **The dev shell must not re-implement a production rule.** A rule that exists in `apps/api` or `apps/ui` moves to `@lifedashboard/contracts` or `@lifedashboard/widget-sdk`, and both hosts call it. Production behaviour stays byte-for-byte: existing API and UI tests keep passing unchanged, except for import paths.
- **Declared dev-only differences** (spec decision 10). These are the only differences the divergence test accepts; it fails on any other:
  1. The runtime `vue.js` is the Vue development build of the app's Vue version (3.5.43).
  2. The sandbox document adds a `<script type="module">` for the Vite client (`/@ld/pkg/@vite/client`).
  3. The sandbox document adds a `<script type="module">` for the probe (`/@ld/runtime/probe.js`).
  4. `connect-src` adds the HMR WebSocket origin (`ws://<host>`).
  5. Styles reach the frame through Vite's injected `<style>` (already allowed by `style-src 'unsafe-inline'`), not `<link>`.
  6. A second load of the frame (Vite full reload) re-handshakes instead of failing the widget.
- **Proven by the 2026-10-19 spike:** HMR works in a `sandbox="allow-scripts"` iframe if:
  - `vue` resolves to the runtime URL from a plugin with `enforce: 'pre'`, which otherwise yields two Vue copies;
  - files under `/@ld/pkg/` and `/@ld/runtime/` send `access-control-allow-origin: *`;
  - Vite's own `server.cors` is `false`.
- **Dev URL layout:**
  - `/` serves the shell;
  - `/@ld/shell/` holds the shell assets;
  - `/@ld/pkg/` is the project (Vite `base`);
  - `/@ld/runtime/` serves `vue.js`, `sdk.js` and `probe.js`;
  - `/@ld/sandbox` is the frame document;
  - `/@ld/api/` is the dev API.
  
  The frame's `connect-src` covers only `/@ld/pkg/` and the WebSocket, so a widget cannot call `/@ld/api/` directly, as in production.
- **Default port:** `5273` with `strictPort`. When it is busy: `Port 5273 is in use. Fix: npx ld-widget dev --port <another port>.`
- **Dev secrets:** `.env.local` in the project, `LD_SECRET_<settingKey>=<value>`, parsed with `node:util` `parseEnv` and read on every call. A value that fails production validation counts as unset and is logged with the production message. A secret value never appears in the terminal, the log file or the shell.
- **Dev log:** `.ld-widget/dev.log`. One line per event: `<ISO time> [<kind>] <message>`. The kind is one of `gateway`, `error`, `csp`, `overflow`, `manifest` or `secret`, and a line carries the shell state (`w=4 h=3 theme=builtin:glass frame=framed`) when the event comes from the frame.

## Review Focus

1. **A third-party npm dependency that imports `vue`** must use the runtime Vue, not a second copy. In a dev server with Vite's dependency optimizer, check that no served module imports `vue.runtime.esm-bundler.js`. Task 6 pins this with a fixture library in its controller-run test.
2. **Editing `widget.json` while `dev` runs:**
   - a valid edit regenerates `widget-env.d.ts` and the shell picks up new sizing, settings and network;
   - an invalid edit logs `[manifest] <parser error>` and keeps the last good manifest;
   - the server never crashes.
   
   Task 6 pins this.
3. **Secrets in dev:**
   - a missing `LD_SECRET_*` gives `UNAVAILABLE` naming the setting;
   - a short value is logged with the production validation message and treated as unset;
   - an echoed value comes back as `[REDACTED]`;
   - the value never appears in `.ld-widget/dev.log`.
   
   Task 5 pins this.
4. **A Vite full reload of the frame** (an edit to a non-component module, or a syntax error recovered) must re-handshake and keep working, not show «Ошибка виджета». Task 7 pins this through the shell helper test and the controller check.
5. **URL state round-trip:**
   - `?w=99&h=0&theme=nope&frame=x` clamps to manifest `min`/`max` and falls back to the default theme and `framed`;
   - the shell state is reproducible from the URL alone, so an agent's browser tool can open each combination.
   
   Task 7 pins this.

---

### Task 1: Shared sandbox document

**Files:**
- Create: `packages/contracts/src/sandbox-document.ts`, `packages/contracts/test/sandbox-document.test.ts`
- Modify: `apps/api/src/sandbox.ts` (remove `sandboxDocument`, call the shared one)
- Test: `apps/api/test/sandbox.test.ts` (unchanged and must pass)

**Interfaces:**
- Produces:
  - `interface SandboxUrls { runtime: string; packageDir: string; entry: string }`. All three are absolute; `runtime` and `packageDir` end with `/`.
  - `interface SandboxExtras { scripts?: readonly string[]; connectSrc?: readonly string[] }`.
  - `sandboxDocument(urls: SandboxUrls, styles: readonly string[], extras?: SandboxExtras): Promise<{ html: string; csp: string }>`.
  - Each extra script is a `<script type="module" src="…">` placed after the import map and links, before the runtime `sdk.js` script. `connectSrc` entries are appended to `connect-src`.
  - The import-map hash uses Web Crypto (`crypto.subtle.digest('SHA-256', …)`, base64). `contracts` stays free of `node:` imports.

- [ ] **Step 1: Write the failing test**

Golden test:
- `sandboxDocument({ runtime: 'http://h/sandbox/runtime/', packageDir: 'http://h/sandbox/packages/abc/', entry: 'http://h/sandbox/packages/abc/index.js' }, ['style.css'])` returns exactly the HTML and CSP strings the current API function produces for base `http://h`, hash `abc` and that manifest. Copy them from a run of today's `apps/api` code before moving it.
- A second case with `extras: { scripts: ['http://h/x.js'], connectSrc: ['ws://h'] }` asserts the script tag position and that `connect-src` ends with ` ws://h`.

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm -C packages/contracts exec vitest run test/sandbox-document.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement**

Move the function. The API route builds `urls` from `${request.protocol}://${host}`, the hash and `manifest.entry`, then `await`s the shared function.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm -C packages/contracts test && pnpm -C apps/api test -- sandbox && pnpm -r typecheck`
Expected: PASS. The API sandbox tests run *controller-run* if the sandbox refuses `listen`.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/sandbox-document.ts packages/contracts/test/sandbox-document.test.ts apps/api/src/sandbox.ts
git commit -m "refactor: share the sandbox document builder through contracts"
```

### Task 2: Shared gateway core

**Files:**
- Create: `packages/contracts/src/widget-http.ts` (moved from `apps/api/src/http-proxy.ts` plus the HTTP step of `apps/api/src/widget-gateway.ts`), `packages/contracts/test/widget-http.test.ts` (moved from `apps/api/test/http-proxy.test.ts`, plus new cases)
- Modify: `packages/contracts/src/widget-gateway.ts`, `packages/contracts/src/widget-secrets.ts`, `apps/api/src/widget-gateway.ts`, `apps/api/src/widget-secrets.ts`, `apps/ui/app/widgets/broker.ts`
- Delete: `apps/api/src/http-proxy.ts`, `apps/api/test/http-proxy.test.ts`
- Test: `packages/contracts/test/widget-gateway.test.ts`, `packages/contracts/test/widget-secrets.test.ts`

**Interfaces:**
- Produces, in `widget-gateway.ts`:
  - `type GatewayFailureCode = 'UNKNOWN_OP' | 'PERMISSION_DENIED' | 'INVALID_INPUT' | 'RATE_LIMITED' | 'CONFLICT' | 'UPSTREAM_ERROR' | 'CONFIRMATION_INVALID'`
  - `class GatewayFailure extends Error { readonly code: GatewayFailureCode }`
  - `checkGatewayCall(op: string, input: unknown, grants: ReadonlySet<WidgetPermission>): { ok: true; op: GatewayOp; input: unknown } | { ok: false; code: 'UNKNOWN_OP' | 'PERMISSION_DENIED' | 'INVALID_INPUT'; message: string }`. It uses the API's current messages, verbatim: `Unknown operation "<op, first 100 chars>"`, `The widget has no "<permission>" permission`, and the parser error.
  - `createRateLimiter(now: () => number): (key: string, op: GatewayOp) => boolean`. It returns `true` when allowed and uses the API's sliding window over `RATE_LIMITS`.
  - `widgetFailure(code: string, message: string): { code: WidgetErrorCode; message: string }`. It takes `string`, because the UI receives any API code, and reproduces today's `toWidgetError` in `broker.ts`. Any other code, such as `VALIDATION_ERROR` or `NOT_FOUND`, becomes `INVALID_INPUT` with the message, as today; the table test includes that row.
    - `CONFLICT` → `CONFLICT` with `'The widget state changed since it was read'`;
    - `RATE_LIMITED` → `RATE_LIMITED` with `'Too many calls'`;
    - `CONFIRMATION_INVALID` → `DECLINED` with `'The confirmation expired'`;
    - `UNKNOWN_OP`, `PERMISSION_DENIED` and `INVALID_INPUT` keep their code and message;
    - `UPSTREAM_ERROR` → `UNAVAILABLE` with the message.
- Produces, in `widget-http.ts`:
  - `interface ProxyRequest` (moved).
  - `proxyHttp(request, origins, timeoutMs?)` (moved). It throws `GatewayFailure` and uses `TextEncoder`/`TextDecoder` instead of `Buffer`.
  - `performHttp(input: ProxyRequest, context: { origins: ReadonlySet<string>; secrets: readonly BoundSecret[]; values: ReadonlyMap<string, string> }, timeoutMs?: number): Promise<HttpOutput>`. It runs today's `http()` steps in the same order: origin check, missing-secret check, injection, proxy, redaction.
- Produces, in `widget-secrets.ts`: `secretValueError(value: unknown, bind: SecretBinding): string | null`. It returns the API's current messages verbatim for a value that is not a string, not well-formed, shorter than 16 characters, has surrounding spaces, contains control characters, or (for a header binding) contains non-Latin-1 characters.
- Consumers:
  - The API route calls `checkGatewayCall`, the limiter, `performHttp` and `secretValueError`. It converts `GatewayFailure` to `ApiError(code, message)`, and keeps audit, sessions and confirmations as they are.
  - `toWidgetError` in the UI calls `widgetFailure` for the `conflict`, `rate-limited`, `invalid` and `upstream` kinds.

- [ ] **Step 1: Write the failing tests**
- A table test of `widgetFailure` covering all seven codes.
- `checkGatewayCall('nope', {}, new Set())` gives `{ ok: false, code: 'UNKNOWN_OP', message: 'Unknown operation "nope"' }`.
- `checkGatewayCall('http.get', { url: 'https://a.example' }, new Set(['state']))` gives `PERMISSION_DENIED` with `The widget has no "network" permission`.
- A `state.set` over 64 KB gives `INVALID_INPUT` with `data must be at most 64 KB as JSON`.
- `createRateLimiter`: the 61st `state.get` inside one window is refused, and the call after the window passes (with a fake `now`).
- `secretValueError` returns each production message.
- Moved proxy tests run unchanged against the new import. `performHttp` cases: a missing secret gives `GatewayFailure('UPSTREAM_ERROR', 'Secret «Ключ» is not set')` before any fetch, and an echo is redacted. These need a listener: *controller-run*.

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-gateway.test.ts test/widget-secrets.test.ts`
Expected: FAIL. The new exports do not exist.

- [ ] **Step 3: Implement the moves and rewire the API route, the secret PUT and the UI broker.**

- [ ] **Step 4: Run the tests**

Run: `pnpm -C packages/contracts test && pnpm -C apps/api test && pnpm -C apps/ui test && pnpm -r typecheck`
Expected: PASS. The existing API gateway, secrets and UI broker tests pass unchanged. Run the API part *controller-run*.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src apps/api/test apps/ui/app/widgets/broker.ts
git commit -m "refactor: share gateway checks, HTTP proxying, rate limits and error mapping through contracts"
```

### Task 3: Host bridge in the SDK

**Files:**
- Create: `packages/widget-sdk/src/host.ts`, `packages/widget-sdk/test/host.test.ts` (the `createHandshakes` and `createBridge` describes moved from `apps/ui/test/broker.test.ts`)
- Modify: `packages/widget-sdk/package.json` (workspace `exports["./host"] = "./src/host.ts"`; not part of `publishConfig.exports`), `apps/ui/app/widgets/broker.ts`, `apps/ui/test/broker.test.ts`

**Interfaces:**
- Produces from `@lifedashboard/widget-sdk/host`: `createHandshakes()`, `createBridge(port, deps)`, `interface Bridge`, `interface HelloEvent`. Signatures are unchanged from `broker.ts`. `listenForHello` stays in the UI because it holds a window-wide singleton.
- `broker.ts` imports these and re-exports them, so `SandboxWidget.vue` stays unchanged.

- [ ] **Step 1: Move the two `describe` blocks to `host.test.ts`, importing from `../src/host.ts`.**

Run: `pnpm -C packages/widget-sdk exec vitest run test/host.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 2: Move the code.**

- [ ] **Step 3: Verify**

Run: `pnpm -C packages/widget-sdk test && pnpm -C apps/ui test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/widget-sdk/src/host.ts packages/widget-sdk/test/host.test.ts packages/widget-sdk/package.json apps/ui/app/widgets/broker.ts apps/ui/test/broker.test.ts
git commit -m "refactor: move the host bridge into the widget SDK for the dev shell"
```

### Task 4: Dev assets built with the SDK

**Files:**
- Create: `packages/widget-sdk/src/dev/themes.ts`, `packages/widget-sdk/src/dev/probe.ts`, `packages/widget-sdk/test/dev-assets.test.ts`
- Modify: `packages/widget-sdk/scripts/build.ts`

**Interfaces:**
- Produces:
  - `extractThemeTokens(css: string): Record<string, string>`. It maps every `--ld-*` declaration in the file to its trimmed value, and the last declaration wins.
  - `interface DevTheme { id: string; name: string; mode: 'light' | 'dark'; tokens: Record<string, string> }`.
  - Build output:
    - `dist/dev/themes.json` (`DevTheme[]`, in `BUILTIN_THEMES` order, read from `apps/ui/app/theme/builtin.ts`, with tokens from `apps/ui/app/theme/styles/themes/<id without builtin:>.css`);
    - `dist/dev/vue.js`, a byte copy of `vue/dist/vue.runtime.esm-browser.js` resolved from the SDK;
    - `dist/dev/probe.js`, a built module.
- Probe behaviour:
  - On `securitypolicyviolation`, post `{ t: 'ld:dev', kind: 'csp', message: '<violatedDirective> blocked <blockedURI>' }` to `parent`.
  - A `ResizeObserver` on `document.documentElement` posts `{ t: 'ld:dev', kind: 'overflow', message: 'content is <scrollW>×<scrollH> px in a <innerW>×<innerH> px frame' }` when the scroll size exceeds the viewport by more than 1 px. It posts once per distinct size.

- [ ] **Step 1: Write the failing test**
- `extractThemeTokens` on a sample with two declarations of one token gives the last value.
- After `pnpm -C packages/widget-sdk build`, `themes.json` lists `builtin:glass`, `builtin:obsidian` and `builtin:paper`.
- Every theme has every `REQUIRED_TOKENS` name (`apps/ui/app/theme/contract.ts`) as `--ld-<name>`.
- No value contains `var(`.
- The first comment of `dist/dev/vue.js` names `v3.5.43`, which equals `apps/ui/package.json` `dependencies.vue`.
- `dist/dev/probe.js` exists and imports nothing.

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/dev-assets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the extractor, the probe, and the three build steps.**

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm -C packages/widget-sdk build && pnpm -C packages/widget-sdk test`
Expected: PASS. Also extend `pack.test.ts` from plan 2a so that `dist/dev/themes.json`, `dist/dev/vue.js` and `dist/dev/probe.js` are in the tarball.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk/src/dev packages/widget-sdk/scripts/build.ts packages/widget-sdk/test/dev-assets.test.ts packages/widget-sdk/test/pack.test.ts
git commit -m "build(widget-sdk): ship theme tokens, the dev Vue runtime and the frame probe"
```

### Task 5: Dev gateway

**Files:**
- Create: `packages/widget-sdk/src/dev/gateway.ts`, `packages/widget-sdk/src/dev/secrets.ts`, `packages/widget-sdk/test/dev-gateway.test.ts`

**Interfaces:**
- Consumes: `checkGatewayCall`, `createRateLimiter`, `widgetFailure`, `GatewayFailure`, `performHttp`, `GATEWAY_OPS`, `secretsOf`, `secretValueError` (Task 2).
- Produces:
  - `type ConfirmMode = 'allow' | 'decline'`
  - `type DevCallResult = { ok: true; value: unknown } | { ok: false; code: WidgetErrorCode; message: string }`
  - `interface DevGateway { call(op: string, input: unknown, confirm: ConfirmMode): Promise<DevCallResult>; reset(): void }`. `reset` clears state and rate counters.
  - `createDevGateway(deps: { manifest: () => WidgetPackageManifest; secrets: () => ReadonlyMap<string, string>; log: (kind: 'gateway', message: string) => void; now?: () => number }): DevGateway`
  - `readDevSecrets(dir: string, manifest: WidgetPackageManifest, log: (kind: 'secret', message: string) => void): Map<string, string>`. It reads `.env.local` with `parseEnv`, keeps `LD_SECRET_<key>` for the manifest's secret settings, and drops a value for which `secretValueError` returns a message. It logs `<key>: <message>` and never the value.
- Pipeline, in order:
  1. `checkGatewayCall`, with grants equal to the manifest permissions.
  2. When `GATEWAY_OPS[op].confirm !== 'never'` and the mode is `decline`, fail with `DECLINED` and `'The user declined the call'`.
  3. Limiter keyed by `'dev'`; refused gives `RATE_LIMITED` and `'Too many calls'`.
  4. Handler:
     - `state.get` and `state.set` work in memory with today's revision and `CONFLICT` rule;
     - `notifications.send` returns `{ ok: true }`;
     - `http.*` calls `performHttp` with `origins` equal to the manifest `network`, the manifest secrets, and the current values.
  5. Map each `GatewayFailure` through `widgetFailure`.
- Every call logs one `gateway` line: `<op> <ok|CODE>`, plus ` <METHOD> <origin> <status>` for HTTP. It never logs a body, path, query or secret.

- [ ] **Step 1: Write the failing tests**
- `state.set` with a stale revision gives `CONFLICT`.
- An unknown op, a missing permission, an over-64 KB input and the 61st `state.get` each give the code and message of the shared functions.
- `notifications.send` in `decline` mode gives `DECLINED`; in `allow` mode, `{ ok: true }`.
- `readDevSecrets` keeps a 16-character `LD_SECRET_apiKey`. It drops a 10-character one and logs `apiKey: The secret must be at least 16 characters without control characters or surrounding spaces`. It ignores keys that are not secret settings.
- *Controller-run*, with a loopback echo server: a header secret is injected and the echoed value comes back as `[REDACTED]`. Without the secret, the call gives `UNAVAILABLE` and `Secret «Ключ» is not set`. The collected log lines never contain the value.

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/dev-gateway.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm -C packages/widget-sdk test`
Expected: PASS. Echo cases run *controller-run*.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk/src/dev/gateway.ts packages/widget-sdk/src/dev/secrets.ts packages/widget-sdk/test/dev-gateway.test.ts
git commit -m "feat(widget-sdk): add a dev gateway that runs the production gateway rules"
```

### Task 6: Dev server and `ld-widget dev`

**Files:**
- Create: `packages/widget-sdk/src/dev/server.ts`, `packages/widget-sdk/src/dev/log.ts`, `packages/widget-sdk/test/dev-server.test.ts`, `packages/widget-sdk/test/dev-server.listen.test.ts` (*controller-run*), `packages/widget-sdk/test/fixtures/vue-lib/` (a project whose `node_modules/fake-vue-lib/index.js` does `import { h } from 'vue'`)
- Modify: `packages/widget-sdk/src/cli.ts`, `packages/create-widget/template/package.json` (`"dev": "ld-widget dev"`), `packages/create-widget/template/AGENTS.md` (add `npx ld-widget dev` before `check` in the workflow)

**Interfaces:**
- Consumes:
  - `sandboxDocument` (Task 1);
  - `createDevGateway` and `readDevSecrets` (Task 5);
  - `packageRoot()` and `writeConfigDeclaration` (plan 2a);
  - `parseWidgetManifest`, `SDK_TARGET_LEVEL`.
- Produces:
  - `DEV_PATHS = { pkg: '/@ld/pkg/', runtime: '/@ld/runtime/', sandbox: '/@ld/sandbox', api: '/@ld/api/', shell: '/@ld/shell/' } as const`
  - `devSandboxDocument(origin: string, wsOrigin: string): Promise<{ html: string; csp: string }>`. It calls `sandboxDocument` with:
    - `runtime` = `origin + DEV_PATHS.runtime`;
    - `packageDir` = `origin + DEV_PATHS.pkg`;
    - `entry` = `packageDir + 'src/index.vue'`;
    - `styles` = `[]`;
    - `extras` = `{ scripts: [packageDir + '@vite/client', runtime + 'probe.js'], connectSrc: [wsOrigin] }`.
  - `createDevLog(dir: string): { write(kind: DevLogKind, message: string, shell?: string): void }`. It prints `[ld-widget] [<kind>] <message>` and appends `<ISO> [<kind>] <message>[ (<shell>)]` to `.ld-widget/dev.log`. `type DevLogKind = 'gateway' | 'error' | 'csp' | 'overflow' | 'manifest' | 'secret'`.
  - `createDevApi(deps: { gateway: DevGateway; info: () => DevInfo; log: DevLog; reset: () => void }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>`. It returns `false` when the path is not under `/@ld/api/`, and it is testable with fake `req`/`res`. Routes:
    - `POST call` takes `{ op, input, confirm }` and returns a `DevCallResult`;
    - `POST log` takes `{ kind, message, shell }` and returns 204;
    - `GET info` returns a `DevInfo`;
    - `POST reset` returns 204;
    - a body over 256 KB gets 413.
  - `interface DevInfo { revision: number; manifest: WidgetPackageManifest; themes: DevTheme[]; secrets: Record<string, boolean>; settingsProblems: string[] }`
  - `startDevServer(dir: string, options?: { port?: number }): Promise<{ url: string; close(): Promise<void> }>`
- `widgetVitePlugins(): Plugin[]`, exported from `build.ts`. It returns `[mediaImportGuard(), vue({ template: { transformAssetUrls: false } })]`. `buildWidget` uses it (plus `stripRegionMarkers()`, which is build-only), and so does the dev server. Dev must reject what the build rejects.
- Vite config:
  - `root: dir`, `base: DEV_PATHS.pkg`, `configFile: false`;
  - plugins `[...widgetVitePlugins(), ldDevPlugin]`;
  - `server: { port, strictPort: true, cors: false }`;
  - `optimizeDeps: { exclude: ['vue', '@lifedashboard/widget-sdk'] }`.
  
  `ldDevPlugin` has `enforce: 'pre'`. Its `resolveId` returns `{ id: <origin>/@ld/runtime/vue.js, external: true }` for `vue` and `{ id: <origin>/@ld/runtime/sdk.js, external: true }` for `@lifedashboard/widget-sdk`. Its `configureServer` middleware handles:
  - ACAO `*` on `/@ld/pkg/` and `/@ld/runtime/`;
  - `/` and `/@ld/shell/*` from `dist/shell/` (until Task 7, `/` answers 503 with `Dev shell not built. Fix: pnpm -C packages/widget-sdk build`);
  - `/@ld/sandbox` with the CSP header;
  - the runtime files from `dist/dev/vue.js`, `dist/sandbox.js` and `dist/dev/probe.js`;
  - the dev API.
- `widget.json` is watched. A valid change runs `writeConfigDeclaration` and bumps `revision`. An invalid one logs `manifest` and keeps the last good manifest. An invalid manifest at start rejects `startDevServer` with `Invalid widget.json: <error>`.
- CLI `ld-widget dev [dir] [--port <n>]` prints:
  - `Dev shell: <url>`;
  - `Log: .ld-widget/dev.log`;
  - when the manifest has secret settings, `Secrets: .env.local (LD_SECRET_<key>=…)`.
  
  It runs until SIGINT.

- [ ] **Step 1: Write the failing tests**

`dev-server.test.ts` (no listening):
- `devSandboxDocument('http://localhost:5273', 'ws://localhost:5273')` gives a CSP containing `connect-src http://localhost:5273/@ld/pkg/ data: blob: ws://localhost:5273`.
- The HTML imports `http://localhost:5273/@ld/pkg/src/index.vue` as `@lifedashboard/widget-entry`.
- `createDevApi` with a stub gateway answers `call`, `log`, `info` and `reset`. It returns `false` for `/x`, and 413 for a 300 KB body.
- `createDevLog` writes the file line format.

`dev-server.listen.test.ts` (*controller-run*) starts the server on the `vue-lib` fixture with port 0 → `strictPort` off. Then:
- `GET /@ld/pkg/src/index.vue` imports `http://localhost:<port>/@ld/runtime/vue.js`.
- Following every import from that module and from the optimized `fake-vue-lib`, no URL contains `vue.runtime.esm-bundler`.
- `GET /@ld/sandbox` has a `content-security-policy` header.
- `GET /@ld/runtime/vue.js` is 200.
- `POST /@ld/api/call` for `state.get` gives `{ ok: true, value: { data: null, revision: 0 } }`.
- Writing an invalid `widget.json` adds a `[manifest]` line to `.ld-widget/dev.log`, and the server still answers.
- A component that imports `../assets/x.mp4` fails to transform with `reference media by URL: assets/x.mp4`, as in `buildWidget`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/dev-server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the server, the log and the CLI `dev` command, and update the template.**

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm -C packages/widget-sdk test && pnpm -C packages/create-widget test`
Expected: PASS. The listen test runs *controller-run*.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk/src/dev packages/widget-sdk/src/cli.ts packages/widget-sdk/test packages/create-widget/template
git commit -m "feat(widget-sdk): add ld-widget dev with the production sandbox and hot reload"
```

### Task 7: Shell app

**Files:**
- Create:
  - `packages/widget-sdk/shell/index.html`, `packages/widget-sdk/shell/main.ts`, `packages/widget-sdk/shell/App.vue`, and small components under `packages/widget-sdk/shell/` as needed;
  - `packages/widget-sdk/src/dev/shell-state.ts`, `packages/widget-sdk/test/shell-state.test.ts`.
- Modify: `packages/widget-sdk/scripts/build.ts` (build `shell/` with Vite, base `/@ld/shell/`, into `dist/shell/`), `packages/widget-sdk/test/pack.test.ts` (`dist/shell/index.html` is packed).

**Interfaces:**
- Consumes:
  - `createHandshakes`, `createBridge` (Task 3);
  - `DevInfo`, `DEV_PATHS` (Task 6);
  - `normalizeConfig`, `isValidSettingValue`, `sizeClass`, `secretsOf`, `GRID_COLS`.
- Produces, in `shell-state.ts` (pure):
  - `interface ShellState { w: number; h: number; theme: string; frame: 'framed' | 'frameless'; confirm: ConfirmMode }`
  - `parseShellState(search: string, manifest: WidgetPackageManifest, themeIds: readonly string[]): ShellState`. It clamps `w`/`h` to the sizing `min`/`max`, defaults to `sizing.default`, the first theme, `framed` and `allow`.
  - `serializeShellState(state: ShellState): string`, giving `?w=…&h=…&theme=…&frame=…&confirm=…`.
  - `describeShell(state: ShellState): string`, giving `w=4 h=3 theme=builtin:glass frame=framed`.
  - `frameSizePx(state: ShellState, cellPx: number): { width: number; height: number }`, with gap 8 px: `n * cell + (n - 1) * 8`.
  - `shellContext(state: ShellState, theme: DevTheme, settings: SettingsSchema | undefined, rawConfig: Record<string, unknown>, secretsSet: ReadonlySet<string>): WidgetContext`. `rootFontSize` is 16, `locale` is `navigator.language` (passed in), and `visible` is true.
- Shell behaviour:
  - A toolbar with `w`/`h` inputs limited to the manifest, a theme select, a framed/frameless toggle, a confirm `allow`/`decline` select, and «Сбросить состояние».
  - The frame:
    - is sized by `frameSizePx`, with the cell taken from the board formula `(contentWidth − 23 × 8 px) / 24`;
    - shows a card look when framed (radius, `--ld-surface-1`, border from tokens) and none when frameless;
    - sets the tokens as CSS variables on the frame box.
  - A settings panel:
    - one control per plain setting, validated with `isValidSettingValue`;
    - raw values kept in the shell's own `localStorage` under `ld-dev-config:<id>`;
    - each secret shown as «задан»/«не задан» with the hint `LD_SECRET_<key> в .env.local`.
  - A log panel lists gateway results and reports. Notifications show as toasts.
  - Every state change replaces the URL (`history.replaceState`), pushes a context patch over the bridge, and reports nothing.
  - Polling `info` every 2 s applies a changed `revision`: it reloads the frame and rebuilds the settings.
- Frame lifecycle:
  - The frame is `<iframe sandbox="allow-scripts" src="/@ld/sandbox">`. On each `load`, the shell re-registers for the hello: this is declared difference 6.
  - On hello, it opens a `MessageChannel`, sends `ld:init` with `shellContext`, and calls `createBridge(port, …)` with:
    - `call` → `fetch('/@ld/api/call')`, throwing `new WidgetError(code, message)` on `ok: false`;
    - `onError` → report kind `error`;
    - `onClose` → report kind `error` with `bridge closed`.
  - `ld:dev` messages from the frame window report their kind.
  - Reports go to `POST /@ld/api/log` with `shell: describeShell(state)`.

- [ ] **Step 1: Write the failing test** (`shell-state.test.ts`)
- `parseShellState('?w=99&h=0&theme=nope&frame=x&confirm=y', counter, ['builtin:glass', 'builtin:paper'])` gives `{ w: 4, h: 1, theme: 'builtin:glass', frame: 'framed', confirm: 'allow' }`.
- `serializeShellState` round-trips.
- `frameSizePx({ w: 3, h: 2, … }, 40)` is `{ width: 136, height: 88 }`.
- `shellContext` gives `sizeClass` `s` for 2×3. It gives `frame` from the state, the theme tokens, and `config` from `normalizeConfig`, so a secret key becomes a boolean.

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/shell-state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helpers and the shell app, and add the shell build step.**

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm -C packages/widget-sdk build && pnpm -C packages/widget-sdk test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk/shell packages/widget-sdk/src/dev/shell-state.ts packages/widget-sdk/test packages/widget-sdk/scripts/build.ts
git commit -m "feat(widget-sdk): add the dev shell page with frame, themes, settings and log"
```

### Task 8: Divergence test and end-to-end check

**Files:**
- Create: `packages/widget-sdk/test/dev-parity.test.ts`
- Modify: `packages/widget-sdk/src/dev/server.ts` (export `DEV_SANDBOX_DIFFERENCES`, the six declared differences from Global Constraints as `{ id: string; description: string }[]`)

**Interfaces:**
- Consumes: `sandboxDocument`, `devSandboxDocument`, `dist/dev/*`, `createDevGateway`.

- [ ] **Step 1: Write the test**

The test fails on any difference not declared:
1. Build `prod = sandboxDocument({ runtime: O+'/@ld/runtime/', packageDir: O+'/@ld/pkg/', entry: O+'/@ld/pkg/src/index.vue' }, [])` and `dev = devSandboxDocument(O, W)`. Assert:
   - `dev.csp === prod.csp.replace(/(connect-src [^;]*)/, '$1 ' + W)`;
   - `dev.html` equals `prod.html` with exactly the two declared `<script type="module">` tags inserted before the runtime `sdk.js` tag.
2. `dist/dev/vue.js` names the same Vue version as the file the API serves, `require.resolve('vue/package.json')` from `apps/api`.
3. `themes.json` covers `BUILTIN_THEMES`, and every theme has all `REQUIRED_TOKENS`.
4. `DEV_SANDBOX_DIFFERENCES` has exactly six entries, with ids `vue-dev-build`, `vite-client`, `probe`, `hmr-websocket`, `styles-via-vite`, `frame-reload`.
5. For a table of inputs, the dev gateway result equals `widgetFailure` applied to the shared check:
   - unknown op;
   - missing permission;
   - widget-supplied `authorization` header;
   - `state.set` over 64 KB;
   - `http.get` to an origin outside `network`.

- [ ] **Step 2: Run it**

Run: `pnpm -C packages/widget-sdk build && pnpm -C packages/widget-sdk exec vitest run test/dev-parity.test.ts`
Expected: PASS. If a case fails, fix the code that diverged, not the test.

- [ ] **Step 3: Controller-run end-to-end check in Orca's built-in browser**

Run: `pnpm -C examples/widgets/hello exec ld-widget dev`. Then:
1. Open the shell. The widget renders.
2. Change `w`/`h` to the manifest limits, each of the three themes, and frameless. The URL and the frame follow.
3. Edit the template text in `src/index.vue`. The frame updates without losing component state.
4. Add `fetch('https://example.com')` temporarily. `.ld-widget/dev.log` gets a `[csp]` or `[gateway]` line, then revert.
5. Shrink to `min`. An `[overflow]` line appears if content overflows.
6. Set confirm to `decline` and trigger a notification. The widget gets `DECLINED`.
7. With a temporary secret fixture widget against a loopback echo server:
   - without `.env.local`, the call gives `UNAVAILABLE`;
   - with `LD_SECRET_apiKey` set, the response shows `[REDACTED]`;
   - `grep` of `.ld-widget/dev.log` for the value finds nothing.

Record the results in the ledger.

- [ ] **Step 4: Commit**

```bash
git add packages/widget-sdk/test/dev-parity.test.ts packages/widget-sdk/src/dev/server.ts
git commit -m "test(widget-sdk): fail when the dev shell diverges from production"
```

## Deferred to other plans

- **Plan 3:** package docs (including the dev workflow, the declared dev differences and the engine checks in Safari/GNOME Web), the full `AGENTS.md`, the skill, the import-dialog starter prompt, docs numbers generated from constants, and the README SDK section.
- **Plan 4:** the acceptance run with a fresh agent.
