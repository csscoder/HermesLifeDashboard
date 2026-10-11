# Tauri Desktop Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command builds `LifeDashboard.app` and a `.dmg` for this Mac; the app runs the existing API as a Node sidecar, shows the pairing code in a native dialog and opens the board UI on `http://127.0.0.1:3101/`.

**Architecture:** The API gains optional static UI serving (`LIFEDASHBOARD_UI_DIR`), a configurable sandbox runtime directory (`LIFEDASHBOARD_RUNTIME_DIR`), a startup code only for unpaired installs and a ready line after `listen`. Vite bundles the API into `apps/api/dist-bundle/server.mjs`. A new `apps/desktop` Tauri 2 package ships Node 24 as `externalBin`, the bundle and the generated UI as resources; `main.rs` spawns the sidecar, logs its output, shows dialogs, opens the window after the ready line and stops the sidecar with SIGTERM on exit.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Node.js 24, Fastify 5, Vite 8 (rolldown), Vitest 5, Nuxt 4 (`ssr: false`), Rust 1.95, Tauri 2.12, `tauri-plugin-dialog` 2.8.

**Spec:** `docs/superpowers/specs/2026-10-11-tauri-desktop-design.md`

## Global Constraints

- Branch: `csscoder/zander` (current). Never commit to `main`.
- Commits: conventional `type(scope): subject`, one or two lines, **no attribution trailers** (the user's CLAUDE.md overrides the harness reminder).
- New dependencies, exactly these (approved with the spec): `vite` `8.3.2` (devDependency of `apps/api`), `@tauri-apps/cli` `2.12.2` (devDependency of `apps/desktop`), crates `tauri` `2.12.3`, `tauri-build` `2.7.2`, `tauri-plugin-dialog` `2.8.2`. Nothing else: no `@fastify/static`, `tauri-plugin-shell`, `reqwest`, `libc`, `nix`, `regex`.
- Target: macOS arm64 only, ad-hoc signing (`signingIdentity: "-"`), no notarization.
- Port `3101`. Origin `http://127.0.0.1:3101`. Data directory `~/Library/Application Support/LifeDashboard Desktop`, log `<dataDir>/logs/api.log` (truncated per launch).
- Ready line, verbatim: `LifeDashboard API listening on http://127.0.0.1:<port>`.
- Pairing line printed by `server.ts`, unchanged: `LifeDashboard pairing code: <6 digits> (valid until <time>)`.
- UI copy (Russian, verbatim): «Код сопряжения» (field label), «Новый код выведен в терминал API или в окно приложения», pairing dialog «Код сопряжения LifeDashboard: <code> — действует до <time>».
- `apps/desktop/package.json` has no `build`, `dev`, `typecheck` or `test` script (root `pnpm build` / `pnpm dev` would recurse or start it). The build script is `package`; run it as `pnpm -C apps/desktop run package`.
- Ready timeout 15 s, stop timeout 5 s, error dialog shows the last 20 log lines.
- Browser work uses Orca's built-in browser through `orca-cli` (project rule); the Tauri window itself is a native app and is checked directly.
- Run each task's package tests; Task 5 and Task 9 also run `pnpm typecheck` and `pnpm test` at the root.

## Review Focus

- A time with a narrow no-break space (`9:46:10 AM`, what `toLocaleTimeString` prints on current ICU) must still produce the pairing dialog — Task 7 test `accepts_a_narrow_no_break_space_in_the_time`.
- Reloading a deep SPA path (`/rooms/main/screen`) must return the app, while a stale hashed asset (`/_nuxt/old.js`) must be a 404, not HTML that WebKit runs as a broken script — Task 3 tests.
- Encoded traversal (`/%2e%2e/secret.txt`, `/..%2fsecret.txt`) must never return a file outside the UI directory — Task 3 test.
- Unknown `/api/...` and `/sandbox/...` paths must keep their JSON errors (401/404), never fall back to `index.html` — Task 3 test.
- The wrapper must ignore a ready line for another port and a `/health` from a foreign server on 3101 — Task 7 test `ready_line_matches_only_its_port`, Task 10 acceptance item 10.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/src/config.ts` (modify) | Parse `LIFEDASHBOARD_UI_DIR`, `LIFEDASHBOARD_RUNTIME_DIR` |
| `apps/api/src/ui-static.ts` (create) | Serve the generated UI with SPA fallback |
| `apps/api/src/app.ts` (modify) | Pass the new config; register `ui-static.ts` when `uiDir` is set |
| `apps/api/src/sandbox.ts` (modify) | Read runtime files from `runtimeDir` when set |
| `apps/api/src/auth.ts` (modify) | Startup code only without an unexpired session |
| `apps/api/src/server.ts` (modify) | Print the ready line after `listen` |
| `apps/api/vite.bundle.config.ts` (create) | SSR bundle of `src/server.ts` |
| `apps/api/scripts/copy-runtime.mjs` (create) | Copy `vue.js` and `sdk.js` next to the bundle |
| `apps/api/scripts/smoke-bundle.mjs` (create) | Start the bundle like the desktop app and probe it |
| `apps/ui/app/PairingForm.vue` (modify) | Desktop-neutral copy |
| `apps/desktop/package.json` (create) | `package` script, `@tauri-apps/cli` |
| `apps/desktop/scripts/prepare-node.mjs` (create) | Copy Node 24 arm64 as the sidecar |
| `apps/desktop/src-tauri/{Cargo.toml,Cargo.lock,build.rs,tauri.conf.json}` (create) | Tauri project |
| `apps/desktop/src-tauri/icons/*` (create) | App icon (source SVG + generated files) |
| `apps/desktop/src-tauri/src/lines.rs` (create) | Pure parsers for the API's stdout lines |
| `apps/desktop/src-tauri/src/main.rs` (create) | Sidecar lifecycle, log, dialogs, window |
| `.gitignore`, `README.md`, `AGENTS.md` (modify) | Ignores and docs |

---

### Task 1: API config for the UI and runtime directories

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/test/config.test.ts`

**Interfaces:**
- Produces: `ApiConfig` gains `uiDir?: string` and `runtimeDir?: string` (absent when the variable is unset). Error messages `Invalid LIFEDASHBOARD_UI_DIR: "<raw>"`, `Invalid LIFEDASHBOARD_RUNTIME_DIR: "<raw>"`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('loadConfig', ...)` in `apps/api/test/config.test.ts`:

```ts
  it('reads absolute LIFEDASHBOARD_UI_DIR and LIFEDASHBOARD_RUNTIME_DIR', () => {
    const config = loadConfig(
      { LIFEDASHBOARD_UI_DIR: '/app/ui', LIFEDASHBOARD_RUNTIME_DIR: '/app/api/runtime' },
      'darwin',
      HOME,
    )
    expect(config.uiDir).toBe('/app/ui')
    expect(config.runtimeDir).toBe('/app/api/runtime')
  })

  it('leaves uiDir and runtimeDir out when unset', () => {
    const config = loadConfig({}, 'darwin', HOME)
    expect('uiDir' in config).toBe(false)
    expect('runtimeDir' in config).toBe(false)
  })

  it.each([
    ['LIFEDASHBOARD_UI_DIR', 'ui'],
    ['LIFEDASHBOARD_UI_DIR', ''],
    ['LIFEDASHBOARD_RUNTIME_DIR', 'runtime'],
    ['LIFEDASHBOARD_RUNTIME_DIR', ''],
  ])('rejects a relative %s %j', (name, value) => {
    expect(() => loadConfig({ [name]: value }, 'darwin', HOME)).toThrow(`Invalid ${name}: "${value}"`)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/config.test.ts`
Expected: FAIL — `config.uiDir` is `undefined`; the rejection cases do not throw.

- [ ] **Step 3: Implement**

In `apps/api/src/config.ts`, extend the interface and `loadConfig`, and add one parser:

```ts
export interface ApiConfig {
  host: '127.0.0.1'
  port: number
  dataDir: string
  uiOrigins: string[]
  // Desktop app only (spec 2026-10-11 «Configuration»): the generated UI and the sandbox runtime files.
  uiDir?: string
  runtimeDir?: string
}
```

```ts
export function loadConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): ApiConfig {
  const config: ApiConfig = {
    host: '127.0.0.1',
    port: parsePort(env.LIFEDASHBOARD_API_PORT),
    dataDir: parseDataDir(env, platform, home),
    uiOrigins: parseOrigins(env.LIFEDASHBOARD_UI_ORIGINS),
  }
  const uiDir = parseOptionalDir('LIFEDASHBOARD_UI_DIR', env.LIFEDASHBOARD_UI_DIR)
  if (uiDir !== undefined) config.uiDir = uiDir
  const runtimeDir = parseOptionalDir('LIFEDASHBOARD_RUNTIME_DIR', env.LIFEDASHBOARD_RUNTIME_DIR)
  if (runtimeDir !== undefined) config.runtimeDir = runtimeDir
  return config
}
```

```ts
function parseOptionalDir(name: string, raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (!isAbsolute(raw)) throw new Error(`Invalid ${name}: "${raw}"`)
  return raw
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/config.test.ts`
Expected: PASS, including the existing default-object test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/test/config.test.ts
git commit -m "feat(api): read optional UI and runtime directories from env"
```

---

### Task 2: Sandbox runtime files from `runtimeDir`

**Files:**
- Modify: `apps/api/src/app.ts`, `apps/api/src/sandbox.ts`
- Modify: `apps/api/test/helpers.ts`
- Test: `apps/api/test/sandbox.test.ts`

**Interfaces:**
- Consumes: `ApiConfig.runtimeDir` (Task 1).
- Produces: `AppDeps.config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir' | 'uiDir' | 'runtimeDir'>`; `SandboxDeps.config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir' | 'runtimeDir'>`; test helper `testApp(base?, extra?: Pick<ApiConfig, 'uiDir' | 'runtimeDir'>)`.

- [ ] **Step 1: Extend the test helper**

In `apps/api/test/helpers.ts` add `import type { ApiConfig } from '../src/config.ts'` and change `testApp`:

```ts
/** A test app on an in-memory database and a temporary data dir, or on `base` (then the caller closes both). */
export async function testApp(base?: Pick<TestApp, 'db' | 'dataDir'>, extra: Pick<ApiConfig, 'uiDir' | 'runtimeDir'> = {}): Promise<TestApp> {
```

and the `buildApp` call:

```ts
    config: { port: 3001, uiOrigins: [ORIGIN], dataDir, ...extra },
```

- [ ] **Step 2: Write the failing test**

Add to `apps/api/test/sandbox.test.ts` (merge the `node:fs`, `node:os`, `node:path` imports with the existing ones):

```ts
describe('GET /sandbox/runtime/:file with runtimeDir', () => {
  it('serves vue.js and sdk.js from runtimeDir and still refuses other names', async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'ld-runtime-'))
    writeFileSync(join(runtimeDir, 'vue.js'), 'export const fromRuntimeDir = "vue"')
    writeFileSync(join(runtimeDir, 'sdk.js'), 'export const fromRuntimeDir = "sdk"')
    writeFileSync(join(runtimeDir, 'evil.js'), 'export const evil = 1')
    const desktop = await testApp(undefined, { runtimeDir })
    try {
      const vue = await call(desktop.app, { url: '/sandbox/runtime/vue.js', origin: 'null' })
      expect([vue.statusCode, vue.body]).toEqual([200, 'export const fromRuntimeDir = "vue"'])
      const sdk = await call(desktop.app, { url: '/sandbox/runtime/sdk.js', origin: 'null' })
      expect([sdk.statusCode, sdk.headers['content-type'], sdk.body]).toEqual([
        200,
        'text/javascript; charset=utf-8',
        'export const fromRuntimeDir = "sdk"',
      ])
      expect((await call(desktop.app, { url: '/sandbox/runtime/evil.js' })).statusCode).toBe(404)
    } finally {
      await desktop.close()
      rmSync(runtimeDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/sandbox.test.ts`
Expected: FAIL — `vue.js` returns the real Vue runtime, not `fromRuntimeDir` (Vitest strips types, so the failure is behavioral).

- [ ] **Step 4: Widen the config types**

`apps/api/src/app.ts`:

```ts
  config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir' | 'uiDir' | 'runtimeDir'>
```

`apps/api/src/sandbox.ts`:

```ts
export interface SandboxDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir' | 'runtimeDir'>
}
```

- [ ] **Step 5: Implement**

In the `/sandbox/runtime/:file` handler of `apps/api/src/sandbox.ts`:

```ts
  app.get<{ Params: { file: string } }>('/sandbox/runtime/:file', async (request, reply) => {
    const locate = RUNTIME_FILES.get(request.params.file)
    if (!locate) throw new ApiError('NOT_FOUND', 'Runtime file not found')
    // The desktop app ships both files next to the API bundle (spec 2026-10-11 «Sandbox runtime»).
    const file = config.runtimeDir === undefined ? locate() : join(config.runtimeDir, request.params.file)
    let body: string
    try {
      body = await readFile(file, 'utf8')
    } catch {
      throw new ApiError('NOT_FOUND', 'Runtime file is missing; run pnpm -C packages/widget-sdk build')
    }
    return reply.header('cache-control', 'no-cache').type(JS).send(body)
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/sandbox.test.ts`
Expected: PASS, including the existing runtime tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/sandbox.ts apps/api/test/helpers.ts apps/api/test/sandbox.test.ts
git commit -m "feat(api): serve sandbox runtime files from a configured directory"
```

---

### Task 3: Static UI serving

**Files:**
- Create: `apps/api/src/ui-static.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/ui-static.test.ts`

**Interfaces:**
- Consumes: `ApiConfig.uiDir` (Task 1), `testApp(base?, extra?)` (Task 2), `allowedHosts` (`auth.ts`), `resolveInside` (`userwidgets.ts`), `fileExtension`, `SERVED_TYPES` (`@lifedashboard/contracts/widget-package`).
- Produces: `registerUiStatic(app: FastifyInstance, deps: { config: Pick<ApiConfig, 'port'> & { uiDir: string } }): void`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/ui-static.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { call, errorCode, pair, testApp, type TestApp } from './helpers.ts'

const INDEX = '<!doctype html><title>LifeDashboard</title>'
const IMMUTABLE = 'public, max-age=31536000, immutable'

let root: string
let t: TestApp

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ld-ui-'))
  const uiDir = join(root, 'public')
  mkdirSync(join(uiDir, '_nuxt'), { recursive: true })
  writeFileSync(join(uiDir, 'index.html'), INDEX)
  writeFileSync(join(uiDir, '_nuxt', 'entry.abc123.js'), 'console.log(1)')
  writeFileSync(join(uiDir, 'favicon.ico'), 'ico')
  writeFileSync(join(root, 'secret.txt'), 'secret')
  t = await testApp(undefined, { uiDir })
})

afterEach(async () => {
  await t.close()
  rmSync(root, { recursive: true, force: true })
})

describe('static UI', () => {
  it('serves index.html at / without caching', async () => {
    const response = await call(t.app, { url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.body).toBe(INDEX)
  })

  it('serves a hashed asset as immutable JavaScript', async () => {
    const response = await call(t.app, { url: '/_nuxt/entry.abc123.js' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(response.headers['cache-control']).toBe(IMMUTABLE)
    expect(response.body).toBe('console.log(1)')
  })

  it('serves favicon.ico with its type', async () => {
    const response = await call(t.app, { url: '/favicon.ico' })
    expect([response.statusCode, response.headers['content-type']]).toEqual([200, 'image/x-icon'])
  })

  it('falls back to index.html for an extensionless SPA path', async () => {
    const response = await call(t.app, { url: '/rooms/main/screen' })
    expect([response.statusCode, response.body]).toEqual([200, INDEX])
  })

  it('answers 404 for a missing file with an extension', async () => {
    const response = await call(t.app, { url: '/_nuxt/old.js' })
    expect([response.statusCode, errorCode(response)]).toEqual([404, 'NOT_FOUND'])
  })

  it.each(['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/_nuxt/..%2f..%2fsecret.txt'])(
    'never serves a file outside the UI directory: %s',
    async (url) => {
      const response = await call(t.app, { url })
      expect(response.statusCode).toBe(404)
      expect(response.body).not.toContain('secret')
    },
  )

  it('does not shadow API, sandbox or health routes', async () => {
    const unauthorized = await call(t.app, { url: '/api/v1/probe' })
    expect([unauthorized.statusCode, errorCode(unauthorized)]).toEqual([401, 'UNAUTHORIZED'])
    const cookie = await pair(t)
    const unknownApi = await call(t.app, { url: '/api/v1/probe', cookie })
    expect([unknownApi.statusCode, errorCode(unknownApi)]).toEqual([404, 'NOT_FOUND'])
    const unknownSandbox = await call(t.app, { url: '/sandbox/unknown' })
    expect([unknownSandbox.statusCode, errorCode(unknownSandbox)]).toEqual([404, 'NOT_FOUND'])
    expect((await call(t.app, { url: '/health' })).json()).toEqual({ status: 'ok' })
  })

  it('rejects a foreign Host', async () => {
    const response = await call(t.app, { url: '/', host: 'evil.test:3001' })
    expect([response.statusCode, errorCode(response)]).toEqual([403, 'FORBIDDEN'])
  })
})

describe('without uiDir', () => {
  it('does not serve the UI', async () => {
    const plain = await testApp()
    try {
      const response = await call(plain.app, { url: '/' })
      expect([response.statusCode, errorCode(response)]).toEqual([404, 'NOT_FOUND'])
    } finally {
      await plain.close()
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/ui-static.test.ts`
Expected: FAIL — `/` answers 404 `Route not found` in the `static UI` block (the `without uiDir` test already passes).

- [ ] **Step 3: Implement `ui-static.ts`**

Create `apps/api/src/ui-static.ts`:

```ts
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { fileExtension, SERVED_TYPES } from '@lifedashboard/contracts/widget-package'
import { allowedHosts } from './auth.ts'
import type { ApiConfig } from './config.ts'
import { ApiError } from './errors.ts'
import { resolveInside } from './userwidgets.ts'

const HTML = 'text/html; charset=utf-8'
const UI_TYPES: Readonly<Record<string, string>> = {
  ...SERVED_TYPES,
  html: HTML,
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
}
const IMMUTABLE = 'public, max-age=31536000, immutable'
// Unmatched paths under these prefixes keep their JSON 404 instead of the SPA fallback.
const RESERVED = /^\/(api|sandbox)(\/|$|\?)/

export interface UiStaticDeps {
  config: Pick<ApiConfig, 'port'> & { uiDir: string }
}

// Spec 2026-10-11 «Static UI»: the generated SPA on the API origin, for the desktop app.
export function registerUiStatic(app: FastifyInstance, { config }: UiStaticDeps): void {
  const hosts = allowedHosts(config)

  app.get<{ Params: { '*': string } }>('/*', async (request, reply) => {
    const host = request.headers.host
    if (host === undefined || !hosts.has(host)) throw new ApiError('FORBIDDEN', 'Host is not allowed')
    if (RESERVED.test(request.url)) throw new ApiError('NOT_FOUND', 'Route not found')
    const path = request.params['*']
    const full = resolveInside(config.uiDir, path)
    const info = full === null ? null : await stat(full).catch(() => null)
    reply.header('x-content-type-options', 'nosniff')
    if (full !== null && info?.isFile()) {
      return reply
        .header('cache-control', path.startsWith('_nuxt/') ? IMMUTABLE : 'no-cache')
        .header('content-length', info.size)
        .type(UI_TYPES[fileExtension(path)] ?? 'application/octet-stream')
        .send(createReadStream(full))
    }
    if (fileExtension(path) !== '') throw new ApiError('NOT_FOUND', 'File not found')
    return reply.header('cache-control', 'no-cache').type(HTML).send(createReadStream(join(config.uiDir, 'index.html')))
  })
}
```

- [ ] **Step 4: Register it**

In `apps/api/src/app.ts` add `import { registerUiStatic } from './ui-static.ts'` and, after `registerSandbox(...)`:

```ts
  if (config.uiDir !== undefined) registerUiStatic(app, { config: { port: config.port, uiDir: config.uiDir } })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/ui-static.test.ts`
Expected: PASS. If a traversal case returns 200 with `INDEX`, the decoded path had no extension; that is safe but the test expects 404 — inspect the decoded `path` before changing either side, and keep the guarantee that `secret` is never served.

- [ ] **Step 6: Run the whole API suite and typecheck**

Run: `pnpm -C apps/api test && pnpm -C apps/api typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ui-static.ts apps/api/src/app.ts apps/api/test/ui-static.test.ts
git commit -m "feat(api): serve the generated UI with SPA fallback when UI dir is set"
```

---

### Task 4: Pairing for the desktop app

**Files:**
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/ui/app/PairingForm.vue`
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: `testApp(base?)`, `pair`, `call` from `apps/api/test/helpers.ts`.
- Produces: `registerAuth` calls `onPairingCode` at registration only when `sessions` has no row with `expires_at` later than `now()`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/auth.test.ts` (`DAY` and `T0` are already imported):

```ts
describe('startup code', () => {
  it('is not issued when an unexpired session exists', async () => {
    await pair(t)
    const restarted = await testApp(t)
    try {
      expect(restarted.codes).toEqual([])
    } finally {
      await restarted.close()
    }
  })

  it('is issued when every session has expired', async () => {
    t.db
      .prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
      .run('expired', new Date(T0 - 31 * DAY).toISOString(), new Date(T0 - DAY).toISOString())
    const restarted = await testApp(t)
    try {
      expect(restarted.codes).toHaveLength(1)
    } finally {
      await restarted.close()
    }
  })

  it('is still issued on request while a session exists', async () => {
    await pair(t)
    const restarted = await testApp(t)
    try {
      expect((await call(restarted.app, { method: 'POST', url: PAIR_CODE, payload: {} })).statusCode).toBe(200)
      expect(restarted.codes).toHaveLength(1)
    } finally {
      await restarted.close()
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/auth.test.ts`
Expected: FAIL — `is not issued when an unexpired session exists` gets one code.

- [ ] **Step 3: Implement**

At the end of `registerAuth` in `apps/api/src/auth.ts`, replace the final `issueCode()` with:

```ts
  // Spec 2026-10-11 «Pairing at start»: a paired install starts without a code; «Новый код» still issues one.
  const paired = db.prepare('SELECT 1 FROM sessions WHERE expires_at > ? LIMIT 1').get(now().toISOString())
  if (paired === undefined) issueCode()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/auth.test.ts`
Expected: PASS, including `prints a 6-digit code on start`.

- [ ] **Step 5: Update the UI copy**

In `apps/ui/app/PairingForm.vue` change the label text `Код из терминала API` to `Код сопряжения`, and `'Новый код выведен в терминал API'` to `'Новый код выведен в терминал API или в окно приложения'`. No test covers this component (the UI suite has no component tests); verify with:

Run: `grep -n "Код сопряжения\|или в окно приложения" apps/ui/app/PairingForm.vue && pnpm -C apps/ui typecheck`
Expected: two matching lines; typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth.ts apps/api/test/auth.test.ts apps/ui/app/PairingForm.vue
git commit -m "feat: skip the startup pairing code for a paired install"
```

---

### Task 5: API bundle, ready line and smoke check

**Files:**
- Create: `apps/api/vite.bundle.config.ts`, `apps/api/scripts/copy-runtime.mjs`, `apps/api/scripts/smoke-bundle.mjs`
- Modify: `apps/api/package.json`, `apps/api/src/server.ts`, `.gitignore`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `LIFEDASHBOARD_UI_DIR`, `LIFEDASHBOARD_RUNTIME_DIR` (Tasks 1–3).
- Produces: `pnpm -C apps/api build:bundle` → `apps/api/dist-bundle/server.mjs`, `apps/api/dist-bundle/runtime/vue.js`, `apps/api/dist-bundle/runtime/sdk.js`; `pnpm -C apps/api smoke:bundle`; stdout line `LifeDashboard API listening on http://127.0.0.1:<port>`.

- [ ] **Step 1: Add Vite to the API**

Run: `pnpm -C apps/api add -D vite@8.3.2`
Expected: `apps/api/package.json` gets `"vite": "8.3.2"` under `devDependencies`; the lockfile resolves to the version already used by `packages/widget-sdk`.

- [ ] **Step 2: Add the bundle config, runtime copy and scripts**

Create `apps/api/vite.bundle.config.ts` (its own name so Vitest never loads it):

```ts
import { defineConfig } from 'vite'

// One self-contained file for the desktop app's Node sidecar (spec 2026-10-11 «Bundle»).
// @lifedashboard/contracts exports .ts sources, which Node refuses to strip under node_modules.
export default defineConfig({
  logLevel: 'warn',
  build: {
    ssr: 'src/server.ts',
    outDir: 'dist-bundle',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    rolldownOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
  ssr: { noExternal: true, target: 'node' },
})
```

Create `apps/api/scripts/copy-runtime.mjs`:

```js
// Copies the sandbox runtime files next to the bundle; sandbox.ts reads them via LIFEDASHBOARD_RUNTIME_DIR.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const out = new URL('../dist-bundle/runtime/', import.meta.url)
mkdirSync(out, { recursive: true })
copyFileSync(require.resolve('vue/dist/vue.runtime.esm-browser.prod.js'), new URL('vue.js', out))
copyFileSync(join(dirname(require.resolve('@lifedashboard/widget-sdk/package.json')), 'dist', 'sandbox.js'), new URL('sdk.js', out))
```

Add to `apps/api/package.json` `scripts`:

```json
    "build:bundle": "vite build -c vite.bundle.config.ts && node scripts/copy-runtime.mjs",
    "smoke:bundle": "node scripts/smoke-bundle.mjs",
```

Add to `.gitignore` under «Dependencies and build output»:

```gitignore
dist-bundle/
/apps/desktop/src-tauri/target/
/apps/desktop/src-tauri/binaries/
/apps/desktop/src-tauri/gen/
```

- [ ] **Step 3: Write the smoke check (the failing test)**

Create `apps/api/scripts/smoke-bundle.mjs`:

```js
// Starts the bundled API the way the desktop app does and probes it (spec 2026-10-11 «Testing»).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 3199
const ORIGIN = `http://127.0.0.1:${PORT}`
const READY = `LifeDashboard API listening on ${ORIGIN}`
const bundle = fileURLToPath(new URL('../dist-bundle/', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'ld-smoke-'))
const uiDir = join(temp, 'ui')
mkdirSync(uiDir)
writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>smoke</title>')

const child = spawn(process.execPath, [join(bundle, 'server.mjs')], {
  env: {
    ...process.env,
    LIFEDASHBOARD_API_PORT: String(PORT),
    LIFEDASHBOARD_DATA_DIR: join(temp, 'data'),
    LIFEDASHBOARD_UI_ORIGINS: ORIGIN,
    LIFEDASHBOARD_UI_DIR: uiDir,
    LIFEDASHBOARD_RUNTIME_DIR: join(bundle, 'runtime'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
const exited = new Promise((resolve) => child.once('exit', resolve))

function waitForReady() {
  return new Promise((resolve, reject) => {
    let buffered = ''
    const timer = setTimeout(() => reject(new Error('no ready line within 15 s')), 15_000)
    exited.then((code) => {
      clearTimeout(timer)
      reject(new Error(`API exited with ${code}`))
    })
    child.stdout.on('data', (chunk) => {
      buffered += chunk
      if (buffered.split('\n').some((line) => line.trim() === READY)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

let failed = false
try {
  await waitForReady()
  for (const path of ['/health', '/', '/sandbox/runtime/sdk.js']) {
    const response = await fetch(`${ORIGIN}${path}`)
    console.log(`${response.status} ${path}`)
    if (response.status !== 200) failed = true
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  child.kill('SIGTERM')
  await exited
  rmSync(temp, { recursive: true, force: true })
}
console.log(failed ? 'smoke: FAIL' : 'smoke: OK')
process.exit(failed ? 1 : 0)
```

- [ ] **Step 4: Build the bundle and run the smoke check to verify it fails**

Run: `pnpm -C packages/widget-sdk build && pnpm -C apps/api build:bundle && ls apps/api/dist-bundle apps/api/dist-bundle/runtime && pnpm -C apps/api smoke:bundle`
Expected: `server.mjs`, `runtime/vue.js`, `runtime/sdk.js` exist; smoke prints `no ready line within 15 s` and `smoke: FAIL` (exit 1). Any other error (for example a bundling `Dynamic require` or `ERR_MODULE_NOT_FOUND`) is a real defect: stop and debug it with superpowers:systematic-debugging before continuing.

- [ ] **Step 5: Print the ready line**

In `apps/api/src/server.ts`, after the `try { await app.listen(...) } catch { ... }` block, add:

```ts
// The desktop app opens its window only after this exact line from its own child (spec 2026-10-11 «Ready line»).
console.log(`LifeDashboard API listening on http://${config.host}:${config.port}`)
```

- [ ] **Step 6: Rebuild and run the smoke check to verify it passes**

Run: `pnpm -C apps/api build:bundle && pnpm -C apps/api smoke:bundle`
Expected: `200 /health`, `200 /`, `200 /sandbox/runtime/sdk.js`, `smoke: OK`, exit 0.

- [ ] **Step 7: Run the root checks**

Run: `pnpm typecheck && pnpm test`
Expected: both exit 0. `git status --short` shows no `dist-bundle` files.

- [ ] **Step 8: Commit**

```bash
git add .gitignore apps/api/package.json apps/api/vite.bundle.config.ts apps/api/scripts apps/api/src/server.ts pnpm-lock.yaml
git commit -m "build(api): bundle the API for the desktop sidecar and print a ready line"
```

---

### Task 6: Desktop package scaffold

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/scripts/prepare-node.mjs`
- Create: `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/build.rs`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/icons/source.svg` and generated `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.png`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `apps/api/dist-bundle/` (Task 5), `apps/ui/.output/public/` (`nuxt generate`).
- Produces: `src-tauri/binaries/node-aarch64-apple-darwin` after `node apps/desktop/scripts/prepare-node.mjs`; a compiling Tauri crate `lifedashboard-desktop` with `mod lines;` declared.

- [ ] **Step 1: Create the npm package**

Create `apps/desktop/package.json`:

```json
{
  "name": "@lifedashboard/desktop",
  "private": true,
  "type": "module",
  "scripts": {
    "package": "tauri build"
  }
}
```

Run: `pnpm -C apps/desktop add -D @tauri-apps/cli@2.12.2`
Expected: `"@tauri-apps/cli": "2.12.2"` in `devDependencies`; `pnpm -C apps/desktop exec tauri --version` prints `tauri-cli 2.12.2`.

- [ ] **Step 2: Create the Node sidecar script**

Create `apps/desktop/scripts/prepare-node.mjs`:

```js
// Copies the running Node as the Tauri sidecar; Tauri requires the target-triple suffix (spec 2026-10-11 «Build»).
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

if (process.versions.node.split('.')[0] !== '24' || process.arch !== 'arm64') {
  console.error(`prepare-node: Node 24 on arm64 is required, got ${process.version} on ${process.arch}`)
  process.exit(1)
}
const dir = new URL('../src-tauri/binaries/', import.meta.url)
mkdirSync(dir, { recursive: true })
const target = fileURLToPath(new URL('node-aarch64-apple-darwin', dir))
copyFileSync(process.execPath, target)
chmodSync(target, 0o755)
console.log(`prepare-node: ${process.execPath} (${process.version}) -> ${target}`)
```

Run: `node apps/desktop/scripts/prepare-node.mjs && apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin --version`
Expected: `v24.21.0` (or the installed 24.x).

- [ ] **Step 3: Create the icon**

Create `apps/desktop/src-tauri/icons/source.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="#14161f"/>
  <rect x="192" y="192" width="300" height="300" rx="56" fill="#7c8cff"/>
  <rect x="532" y="192" width="300" height="140" rx="40" fill="#4fd1c5"/>
  <rect x="532" y="372" width="300" height="120" rx="40" fill="#f6c177"/>
  <rect x="192" y="532" width="640" height="300" rx="56" fill="#e7e9f3" fill-opacity="0.85"/>
</svg>
```

Generate into a scratch directory and copy only the desktop files (the command also emits Windows, Android and iOS icons that this build does not use):

```bash
ICONS_TMP="$(mktemp -d)"
pnpm -C apps/desktop exec tauri icon src-tauri/icons/source.svg -o "$ICONS_TMP"
cp "$ICONS_TMP"/{32x32.png,128x128.png,128x128@2x.png,icon.icns,icon.png} apps/desktop/src-tauri/icons/
ls apps/desktop/src-tauri/icons
```

Expected: `source.svg` and the five generated files.

- [ ] **Step 4: Create the Tauri project files**

Create `apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "lifedashboard-desktop"
version = "0.1.0"
edition = "2021"
publish = false

[build-dependencies]
tauri-build = { version = "2.7.2", features = [] }

[dependencies]
tauri = { version = "2.12.3", features = [] }
tauri-plugin-dialog = "2.8.2"
```

Create `apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

Create `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "LifeDashboard",
  "version": "0.1.0",
  "identifier": "dev.lifedashboard.desktop",
  "build": {
    "frontendDist": "http://127.0.0.1:3101",
    "beforeBuildCommand": "pnpm -C ../.. build && pnpm -C ../api build:bundle && node scripts/prepare-node.mjs"
  },
  "app": {
    "windows": [],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.png"],
    "externalBin": ["binaries/node"],
    "resources": {
      "../../api/dist-bundle/": "api/",
      "../../ui/.output/public/": "ui/"
    },
    "macOS": { "signingIdentity": "-" }
  }
}
```

`beforeBuildCommand` runs in `apps/desktop` (Tauri CLI uses the directory of the nearest `package.json` above the working directory); `frontendDist` as a URL embeds no assets. No `capabilities/` directory: the remote page gets no IPC.

Create `apps/desktop/src-tauri/src/main.rs` (Task 8 replaces it):

```rust
mod lines;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("failed to run LifeDashboard");
}
```

Create `apps/desktop/src-tauri/src/lines.rs` with only a module comment for now:

```rust
//! Parsers for the API's stdout lines (spec 2026-10-11 «Wrapper»).
```

- [ ] **Step 5: Verify the crate compiles**

Run: `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: builds; `Cargo.lock` is created. `tauri-build` checks that `binaries/node-aarch64-apple-darwin` exists, which Step 2 provides.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json apps/desktop/scripts apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/build.rs apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/icons apps/desktop/src-tauri/src pnpm-lock.yaml
git commit -m "build(desktop): scaffold the Tauri package with a Node sidecar"
```

---

### Task 7: Stdout line parsers

**Files:**
- Modify: `apps/desktop/src-tauri/src/lines.rs`

**Interfaces:**
- Produces: `pub fn pairing_code(line: &str) -> Option<(&str, &str)>` returning `(code, until)`; `pub fn is_ready(line: &str, port: u16) -> bool`.

- [ ] **Step 1: Write the failing tests with stub functions**

Replace `apps/desktop/src-tauri/src/lines.rs` with:

```rust
//! Parsers for the API's stdout lines (spec 2026-10-11 «Wrapper»).

/// `(code, until)` from `LifeDashboard pairing code: 123456 (valid until 9:46:10 AM)`.
pub fn pairing_code(_line: &str) -> Option<(&str, &str)> {
    None
}

/// The line `server.ts` prints after `listen` on `port`.
pub fn is_ready(_line: &str, _port: u16) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_pairing_line() {
        assert_eq!(
            pairing_code("LifeDashboard pairing code: 012345 (valid until 9:46:10 AM)"),
            Some(("012345", "9:46:10 AM"))
        );
    }

    #[test]
    fn accepts_a_narrow_no_break_space_in_the_time() {
        assert_eq!(
            pairing_code("LifeDashboard pairing code: 721108 (valid until 9:46:10\u{202f}AM)"),
            Some(("721108", "9:46:10\u{202f}AM"))
        );
    }

    #[test]
    fn rejects_a_code_that_is_not_six_digits() {
        assert_eq!(pairing_code("LifeDashboard pairing code: 12345 (valid until 9:46 AM)"), None);
        assert_eq!(pairing_code("LifeDashboard pairing code: 1234567 (valid until 9:46 AM)"), None);
        assert_eq!(pairing_code("LifeDashboard pairing code: 12a456 (valid until 9:46 AM)"), None);
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(pairing_code(""), None);
        assert_eq!(
            pairing_code(r#"{"level":30,"msg":"Server listening at http://127.0.0.1:3101"}"#),
            None
        );
    }

    #[test]
    fn ready_line_matches_only_its_port() {
        assert!(is_ready("LifeDashboard API listening on http://127.0.0.1:3101", 3101));
        assert!(!is_ready("LifeDashboard API listening on http://127.0.0.1:3001", 3101));
        assert!(!is_ready(r#"{"level":30,"msg":"Server listening at http://127.0.0.1:3101"}"#, 3101));
        assert!(!is_ready("", 3101));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml lines`
Expected: FAIL — `reads_a_pairing_line`, `accepts_a_narrow_no_break_space_in_the_time` and `ready_line_matches_only_its_port` fail; the two `None`-only tests pass.

- [ ] **Step 3: Implement**

Replace the two stub functions:

```rust
const PAIRING_PREFIX: &str = "LifeDashboard pairing code: ";

/// `(code, until)` from `LifeDashboard pairing code: 123456 (valid until 9:46:10 AM)`.
/// `until` is whatever `toLocaleTimeString` printed, including non-ASCII spaces.
pub fn pairing_code(line: &str) -> Option<(&str, &str)> {
    let rest = line.trim().strip_prefix(PAIRING_PREFIX)?;
    let (code, rest) = rest.split_at_checked(6)?;
    if !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let until = rest.strip_prefix(" (valid until ")?.strip_suffix(')')?;
    Some((code, until))
}

/// The line `server.ts` prints after `listen` on `port`.
pub fn is_ready(line: &str, port: u16) -> bool {
    line.trim() == format!("LifeDashboard API listening on http://127.0.0.1:{port}")
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml lines`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/lines.rs
git commit -m "feat(desktop): parse pairing and ready lines from the API output"
```

---

### Task 8: Wrapper lifecycle and package build

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `lines::pairing_code`, `lines::is_ready` (Task 7); resources `api/server.mjs`, `api/runtime/`, `ui/` and the `node` sidecar next to the executable (Task 6).
- Produces: `LifeDashboard.app` and `LifeDashboard_0.1.0_aarch64.dmg` under `apps/desktop/src-tauri/target/release/bundle/`.

The lifecycle runs only inside a bundled app, so it has no unit test; its checks are Step 3 (build), Step 4 (package) and Task 10 (acceptance). The parsing logic it depends on is covered in Task 7.

- [ ] **Step 1: Implement `main.rs`**

Replace `apps/desktop/src-tauri/src/main.rs`:

```rust
mod lines;

use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const PORT: u16 = 3101;
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const LOG_TAIL: usize = 20;
// Separate from the dev data directory (spec 2026-10-11 «Decisions»).
const DATA_DIR_NAME: &str = "LifeDashboard Desktop";

enum ApiEvent {
    Ready,
    Exited,
}

#[derive(Default)]
struct Sidecar {
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
}

/// `<dataDir>/logs/api.log`, truncated per launch, plus the last lines for error dialogs.
#[derive(Clone)]
struct Log {
    file: Arc<Mutex<File>>,
    tail: Arc<Mutex<VecDeque<String>>>,
    path: PathBuf,
}

impl Log {
    fn create(path: PathBuf) -> std::io::Result<Self> {
        Ok(Self { file: Arc::new(Mutex::new(File::create(&path)?)), tail: Arc::default(), path })
    }

    fn write(&self, line: &str) {
        if let Ok(mut file) = self.file.lock() {
            let _ = writeln!(file, "{line}");
        }
        if let Ok(mut tail) = self.tail.lock() {
            if tail.len() == LOG_TAIL {
                tail.pop_front();
            }
            tail.push_back(line.to_owned());
        }
    }

    fn tail(&self) -> String {
        self.tail.lock().map(|tail| Vec::from(tail.clone()).join("\n")).unwrap_or_default()
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar::default())
        .setup(|app| {
            start(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build LifeDashboard");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop(app);
        }
    });
}

fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().data_dir()?.join(DATA_DIR_NAME);
    let logs = data_dir.join("logs");
    fs::create_dir_all(&logs)?;
    let log = Log::create(logs.join("api.log"))?;
    let resources = app.path().resource_dir()?;
    // externalBin lands next to the app executable without the target-triple suffix.
    let node = std::env::current_exe()?.parent().ok_or("no executable directory")?.join("node");
    let origin = format!("http://127.0.0.1:{PORT}");

    let mut child = Command::new(node)
        .arg(resources.join("api").join("server.mjs"))
        .env("LIFEDASHBOARD_API_PORT", PORT.to_string())
        .env("LIFEDASHBOARD_DATA_DIR", &data_dir)
        .env("LIFEDASHBOARD_UI_ORIGINS", &origin)
        .env("LIFEDASHBOARD_UI_DIR", resources.join("ui"))
        .env("LIFEDASHBOARD_RUNTIME_DIR", resources.join("api").join("runtime"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().ok_or("no API stdout")?;
    let stderr = child.stderr.take().ok_or("no API stderr")?;
    *app.state::<Sidecar>().child.lock().map_err(|_| "sidecar lock poisoned")? = Some(child);

    let (events, received) = mpsc::channel();
    let ready = events.clone();
    let dialogs = app.clone();
    pump(
        stdout,
        log.clone(),
        move |line| {
            if let Some((code, until)) = lines::pairing_code(line) {
                dialogs
                    .dialog()
                    .message(format!("Код сопряжения LifeDashboard: {code} — действует до {until}"))
                    .title("LifeDashboard")
                    .show(|_| {});
            } else if lines::is_ready(line, PORT) {
                let _ = ready.send(ApiEvent::Ready);
            }
        },
        move || {
            let _ = events.send(ApiEvent::Exited);
        },
    );
    pump(stderr, log.clone(), |_| {}, || {});
    supervise(app.clone(), received, log, origin);
    Ok(())
}

/// Writes every line of `stream` to the log and to `on_line`; `on_end` runs once at EOF.
fn pump(
    stream: impl Read + Send + 'static,
    log: Log,
    mut on_line: impl FnMut(&str) + Send + 'static,
    on_end: impl FnOnce() + Send + 'static,
) {
    thread::spawn(move || {
        for chunk in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
            let line = String::from_utf8_lossy(&chunk);
            let line = line.trim_end_matches('\r');
            log.write(line);
            on_line(line);
        }
        on_end();
    });
}

/// Opens the window after the ready line from our own child; a `/health` answer could come
/// from another process that holds the port (spec 2026-10-11 «Ready line»).
fn supervise(app: AppHandle, events: Receiver<ApiEvent>, log: Log, origin: String) {
    thread::spawn(move || {
        match events.recv_timeout(READY_TIMEOUT) {
            Ok(ApiEvent::Ready) => {}
            Ok(ApiEvent::Exited) | Err(RecvTimeoutError::Disconnected) => {
                return fail(&app, "API завершился при запуске.", &log)
            }
            Err(RecvTimeoutError::Timeout) => return fail(&app, "API не запустился за 15 секунд.", &log),
        }
        if let Err(error) = open_window(&app, &origin) {
            return fail(&app, &format!("Не удалось открыть окно: {error}"), &log);
        }
        // Blocks until the API stops; a stop requested by the app is not an error.
        let _ = events.recv();
        fail(&app, "API неожиданно остановился.", &log);
    });
}

fn open_window(app: &AppHandle, origin: &str) -> Result<(), Box<dyn std::error::Error>> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("{origin}/").parse()?))
        .title("LifeDashboard")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1280.0, 720.0)
        // HTML5 folder drops must reach PackagesDialog.vue, not Tauri's file-drop handler.
        .disable_drag_drop_handler()
        .build()?;
    Ok(())
}

fn fail(app: &AppHandle, reason: &str, log: &Log) {
    if app.state::<Sidecar>().stopping.load(Ordering::SeqCst) {
        return;
    }
    app.dialog()
        .message(format!(
            "{reason}\n\nПоследние строки лога:\n{}\n\nЛог: {}",
            log.tail(),
            log.path.display()
        ))
        .title("LifeDashboard не работает")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    app.exit(1);
}

/// SIGTERM lets server.ts close the database; SIGKILL after STOP_TIMEOUT.
/// `/bin/kill` avoids a libc dependency; `Child::kill` sends SIGKILL.
fn stop(app: &AppHandle) {
    let sidecar = app.state::<Sidecar>();
    sidecar.stopping.store(true, Ordering::SeqCst);
    let Some(mut child) = sidecar.child.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    let _ = Command::new("/bin/kill").args(["-TERM", &child.id().to_string()]).status();
    let deadline = Instant::now() + STOP_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}
```

- [ ] **Step 2: Run the parser tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: 5 passed (the `lines` tests).

- [ ] **Step 3: Build without warnings**

Run: `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | grep -E "^(warning|error)" ; echo "grep exit $?"`
Expected: no `warning`/`error` lines (`grep exit 1`). Fix any warning at its cause; do not add `#[allow]`.

- [ ] **Step 4: Build the package**

Run: `pnpm -C apps/desktop run package`
Expected: `beforeBuildCommand` runs the root build, the API bundle and `prepare-node`; `tauri build` ends with paths to `LifeDashboard.app` and `LifeDashboard_0.1.0_aarch64.dmg` under `apps/desktop/src-tauri/target/release/bundle/`.

- [ ] **Step 5: Inspect the bundle**

Run:

```bash
APP=apps/desktop/src-tauri/target/release/bundle/macos/LifeDashboard.app
ls "$APP/Contents/MacOS" "$APP/Contents/Resources/api" "$APP/Contents/Resources/api/runtime" && ls "$APP/Contents/Resources/ui" | head
"$APP/Contents/MacOS/node" --version
codesign --verify --deep --strict --verbose=2 "$APP"
```

Expected: `MacOS/` holds the app binary and `node`; `Resources/api/` holds `server.mjs` and `runtime/{vue.js,sdk.js}`; `Resources/ui/` holds `index.html` and `_nuxt/`; `node` prints v24; `codesign` reports the bundle valid (ad-hoc). If a path differs from the layout `main.rs` expects, fix `main.rs` or `tauri.conf.json` and repeat Steps 3–5.

- [ ] **Step 6: Launch once from the build folder**

Run: `open apps/desktop/src-tauri/target/release/bundle/macos/LifeDashboard.app`, wait about 5 s, then `tail -5 ~/Library/Application\ Support/LifeDashboard\ Desktop/logs/api.log` and `pgrep -fl server.mjs`.
Expected: the pairing dialog appears; the log contains the ready line; one `node … server.mjs` process. Quit with Cmd+Q, then `pgrep -f server.mjs` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/main.rs
git commit -m "feat(desktop): run the API sidecar and open the board window"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`, `AGENTS.md`

- [ ] **Step 1: Update `README.md`**

Make exactly these changes:

1. Status note: replace `the Tauri desktop app, Hermes integration, and many planned widgets are not available yet` with `a local macOS desktop build exists (unsigned, arm64 only); Hermes integration and many planned widgets are not available yet`.
2. «What works today» table: replace the row `| Desktop app / animated backgrounds | Planned; there is no Tauri desktop distribution or animated-background system yet. |` with two rows:

```markdown
| Desktop app | Local macOS (Apple Silicon) build with Tauri: the app runs the same API and UI; ad-hoc signed, not notarized or distributed. |
| Animated backgrounds | Planned; there is no animated-background system yet. |
```

3. Architecture block: replace `Planned: Tauri desktop host; optional Hermes Agent adapter` with `Tauri desktop host (local macOS build); planned: optional Hermes Agent adapter`, and add the row `| [`apps/desktop`](apps/desktop) | Tauri 2 macOS wrapper: Node sidecar with the bundled API, one window on the API origin. |` to the path table after `apps/api`.
4. Replace the paragraph starting `The current UI runs in a browser with a local API. **Tauri packaging is a future delivery target**` with: `The UI runs in a browser with a local API during development. The desktop app reuses the same UI and backend: Tauri starts the bundled API and opens the UI it serves.`
5. After the «Configuration» section, add:

````markdown
### Desktop app (macOS, local build)

Requirements: Apple Silicon, Node.js 24, Rust (`rustup`), Xcode Command Line Tools.

```bash
pnpm install
pnpm -C apps/desktop run package
open apps/desktop/src-tauri/target/release/bundle/dmg/
```

Drag **LifeDashboard** from the `.dmg` to `/Applications` and start it. The app shows the pairing code in a dialog on first start. It uses port `3101` and its own data directory, `~/Library/Application Support/LifeDashboard Desktop` (separate from `pnpm dev`), and writes the API log to `logs/api.log` there. Install widgets again in the app through **«Виджеты» → «Выбрать папку»**.

The build is ad-hoc signed and not notarized; it is meant for the machine that built it.
````

6. Commands table: add `| `pnpm -C apps/desktop run package` | Build the macOS desktop app and `.dmg` (Apple Silicon). |`.
7. Replace `**This is not yet a packaged desktop installer.**` with `The desktop installer is built separately, see «Desktop app».`

- [ ] **Step 2: Update `AGENTS.md`**

Add the row `| `apps/desktop` | Tauri 2 macOS wrapper: Node sidecar running the bundled API, one window on the API origin. |` after `apps/api`, and after the commands line add: `Desktop build (macOS arm64): `pnpm -C apps/desktop run package`; the package has no `build`/`dev` script on purpose.`

- [ ] **Step 3: Verify**

Run: `grep -n "apps/desktop" README.md AGENTS.md && pnpm typecheck && pnpm test`
Expected: matches in both files; both commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document the local macOS desktop build"
```

---

### Task 10: Manual acceptance in the Tauri window

**Files:**
- Modify: `docs/superpowers/plans/2026-10-11-tauri-desktop.md` (append «Acceptance results»)

GUI steps (folder picker, drag and drop, dialogs) need a person at the Mac or the `computer-use` skill driving the native window. Run each item, record pass/fail with evidence; never mark an item passed without observing it.

- [ ] **Step 1: Prepare**

```bash
pnpm -C examples/widgets/hello build
pnpm -C examples/widgets/hostile build
open apps/desktop/src-tauri/target/release/bundle/dmg/
```

Drag the app to `/Applications`. Reset the desktop data for a clean first start only if the user agrees (`~/Library/Application Support/LifeDashboard Desktop`).

- [ ] **Step 2: Run the checklist (spec «Acceptance criteria»)**

1. `pnpm -C apps/desktop run package` produced the `.app` and `.dmg` (Task 8).
2. Start from `/Applications` via Finder: the pairing dialog appears; entering the code pairs.
3. Quit and start again: no pairing dialog; the board is there.
4. Add the built-in clock, move and resize it; quit and start: the layout is kept.
5. «Виджеты» → «Выбрать папку» opens a folder picker; `examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0/` installs.
6. Remove the package; install it again by dropping the same folder on the dialog.
7. Place `hello`: the background video plays; state and notifications work; after a restart its state is kept.
8. Install and place `hostile`: it stays inside its iframe and the board keeps working.
9. Cmd+Q, then `pgrep -f server.mjs` prints nothing.
10. Quit the app; run `node -e "require('http').createServer((q,s)=>s.end('{\"status\":\"ok\"}')).listen(3101,'127.0.0.1')"` in a terminal; start the app: an error dialog appears, no window opens on that server, the app exits. Stop the node server.

- [ ] **Step 3: Record results**

Append to this plan:

```markdown
## Acceptance results (2026-10-11)

| # | Result | Evidence |
| --- | --- | --- |
| 1 | pass/fail/not run | … |
```

List every failed or skipped item with its reason. When the feature is archived, these results go into its `outcome.md` (spec «Acceptance criteria»). A failure in items 5–8 is a defect to debug (superpowers:systematic-debugging), not a reason to change the spec silently.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-10-11-tauri-desktop.md
git commit -m "docs: record desktop acceptance results"
```
