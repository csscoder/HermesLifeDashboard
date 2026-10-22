# Hermes Tasks Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installable widgets can reach user-approved HTTP origins through the LifeDashboard API, and a new
`examples/widgets/hermes-tasks` widget shows and edits the user's Hermes Tasks tasks.

**Architecture:** A `network` permission plus an exact-origin list in `widget.json`; approved origins are stored
per package; two gateway operations (`http.get`, `http.send`) are proxied by the API with Node `fetch`
(no redirects, bounded size and time). The widget is a sandboxed Vue package whose pure TypeScript modules
(client, autosave queue, quick-add parser, dates, layout) are unit-tested; Vue components are thin and
checked in Orca's browser against the live Hermes Tasks container.

**Tech Stack:** TypeScript (strict), Vue 3.5 SFC, Fastify 5, node:sqlite, Vitest 5.0.3, pnpm 10 workspace,
`ld-widget build` (Vite library build).

**Spec:** `docs/superpowers/specs/2026-10-11-hermes-tasks-widget-design.md`

## Global Constraints

- Node.js 24, pnpm 10.30.2; exact dependency versions (`saveExact: true`). The only new dependency entry is
  `vitest` `5.0.3` in `examples/widgets/hermes-tasks/package.json` (already used by four workspace packages).
- Origin format: `scheme://host[:port]`, scheme `http` or `https`, no path, query, fragment, credentials or
  wildcard; valid only when `new URL(x).origin === x`; 1–16 distinct origins per manifest.
- `network` in `widget.json` and the `network` permission are declared together or not at all. `network` is
  optional in `WidgetPackageManifest`; absent means no origins. A manifest without `network` must parse to an
  object without the key (package hashes and stored manifests stay unchanged).
- `http.get`: `confirm: 'never'`; `http.send` (`POST`, `PUT`, `PATCH`, `DELETE`): `confirm: 'optional'`.
- Request headers: only `accept` (both ops) and `content-type` (`http.send`), lower-case names, values ≤ 200
  characters without control characters. URL ≤ 2048 characters. Request body ≤ 64 KB (UTF-8).
- Upstream: `redirect: 'manual'`, `credentials: 'omit'`, timeout 4000 ms, body ≤ 100 KB, serialized answer
  `JSON.stringify({ status, contentType, body })` ≤ 120 KB (122 880 bytes); otherwise `UPSTREAM_ERROR` (502).
- Rate limits: `http.get` 120/min, `http.send` 60/min, keyed by `(widgetId, op)`.
- Audit outcome for HTTP ops: `<status or error code> <METHOD> <origin>`; never path, query or bodies.
- Widget: id `dev.lifedashboard.hermes-tasks`, permissions `state` + `network`,
  `network: ["http://127.0.0.1:8787"]`, sizing default 8×8, min 3×4, max 16×16. Rail layout at width ≥ 7
  cells, stacked below. Refresh every 10 s while `context.visible`. Lists read whole: `limit=200`, up to 1000
  rows per request. UI text in Russian; styles only from `--ld-*` theme tokens; no `v-html`.
- Repository and code text in English; commits in the project format (`feat(api): …`, `docs: …`), short, no
  attribution trailers.

## Review Focus

1. **A non-JSON answer on port 8787** (another service, an HTML error page): the widget shows «Hermes Tasks
   недоступен» instead of crashing. Test in Task 7 (`answers without JSON become a retryable UNAVAILABLE`).
2. **Tag names that need URL encoding** (`дом & сад`, `#`, spaces): the filter request carries the exact tag.
   Test in Task 7 (`encodes tag names in the query`).
3. **Hermes Tasks time zone differs from the Mac's**: relative dates («Сегодня», «Завтра», «След. неделя»,
   quick-add defaults) come from the workspace `today`, never the machine clock. Tests in Task 6 (`dates`
   and `quick-add` take `today` as a string; DST date math).
4. **The minimum widget size 3×4**: stacked layout, nothing requires the rail. Test in Task 6 (`layoutFor`).
5. **URL tricks against the allowlist** (`http://127.0.0.1:8787@evil.example/`, upper-case scheme, another
   host spelling of the same server): credentials are rejected, normalization happens before the origin
   check, a different host string is a different origin. Tests in Task 3 (contracts and `proxyHttp`) and
   Task 4 (gateway).

---

### Task 1: Manifest `network` field and permission

**Files:**
- Modify: `packages/contracts/src/widget-package.ts`
- Modify: `apps/ui/app/widgets/PackagesDialog.vue` (label only)
- Test: `packages/contracts/test/widget-package.test.ts`

**Interfaces:**
- Produces: `WIDGET_PERMISSIONS = ['state', 'notifications', 'network']`;
  `WidgetPackageManifest.network?: string[]`; `isNetworkOrigin(value: unknown): value is string`;
  `NETWORK_ORIGINS_MAX = 16`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/test/widget-package.test.ts` (add `isNetworkOrigin` to the import list):

```ts
describe('manifest network', () => {
  function withNetwork(network: unknown, permissions: string[] = ['state', 'network']): unknown {
    return mutatedManifest((manifest) => {
      manifest.permissions = permissions
      manifest.network = network
    })
  }

  it('keeps approved-format origins with the network permission', () => {
    const result = parseWidgetManifest(withNetwork(['http://127.0.0.1:8787', 'https://api.example.com']))
    expect(result.ok && result.value.network).toEqual(['http://127.0.0.1:8787', 'https://api.example.com'])
  })

  it('leaves network out of a manifest that has none', () => {
    const result = parseWidgetManifest(mutatedManifest(() => {}))
    expect(result.ok && 'network' in result.value).toBe(false)
  })

  it.each([
    ['a path', ['http://127.0.0.1:8787/api']],
    ['a trailing slash', ['http://127.0.0.1:8787/']],
    ['an upper-case scheme', ['HTTP://127.0.0.1:8787']],
    ['a default port', ['https://example.com:443']],
    ['credentials', ['http://u:p@127.0.0.1:8787']],
    ['a wildcard', ['http://*.example.com']],
    ['another scheme', ['ftp://example.com']],
    ['duplicates', ['http://a.example', 'http://a.example']],
    ['an empty list', []],
    ['17 origins', Array.from({ length: 17 }, (_, index) => `http://h${index}.example`)],
    ['a number', [8787]],
    ['a string instead of a list', 'http://127.0.0.1:8787'],
  ])('rejects %s', (_name, network) => {
    const result = parseWidgetManifest(withNetwork(network))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/manifest\.network must be/)
  })

  it('requires network and the network permission together', () => {
    for (const raw of [withNetwork(['http://127.0.0.1:8787'], ['state']), withNetwork(undefined, ['network'])]) {
      const result = parseWidgetManifest(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/network permission/)
    }
  })

  it('isNetworkOrigin accepts only normalized origins', () => {
    expect(isNetworkOrigin('http://127.0.0.1:8787')).toBe(true)
    expect(isNetworkOrigin('http://localhost')).toBe(true)
    expect(isNetworkOrigin('http://localhost:80')).toBe(false)
    expect(isNetworkOrigin('http://127.0.0.1:8787@evil.example')).toBe(false)
    expect(isNetworkOrigin(null)).toBe(false)
  })
})
```

`withNetwork(undefined, …)` sets `manifest.network = undefined`, which `JSON`-style parsing treats as absent:
the parser must check `raw.network !== undefined`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-package.test.ts`
Expected: FAIL — `isNetworkOrigin` is not exported; network cases fail with «unknown field "network"».

- [ ] **Step 3: Implement**

In `packages/contracts/src/widget-package.ts`:

```ts
export const WIDGET_PERMISSIONS = ['state', 'notifications', 'network'] as const
```

```ts
export const NETWORK_ORIGINS_MAX = 16
```

Add `'network'` to `MANIFEST_KEYS`:

```ts
const MANIFEST_KEYS = ['id', 'version', 'title', 'author', 'sdk', 'entry', 'styles', 'sizing', 'permissions', 'network']
```

Extend the interface:

```ts
export interface WidgetPackageManifest {
  id: string
  version: string
  title: string
  author: string
  sdk: 1
  entry: string
  styles: string[]
  sizing: WidgetSizing
  permissions: WidgetPermission[]
  // Spec 2026-10-11: exact origins for http.get/http.send. Optional: stored manifests of older
  // versions are read back without re-validation and lack it; absent means no origins.
  network?: string[]
}
```

Add after `isPackageVersion`:

```ts
/** `scheme://host[:port]` exactly as `URL#origin` prints it: no path, credentials, default port or wildcard. */
export function isNetworkOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname.includes('*') && url.origin === value
}

function parseNetwork(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > NETWORK_ORIGINS_MAX) return null
  if (!raw.every(isNetworkOrigin) || new Set(raw).size !== raw.length) return null
  return [...raw]
}
```

In `parseManifest`, replace the permissions error and the return:

```ts
  const permissions = parsePermissions(raw.permissions)
  if (!permissions) return fail(`manifest.permissions must be distinct items of: ${WIDGET_PERMISSIONS.join(', ')}`)
  let network: string[] | undefined
  if (raw.network !== undefined) {
    const parsed = parseNetwork(raw.network)
    if (!parsed) {
      return fail(
        `manifest.network must be 1–${NETWORK_ORIGINS_MAX} distinct origins such as http://127.0.0.1:8787 (scheme, host and port only)`,
      )
    }
    network = parsed
  }
  if (permissions.includes('network') !== (network !== undefined)) {
    return fail('manifest.network and the network permission must be declared together')
  }
  return {
    ok: true,
    value: {
      id: raw.id,
      version: raw.version,
      title: raw.title,
      author: raw.author,
      sdk: 1,
      entry: raw.entry,
      styles: [...(raw.styles as string[])],
      sizing,
      permissions,
      // Left out when absent, so a manifest without network keeps its canonical JSON and package hash.
      ...(network === undefined ? {} : { network }),
    },
  }
```

In `apps/ui/app/widgets/PackagesDialog.vue` the `PERMISSIONS` record must cover the new permission:

```ts
const PERMISSIONS: Record<WidgetPermission, string> = {
  state: 'Хранить собственные данные виджета',
  notifications: 'Показывать уведомления',
  network: 'Доступ к сети',
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C packages/contracts exec vitest run test/widget-package.test.ts`
Expected: PASS.

Run: `pnpm -C packages/contracts typecheck && pnpm -C apps/api typecheck && pnpm -C apps/ui typecheck && pnpm -C packages/contracts test`
Expected: all exit 0. If a test elsewhere asserts the old «state, notifications» message exactly, update it to the
new list text.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/widget-package.ts packages/contracts/test/widget-package.test.ts apps/ui/app/widgets/PackagesDialog.vue
git commit -m "feat(contracts): declare network origins in widget manifests"
```

---

### Task 2: Approved origins storage

**Files:**
- Modify: `apps/api/src/migrations.ts` (append one migration)
- Modify: `apps/api/src/widget-packages.ts`
- Modify: `apps/api/src/widget-uploads.ts:93,185`
- Modify: `packages/contracts/src/widget-package.ts` (`PackageInspection.newOrigins`, `InstalledPackage.origins`)
- Modify: `apps/ui/test/catalog.test.ts` (fixture field)
- Test: `apps/api/test/widget-uploads.test.ts`, `apps/api/test/widget-packages.test.ts`

**Interfaces:**
- Consumes: `WidgetPackageManifest.network?` (Task 1).
- Produces: table `widget_network_origins(package_id, origin, granted_at)`;
  `originsOf(db: DatabaseSync, packageId: string): string[]`;
  `newOriginsOf(db: DatabaseSync, manifest: WidgetPackageManifest): string[]` (both exported from
  `apps/api/src/widget-packages.ts`); `PackageInspection.newOrigins: string[]`; `InstalledPackage.origins: string[]`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/widget-uploads.test.ts`, line 79 expects the inspection with `toEqual`; add the field:

```ts
    expect(inspection).toEqual({ manifest, hash: null, installed: false, newPermissions: ['state'], newOrigins: [], sizes: { code: 25, assets: 0, source: 0 } })
```

In `apps/api/test/widget-packages.test.ts`, the listed package at line 54 gains `origins: []` next to `grants`.
Then append to `apps/api/test/widget-uploads.test.ts`:

```ts
describe('network origins', () => {
  const ORIGIN_A = 'http://127.0.0.1:8787'
  const ORIGIN_B = 'http://127.0.0.1:9999'

  function netPackage(version: string, network: string[]) {
    return widgetPackage((pkg) => {
      pkg.manifest.version = version
      pkg.manifest.permissions = ['state', 'network']
      pkg.manifest.network = network
    })
  }

  it('lists new origins before install, stores them, and lists only unheld ones for a new version', async () => {
    const first = await uploadPackage(t, cookie, netPackage('1.0.0', [ORIGIN_A]))
    expect(first.inspection.newOrigins).toEqual([ORIGIN_A])
    await installPackage(t, cookie, netPackage('1.0.0', [ORIGIN_A]))
    const rows = t.db.prepare('SELECT package_id, origin FROM widget_network_origins').all()
    expect(rows).toEqual([{ package_id: 'dev.test.hello', origin: ORIGIN_A }])

    const second = await uploadPackage(t, cookie, netPackage('1.1.0', [ORIGIN_A, ORIGIN_B]))
    expect(second.inspection.newOrigins).toEqual([ORIGIN_B])
  })

  it('shows held origins in the packages list and drops them with the package', async () => {
    await installPackage(t, cookie, netPackage('1.0.0', [ORIGIN_A]))
    const listed = await call(t.app, { url: '/api/v1/widget-packages', cookie })
    expect(listed.json().data[0].origins).toEqual([ORIGIN_A])
    expect((await call(t.app, { method: 'DELETE', url: '/api/v1/widget-packages/dev.test.hello', cookie, payload: {} })).statusCode).toBe(200)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widget_network_origins').get()).toEqual({ n: 0 })
  })
})
```

The file's `beforeEach` provides `t` and `cookie`; `call`, `installPackage`, `uploadPackage` and
`widgetPackage` are already imported from `./helpers.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/widget-uploads.test.ts test/widget-packages.test.ts`
Expected: FAIL — `newOrigins` / `origins` missing; `no such table: widget_network_origins`.

- [ ] **Step 3: Implement**

`packages/contracts/src/widget-package.ts`:

```ts
export interface PackageInspection {
  manifest: WidgetPackageManifest
  hash: string | null
  installed: boolean
  // Manifest permissions the package does not hold yet.
  newPermissions: WidgetPermission[]
  // Manifest network origins the package does not hold yet (spec 2026-10-11).
  newOrigins: string[]
  sizes: FolderSizes
}
```

```ts
export interface InstalledPackage {
  id: string
  title: string
  author: string
  // Newest first.
  versions: InstalledPackageVersion[]
  grants: Grant[]
  // Network origins the user approved for the package.
  origins: string[]
}
```

Append to `MIGRATIONS` in `apps/api/src/migrations.ts`, after `movePackageFilesToDisk`:

```ts
  `
-- Spec 2026-10-11-hermes-tasks-widget: network origins the user approved, per package.
CREATE TABLE widget_network_origins (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (package_id, origin)
);
`,
```

`apps/api/src/widget-packages.ts` — add after `newPermissionsOf`:

```ts
export function originsOf(db: DatabaseSync, packageId: string): string[] {
  const rows = db.prepare('SELECT origin FROM widget_network_origins WHERE package_id = ? ORDER BY origin').all(packageId) as unknown as { origin: string }[]
  return rows.map((row) => row.origin)
}

export function newOriginsOf(db: DatabaseSync, manifest: WidgetPackageManifest): string[] {
  const held = new Set(originsOf(db, manifest.id))
  return (manifest.network ?? []).filter((origin) => !held.has(origin))
}
```

At the end of `insertVersion`:

```ts
  // Like grants, approved origins belong to the package and only grow.
  const origin = db.prepare('INSERT OR IGNORE INTO widget_network_origins (package_id, origin, granted_at) VALUES (?, ?, ?)')
  for (const value of manifest.network ?? []) origin.run(manifest.id, value, at)
```

In `listPackages`, next to `grants: grantsOf(db, pkg.id),` add `origins: originsOf(db, pkg.id),`.
Update the comment in `deletePackage` to «Versions, grants and origins go with it (ON DELETE CASCADE).»

`apps/api/src/widget-uploads.ts`: import `newOriginsOf` with `newPermissionsOf`; line 93 becomes

```ts
      inspection: { manifest: session.manifest, hash: null, installed, newPermissions: newPermissionsOf(db, session.manifest), newOrigins: newOriginsOf(db, session.manifest), sizes: session.sizes },
```

and line 185 becomes

```ts
      return { manifest: session.manifest, hash, installed: true, newPermissions: [], newOrigins: [], sizes: session.sizes }
```

`apps/ui/test/catalog.test.ts`: add `origins: [],` after `grants: [],` in the `InstalledPackage` fixture
(line 45). Run `pnpm -C apps/ui typecheck` and add `origins: []` / `newOrigins: []` to any other literal it
reports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/widget-uploads.test.ts test/widget-packages.test.ts test/db.test.ts`
Expected: PASS (`db.test.ts` compares `user_version` with `MIGRATIONS.length`, so it follows the new entry).

Run: `pnpm -C packages/contracts typecheck && pnpm -C apps/api typecheck && pnpm -C apps/ui typecheck && pnpm -C apps/api test && pnpm -C apps/ui test`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migrations.ts apps/api/src/widget-packages.ts apps/api/src/widget-uploads.ts packages/contracts/src/widget-package.ts apps/api/test/widget-uploads.test.ts apps/api/test/widget-packages.test.ts apps/ui/test/catalog.test.ts
git commit -m "feat(api): store the network origins approved per package"
```

---

### Task 3: HTTP input parsers and the upstream proxy

**Files:**
- Modify: `packages/contracts/src/widget-gateway.ts` (types, limits, two exported parsers; no `GATEWAY_OPS` change yet)
- Modify: `packages/contracts/src/api.ts` (`ErrorCode` gains `UPSTREAM_ERROR`)
- Modify: `apps/api/src/errors.ts` (`UPSTREAM_ERROR: 502`)
- Create: `apps/api/src/http-proxy.ts`
- Test: `packages/contracts/test/widget-gateway.test.ts`, `apps/api/test/http-proxy.test.ts`

**Interfaces:**
- Produces (contracts): `HTTP_LIMITS`, `HTTP_SEND_METHODS`, `HttpSendMethod`, `HttpGetInput`,
  `HttpSendInput`, `HttpOutput`, `parseHttpGet(raw: Record<string, unknown>): ParseResult<HttpGetInput>`,
  `parseHttpSend(raw: Record<string, unknown>): ParseResult<HttpSendInput>`.
- Produces (API): `proxyHttp(request: ProxyRequest, origins: ReadonlySet<string>, timeoutMs?: number): Promise<HttpOutput>`
  with `ProxyRequest = { url: string; method: 'GET' | HttpSendMethod; headers?: Record<string, string>; body?: string }`;
  throws `ApiError('PERMISSION_DENIED' | 'UPSTREAM_ERROR', message)`.

- [ ] **Step 1: Write the failing contract tests**

Append to `packages/contracts/test/widget-gateway.test.ts` (extend the import with `HTTP_LIMITS`,
`parseHttpGet`, `parseHttpSend`):

```ts
describe('http inputs', () => {
  const base = 'http://127.0.0.1:8787/api/v1/tasks?due=today'

  it('parses http.get with an accept header', () => {
    expect(parseHttpGet({ url: base, headers: { accept: 'application/json' } })).toEqual({
      ok: true,
      value: { url: base, headers: { accept: 'application/json' } },
    })
    expect(parseHttpGet({ url: base })).toEqual({ ok: true, value: { url: base } })
  })

  it('normalizes the URL', () => {
    expect(parseHttpGet({ url: 'HTTP://127.0.0.1:8787/x' })).toEqual({ ok: true, value: { url: 'http://127.0.0.1:8787/x' } })
  })

  it('parses http.send with a method, content type and body', () => {
    const input = { url: base, method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{"a":1}' }
    expect(parseHttpSend(input)).toEqual({ ok: true, value: input })
    expect(parseHttpSend({ url: base, method: 'DELETE' })).toEqual({ ok: true, value: { url: base, method: 'DELETE' } })
  })

  it('accepts a body of exactly 64 KB and rejects one byte more', () => {
    expect(parseHttpSend({ url: base, method: 'POST', body: 'x'.repeat(HTTP_LIMITS.bodyBytes) }).ok).toBe(true)
    expect(parseHttpSend({ url: base, method: 'POST', body: 'é'.repeat(HTTP_LIMITS.bodyBytes / 2 + 1) }).ok).toBe(false)
  })

  it.each([
    ['get', { url: 'ftp://x.example/' }, /url must be/],
    ['get', { url: 'http://127.0.0.1:8787@evil.example/' }, /url must be/],
    ['get', { url: '/relative' }, /url must be/],
    ['get', { url: `http://x.example/${'a'.repeat(2048)}` }, /url must be/],
    ['get', { url: 42 }, /url must be/],
    ['get', { url: base, method: 'GET' }, /takes url and headers only/],
    ['get', { url: base, body: '' }, /takes url and headers only/],
    ['get', { url: base, headers: { cookie: 'a' } }, /headers may name only accept/],
    ['get', { url: base, headers: { Accept: 'a' } }, /headers may name only accept/],
    ['get', { url: base, headers: { 'content-type': 'a' } }, /headers may name only accept/],
    ['get', { url: base, headers: { accept: 'a\nb' } }, /headers\.accept must be/],
    ['get', { url: base, headers: { accept: 'a'.repeat(201) } }, /headers\.accept must be/],
    ['get', { url: base, headers: 'accept' }, /headers must be an object/],
    ['send', { url: base, method: 'GET' }, /method must be/],
    ['send', { url: base, method: 'post' }, /method must be/],
    ['send', { url: base, method: 'POST', body: 1 }, /body must be/],
    ['send', { url: base, method: 'POST', extra: 1 }, /takes url, method, headers and body only/],
    ['send', { url: base, method: 'POST', headers: { authorization: 'x' } }, /headers may name only accept and content-type/],
  ])('rejects http.%s %j', (op, input, message) => {
    const result = op === 'get' ? parseHttpGet(input) : parseHttpSend(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-gateway.test.ts`
Expected: FAIL — `parseHttpGet` is not exported.

- [ ] **Step 3: Implement the contract parsers**

In `packages/contracts/src/widget-gateway.ts`, after `NotificationInput`:

```ts
// Spec 2026-10-11 «Operations»: HTTP through the API to origins the user approved.
export const HTTP_LIMITS = {
  urlLength: 2048,
  headerValueLength: 200,
  bodyBytes: 65_536,
  responseBytes: 102_400,
  // JSON of the whole answer: escaping can grow a 100 KB body past BRIDGE_LIMITS.maxMessageBytes.
  answerBytes: 122_880,
  // Under the UI's API_TIMEOUT_MS (5 s), which is under BRIDGE_LIMITS.requestTimeoutMs.
  timeoutMs: 4_000,
} as const

export const HTTP_SEND_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HttpSendMethod = (typeof HTTP_SEND_METHODS)[number]

export interface HttpGetInput {
  url: string
  headers?: { accept?: string }
}

export interface HttpSendInput {
  url: string
  method: HttpSendMethod
  headers?: { accept?: string; 'content-type'?: string }
  body?: string
}

export interface HttpOutput {
  status: number
  contentType: string | null
  body: string
}

const CONTROL = /[\u0000-\u001f\u007f]/

function parseHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > HTTP_LIMITS.urlLength) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  return url.href
}

function parseHttpHeaders(raw: unknown, allowed: readonly string[]): ParseResult<Record<string, string> | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return fail('headers must be an object')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!allowed.includes(name)) return fail(`headers may name only ${allowed.join(' and ')}`)
    if (typeof value !== 'string' || value.length > HTTP_LIMITS.headerValueLength || CONTROL.test(value)) {
      return fail(`headers.${name} must be at most ${HTTP_LIMITS.headerValueLength} characters without control characters`)
    }
    headers[name] = value
  }
  return { ok: true, value: headers }
}

const URL_RULE = `url must be an absolute http(s) URL of at most ${HTTP_LIMITS.urlLength} characters without credentials`

export function parseHttpGet(raw: Record<string, unknown>): ParseResult<HttpGetInput> {
  if (unknownKey(raw, ['url', 'headers']) !== undefined) return fail('http.get takes url and headers only')
  const url = parseHttpUrl(raw.url)
  if (url === null) return fail(URL_RULE)
  const headers = parseHttpHeaders(raw.headers, ['accept'])
  if (!headers.ok) return headers
  return { ok: true, value: headers.value === undefined ? { url } : { url, headers: headers.value } }
}

export function parseHttpSend(raw: Record<string, unknown>): ParseResult<HttpSendInput> {
  if (unknownKey(raw, ['url', 'method', 'headers', 'body']) !== undefined) return fail('http.send takes url, method, headers and body only')
  const url = parseHttpUrl(raw.url)
  if (url === null) return fail(URL_RULE)
  const method = raw.method
  if (!(HTTP_SEND_METHODS as readonly unknown[]).includes(method)) return fail(`method must be one of ${HTTP_SEND_METHODS.join(', ')}`)
  const headers = parseHttpHeaders(raw.headers, ['accept', 'content-type'])
  if (!headers.ok) return headers
  const body = raw.body
  if (body !== undefined && (typeof body !== 'string' || byteLength(body) > HTTP_LIMITS.bodyBytes)) {
    return fail('body must be a string of at most 64 KB')
  }
  return {
    ok: true,
    value: {
      url,
      method: method as HttpSendMethod,
      ...(headers.value === undefined ? {} : { headers: headers.value }),
      ...(body === undefined ? {} : { body }),
    },
  }
}
```

`packages/contracts/src/api.ts` — add to `ErrorCode` after `CONFIRMATION_INVALID`:

```ts
  // Network gateway (spec 2026-10-11): the upstream service failed, timed out or answered too much.
  | 'UPSTREAM_ERROR'
```

`apps/api/src/errors.ts` — add to `STATUS`: `UPSTREAM_ERROR: 502,`.

- [ ] **Step 4: Run the contract tests**

Run: `pnpm -C packages/contracts exec vitest run test/widget-gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing proxy tests**

Create `apps/api/test/http-proxy.test.ts`:

```ts
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../src/errors.ts'
import { proxyHttp } from '../src/http-proxy.ts'

let server: Server
let port = 0
let origin = ''
let handle: (request: IncomingMessage, response: ServerResponse) => void
const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    request.on('end', () => {
      seen.push({ method: request.method!, url: request.url!, headers: request.headers, body })
      handle(request, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as AddressInfo).port
  origin = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  seen.length = 0
  handle = (_request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
})

const allowed = () => new Set([origin])

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('proxyHttp', () => {
  it('returns the status, content type and text body', async () => {
    expect(await proxyHttp({ url: `${origin}/api/v1/tasks?due=today`, method: 'GET', headers: { accept: 'application/json' } }, allowed())).toEqual({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true}',
    })
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/v1/tasks?due=today' })
    expect(seen[0]!.headers.accept).toBe('application/json')
  })

  it('sends the method, content type and body, and never an origin or cookie', async () => {
    await proxyHttp({ url: `${origin}/api/v1/tasks`, method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":1}' }, allowed())
    expect(seen[0]).toMatchObject({ method: 'POST', body: '{"t":1}' })
    expect(seen[0]!.headers['content-type']).toBe('application/json')
    expect(seen[0]!.headers.origin).toBeUndefined()
    expect(seen[0]!.headers.cookie).toBeUndefined()
    expect(seen[0]!.headers.authorization).toBeUndefined()
  })

  it('returns an error status as data', async () => {
    handle = (_request, response) => response.writeHead(409, { 'content-type': 'application/json' }).end('{"ok":false}')
    expect((await proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed())).status).toBe(409)
  })

  it('checks the normalized origin and treats another host spelling as another origin', async () => {
    expect((await proxyHttp({ url: `HTTP://127.0.0.1:${port}/x`, method: 'GET' }, allowed())).status).toBe(200)
    expect((await rejection(proxyHttp({ url: `http://localhost:${port}/x`, method: 'GET' }, allowed()))).code).toBe('PERMISSION_DENIED')
    expect((await rejection(proxyHttp({ url: 'http://evil.example/', method: 'GET' }, allowed()))).code).toBe('PERMISSION_DENIED')
    expect(seen).toHaveLength(1)
  })

  it('returns a redirect without following it', async () => {
    handle = (_request, response) => response.writeHead(302, { location: 'http://evil.example/' }).end()
    expect((await proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed())).status).toBe(302)
    expect(seen).toHaveLength(1)
  })

  it('ends a slow answer with UPSTREAM_ERROR', async () => {
    handle = () => {}
    const error = await rejection(proxyHttp({ url: `${origin}/slow`, method: 'GET' }, allowed(), 200))
    expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The service did not answer in time'])
  })

  it('reports a dropped connection as unreachable', async () => {
    handle = (request) => request.socket.destroy()
    const error = await rejection(proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed()))
    expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The service is unreachable'])
  })

  it('accepts a body of exactly 100 KB and aborts one byte more', async () => {
    handle = (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(102_400))
    expect((await proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed())).body).toHaveLength(102_400)
    handle = (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(102_401))
    const error = await rejection(proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed()))
    expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The response is larger than 100 KB'])
  })

  it('rejects an answer whose JSON form passes 120 KB', async () => {
    // Each quote becomes \" in JSON: 70 000 bytes of body serialize to more than 140 000.
    handle = (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('"'.repeat(70_000))
    const error = await rejection(proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed()))
    expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The response is too large'])
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/http-proxy.test.ts`
Expected: FAIL — cannot find module `../src/http-proxy.ts`.

- [ ] **Step 7: Implement the proxy**

Create `apps/api/src/http-proxy.ts`:

```ts
import { HTTP_LIMITS, type HttpOutput, type HttpSendMethod } from '@lifedashboard/contracts/widget-gateway'
import { ApiError } from './errors.ts'

export interface ProxyRequest {
  url: string
  method: 'GET' | HttpSendMethod
  headers?: Record<string, string>
  body?: string
}

/**
 * Spec 2026-10-11 «Operations»: one request to an approved origin. No redirects, cookies or extra
 * headers; bounded in time and size. Any upstream status is a result; failures are UPSTREAM_ERROR.
 */
export async function proxyHttp(request: ProxyRequest, origins: ReadonlySet<string>, timeoutMs: number = HTTP_LIMITS.timeoutMs): Promise<HttpOutput> {
  if (!origins.has(new URL(request.url).origin)) throw new ApiError('PERMISSION_DENIED', 'The widget may not reach this origin')
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers ?? {},
      body: request.body,
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const output: HttpOutput = {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await readText(response),
    }
    if (Buffer.byteLength(JSON.stringify(output)) > HTTP_LIMITS.answerBytes) throw new ApiError('UPSTREAM_ERROR', 'The response is too large')
    return output
  } catch (error) {
    if (error instanceof ApiError) throw error
    const name = error instanceof Error ? error.name : ''
    throw new ApiError('UPSTREAM_ERROR', name === 'TimeoutError' || name === 'AbortError' ? 'The service did not answer in time' : 'The service is unreachable')
  }
}

// The timeout signal also covers this read, so a stalled body ends as «did not answer in time».
async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > HTTP_LIMITS.responseBytes) {
      await reader.cancel()
      throw new ApiError('UPSTREAM_ERROR', 'The response is larger than 100 KB')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/http-proxy.test.ts && pnpm -C packages/contracts test`
Expected: PASS.

Run: `pnpm -C packages/contracts typecheck && pnpm -C apps/api typecheck && pnpm -C apps/ui typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/widget-gateway.ts packages/contracts/src/api.ts packages/contracts/test/widget-gateway.test.ts apps/api/src/errors.ts apps/api/src/http-proxy.ts apps/api/test/http-proxy.test.ts
git commit -m "feat(api): proxy bounded HTTP requests to approved origins"
```

---

### Task 4: `http.get` and `http.send` in the gateway

**Files:**
- Modify: `packages/contracts/src/widget-gateway.ts` (`GATEWAY_OPS`, `GatewayInputs`, `parseGatewayInput`)
- Modify: `apps/api/src/widget-gateway.ts`
- Modify: `apps/ui/app/ConfirmDialog.vue` (`ACTIONS` entries only)
- Test: `packages/contracts/test/widget-gateway.test.ts`, `apps/api/test/widget-gateway.test.ts`, `apps/ui/test/broker.test.ts`

**Interfaces:**
- Consumes: `parseHttpGet`, `parseHttpSend`, `HttpOutput` (Task 3); `proxyHttp` (Task 3); `originsOf` (Task 2).
- Produces: `GatewayOp` includes `'http.get' | 'http.send'`; `GatewayContext.origins: ReadonlySet<string>`;
  `confirmablePermissions()` returns `['notifications', 'network']`.

- [ ] **Step 1: Update the contract tests (failing)**

In `packages/contracts/test/widget-gateway.test.ts` replace the `isGatewayOp` test:

```ts
describe('isGatewayOp', () => {
  it('knows the five operations and nothing from the prototype', () => {
    expect(['state.get', 'state.set', 'notifications.send', 'http.get', 'http.send'].every(isGatewayOp)).toBe(true)
    expect(isGatewayOp('http.post')).toBe(false)
    expect(isGatewayOp('toString')).toBe(false)
    expect(isGatewayOp('constructor')).toBe(false)
    expect(isGatewayOp(1)).toBe(false)
  })
})
```

Replace the first `confirmation policy` test:

```ts
  it('asks for notifications.send and http.send, so notifications and network offer a mode', () => {
    expect(Object.fromEntries(Object.entries(GATEWAY_OPS).map(([op, spec]) => [op, spec.confirm]))).toEqual({
      'state.get': 'never',
      'state.set': 'never',
      'notifications.send': 'optional',
      'http.get': 'never',
      'http.send': 'optional',
    })
    expect(confirmablePermissions()).toEqual(['notifications', 'network'])
  })
```

Add to the `parseGatewayInput` describe:

```ts
  it('routes http inputs to their parsers', () => {
    expect(parseGatewayInput('http.get', { url: 'http://127.0.0.1:8787/x' })).toEqual({ ok: true, value: { url: 'http://127.0.0.1:8787/x' } })
    expect(parseGatewayInput('http.send', { url: 'http://127.0.0.1:8787/x', method: 'POST' })).toEqual({
      ok: true,
      value: { url: 'http://127.0.0.1:8787/x', method: 'POST' },
    })
    expect(parseGatewayInput('http.get', null).ok).toBe(false)
  })
```

In `apps/ui/test/broker.test.ts` line 48, `http.get` becomes a known op; keep the test about unknown ops:

```ts
    await expect(client.call('http.post', {})).rejects.toMatchObject({ code: 'UNKNOWN_OP' })
```

- [ ] **Step 2: Write the failing gateway tests**

Append to `apps/api/test/widget-gateway.test.ts` (add imports: `afterAll, beforeAll` from vitest;
`createServer, type IncomingMessage, type Server, type ServerResponse` from `node:http`;
`type AddressInfo` from `node:net`):

```ts
describe('http', () => {
  let server: Server
  let origin = ''
  let handle: (request: IncomingMessage, response: ServerResponse) => void
  const seen: { method: string; url: string; body: string }[] = []
  const send = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"x"}' }

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      request.on('end', () => {
        seen.push({ method: request.method!, url: request.url!, body })
        handle(request, response)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(async () => {
    seen.length = 0
    handle = (_request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    // Version 1.1.0 asks for network; the placed widget moves to it, 1.0.0 stays installed.
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'network']
      p.manifest.network = [origin]
    }))
    t.db.prepare("UPDATE widgets SET source_version = '1.1.0' WHERE id = ?").run(PKG_WIDGET)
  })

  function confirmed(token: string, id: string, payload: unknown) {
    return call(t.app, {
      method: 'POST',
      url: '/api/v1/widget-gateway/http.send',
      cookie,
      payload,
      headers: { 'x-widget-session': token, 'x-widget-confirmation': id },
    })
  }

  it('proxies a GET to an approved origin and audits status, method and origin only', async () => {
    const token = await openSession(PKG_WIDGET)
    const response = await gateway('http.get', token, { url: `${origin}/api/v1/tasks?due=today`, headers: { accept: 'application/json' } })
    expect(response.json().data).toEqual({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/v1/tasks?due=today' })
    expect(auditRows().at(-1)).toEqual({ widget_id: PKG_WIDGET, package_id: 'dev.test.hello', op: 'http.get', outcome: `200 GET ${origin}` })
  })

  it('denies an unlisted origin and rejects credentials in the URL before any request', async () => {
    const token = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: 'http://evil.example/' }))).toBe('PERMISSION_DENIED')
    expect(errorCode(await gateway('http.get', token, { url: `${origin}@evil.example/` }))).toBe('INVALID_INPUT')
    expect(seen).toHaveLength(0)
  })

  it('denies an origin the user has not approved', async () => {
    t.db.prepare('DELETE FROM widget_network_origins').run()
    const token = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: `${origin}/` }))).toBe('PERMISSION_DENIED')
  })

  it('gives an older version without network no origins, although the package holds the grant', async () => {
    t.db.prepare("UPDATE widgets SET source_version = '1.0.0' WHERE id = ?").run(PKG_WIDGET)
    const token = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: `${origin}/` }))).toBe('PERMISSION_DENIED')
  })

  it('asks before http.send in ask mode and sends once after the confirmation', async () => {
    const token = await openSession(PKG_WIDGET)
    const input = { url: `${origin}/api/v1/tasks`, ...send }
    const asked = await gateway('http.send', token, input)
    expect([asked.statusCode, errorCode(asked)]).toEqual([428, 'CONFIRMATION_REQUIRED'])
    expect(seen).toHaveLength(0)
    const sent = await confirmed(token, asked.json().error.confirmationId, input)
    expect(sent.json().data.status).toBe(200)
    expect(seen).toEqual([{ method: 'POST', url: '/api/v1/tasks', body: '{"title":"x"}' }])
  })

  it('sends without asking in allow mode', async () => {
    t.db.prepare("UPDATE widget_grants SET mode = 'allow' WHERE permission = 'network'").run()
    const token = await openSession(PKG_WIDGET)
    expect((await gateway('http.send', token, { url: `${origin}/api/v1/tasks`, ...send })).json().data.status).toBe(200)
  })

  it('answers 502 UPSTREAM_ERROR for a dropped connection and audits it', async () => {
    handle = (request) => request.socket.destroy()
    const token = await openSession(PKG_WIDGET)
    const response = await gateway('http.get', token, { url: `${origin}/` })
    expect([response.statusCode, errorCode(response), response.json().error.message]).toEqual([502, 'UPSTREAM_ERROR', 'The service is unreachable'])
    expect(auditRows().at(-1)).toMatchObject({ op: 'http.get', outcome: `UPSTREAM_ERROR GET ${origin}` })
  })

  it('keeps the http.get count across a new session', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let index = 0; index < 120; index++) expect((await gateway('http.get', token, { url: `${origin}/` })).statusCode).toBe(200)
    const fresh = await openSession(PKG_WIDGET)
    expect(errorCode(await gateway('http.get', fresh, { url: `${origin}/` }))).toBe('RATE_LIMITED')
  })

  it('denies http to a built-in widget', async () => {
    const token = await openSession(BUILTIN_WIDGET)
    expect(errorCode(await gateway('http.get', token, { url: `${origin}/` }))).toBe('PERMISSION_DENIED')
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-gateway.test.ts && pnpm -C apps/api exec vitest run test/widget-gateway.test.ts`
Expected: FAIL — `http.get` is an unknown op.

- [ ] **Step 4: Register the operations in the contract**

`packages/contracts/src/widget-gateway.ts`:

```ts
export const GATEWAY_OPS = {
  'state.get': { permission: 'state', confirm: 'never' },
  'state.set': { permission: 'state', confirm: 'never' },
  'notifications.send': { permission: 'notifications', confirm: 'optional' },
  // Spec 2026-10-11: polling must never open a dialog; writes follow the grant mode.
  'http.get': { permission: 'network', confirm: 'never' },
  'http.send': { permission: 'network', confirm: 'optional' },
} as const satisfies Record<string, { permission: WidgetPermission; confirm: ConfirmPolicy }>
```

```ts
export interface GatewayInputs {
  'state.get': Record<string, never>
  'state.set': StateSetInput
  'notifications.send': NotificationInput
  'http.get': HttpGetInput
  'http.send': HttpSendInput
}
```

`HttpGetInput`/`HttpSendInput` are declared above `GatewayInputs` after Task 3; move the HTTP block
(constants, types, parsers) above `GatewayInputs` if it is not. Replace the body of `parseGatewayInput`:

```ts
export function parseGatewayInput<Op extends GatewayOp>(op: Op, raw: unknown): ParseResult<GatewayInputs[Op]> {
  if (!isRecord(raw)) return fail('input must be an object')
  let result: ParseResult<unknown>
  if (op === 'state.get') {
    result = Object.keys(raw).length === 0 ? { ok: true, value: {} } : fail('state.get takes no input')
  } else if (op === 'state.set') {
    result = parseStateSet(raw)
  } else if (op === 'notifications.send') {
    result = parseNotification(raw)
  } else if (op === 'http.get') {
    result = parseHttpGet(raw)
  } else {
    result = parseHttpSend(raw)
  }
  return result as ParseResult<GatewayInputs[Op]>
}
```

- [ ] **Step 5: Wire the API gateway**

`apps/api/src/widget-gateway.ts`:

Imports: add `type HttpOutput` to the `@lifedashboard/contracts/widget-gateway` import; add
`type WidgetPackageManifest` to the `widget-package` import; add `import { proxyHttp } from './http-proxy.ts'`;
change `import { grantsOf } from './widget-packages.ts'` to `import { grantsOf, originsOf } from './widget-packages.ts'`.

```ts
const RATE_LIMITS: Record<GatewayOp, { max: number; windowMs: number }> = {
  'state.get': { max: 120, windowMs: MINUTE },
  'state.set': { max: 60, windowMs: MINUTE },
  'notifications.send': { max: 10, windowMs: HOUR },
  'http.get': { max: 120, windowMs: MINUTE },
  'http.send': { max: 60, windowMs: MINUTE },
}

/** What an operation handler may use; sub-project 2 adds a secret resolver here without changing the pipeline. */
export interface GatewayContext {
  widgetId: string
  packageId: string | null
  grants: ReadonlySet<WidgetPermission>
  // Manifest origins of the instance's version that the user approved for the package.
  origins: ReadonlySet<string>
}
```

Add below `needsConfirmation`:

```ts
// Spec 2026-10-11 audit: method and origin of an HTTP call; never its path, query or body.
function httpTarget(op: GatewayOp, input: unknown): string {
  if (op !== 'http.get' && op !== 'http.send') return ''
  const { url, method } = input as { url: string; method?: string }
  return ` ${method ?? 'GET'} ${new URL(url).origin}`
}
```

In `POST /widget-sessions`, take `origins` from `resolveWidget` and store them:

```ts
    const { packageId, grants, origins } = resolveWidget(db, widgetId)
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, {
      dashboard: request.sessionHash,
      widgetId,
      packageId,
      grants: new Set(grants),
      origins: new Set(origins),
      lastUsedAt: now().getTime(),
      confirmation: null,
    })
```

In `POST /widget-gateway/:op`, declare `let target = ''` next to `let outcome = 'ok'`, set it right after
the input parses, await the handler and record the status (the rest of the try block stays):

```ts
      const input = parseGatewayInput(op, request.body)
      if (!input.ok) throw new ApiError('INVALID_INPUT', input.error)
      target = httpTarget(op, input.value)
```

```ts
      const handler = handlers[op] as (context: GatewayContext, input: unknown) => unknown
      // Awaited inside try: an HTTP handler is asynchronous, and catch and audit must see its end.
      const output = await handler(
        { widgetId: session.widgetId, packageId: session.packageId, grants: session.grants, origins: session.origins },
        input.value,
      )
      if (target !== '') outcome = String((output as HttpOutput).status)
      return ok(request, output)
```

and the `finally` becomes `audit(session, op, outcome + target)`.

Replace `resolveWidget`:

```ts
function resolveWidget(db: DatabaseSync, widgetId: string): { packageId: string | null; grants: WidgetPermission[]; origins: string[] } {
  const row = db.prepare('SELECT source_kind, source_type, source_version FROM widgets WHERE id = ?').get(widgetId) as
    | { source_kind: string; source_type: string; source_version: string | null }
    | undefined
  if (!row) throw new ApiError('NOT_FOUND', 'Widget not found')
  if (row.source_kind === 'package') {
    const installed = db.prepare('SELECT manifest FROM widget_package_versions WHERE package_id = ? AND version = ?').get(row.source_type, row.source_version) as
      | { manifest: string }
      | undefined
    if (!installed) throw new ApiError('NOT_FOUND', 'Widget package version is not installed')
    // Stored manifests are not re-validated; an older one has no network field and so no origins.
    const manifest = JSON.parse(installed.manifest) as WidgetPackageManifest
    const approved = new Set(originsOf(db, row.source_type))
    return {
      packageId: row.source_type,
      grants: grantsOf(db, row.source_type).map((grant) => grant.permission),
      origins: (manifest.network ?? []).filter((origin) => approved.has(origin)),
    }
  }
  const manifest = findBuiltinWidget(row.source_type)
  if (!manifest) throw new ApiError('NOT_FOUND', 'Unknown built-in widget')
  return { packageId: null, grants: [...manifest.permissions], origins: [] }
}
```

Add the handlers to `operationHandlers`:

```ts
    'http.get': ({ origins }, { url, headers }) => proxyHttp({ url, method: 'GET', headers: { ...headers } as Record<string, string> }, origins),
    'http.send': ({ origins }, { url, method, headers, body }) =>
      proxyHttp({ url, method, headers: { ...headers } as Record<string, string>, body }, origins),
```

`apps/ui/app/ConfirmDialog.vue` — `ACTIONS` is a `Record<GatewayOp, string>`:

```ts
const ACTIONS: Record<GatewayOp, string> = {
  'state.get': 'прочитать свои данные',
  'state.set': 'сохранить свои данные',
  'notifications.send': 'показать уведомление',
  'http.get': 'прочитать данные из сети',
  'http.send': 'отправить запрос в сеть',
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C packages/contracts test && pnpm -C apps/api test && pnpm -C apps/ui test`
Expected: PASS.

Run: `pnpm -C packages/contracts typecheck && pnpm -C apps/api typecheck && pnpm -C apps/ui typecheck && pnpm -C packages/widget-sdk typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/widget-gateway.ts packages/contracts/test/widget-gateway.test.ts apps/api/src/widget-gateway.ts apps/api/test/widget-gateway.test.ts apps/ui/app/ConfirmDialog.vue apps/ui/test/broker.test.ts
git commit -m "feat(api): add http.get and http.send gateway operations"
```

---

### Task 5: Host UI, SDK types and README for the network gateway

**Files:**
- Modify: `apps/ui/app/api.ts` (`ApiFailure` kind `upstream`)
- Modify: `apps/ui/app/widgets/broker.ts` (`toWidgetError`)
- Modify: `apps/ui/app/ConfirmDialog.vue` (request preview)
- Modify: `apps/ui/app/widgets/PackagesDialog.vue` (origins)
- Modify: `packages/widget-sdk/src/index.ts` (type exports)
- Modify: `README.md`
- Test: `apps/ui/test/api.test.ts`, `apps/ui/test/broker.test.ts`

**Interfaces:**
- Consumes: `UPSTREAM_ERROR` (Task 3), `HttpSendInput` (Task 3), `newOrigins` / `origins` (Task 2).
- Produces: `ApiFailure` gains `{ kind: 'upstream'; message: string }`; `@lifedashboard/widget-sdk` exports types
  `HttpGetInput`, `HttpSendInput`, `HttpOutput`.

- [ ] **Step 1: Write the failing tests**

In `apps/ui/test/api.test.ts`, inside `describe('apiRequest')`:

```ts
  it('keeps the message of a 502 UPSTREAM_ERROR; another 502 stays unavailable', async () => {
    vi.stubGlobal('fetch', respond(502, { error: { code: 'UPSTREAM_ERROR', message: 'The service is unreachable', requestId: 'x', retryable: false } }))
    expect(await api.gateway('http.get', 't', { url: 'http://127.0.0.1:8787/' })).toEqual({ ok: false, kind: 'upstream', message: 'The service is unreachable' })
    vi.stubGlobal('fetch', respond(502, { error: { code: 'X', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.rooms()).toEqual({ ok: false, kind: 'unavailable' })
  })
```

In `apps/ui/test/broker.test.ts`, inside `describe('createGatewayClient')`:

```ts
  it('reports an upstream failure as UNAVAILABLE with its message', async () => {
    const { client } = setup(answers({ ok: false, kind: 'upstream', message: 'The service did not answer in time' }))
    await expect(client.call('http.get', { url: 'http://127.0.0.1:8787/' })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'The service did not answer in time',
    })
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/api.test.ts test/broker.test.ts`
Expected: FAIL — the 502 maps to `unavailable`; the broker gives the generic message.

- [ ] **Step 3: Implement**

`apps/ui/app/api.ts`:

```ts
  | { kind: 'invalid'; code: string; message: string }
  // Network gateway: the service behind http.get/http.send failed; the message names the cause.
  | { kind: 'upstream'; message: string }
  | { kind: 'unavailable' }
```

Before the final `return { ok: false, kind: 'unavailable' }` in `apiRequest`:

```ts
  if (response.status === 502 && errorField(payload, 'code') === 'UPSTREAM_ERROR') {
    return { ok: false, kind: 'upstream', message: errorField(payload, 'message') ?? 'The service failed' }
  }
```

`apps/ui/app/widgets/broker.ts`, in `toWidgetError` before `default`:

```ts
    case 'upstream':
      return new WidgetError('UNAVAILABLE', failure.message)
```

`apps/ui/app/ConfirmDialog.vue` — import `type HttpSendInput` with the other contract types and add:

```ts
const request = computed(() => (current.value?.op === 'http.send' ? (current.value.input as HttpSendInput) : null))
```

In the template, after the notification preview:

```vue
      <div v-if="request" class="confirm__preview">
        <p class="confirm__preview-title">{{ request.method }} {{ request.url }}</p>
      </div>
```

`apps/ui/app/widgets/PackagesDialog.vue`:

In the review list, the permission item shows the origins:

```vue
        <li v-for="permission in manifest.permissions" :key="permission" class="packages__grant">
          {{ PERMISSIONS[permission] }}<template v-if="permission === 'network'">: {{ (manifest.network ?? []).join(', ') }}</template>
```

After the «Новые разрешения» warning:

```vue
      <p v-if="isUpdate && pending.inspection.newOrigins.length > 0" class="packages__warning">
        Новые адреса: {{ pending.inspection.newOrigins.join(', ') }}
      </p>
```

In the installed list:

```vue
            <span v-for="grant in pkg.grants" :key="grant.permission" class="packages__grant">
              {{ PERMISSIONS[grant.permission] }}<template v-if="grant.permission === 'network'">: {{ pkg.origins.join(', ') }}</template>
```

`packages/widget-sdk/src/index.ts` — extend the type re-export:

```ts
export type { HttpGetInput, HttpOutput, HttpSendInput, SizeClass, WidgetContext, WidgetErrorCode } from '@lifedashboard/contracts/widget-gateway'
```

`README.md`:
- Line 71: replace the paragraph with

```markdown
**Gateway operations:** `state.get`, `state.set`, `notifications.send`, `http.get` and `http.send`. HTTP goes through the LifeDashboard API to the exact origins a widget lists in `widget.json` `network` (together with the `network` permission) and the user approves at install; a new version with a new origin asks again. Redirects are not followed, no cookies or secrets are sent, the request body is at most 64 KB, the response at most 100 KB, and the upstream timeout is 4 s. LifeDashboard data sources, local device actions and Hermes are planned; they are not available through the SDK today.
```

- Line 85: replace «A widget still has no network access beyond its own folder.» with «A widget loads files only from its own folder; network requests go through `http.get` and `http.send`.»
- In «Existing examples», after the `hello` item add:

```markdown
- [`examples/widgets/hermes-tasks`](examples/widgets/hermes-tasks) shows and edits tasks of a local Hermes Tasks container on `127.0.0.1:8787` through `http.get`/`http.send`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/ui test && pnpm -C apps/ui typecheck && pnpm -C packages/widget-sdk typecheck`
Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/api.ts apps/ui/app/widgets/broker.ts apps/ui/app/ConfirmDialog.vue apps/ui/app/widgets/PackagesDialog.vue packages/widget-sdk/src/index.ts README.md apps/ui/test/api.test.ts apps/ui/test/broker.test.ts
git commit -m "feat(ui): show network origins and upstream errors for widgets"
```

---

### Task 6: Widget package and pure helpers

**Files:**
- Create: `examples/widgets/hermes-tasks/widget.json`
- Create: `examples/widgets/hermes-tasks/package.json`
- Create: `examples/widgets/hermes-tasks/src/views.ts`
- Create: `examples/widgets/hermes-tasks/src/layout.ts`
- Create: `examples/widgets/hermes-tasks/src/dates.ts`
- Create: `examples/widgets/hermes-tasks/src/quick-add.ts`
- Test: `examples/widgets/hermes-tasks/test/helpers.test.ts`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Consumes: manifest `network` (Task 1) — `ld-widget build` validates it in Task 9.
- Produces:
  - `views.ts`: `type View = 'today' | 'upcoming' | 'inbox' | 'all'`; `VIEWS: readonly { id: View; label: string }[]`.
  - `layout.ts`: `type Layout = 'rail' | 'stacked'`; `RAIL_MIN_WIDTH = 7`; `layoutFor(size: { w: number }): Layout`.
  - `dates.ts`: `addDays(date: string, days: number): string`; `nextMonday(date: string): string`;
    `formatDue(due: string, today: string): string`.
  - `quick-add.ts`: `interface QuickAdd { title: string; tags: string[]; date: string | null }`;
    `parseQuickAdd(text: string, context: { today: string; view: View; tag: string | null }): QuickAdd | null`.

- [ ] **Step 1: Create the package files**

`examples/widgets/hermes-tasks/widget.json`:

```json
{
  "id": "dev.lifedashboard.hermes-tasks",
  "version": "1.0.0",
  "title": "Задачи Hermes",
  "author": "LifeDashboard",
  "sdk": 1,
  "entry": "index.js",
  "styles": ["style.css"],
  "sizing": { "default": { "w": 8, "h": 8 }, "min": { "w": 3, "h": 4 }, "max": { "w": 16, "h": 16 } },
  "permissions": ["state", "network"],
  "network": ["http://127.0.0.1:8787"]
}
```

`examples/widgets/hermes-tasks/package.json`:

```json
{
  "name": "@lifedashboard/example-hermes-tasks",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "ld-widget build",
    "test": "vitest run"
  },
  "devDependencies": {
    "@lifedashboard/widget-sdk": "workspace:*",
    "vitest": "5.0.3"
  }
}
```

Run: `pnpm install`
Expected: exit 0; `pnpm-lock.yaml` gains the new importer.

`examples/widgets/hermes-tasks/src/views.ts`:

```ts
export type View = 'today' | 'upcoming' | 'inbox' | 'all'

export const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'upcoming', label: 'Скоро' },
  { id: 'inbox', label: 'Входящие' },
  { id: 'all', label: 'Все' },
]
```

- [ ] **Step 2: Write the failing tests**

`examples/widgets/hermes-tasks/test/helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addDays, formatDue, nextMonday } from '../src/dates.ts'
import { layoutFor } from '../src/layout.ts'
import { parseQuickAdd } from '../src/quick-add.ts'

const today = '2026-10-11' // a Sunday

describe('layoutFor', () => {
  it('uses the rail from 7 cells and the stacked layout below, down to the 3×4 minimum', () => {
    expect(layoutFor({ w: 7 })).toBe('rail')
    expect(layoutFor({ w: 16 })).toBe('rail')
    expect(layoutFor({ w: 6 })).toBe('stacked')
    expect(layoutFor({ w: 3 })).toBe('stacked')
  })
})

describe('dates', () => {
  it('adds days across months, years and DST changes without the machine clock', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-11', -1)).toBe('2026-10-10')
  })

  it('finds the next Monday, a week ahead from a Monday', () => {
    expect(nextMonday('2026-10-11')).toBe('2026-10-12')
    expect(nextMonday('2026-10-12')).toBe('2026-10-19')
    expect(nextMonday('2026-10-17')).toBe('2026-10-19')
  })

  it('formats due dates relative to the workspace today', () => {
    expect(formatDue('2026-10-11', today)).toBe('сегодня')
    expect(formatDue('2026-10-12', today)).toBe('завтра')
    expect(formatDue('2026-10-10', today)).toBe('вчера')
    expect(formatDue('2026-10-09', today)).toBe('9 окт')
    expect(formatDue('2027-03-18', today)).toBe('18 мар 2027')
    expect(formatDue('2026-10-11T19:00', today)).toBe('сегодня 19:00')
  })
})

describe('parseQuickAdd', () => {
  const context = { today, view: 'today' as const, tag: null }

  it('takes #tags and a date word out of the title', () => {
    expect(parseQuickAdd('Купить молоко #дом завтра', context)).toEqual({ title: 'Купить молоко', tags: ['дом'], date: '2026-10-12' })
    expect(parseQuickAdd('Позвонить маме Сегодня #Близкие', context)).toEqual({ title: 'Позвонить маме', tags: ['близкие'], date: today })
  })

  it('takes the default date from the view', () => {
    expect(parseQuickAdd('Задача', context)?.date).toBe(today)
    expect(parseQuickAdd('Задача', { ...context, view: 'upcoming' })?.date).toBe('2026-10-12')
    expect(parseQuickAdd('Задача', { ...context, view: 'inbox' })?.date).toBeNull()
    expect(parseQuickAdd('Задача', { ...context, view: 'all' })?.date).toBeNull()
  })

  it('adds the selected tag once', () => {
    expect(parseQuickAdd('Фильм #кино', { ...context, tag: 'кино' })?.tags).toEqual(['кино'])
    expect(parseQuickAdd('Фильм', { ...context, tag: 'кино' })?.tags).toEqual(['кино'])
  })

  it('keeps emoji and a lone #, and returns null without a title', () => {
    expect(parseQuickAdd('🎬 Фильм # вечером', context)?.title).toBe('🎬 Фильм # вечером')
    expect(parseQuickAdd('  #дом завтра ', context)).toBeNull()
    expect(parseQuickAdd('', context)).toBeNull()
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm -C examples/widgets/hermes-tasks test`
Expected: FAIL — cannot find `../src/dates.ts`.

- [ ] **Step 4: Implement**

`examples/widgets/hermes-tasks/src/layout.ts`:

```ts
export type Layout = 'rail' | 'stacked'

export const RAIL_MIN_WIDTH = 7

/** Spec «Layout»: the rail needs room for two columns; narrower widgets stack. */
export function layoutFor(size: { w: number }): Layout {
  return size.w >= RAIL_MIN_WIDTH ? 'rail' : 'stacked'
}
```

`examples/widgets/hermes-tasks/src/dates.ts`:

```ts
// Workspace dates are YYYY-MM-DD strings in the Hermes Tasks time zone. They are computed in UTC from
// those strings and never from the machine clock, whose zone may differ.

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function nextMonday(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return addDays(date, (8 - weekday) % 7 || 7)
}

/** «сегодня», «завтра», «вчера», «9 окт» or «18 мар 2027», plus « 19:00» for a timed due. */
export function formatDue(due: string, today: string): string {
  const date = due.slice(0, 10)
  const time = due.slice(11, 16)
  let day: string
  if (date === today) day = 'сегодня'
  else if (date === addDays(today, 1)) day = 'завтра'
  else if (date === addDays(today, -1)) day = 'вчера'
  else {
    const month = MONTHS[Number(date.slice(5, 7)) - 1]
    day = `${Number(date.slice(8, 10))} ${month}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`}`
  }
  return time ? `${day} ${time}` : day
}
```

`examples/widgets/hermes-tasks/src/quick-add.ts`:

```ts
import { addDays } from './dates.ts'
import type { View } from './views.ts'

export interface QuickAdd {
  title: string
  tags: string[]
  date: string | null
}

/** «Купить молоко #дом завтра» → title, tags and date; null when no title is left. */
export function parseQuickAdd(text: string, context: { today: string; view: View; tag: string | null }): QuickAdd | null {
  const tags = new Set<string>(context.tag === null ? [] : [context.tag])
  let date: string | undefined
  const words: string[] = []
  for (const word of text.trim().split(/\s+/)) {
    const lower = word.toLowerCase()
    if (word.length > 1 && word.startsWith('#')) tags.add(lower.slice(1))
    else if (lower === 'сегодня') date = context.today
    else if (lower === 'завтра') date = addDays(context.today, 1)
    else if (word !== '') words.push(word)
  }
  const title = words.join(' ')
  if (title === '') return null
  return { title, tags: [...tags], date: date ?? defaultDate(context.view, context.today) }
}

// Spec «Quick add»: a task added in a view should show up in it.
function defaultDate(view: View, today: string): string | null {
  if (view === 'today') return today
  if (view === 'upcoming') return addDays(today, 1)
  return null
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C examples/widgets/hermes-tasks test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add examples/widgets/hermes-tasks/widget.json examples/widgets/hermes-tasks/package.json examples/widgets/hermes-tasks/src/views.ts examples/widgets/hermes-tasks/src/layout.ts examples/widgets/hermes-tasks/src/dates.ts examples/widgets/hermes-tasks/src/quick-add.ts examples/widgets/hermes-tasks/test/helpers.test.ts pnpm-lock.yaml
git commit -m "feat(widgets): scaffold the Hermes Tasks widget with dates and quick add"
```

---

### Task 7: Hermes Tasks client

**Files:**
- Create: `examples/widgets/hermes-tasks/src/api.ts`
- Test: `examples/widgets/hermes-tasks/test/api.test.ts`

**Interfaces:**
- Consumes: `View` (Task 6); type `HttpOutput` from `@lifedashboard/widget-sdk` (Task 5).
- Produces (all exported from `src/api.ts`):
  - `BASE = 'http://127.0.0.1:8787/api/v1'`, `PAGE_SIZE = 200`, `LIST_CAP = 1000`.
  - `type Call = (op: 'http.get' | 'http.send', input: unknown) => Promise<unknown>`.
  - Types `Priority`, `Schedule`, `ListItem`, `ListResult`, `Occurrence`, `TaskSummary`, `TaskDetail`,
    `CloseResult`, `UpdateResult`, `Tag`, `Project`, `Workspace`, `TaskPatch`, `NewTask`, `Attempt`.
  - `class TasksError extends Error { code: string; retryable: boolean }`; `toTasksError(error: unknown): TasksError`;
    `newKey(): string`.
  - `createTasksApi(call: Call, base?: string)` returning `{ readonly epoch: string | null; workspace(): Promise<Workspace>;
    list(view: View, tag: string | null): Promise<ListResult>; task(taskId: string): Promise<TaskDetail>;
    projects(): Promise<Project[]>; occurrenceAction(action: 'complete' | 'skip' | 'reopen', occurrenceId: string, version: number): Attempt;
    reschedule(occurrenceId: string, version: number, schedule: Schedule): Attempt;
    update(taskId: string, version: number, patch: TaskPatch): Attempt; create(task: NewTask): Attempt;
    send<T>(attempt: Attempt): Promise<T> }`; `type TasksApi = ReturnType<typeof createTasksApi>`.

- [ ] **Step 1: Write the failing tests**

`examples/widgets/hermes-tasks/test/api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { BASE, createTasksApi, TasksError, type ListItem } from '../src/api.ts'

type Handler = (op: string, input: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => unknown

function fake(handler: Handler) {
  const call = vi.fn(async (op: string, input: unknown) => handler(op, input as Parameters<Handler>[1]))
  return { call, api: createTasksApi(call) }
}

const meta = (epoch = 'e1') => ({ workspaceEpoch: epoch, mutationSeq: 1, asOf: '2026-10-11T08:00:00Z', replayed: false })
const reply = (status: number, payload: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(payload) })
const ok = (data: unknown, epoch?: string) => reply(200, { ok: true, data, meta: meta(epoch) })
const failure = (status: number, code: string, retryable = false) =>
  reply(status, { ok: false, error: { code, message: `${code} message`, retryable, details: null }, meta: { requestId: 'r', workspaceEpoch: 'e1' } })

function item(id: string, overdue = false): ListItem {
  return { taskId: `t${id}`, occurrenceId: `o${id}`, title: id, projectId: null, taskVersion: 1, occurrenceVersion: 1, due: '2026-10-11', overdue, status: 'open', recurring: false }
}

const query = (url: string) => new URL(url).searchParams

describe('request', () => {
  it('returns envelope data, remembers the epoch and asks for JSON', async () => {
    const { api, call } = fake(() => ok({ today: '2026-10-11', tags: [], nextTagsCursor: null }, 'e7'))
    expect(await api.workspace()).toEqual({ today: '2026-10-11', tags: [] })
    expect(api.epoch).toBe('e7')
    expect(call).toHaveBeenCalledWith('http.get', { url: `${BASE}/workspace?tagsLimit=200`, headers: { accept: 'application/json' } })
  })

  it('turns an error envelope into a TasksError with its code', async () => {
    const { api } = fake(() => failure(409, 'VERSION_CONFLICT'))
    await expect(api.task('t1')).rejects.toMatchObject({ code: 'VERSION_CONFLICT', retryable: false, message: 'VERSION_CONFLICT message' })
    const busy = fake(() => failure(503, 'STORAGE_BUSY', true))
    await expect(busy.api.task('t1')).rejects.toMatchObject({ code: 'STORAGE_BUSY', retryable: true })
  })

  it('passes gateway errors on with their code; only transport codes are retryable', async () => {
    const declined = fake(() => Promise.reject(Object.assign(new Error('The user declined the call'), { code: 'DECLINED' })))
    await expect(declined.api.task('t1')).rejects.toMatchObject({ code: 'DECLINED', retryable: false })
    const down = fake(() => Promise.reject(Object.assign(new Error('The service is unreachable'), { code: 'UNAVAILABLE' })))
    await expect(down.api.task('t1')).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true, message: 'The service is unreachable' })
  })

  it('answers without JSON become a retryable UNAVAILABLE', async () => {
    const { api } = fake(() => ({ status: 404, contentType: 'text/html', body: '<h1>Not Found</h1>' }))
    const error = await api.task('t1').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(TasksError)
    expect(error).toMatchObject({ code: 'UNAVAILABLE', retryable: true, message: 'Hermes Tasks answered 404 without JSON' })
  })
})

describe('reading lists', () => {
  it('follows tag pages', async () => {
    const { api, call } = fake((_op, { url }) =>
      query(url).get('tagsCursor') === null
        ? ok({ today: '2026-10-11', tags: [{ name: 'a', openCount: 1 }], nextTagsCursor: 'c1' })
        : ok({ today: '2026-10-11', tags: [{ name: 'b', openCount: 2 }], nextTagsCursor: null }),
    )
    expect((await api.workspace()).tags.map((tag) => tag.name)).toEqual(['a', 'b'])
    expect(query((call.mock.calls[1]![1] as { url: string }).url).get('tagsCursor')).toBe('c1')
  })

  it('merges Today: a row in both answers appears once, under overdue', async () => {
    const { api } = fake((_op, { url }) =>
      query(url).get('due') === 'overdue'
        ? ok({ items: [item('a', true)], nextCursor: null })
        : ok({ items: [item('a', true), item('b')], nextCursor: null }),
    )
    const result = await api.list('today', null)
    expect(result.overdue.map((row) => row.title)).toEqual(['a'])
    expect(result.items.map((row) => row.title)).toEqual(['b'])
  })

  it('maps views to queries', async () => {
    const { api, call } = fake(() => ok({ items: [], nextCursor: null }))
    await api.list('upcoming', null)
    await api.list('inbox', null)
    await api.list('all', null)
    const urls = call.mock.calls.map(([, input]) => (input as { url: string }).url)
    expect(urls.map((url) => Object.fromEntries(query(url)))).toEqual([
      { status: 'open', due: 'upcoming', limit: '200' },
      { status: 'open', projectId: 'inbox', limit: '200' },
      { status: 'open', limit: '200' },
    ])
  })

  it('encodes tag names in the query', async () => {
    const { api, call } = fake(() => ok({ items: [], nextCursor: null }))
    await api.list('all', 'дом & сад #1')
    const url = (call.mock.calls[0]![1] as { url: string }).url
    expect(query(url).getAll('tags')).toEqual(['дом & сад #1'])
    expect(url).not.toContain(' ')
  })

  it('reads pages up to 1000 rows and reports the rest as truncated', async () => {
    let n = 0
    const { api, call } = fake(() => ok({ items: Array.from({ length: 200 }, () => item(String(n++))), nextCursor: 'more' }))
    const result = await api.list('all', null)
    expect(result.items).toHaveLength(1000)
    expect(result.truncated).toBe(true)
    expect(call).toHaveBeenCalledTimes(5)
  })

  it('restarts a request once after CURSOR_STALE, then gives up', async () => {
    const pages = [ok({ items: [item('a')], nextCursor: 'c' }), failure(409, 'CURSOR_STALE'), ok({ items: [item('a')], nextCursor: 'c' }), ok({ items: [item('b')], nextCursor: null })]
    const once = fake(() => pages.shift())
    expect((await once.api.list('all', null)).items.map((row) => row.title)).toEqual(['a', 'b'])

    const always = fake((_op, { url }) => (query(url).get('cursor') === null ? ok({ items: [item('a')], nextCursor: 'c' }) : failure(409, 'CURSOR_STALE')))
    await expect(always.api.list('all', null)).rejects.toMatchObject({ code: 'CURSOR_STALE' })
  })

  it('reads all project pages', async () => {
    const { api } = fake((_op, { url }) =>
      query(url).get('cursor') === null
        ? ok({ items: [{ id: 'p1', name: 'A', archived: false }], nextCursor: 'c' })
        : ok({ items: [{ id: 'p2', name: 'B', archived: false }], nextCursor: null }),
    )
    expect((await api.projects()).map((project) => project.id)).toEqual(['p1', 'p2'])
  })
})

describe('writes', () => {
  it('prepares an attempt with the latest epoch and a new key, and resends it unchanged', async () => {
    const { api, call } = fake((op) => (op === 'http.get' ? ok({ today: '2026-10-11', tags: [], nextTagsCursor: null }, 'e9') : ok({ task: { version: 4 } })))
    await api.workspace()
    const attempt = api.update('t 1', 3, { title: 'Новое' })
    expect(attempt).toEqual({
      method: 'PATCH',
      path: '/tasks/t%201',
      body: { expectedVersion: 3, title: 'Новое', workspaceEpoch: 'e9', idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/) },
    })
    expect(api.update('t 1', 3, { title: 'Новое' }).body.idempotencyKey).not.toBe(attempt.body.idempotencyKey)
    await api.send(attempt)
    await api.send(attempt)
    const sends = call.mock.calls.filter(([op]) => op === 'http.send').map(([, input]) => input)
    expect(sends).toEqual([
      { url: `${BASE}/tasks/t%201`, method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(attempt.body) },
      { url: `${BASE}/tasks/t%201`, method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(attempt.body) },
    ])
  })

  it('builds occurrence, reschedule and create paths', () => {
    const { api } = fake(() => ok(null))
    expect(api.occurrenceAction('skip', 'o1', 2)).toMatchObject({ method: 'POST', path: '/occurrences/o1/skip', body: { expectedVersion: 2 } })
    expect(api.reschedule('o1', 2, { kind: 'date', date: '2026-10-12' })).toMatchObject({
      method: 'POST',
      path: '/occurrences/o1/reschedule',
      body: { expectedVersion: 2, schedule: { kind: 'date', date: '2026-10-12' } },
    })
    expect(api.create({ title: 'X', tags: ['a'], schedule: null })).toMatchObject({ method: 'POST', path: '/tasks', body: { title: 'X', tags: ['a'], schedule: null } })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C examples/widgets/hermes-tasks exec vitest run test/api.test.ts`
Expected: FAIL — cannot find `../src/api.ts`.

- [ ] **Step 3: Implement**

`examples/widgets/hermes-tasks/src/api.ts`:

```ts
import type { HttpOutput } from '@lifedashboard/widget-sdk'
import type { View } from './views.ts'

export const BASE = 'http://127.0.0.1:8787/api/v1'
export const PAGE_SIZE = 200
// Spec «Views and filter»: a personal list never needs more; the UI says when rows were left out.
export const LIST_CAP = 1000
// Gateway codes after which the very same request may be sent again.
const RETRYABLE = new Set(['UNAVAILABLE', 'TIMEOUT', 'BRIDGE_CLOSED'])

export type Call = (op: 'http.get' | 'http.send', input: unknown) => Promise<unknown>
export type Priority = 'none' | 'low' | 'medium' | 'high'
export type Schedule = { kind: 'date'; date: string } | { kind: 'datetime'; datetime: string } | null

export interface ListItem {
  taskId: string
  occurrenceId: string
  title: string
  projectId: string | null
  projectName?: string
  taskVersion: number
  occurrenceVersion: number
  due: string | null
  overdue: boolean
  status: 'open' | 'completed' | 'skipped'
  recurring: boolean
  priority?: 'low' | 'medium' | 'high'
  tags?: string[]
}

export interface ListResult {
  overdue: ListItem[]
  items: ListItem[]
  truncated: boolean
}

export interface Occurrence {
  id: string
  taskId: string
  due: string | null
  status: 'open' | 'completed' | 'skipped'
  overdue: boolean
  version: number
}

export interface TaskSummary {
  id: string
  title: string
  description: string | null
  projectId: string | null
  priority: Priority
  tags: string[]
  recurrence: { frequency: 'day' | 'week' | 'month' | 'year'; interval: number } | null
  version: number
}

export interface TaskDetail {
  task: TaskSummary
  currentOccurrence: Occurrence | null
}

export interface CloseResult {
  closedOccurrence: Occurrence
  nextOccurrence: Occurrence | null
  taskVersion: number
}

export interface UpdateResult {
  task: TaskSummary
}

export interface Tag {
  name: string
  openCount: number
}

export interface Project {
  id: string
  name: string
  archived: boolean
}

export interface Workspace {
  today: string
  tags: Tag[]
}

export interface TaskPatch {
  title?: string
  description?: string | null
  priority?: Priority
  tags?: string[]
  projectId?: string | null
}

export interface NewTask {
  title: string
  tags: string[]
  schedule: Schedule
}

/** One write intention. Resent unchanged, Hermes Tasks answers a replay instead of acting twice. */
export interface Attempt {
  method: 'POST' | 'PATCH'
  path: string
  body: Record<string, unknown>
}

/** `code` is the Hermes Tasks code, or a gateway code (UNAVAILABLE, DECLINED, RATE_LIMITED, …). */
export class TasksError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'TasksError'
    this.code = code
    this.retryable = retryable
  }
}

export function toTasksError(error: unknown): TasksError {
  if (error instanceof TasksError) return error
  const raw = (error as { code?: unknown } | null)?.code
  const code = typeof raw === 'string' ? raw : 'UNAVAILABLE'
  return new TasksError(code, error instanceof Error ? error.message : String(error), RETRYABLE.has(code))
}

// crypto.randomUUID needs a secure context, which an opaque-origin frame may not be.
export function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface Envelope {
  ok?: boolean
  data?: unknown
  error?: { code?: string; message?: string; retryable?: boolean }
  meta?: { workspaceEpoch?: unknown }
}

interface Paging {
  items: string
  next: string
  cursor: string
  limit: string
}

type Query = Record<string, string | string[]>

const TASK_PAGES: Paging = { items: 'items', next: 'nextCursor', cursor: 'cursor', limit: 'limit' }
const TAG_PAGES: Paging = { items: 'tags', next: 'nextTagsCursor', cursor: 'tagsCursor', limit: 'tagsLimit' }
const VIEW_QUERY: Record<Exclude<View, 'today'>, Query> = {
  upcoming: { status: 'open', due: 'upcoming' },
  inbox: { status: 'open', projectId: 'inbox' },
  all: { status: 'open' },
}

function withQuery(path: string, query: Query): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) for (const item of [value].flat()) params.append(name, item)
  return `${path}?${params}`
}

export function createTasksApi(call: Call, base: string = BASE) {
  let epoch: string | null = null

  async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    let output: HttpOutput
    try {
      output = (method === 'GET'
        ? await call('http.get', { url: base + path, headers: { accept: 'application/json' } })
        : await call('http.send', {
            url: base + path,
            method,
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })) as HttpOutput
    } catch (error) {
      throw toTasksError(error)
    }
    let envelope: Envelope | null
    try {
      envelope = JSON.parse(output.body) as Envelope | null
    } catch {
      envelope = null
    }
    if (envelope === null || typeof envelope !== 'object') {
      throw new TasksError('UNAVAILABLE', `Hermes Tasks answered ${output.status} without JSON`, true)
    }
    if (typeof envelope.meta?.workspaceEpoch === 'string') epoch = envelope.meta.workspaceEpoch
    if (envelope.ok === true && output.status < 300) return envelope.data as T
    const error = envelope.error
    throw new TasksError(error?.code ?? 'UNAVAILABLE', error?.message ?? `Hermes Tasks answered ${output.status}`, error?.retryable ?? output.status >= 500)
  }

  async function readPages<T>(path: string, query: Query, paging: Paging): Promise<{ first: Record<string, unknown>; items: T[]; truncated: boolean }> {
    const items: T[] = []
    let first: Record<string, unknown> | null = null
    let cursor: string | null = null
    do {
      const page: Record<string, unknown> = await request<Record<string, unknown>>(
        'GET',
        withQuery(path, { ...query, [paging.limit]: String(PAGE_SIZE), ...(cursor === null ? {} : { [paging.cursor]: cursor }) }),
      )
      first ??= page
      items.push(...(page[paging.items] as T[]))
      cursor = (page[paging.next] as string | null | undefined) ?? null
    } while (cursor !== null && items.length < LIST_CAP)
    return { first: first!, items: items.slice(0, LIST_CAP), truncated: cursor !== null }
  }

  // CURSOR_STALE: the data changed between pages; one restart from the first page, then the caller decides.
  async function readAll<T>(path: string, query: Query, paging: Paging) {
    try {
      return await readPages<T>(path, query, paging)
    } catch (error) {
      if (!(error instanceof TasksError) || error.code !== 'CURSOR_STALE') throw error
      return readPages<T>(path, query, paging)
    }
  }

  function prepare(method: Attempt['method'], path: string, fields: Record<string, unknown>): Attempt {
    // Before the first read there is no epoch; Hermes Tasks rejects the write and the next refresh reads one.
    return { method, path, body: { ...fields, workspaceEpoch: epoch ?? '', idempotencyKey: newKey() } }
  }

  const id = encodeURIComponent

  return {
    get epoch(): string | null {
      return epoch
    },

    async workspace(): Promise<Workspace> {
      const { first, items } = await readAll<Tag>('/workspace', {}, TAG_PAGES)
      return { today: first.today as string, tags: items }
    },

    async list(view: View, tag: string | null): Promise<ListResult> {
      const tags: Query = tag === null ? {} : { tags: [tag] }
      if (view === 'today') {
        const [overdue, today] = await Promise.all([
          readAll<ListItem>('/tasks', { status: 'open', due: 'overdue', ...tags }, TASK_PAGES),
          readAll<ListItem>('/tasks', { status: 'open', due: 'today', ...tags }, TASK_PAGES),
        ])
        // A task timed earlier today is in both answers; it belongs under «Просрочено».
        return { overdue: overdue.items, items: today.items.filter((item) => !item.overdue), truncated: overdue.truncated || today.truncated }
      }
      const result = await readAll<ListItem>('/tasks', { ...VIEW_QUERY[view], ...tags }, TASK_PAGES)
      return { overdue: [], items: result.items, truncated: result.truncated }
    },

    task: (taskId: string) => request<TaskDetail>('GET', `/tasks/${id(taskId)}`),

    async projects(): Promise<Project[]> {
      return (await readAll<Project>('/projects', {}, TASK_PAGES)).items
    },

    occurrenceAction: (action: 'complete' | 'skip' | 'reopen', occurrenceId: string, version: number) =>
      prepare('POST', `/occurrences/${id(occurrenceId)}/${action}`, { expectedVersion: version }),

    reschedule: (occurrenceId: string, version: number, schedule: Schedule) =>
      prepare('POST', `/occurrences/${id(occurrenceId)}/reschedule`, { expectedVersion: version, schedule }),

    update: (taskId: string, version: number, patch: TaskPatch) => prepare('PATCH', `/tasks/${id(taskId)}`, { expectedVersion: version, ...patch }),

    create: (task: NewTask) => prepare('POST', '/tasks', { ...task }),

    send: <T>(attempt: Attempt) => request<T>(attempt.method, attempt.path, attempt.body),
  }
}

export type TasksApi = ReturnType<typeof createTasksApi>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C examples/widgets/hermes-tasks test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/widgets/hermes-tasks/src/api.ts examples/widgets/hermes-tasks/test/api.test.ts
git commit -m "feat(widgets): add the Hermes Tasks client over the network gateway"
```

---

### Task 8: Autosave queue

**Files:**
- Create: `examples/widgets/hermes-tasks/src/autosave.ts`
- Test: `examples/widgets/hermes-tasks/test/autosave.test.ts`

**Interfaces:**
- Consumes: `Attempt`, `TaskPatch`, `Priority`, `TasksError`, `toTasksError` (Task 7).
- Produces: `interface AutosaveState { version: number; dirty: TaskPatch; saving: boolean; failed: { code: string; message: string } | null }`;
  `interface AutosaveDeps { prepare(patch: TaskPatch, version: number): Attempt; send(attempt: Attempt): Promise<{ task: { version: number } }>; onSaved?(): void; onFailed?(error: TasksError): void }`;
  `createAutosave(state: AutosaveState, deps: AutosaveDeps): { draft<K extends keyof TaskPatch>(field: K, value: TaskPatch[K]): void; edit<K extends keyof TaskPatch>(field: K, value: TaskPatch[K]): Promise<void>; retry(): Promise<void> }`;
  `interface Editable { title: string; description: string | null; priority: Priority; tags: string[]; projectId: string | null }`;
  `shown(task: Editable, dirty: TaskPatch): Editable`.

- [ ] **Step 1: Write the failing tests**

`examples/widgets/hermes-tasks/test/autosave.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { TasksError, type Attempt, type TaskPatch } from '../src/api.ts'
import { createAutosave, shown, type AutosaveState } from '../src/autosave.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function setup() {
  const state: AutosaveState = { version: 3, dirty: {}, saving: false, failed: null }
  const answers: ReturnType<typeof deferred<{ task: { version: number } }>>[] = []
  let key = 0
  const prepare = vi.fn((patch: TaskPatch, version: number): Attempt => ({ method: 'PATCH', path: '/tasks/t1', body: { ...patch, expectedVersion: version, idempotencyKey: `k${++key}` } }))
  const send = vi.fn((_attempt: Attempt) => {
    const answer = deferred<{ task: { version: number } }>()
    answers.push(answer)
    return answer.promise
  })
  const onSaved = vi.fn()
  const autosave = createAutosave(state, { prepare, send, onSaved })
  return { state, answers, prepare, send, onSaved, autosave }
}

const task = { title: 'Сервер', description: null, priority: 'none' as const, tags: ['a'], projectId: null }

describe('createAutosave', () => {
  it('sends one write at a time; an edit made meanwhile goes next with the returned version', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    void autosave.edit('priority', 'high')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0].body).toMatchObject({ title: 'Новое', expectedVersion: 3 })
    answers[0]!.resolve({ task: { version: 4 } })
    await first
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0].body).toEqual({ priority: 'high', expectedVersion: 4, idempotencyKey: 'k2' })
    expect(state.dirty).toEqual({ priority: 'high' })
    answers[1]!.resolve({ task: { version: 5 } })
    await vi.waitFor(() => expect(state.saving).toBe(false))
    expect([state.version, state.dirty]).toEqual([5, {}])
  })

  it('keeps a field typed again during its own save', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Один')
    void autosave.edit('title', 'Два')
    answers[0]!.resolve({ task: { version: 4 } })
    await first
    expect(send.mock.calls[1]![0].body).toMatchObject({ title: 'Два', expectedVersion: 4 })
    expect(state.dirty).toEqual({ title: 'Два' })
  })

  it('does not send a draft, but keeps it dirty', async () => {
    const { state, send, autosave } = setup()
    autosave.draft('title', 'Пишу…')
    void autosave.edit('priority', 'low')
    expect(send.mock.calls[0]![0].body).toEqual({ priority: 'low', expectedVersion: 3, idempotencyKey: 'k1' })
    expect(state.dirty).toEqual({ title: 'Пишу…', priority: 'low' })
  })

  it('stops after a lost answer and resends the same attempt before later edits', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    void autosave.edit('priority', 'high')
    answers[0]!.reject(new TasksError('UNAVAILABLE', 'The service is unreachable', true))
    await first
    expect(state.failed).toEqual({ code: 'UNAVAILABLE', message: 'The service is unreachable' })
    expect(send).toHaveBeenCalledTimes(1)
    void autosave.edit('tags', ['b'])
    expect(send).toHaveBeenCalledTimes(1)

    const again = autosave.retry()
    expect(send.mock.calls[1]![0]).toBe(send.mock.calls[0]![0])
    answers[1]!.resolve({ task: { version: 4 } })
    await again
    expect(send.mock.calls[2]![0].body).toEqual({ priority: 'high', tags: ['b'], expectedVersion: 4, idempotencyKey: 'k2' })
  })

  it('after a conflict sends every dirty field as a new attempt from the re-read version', async () => {
    const { state, answers, send, prepare, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    answers[0]!.reject(new TasksError('VERSION_CONFLICT', 'changed', false))
    await first
    expect(state.dirty).toEqual({ title: 'Новое' })
    state.version = 9
    void autosave.retry()
    expect(prepare).toHaveBeenLastCalledWith({ title: 'Новое' }, 9)
    expect(send.mock.calls[1]![0].body.idempotencyKey).toBe('k2')
  })

  it('keeps the typed value after DECLINED and sends nothing on its own', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    answers[0]!.reject(new TasksError('DECLINED', 'The user declined the call', false))
    await first
    expect([state.failed?.code, state.dirty]).toEqual(['DECLINED', { title: 'Новое' }])
    void autosave.edit('priority', 'low')
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('shown', () => {
  it('shows dirty fields over the server values and the server values elsewhere', () => {
    expect(shown({ ...task, priority: 'high' }, { title: 'Моё' })).toEqual({ ...task, priority: 'high', title: 'Моё' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C examples/widgets/hermes-tasks exec vitest run test/autosave.test.ts`
Expected: FAIL — cannot find `../src/autosave.ts`.

- [ ] **Step 3: Implement**

`examples/widgets/hermes-tasks/src/autosave.ts`:

```ts
import { toTasksError, type Attempt, type Priority, type TaskPatch, type TasksError } from './api.ts'

export interface AutosaveState {
  version: number
  // Typed but not confirmed by Hermes Tasks; a refresh never overwrites these.
  dirty: TaskPatch
  saving: boolean
  // Set by a failed write; nothing is sent again until retry().
  failed: { code: string; message: string } | null
}

export interface AutosaveDeps {
  prepare(patch: TaskPatch, version: number): Attempt
  send(attempt: Attempt): Promise<{ task: { version: number } }>
  onSaved?(): void
  onFailed?(error: TasksError): void
}

export interface Editable {
  title: string
  description: string | null
  priority: Priority
  tags: string[]
  projectId: string | null
}

/** Spec «Autosave»: one write per task in flight, later edits merged into the next one. */
export function createAutosave(state: AutosaveState, deps: AutosaveDeps) {
  // Fields the user committed (change or blur); a draft is dirty but not sent.
  const committed = new Set<keyof TaskPatch>()
  // The attempt that lost its answer, resent unchanged by retry().
  let lost: { attempt: Attempt; patch: TaskPatch } | null = null

  async function run(attempt: Attempt, patch: TaskPatch): Promise<void> {
    state.saving = true
    try {
      const result = await deps.send(attempt)
      state.version = result.task.version
      for (const field of Object.keys(patch) as (keyof TaskPatch)[]) {
        if (same(state.dirty[field], patch[field])) {
          delete state.dirty[field]
          committed.delete(field)
        }
      }
      state.saving = false
      deps.onSaved?.()
      // Not awaited: this write is done; the next one runs on its own.
      void flush()
    } catch (error) {
      const failure = toTasksError(error)
      state.saving = false
      state.failed = { code: failure.code, message: failure.message }
      lost = failure.retryable ? { attempt, patch } : null
      deps.onFailed?.(failure)
    }
  }

  function flush(): Promise<void> {
    if (state.saving || state.failed !== null || committed.size === 0) return Promise.resolve()
    const patch: TaskPatch = {}
    for (const field of committed) Object.assign(patch, { [field]: state.dirty[field] })
    return run(deps.prepare(patch, state.version), patch)
  }

  return {
    draft<K extends keyof TaskPatch>(field: K, value: TaskPatch[K]): void {
      state.dirty[field] = value
    },

    edit<K extends keyof TaskPatch>(field: K, value: TaskPatch[K]): Promise<void> {
      state.dirty[field] = value
      committed.add(field)
      return flush()
    },

    /** After a lost answer: that attempt unchanged, then later edits. Otherwise a new attempt from `state.version`. */
    retry(): Promise<void> {
      if (state.saving || state.failed === null) return Promise.resolve()
      state.failed = null
      const kept = lost
      lost = null
      return kept ? run(kept.attempt, kept.patch) : flush()
    },
  }
}

export function shown(task: Editable, dirty: TaskPatch): Editable {
  return { title: task.title, description: task.description, priority: task.priority, tags: task.tags, projectId: task.projectId, ...dirty }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C examples/widgets/hermes-tasks test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/widgets/hermes-tasks/src/autosave.ts examples/widgets/hermes-tasks/test/autosave.test.ts
git commit -m "feat(widgets): queue Hermes Tasks edits for autosave"
```

---

### Task 9: Widget UI

**Files:**
- Create: `examples/widgets/hermes-tasks/src/use-tasks.ts`
- Create: `examples/widgets/hermes-tasks/src/index.vue`
- Create: `examples/widgets/hermes-tasks/src/Rail.vue`
- Create: `examples/widgets/hermes-tasks/src/ViewTabs.vue`
- Create: `examples/widgets/hermes-tasks/src/TaskList.vue`
- Create: `examples/widgets/hermes-tasks/src/TaskRow.vue`
- Create: `examples/widgets/hermes-tasks/src/DetailPanel.vue`

**Interfaces:**
- Consumes: everything from Tasks 6–8; `useWidget`, `WidgetError`, `type Widget` from `@lifedashboard/widget-sdk`.
- Produces: `useTasks(widget: Widget)` returning a `reactive` object (refs unwrapped) with fields `api`, `view`,
  `tag`, `today`, `tags`, `list`, `loaded`, `unavailable`, `pending`, `toasts`, `openTaskId`, `detail`,
  `projects` and methods `refresh(): Promise<void>`, `retry(): void`,
  `close(occurrenceId: string, version: number, action: 'complete' | 'skip'): Promise<boolean>`,
  `reschedule(occurrenceId: string, version: number, schedule: Schedule): Promise<boolean>`,
  `create(text: string): Promise<boolean>`, `openTask(taskId: string): void`, `closeTask(): void`,
  `loadDetail(): Promise<void>`, `toast(text: string, action?: Toast['action']): void`, `dismiss(id: number): void`;
  `type Tasks = ReturnType<typeof useTasks>`.

The SFCs have no unit-test harness in this repository (as for `hello`); their behaviour is covered by the
Task 10 browser checks. The composable keeps all decisions; components only render and forward events.

- [ ] **Step 1: Write the composable**

`examples/widgets/hermes-tasks/src/use-tasks.ts`:

```ts
import { markRaw, onBeforeUnmount, reactive, ref, watch, type WatchStopHandle } from 'vue'
import { WidgetError, type Widget } from '@lifedashboard/widget-sdk'
import {
  createTasksApi,
  toTasksError,
  type Attempt,
  type CloseResult,
  type ListItem,
  type ListResult,
  type Project,
  type Schedule,
  type Tag,
  type TaskDetail,
  type TasksError,
} from './api.ts'
import { parseQuickAdd } from './quick-add.ts'
import type { View } from './views.ts'

const REFRESH_MS = 10_000
const RATE_PAUSE_MS = 30_000
const TOAST_MS = 5_000
const EMPTY: ListResult = { overdue: [], items: [], truncated: false }

export interface Toast {
  id: number
  text: string
  action: { label: string; run: () => void } | null
}

interface Prefs {
  view: View
  tag: string | null
}

interface MutationOptions<T> {
  pendingId?: string
  onDone?: (result: T) => void
}

/** Spec «Refresh», «Actions» and «Errors»: the widget's data and every call to Hermes Tasks. */
export function useTasks(widget: Widget) {
  const api = markRaw(createTasksApi((op, input) => widget.call(op, input)))
  const view = ref<View>('today')
  const tag = ref<string | null>(null)
  const today = ref<string | null>(null)
  const tags = ref<Tag[]>([])
  const list = ref<ListResult>(EMPTY)
  const loaded = ref(false)
  const unavailable = ref(false)
  const pending = ref<string[]>([])
  const toasts = ref<Toast[]>([])
  const openTaskId = ref<string | null>(null)
  const detail = ref<TaskDetail | null>(null)
  const projects = ref<Project[]>([])
  // A write lost to UNAVAILABLE; the banner's «Повторить» sends it again with the same key.
  let retryAction: (() => Promise<unknown>) | null = null
  let refreshing = false
  let queued = false
  let pausedUntil = 0
  let prefsRevision = 0
  let toastId = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  const stops: WatchStopHandle[] = []

  function toast(text: string, action: Toast['action'] = null): void {
    const id = ++toastId
    toasts.value = [...toasts.value, { id, text, action }]
    setTimeout(() => dismiss(id), TOAST_MS)
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }

  async function loadDetail(): Promise<void> {
    const taskId = openTaskId.value
    if (taskId === null) return
    try {
      const [task, all] = await Promise.all([api.task(taskId), api.projects()])
      if (openTaskId.value !== taskId) return
      detail.value = task
      projects.value = all
    } catch (error) {
      const failure = toTasksError(error)
      // Deleted through Hermes meanwhile.
      if (failure.code === 'NOT_FOUND') closeTask()
      else throw failure
    }
  }

  function readFailed(failure: TasksError): void {
    // A second CURSOR_STALE: the previous list stays until the next refresh.
    if (failure.code === 'CURSOR_STALE') return
    if (failure.code === 'RATE_LIMITED') pausedUntil = Date.now() + RATE_PAUSE_MS
    else if (failure.retryable) unavailable.value = true
    else toast(failure.message)
  }

  async function refresh(): Promise<void> {
    if (refreshing) {
      queued = true
      return
    }
    if (Date.now() < pausedUntil) return
    refreshing = true
    try {
      const workspace = await api.workspace()
      today.value = workspace.today
      tags.value = workspace.tags
      const wanted = { view: view.value, tag: tag.value }
      const result = await api.list(wanted.view, wanted.tag)
      // The filter changed while this ran: the queued refresh reads the new one.
      if (wanted.view === view.value && wanted.tag === tag.value) {
        list.value = result
        loaded.value = true
      }
      await loadDetail()
      if (retryAction === null) unavailable.value = false
    } catch (error) {
      readFailed(toTasksError(error))
    } finally {
      refreshing = false
      if (queued) {
        queued = false
        void refresh()
      }
    }
  }

  function mutationFailed(failure: TasksError, again: () => Promise<unknown>): void {
    switch (failure.code) {
      case 'DECLINED':
        return
      case 'VERSION_CONFLICT':
        toast('Задача изменилась в Hermes, данные обновлены')
        return
      case 'WORKSPACE_EPOCH_MISMATCH':
        toast('Данные Hermes Tasks могли быть восстановлены из резервной копии')
        return
      case 'RATE_LIMITED':
        pausedUntil = Date.now() + RATE_PAUSE_MS
        toast('Слишком много запросов, повторите позже')
        return
    }
    if (failure.retryable) {
      unavailable.value = true
      retryAction = again
    } else {
      toast(failure.message)
    }
  }

  async function mutate<T>(attempt: Attempt, options: MutationOptions<T> = {}): Promise<T | null> {
    const { pendingId, onDone } = options
    if (pendingId !== undefined) pending.value = [...pending.value, pendingId]
    try {
      const result = await api.send<T>(attempt)
      retryAction = null
      unavailable.value = false
      onDone?.(result)
      return result
    } catch (error) {
      mutationFailed(toTasksError(error), () => mutate(attempt, options))
      return null
    } finally {
      if (pendingId !== undefined) pending.value = pending.value.filter((id) => id !== pendingId)
      void refresh()
    }
  }

  function retry(): void {
    const again = retryAction
    retryAction = null
    unavailable.value = false
    void (again ? again() : refresh())
  }

  function hide(occurrenceId: string): void {
    const keep = (item: ListItem) => item.occurrenceId !== occurrenceId
    list.value = { ...list.value, overdue: list.value.overdue.filter(keep), items: list.value.items.filter(keep) }
  }

  async function close(occurrenceId: string, version: number, action: 'complete' | 'skip'): Promise<boolean> {
    const result = await mutate<CloseResult>(api.occurrenceAction(action, occurrenceId, version), {
      pendingId: occurrenceId,
      onDone: ({ closedOccurrence }) => {
        hide(occurrenceId)
        // Reopen needs the closed occurrence's new version, so the undo starts only after the answer.
        toast(action === 'complete' ? 'Выполнено' : 'Пропущено', {
          label: 'Вернуть',
          run: () => void mutate(api.occurrenceAction('reopen', closedOccurrence.id, closedOccurrence.version)),
        })
      },
    })
    return result !== null
  }

  async function reschedule(occurrenceId: string, version: number, schedule: Schedule): Promise<boolean> {
    return (await mutate(api.reschedule(occurrenceId, version, schedule), { pendingId: occurrenceId })) !== null
  }

  async function create(text: string): Promise<boolean> {
    if (today.value === null) return false
    const parsed = parseQuickAdd(text, { today: today.value, view: view.value, tag: tag.value })
    if (parsed === null) return false
    const schedule: Schedule = parsed.date === null ? null : { kind: 'date', date: parsed.date }
    return (await mutate(api.create({ title: parsed.title, tags: parsed.tags, schedule }))) !== null
  }

  function openTask(taskId: string): void {
    openTaskId.value = taskId
    detail.value = null
    loadDetail().catch((error: unknown) => readFailed(toTasksError(error)))
  }

  function closeTask(): void {
    openTaskId.value = null
    detail.value = null
  }

  async function restorePrefs(): Promise<void> {
    try {
      const saved = await widget.state.get<Prefs>()
      prefsRevision = saved.revision
      if (saved.data) {
        view.value = saved.data.view
        tag.value = saved.data.tag
      }
    } catch {
      // Defaults stay.
    }
  }

  async function savePrefs(): Promise<void> {
    const prefs: Prefs = { view: view.value, tag: tag.value }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        prefsRevision = (await widget.state.set(prefs, prefsRevision)).revision
        return
      } catch (error) {
        // Another tab saved first: take its revision and write once more. Other failures keep the old prefs.
        if (!(error instanceof WidgetError) || error.code !== 'CONFLICT') return
        try {
          prefsRevision = (await widget.state.get<Prefs>()).revision
        } catch {
          return
        }
      }
    }
  }

  async function start(): Promise<void> {
    await restorePrefs()
    if (disposed) return
    stops.push(
      watch([view, tag], () => {
        loaded.value = false
        list.value = EMPTY
        void savePrefs()
        void refresh()
      }),
      watch(
        () => widget.context.visible,
        (visible) => {
          clearInterval(timer)
          if (!visible) return
          void refresh()
          timer = setInterval(() => void refresh(), REFRESH_MS)
        },
        { immediate: true },
      ),
    )
  }

  void start()
  onBeforeUnmount(() => {
    disposed = true
    for (const stop of stops) stop()
    clearInterval(timer)
  })

  return reactive({
    api,
    view,
    tag,
    today,
    tags,
    list,
    loaded,
    unavailable,
    pending,
    toasts,
    openTaskId,
    detail,
    projects,
    refresh,
    retry,
    close,
    reschedule,
    create,
    openTask,
    closeTask,
    loadDetail,
    toast,
    dismiss,
  })
}

export type Tasks = ReturnType<typeof useTasks>
```

- [ ] **Step 2: Write the root component**

`examples/widgets/hermes-tasks/src/index.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'
import DetailPanel from './DetailPanel.vue'
import Rail from './Rail.vue'
import TaskList from './TaskList.vue'
import ViewTabs from './ViewTabs.vue'
import { layoutFor } from './layout.ts'
import { useTasks } from './use-tasks.ts'

const widget = useWidget()
const tasks = useTasks(widget)
const layout = computed(() => layoutFor(widget.context.size))
</script>

<template>
  <div class="tasks" :class="`tasks--${layout}`" :data-size="widget.context.sizeClass">
    <Rail v-if="layout === 'rail'" :tasks="tasks" />
    <DetailPanel v-if="layout === 'rail' && tasks.openTaskId" :key="tasks.openTaskId" :tasks="tasks" layout="rail" />
    <main v-else class="tasks__main">
      <ViewTabs v-if="layout === 'stacked'" :tasks="tasks" />
      <p v-if="tasks.unavailable" class="tasks__banner" role="alert">
        Hermes Tasks недоступен
        <button type="button" class="tasks__retry" @click="tasks.retry()">Повторить</button>
      </p>
      <TaskList :tasks="tasks" />
    </main>
    <template v-if="layout === 'stacked' && tasks.openTaskId">
      <div class="tasks__scrim" @click="tasks.closeTask()" />
      <DetailPanel :key="tasks.openTaskId" :tasks="tasks" layout="stacked" />
    </template>
    <TransitionGroup tag="div" name="toast" class="tasks__toasts" aria-live="polite">
      <div v-for="item in tasks.toasts" :key="item.id" class="toast">
        <span>{{ item.text }}</span>
        <button
          v-if="item.action"
          type="button"
          class="toast__action"
          @click="
            item.action.run();
            tasks.dismiss(item.id)
          "
        >
          {{ item.action.label }}
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style>
/* Shared by every component of this widget; the frame isolates it from the board. */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  background: transparent;
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: default;
}

:focus-visible {
  outline: 2px solid var(--ld-focus-ring);
  outline-offset: 2px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.65rem;
  border: 0;
  border-radius: var(--ld-radius-pill);
  background: var(--ld-surface-2);
  color: var(--ld-text-secondary);
  font-size: 0.75rem;
  white-space: nowrap;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), color var(--ld-duration-fast) var(--ld-ease-standard);
}

.chip:hover {
  background: var(--ld-surface-3);
}

.chip--on {
  background: var(--ld-accent-subtle);
  color: var(--ld-accent-text);
}

.chip__count {
  color: var(--ld-text-muted);
}

.chip__x {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  line-height: 1;
}

.segment-group {
  display: flex;
  gap: 0.15rem;
  padding: 0.2rem;
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-2);
}

.segment {
  flex: 1;
  padding: 0.3rem 0.2rem;
  border: 0;
  border-radius: calc(var(--ld-radius-control) - 0.15rem);
  background: none;
  color: var(--ld-text-secondary);
  font-size: 0.78rem;
  white-space: nowrap;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), color var(--ld-duration-fast) var(--ld-ease-standard);
}

.segment--on {
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
}
</style>

<style scoped>
.tasks {
  position: relative;
  display: flex;
  gap: var(--ld-gap);
  height: 100vh;
  padding: var(--ld-widget-padding);
  overflow: hidden;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
  font-size: calc(0.875rem * var(--ld-font-scale));
  line-height: var(--ld-leading);
  letter-spacing: var(--ld-tracking);
}

.tasks__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--ld-gap);
  min-width: 0;
}

.tasks__banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  padding: 0.4rem 0.6rem;
  border-radius: var(--ld-radius-control);
  background: var(--ld-danger-subtle);
  color: var(--ld-danger-text);
  font-size: 0.8rem;
}

.tasks__retry {
  border: 0;
  background: none;
  color: inherit;
  font-weight: var(--ld-weight-medium);
  text-decoration: underline;
}

.tasks__scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--ld-scrim);
}

.tasks__toasts {
  position: absolute;
  bottom: calc(var(--ld-widget-padding) + var(--ld-control-height) + 0.5rem);
  left: 50%;
  z-index: 3;
  display: grid;
  gap: 0.4rem;
  translate: -50% 0;
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0.85rem;
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-3);
  box-shadow: var(--ld-shadow-raised, none);
  font-size: 0.8rem;
  white-space: nowrap;
}

.toast__action {
  border: 0;
  background: none;
  color: var(--ld-accent-text);
  font-weight: var(--ld-weight-medium);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--ld-duration-base) var(--ld-ease-standard), translate var(--ld-duration-base) var(--ld-ease-emphasized);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  translate: 0 0.5rem;
}
</style>
```

- [ ] **Step 3: Write the navigation components**

`examples/widgets/hermes-tasks/src/Rail.vue`:

```vue
<script setup lang="ts">
import type { Tasks } from './use-tasks.ts'
import { VIEWS } from './views.ts'

defineProps<{ tasks: Tasks }>()
</script>

<template>
  <nav class="rail" aria-label="Списки">
    <button
      v-for="item in VIEWS"
      :key="item.id"
      type="button"
      class="rail__item"
      :class="{ 'rail__item--on': tasks.view === item.id }"
      :aria-pressed="tasks.view === item.id"
      @click="tasks.view = item.id"
    >
      {{ item.label }}
    </button>
    <p v-if="tasks.tags.length > 0" class="rail__section">Теги</p>
    <button
      v-for="item in tasks.tags"
      :key="item.name"
      type="button"
      class="rail__item"
      :class="{ 'rail__item--on': tasks.tag === item.name }"
      :aria-pressed="tasks.tag === item.name"
      @click="tasks.tag = tasks.tag === item.name ? null : item.name"
    >
      <span class="rail__name"># {{ item.name }}</span>
      <span class="rail__count">{{ item.openCount }}</span>
    </button>
  </nav>
</template>

<style scoped>
.rail {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 0.1rem;
  width: 9.5rem;
  padding-right: var(--ld-gap);
  overflow-y: auto;
  border-right: var(--ld-border-width) solid var(--ld-border-subtle);
  scrollbar-width: thin;
}

.rail__item {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  border: 0;
  border-radius: var(--ld-radius-control);
  background: none;
  color: var(--ld-text-secondary);
  text-align: left;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), color var(--ld-duration-fast) var(--ld-ease-standard);
}

.rail__item:hover {
  background: var(--ld-state-hover);
}

.rail__item--on {
  background: var(--ld-state-selected);
  color: var(--ld-text-primary);
}

.rail__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail__count {
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}

.rail__section {
  margin: 0.9rem 0.6rem 0.25rem;
  color: var(--ld-text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
```

`examples/widgets/hermes-tasks/src/ViewTabs.vue`:

```vue
<script setup lang="ts">
import type { Tasks } from './use-tasks.ts'
import { VIEWS } from './views.ts'

defineProps<{ tasks: Tasks }>()
</script>

<template>
  <nav class="tabs" aria-label="Списки">
    <div class="segment-group">
      <button
        v-for="item in VIEWS"
        :key="item.id"
        type="button"
        class="segment"
        :class="{ 'segment--on': tasks.view === item.id }"
        :aria-pressed="tasks.view === item.id"
        @click="tasks.view = item.id"
      >
        {{ item.label }}
      </button>
    </div>
    <div v-if="tasks.tags.length > 0" class="tabs__tags">
      <button type="button" class="chip" :class="{ 'chip--on': tasks.tag === null }" :aria-pressed="tasks.tag === null" @click="tasks.tag = null">
        все
      </button>
      <button
        v-for="item in tasks.tags"
        :key="item.name"
        type="button"
        class="chip"
        :class="{ 'chip--on': tasks.tag === item.name }"
        :aria-pressed="tasks.tag === item.name"
        @click="tasks.tag = tasks.tag === item.name ? null : item.name"
      >
        {{ item.name }} <span class="chip__count">{{ item.openCount }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
  gap: 0.5rem;
}

.tabs__tags {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  scrollbar-width: none;
}
</style>
```

- [ ] **Step 4: Write the list components**

`examples/widgets/hermes-tasks/src/TaskList.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import TaskRow from './TaskRow.vue'
import type { Tasks } from './use-tasks.ts'
import { VIEWS } from './views.ts'

const props = defineProps<{ tasks: Tasks }>()
const text = ref('')
const title = computed(() => {
  const label = VIEWS.find((item) => item.id === props.tasks.view)?.label ?? ''
  return props.tasks.tag === null ? label : `${label} · #${props.tasks.tag}`
})
const count = computed(() => props.tasks.list.overdue.length + props.tasks.list.items.length)

async function add(): Promise<void> {
  if (await props.tasks.create(text.value)) text.value = ''
}
</script>

<template>
  <section class="list">
    <header class="list__head">
      <h2 class="list__title">{{ title }}</h2>
      <span v-if="tasks.loaded" class="list__count">{{ count }}</span>
    </header>
    <div class="list__scroll">
      <p v-if="!tasks.loaded" class="list__empty">Загрузка…</p>
      <template v-else>
        <template v-if="tasks.list.overdue.length > 0">
          <h3 class="list__group list__group--late">Просрочено · {{ tasks.list.overdue.length }}</h3>
          <TaskRow v-for="item in tasks.list.overdue" :key="item.occurrenceId" :item="item" :tasks="tasks" />
          <h3 v-if="tasks.list.items.length > 0" class="list__group">Сегодня · {{ tasks.list.items.length }}</h3>
        </template>
        <TaskRow v-for="item in tasks.list.items" :key="item.occurrenceId" :item="item" :tasks="tasks" />
        <p v-if="count === 0" class="list__empty">Задач нет</p>
        <p v-if="tasks.list.truncated" class="list__note">Показаны первые 1000</p>
      </template>
    </div>
    <form class="list__add" @submit.prevent="add">
      <input v-model="text" class="list__input" placeholder="Новая задача… #тег завтра" aria-label="Новая задача" enterkeyhint="done" />
    </form>
  </section>
</template>

<style scoped>
.list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.list__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.list__title {
  margin: 0;
  overflow: hidden;
  font-family: var(--ld-font-display);
  font-size: 1rem;
  font-weight: var(--ld-weight-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list__count {
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}

.list__scroll {
  flex: 1;
  min-height: 0;
  margin: 0 -0.25rem;
  padding: 0 0.25rem;
  overflow-y: auto;
  scrollbar-width: thin;
}

.list__group {
  margin: 0.75rem 0 0.25rem;
  color: var(--ld-text-muted);
  font-size: 0.68rem;
  font-weight: var(--ld-weight-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.list__group--late {
  color: var(--ld-danger-text);
}

.list__empty,
.list__note {
  margin: 0;
  padding: 1.5rem 0;
  color: var(--ld-text-muted);
  text-align: center;
}

.list__note {
  padding: 0.5rem 0;
  font-size: 0.75rem;
}

.list__add {
  margin-top: var(--ld-gap);
}

.list__input {
  width: 100%;
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-2);
}

.list__input::placeholder {
  color: var(--ld-text-muted);
}
</style>
```

`examples/widgets/hermes-tasks/src/TaskRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { ListItem, Schedule } from './api.ts'
import { addDays, formatDue } from './dates.ts'
import type { Tasks } from './use-tasks.ts'

const props = defineProps<{ item: ListItem; tasks: Tasks }>()
const busy = computed(() => props.tasks.pending.includes(props.item.occurrenceId))
const due = computed(() => (props.item.due && props.tasks.today ? formatDue(props.item.due, props.tasks.today) : null))

function tomorrow(): void {
  const today = props.tasks.today
  if (today === null) return
  const date = addDays(today, 1)
  const time = props.item.due?.slice(11, 16)
  const schedule: Schedule = time ? { kind: 'datetime', datetime: `${date}T${time}` } : { kind: 'date', date }
  void props.tasks.reschedule(props.item.occurrenceId, props.item.occurrenceVersion, schedule)
}
</script>

<template>
  <div class="row" :class="{ 'row--busy': busy }">
    <button
      type="button"
      class="row__check"
      :class="`row__check--${item.priority ?? 'none'}`"
      :disabled="busy"
      :aria-label="`Выполнить: ${item.title}`"
      @click="tasks.close(item.occurrenceId, item.occurrenceVersion, 'complete')"
    />
    <button type="button" class="row__body" :aria-label="`Открыть: ${item.title}`" @click="tasks.openTask(item.taskId)">
      <span class="row__title">{{ item.title }}</span>
      <span class="row__meta">
        <span v-if="due" :class="{ 'row__due--late': item.overdue }">{{ due }}</span>
        <span v-if="item.recurring" title="Повторяется">↻</span>
        <span v-if="item.projectName" class="row__project">{{ item.projectName }}</span>
        <span v-for="name in item.tags ?? []" :key="name" class="row__tag">#{{ name }}</span>
      </span>
    </button>
    <div class="row__actions">
      <button
        v-if="item.recurring"
        type="button"
        class="row__action"
        :disabled="busy"
        title="Пропустить"
        :aria-label="`Пропустить: ${item.title}`"
        @click="tasks.close(item.occurrenceId, item.occurrenceVersion, 'skip')"
      >
        ⤼
      </button>
      <button type="button" class="row__action" :disabled="busy" title="На завтра" :aria-label="`Перенести на завтра: ${item.title}`" @click="tomorrow">
        →
      </button>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.4rem 0.35rem;
  border-radius: var(--ld-radius-control);
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), opacity var(--ld-duration-base) var(--ld-ease-standard);
}

.row:hover {
  background: var(--ld-state-hover);
}

.row--busy {
  opacity: 0.45;
}

.row__check {
  flex: none;
  width: 1.05rem;
  height: 1.05rem;
  margin-top: 0.15rem;
  padding: 0;
  border: 0.1rem solid var(--ld-text-muted);
  border-radius: 50%;
  background: transparent;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard);
}

.row__check:hover:not(:disabled) {
  background: var(--ld-state-active);
}

.row__check--high {
  border-color: var(--ld-danger);
}

.row__check--medium {
  border-color: var(--ld-warning);
}

.row__check--low {
  border-color: var(--ld-info);
}

.row__body {
  display: grid;
  flex: 1;
  gap: 0.1rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
}

.row__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  color: var(--ld-text-muted);
  font-size: 0.72rem;
}

.row__due--late {
  color: var(--ld-danger-text);
}

.row__tag {
  color: var(--ld-accent-text);
}

.row__actions {
  display: flex;
  gap: 0.15rem;
  opacity: 0;
  transition: opacity var(--ld-duration-fast) var(--ld-ease-standard);
}

.row:hover .row__actions,
.row:focus-within .row__actions {
  opacity: 1;
}

.row__action {
  width: 1.6rem;
  height: 1.6rem;
  border: 0;
  border-radius: var(--ld-radius-control);
  background: none;
  color: var(--ld-text-secondary);
}

.row__action:hover:not(:disabled) {
  background: var(--ld-state-hover);
  color: var(--ld-text-primary);
}
</style>
```

- [ ] **Step 5: Write the detail panel**

`examples/widgets/hermes-tasks/src/DetailPanel.vue`:

```vue
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Priority, Schedule } from './api.ts'
import { createAutosave, shown, type AutosaveState } from './autosave.ts'
import { addDays, formatDue, nextMonday } from './dates.ts'
import type { Layout } from './layout.ts'
import type { Tasks } from './use-tasks.ts'

const props = defineProps<{ tasks: Tasks; layout: Layout }>()

const PRIORITIES: readonly { id: Priority; label: string }[] = [
  { id: 'none', label: 'Нет' },
  { id: 'low', label: 'Низкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'high', label: 'Высокий' },
]
const EVERY = { day: 'ежедневно', week: 'еженедельно', month: 'ежемесячно', year: 'ежегодно' } as const
const UNITS = { day: 'дн.', week: 'нед.', month: 'мес.', year: 'г.' } as const

// The panel is keyed by task id, so the id never changes for this instance.
const taskId = props.tasks.openTaskId!
const state = reactive<AutosaveState>({ version: 0, dirty: {}, saving: false, failed: null })
const autosave = createAutosave(state, {
  prepare: (patch, version) => props.tasks.api.update(taskId, version, patch),
  send: (attempt) => props.tasks.api.send(attempt),
  onSaved: () => void props.tasks.refresh(),
  onFailed: async (failure) => {
    // A lost answer keeps its attempt for «Повторить»; anything else re-reads the task first.
    if (failure.retryable) return
    if (failure.code === 'VERSION_CONFLICT') props.tasks.toast('Задача изменилась в Hermes. «Повторить» сохранит ваши правки')
    else if (failure.code !== 'DECLINED') props.tasks.toast(failure.message)
    try {
      await props.tasks.loadDetail()
    } catch {
      return
    }
    if (props.tasks.detail) state.version = props.tasks.detail.task.version
  },
})

const task = computed(() => props.tasks.detail?.task ?? null)
const occurrence = computed(() => props.tasks.detail?.currentOccurrence ?? null)
const fields = computed(() => (task.value ? shown(task.value, state.dirty) : null))
const dueDate = computed(() => occurrence.value?.due?.slice(0, 10) ?? '')
const time = ref('')
const newTag = ref('')

const quick = computed(() => {
  const today = props.tasks.today
  if (today === null) return []
  return [
    { label: 'Сегодня', date: today },
    { label: 'Завтра', date: addDays(today, 1) },
    { label: 'След. неделя', date: nextMonday(today) },
  ]
})

const rule = computed(() => {
  const value = task.value?.recurrence
  if (!value) return null
  return value.interval === 1 ? EVERY[value.frequency] : `раз в ${value.interval} ${UNITS[value.frequency]}`
})

watch(
  task,
  (value) => {
    // Idle: follow versions bumped by Hermes, so the next PATCH is not a conflict with an old read.
    if (value && !state.saving && state.failed === null) state.version = value.version
  },
  { immediate: true },
)

watch(
  () => occurrence.value?.due,
  (due) => {
    time.value = due?.slice(11, 16) ?? ''
  },
  { immediate: true },
)

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
}

function moveTo(date: string | null): void {
  const current = occurrence.value
  if (!current) return
  const schedule: Schedule = date === null ? null : time.value ? { kind: 'datetime', datetime: `${date}T${time.value}` } : { kind: 'date', date }
  void props.tasks.reschedule(current.id, current.version, schedule)
}

function changeTime(value: string): void {
  time.value = value
  if (dueDate.value) moveTo(dueDate.value)
}

function addTag(): void {
  const name = newTag.value.trim().replace(/^#/, '').toLowerCase()
  newTag.value = ''
  if (!name || !fields.value || fields.value.tags.includes(name)) return
  void autosave.edit('tags', [...fields.value.tags, name].sort())
}

function removeTag(name: string): void {
  if (fields.value) void autosave.edit('tags', fields.value.tags.filter((item) => item !== name))
}

async function complete(): Promise<void> {
  const current = occurrence.value
  if (current && (await props.tasks.close(current.id, current.version, 'complete'))) props.tasks.closeTask()
}
</script>

<template>
  <aside class="panel" :class="`panel--${layout}`" aria-label="Задача" @keydown.esc="tasks.closeTask()">
    <header class="panel__head">
      <button type="button" class="panel__link" @click="tasks.closeTask()">← Назад</button>
      <span class="panel__status" role="status">
        <template v-if="state.saving">Сохранение…</template>
        <template v-else-if="state.failed">
          Не сохранено
          <button type="button" class="panel__link panel__link--accent" @click="autosave.retry()">Повторить</button>
        </template>
      </span>
      <button v-if="occurrence?.status === 'open'" type="button" class="panel__link panel__link--done" @click="complete">✓ Выполнить</button>
    </header>

    <p v-if="!fields" class="panel__muted">Загрузка…</p>
    <div v-else class="panel__body">
      <label class="panel__label" for="task-title">Название</label>
      <input
        id="task-title"
        class="panel__field panel__field--title"
        :value="fields.title"
        @input="autosave.draft('title', valueOf($event))"
        @change="autosave.edit('title', valueOf($event))"
      />

      <template v-if="occurrence">
        <span class="panel__label">
          Дата
          <span v-if="occurrence.due && tasks.today" class="panel__muted">· {{ formatDue(occurrence.due, tasks.today) }}</span>
        </span>
        <div class="panel__chips">
          <button
            v-for="item in quick"
            :key="item.label"
            type="button"
            class="chip"
            :class="{ 'chip--on': dueDate === item.date }"
            @click="moveTo(item.date)"
          >
            {{ item.label }}
          </button>
          <button v-if="!task?.recurrence" type="button" class="chip" :class="{ 'chip--on': dueDate === '' }" @click="moveTo(null)">Без даты</button>
        </div>
        <div class="panel__row">
          <input type="date" class="panel__field" aria-label="Дата" :value="dueDate" @change="moveTo(valueOf($event) || null)" />
          <input type="time" class="panel__field" aria-label="Время" :value="time" :disabled="!dueDate" @change="changeTime(valueOf($event))" />
        </div>
      </template>

      <span class="panel__label">Теги</span>
      <div class="panel__chips">
        <span v-for="name in fields.tags" :key="name" class="chip chip--on">
          #{{ name }}
          <button type="button" class="chip__x" :aria-label="`Убрать тег ${name}`" @click="removeTag(name)">×</button>
        </span>
        <form class="panel__tag" @submit.prevent="addTag">
          <input v-model="newTag" class="panel__field" list="task-tags" placeholder="+ тег" aria-label="Новый тег" @change="addTag" />
        </form>
        <datalist id="task-tags">
          <option v-for="item in tasks.tags" :key="item.name" :value="item.name" />
        </datalist>
      </div>

      <span class="panel__label">Приоритет</span>
      <div class="segment-group" role="group" aria-label="Приоритет">
        <button
          v-for="item in PRIORITIES"
          :key="item.id"
          type="button"
          class="segment"
          :class="[`segment--${item.id}`, { 'segment--on': fields.priority === item.id }]"
          :aria-pressed="fields.priority === item.id"
          @click="autosave.edit('priority', item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <label class="panel__label" for="task-project">Проект</label>
      <select id="task-project" class="panel__field" :value="fields.projectId ?? ''" @change="autosave.edit('projectId', valueOf($event) || null)">
        <option value="">Входящие</option>
        <option v-for="item in tasks.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>

      <label class="panel__label" for="task-note">Заметка</label>
      <textarea
        id="task-note"
        class="panel__field panel__field--note"
        :value="fields.description ?? ''"
        @input="autosave.draft('description', valueOf($event) || null)"
        @change="autosave.edit('description', valueOf($event) || null)"
      />

      <p v-if="rule" class="panel__muted">Повтор: {{ rule }} · меняется через Hermes</p>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.panel--rail {
  flex: 1;
}

.panel--stacked {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 2;
  width: 82%;
  padding: var(--ld-widget-padding);
  border-left: var(--ld-border-width) solid var(--ld-border-subtle);
  background: var(--ld-surface-1-solid);
  box-shadow: var(--ld-shadow-raised, none);
  animation: panel-in var(--ld-duration-base) var(--ld-ease-emphasized);
}

@keyframes panel-in {
  from {
    translate: 100% 0;
  }
}

.panel__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.panel__link {
  padding: 0.2rem 0.35rem;
  border: 0;
  border-radius: var(--ld-radius-control);
  background: none;
  color: var(--ld-text-secondary);
}

.panel__link:hover {
  background: var(--ld-state-hover);
}

.panel__link--accent {
  color: var(--ld-accent-text);
}

.panel__link--done {
  margin-left: auto;
  color: var(--ld-success-text);
}

.panel__status {
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}

.panel__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

.panel__label {
  margin-top: 0.55rem;
  color: var(--ld-text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.panel__muted {
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.75rem;
  letter-spacing: normal;
  text-transform: none;
}

.panel__field {
  width: 100%;
  min-height: var(--ld-control-height);
  padding: 0.3rem 0.6rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-2);
}

.panel__field--title {
  font-size: 1rem;
  font-weight: var(--ld-weight-medium);
}

.panel__field--note {
  min-height: 4.5rem;
  resize: vertical;
}

.panel__row {
  display: flex;
  gap: 0.4rem;
}

.panel__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.panel__tag {
  flex: 1;
  min-width: 5rem;
}

.segment--on.segment--high {
  box-shadow: inset 0 0 0 0.1rem var(--ld-danger);
}

.segment--on.segment--medium {
  box-shadow: inset 0 0 0 0.1rem var(--ld-warning);
}

.segment--on.segment--low {
  box-shadow: inset 0 0 0 0.1rem var(--ld-info);
}
</style>
```

- [ ] **Step 6: Build the widget**

Run: `pnpm -C packages/widget-sdk build && pnpm -C examples/widgets/hermes-tasks build`
Expected: exit 0; `examples/widgets/hermes-tasks/dist/dev.lifedashboard.hermes-tasks-1.0.0/` contains
`widget.json` (with `"format": 2` and the `network` list), `index.js`, `style.css` and `source/`.

Run: `grep -c "v-html" examples/widgets/hermes-tasks/src/*.vue`
Expected: every count is 0.

Run: `pnpm -C examples/widgets/hermes-tasks test`
Expected: PASS (dist/ is excluded by Vitest's default exclude).

- [ ] **Step 7: Commit**

```bash
git add examples/widgets/hermes-tasks/src/use-tasks.ts examples/widgets/hermes-tasks/src/index.vue examples/widgets/hermes-tasks/src/Rail.vue examples/widgets/hermes-tasks/src/ViewTabs.vue examples/widgets/hermes-tasks/src/TaskList.vue examples/widgets/hermes-tasks/src/TaskRow.vue examples/widgets/hermes-tasks/src/DetailPanel.vue
git commit -m "feat(widgets): build the Hermes Tasks widget UI"
```

`dist/` is ignored by `.gitignore`; `git status` must show only the seven new source files.

---

### Task 10: Full verification and browser acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-10-11-hermes-tasks-widget.md` (append «Acceptance results»)

Preconditions: the Hermes Tasks container answers `curl -s http://127.0.0.1:8787/health` with `{"ok":true}`.
If it does not, stop and report: acceptance needs the live service (do not start or change the container).

- [ ] **Step 1: Run the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0. Record the per-package test counts.

- [ ] **Step 2: Start LifeDashboard and install the widget**

Run `pnpm dev` in the background. Open the UI in Orca's built-in browser (`orca tab create --url <UI URL>`; the
UI URL and the pairing code are printed by `pnpm dev`). Pair, open «Виджеты» → «Выбрать папку», pick
`examples/widgets/hermes-tasks/dist/dev.lifedashboard.hermes-tasks-1.0.0`.

Check: the review shows «Доступ к сети: http://127.0.0.1:8787» with a mode select (default «Спрашивать каждый
раз»). Choose «Разрешить», install, add the widget with «Добавить виджет…».

- [ ] **Step 3: Browser checks**

Use `orca snapshot`, `orca click`, `orca fill`, `orca screenshot` and `orca console`. For each check record
pass or fail with a one-line observation:

1. The widget lists the live tasks; «Сегодня» shows overdue tasks under «Просрочено» and none twice.
2. «Скоро», «Входящие», «Все» each load; a tag chip or rail tag filters the list; «все» clears it.
3. Complete a task: the row dims, disappears, the toast «Выполнено · Вернуть» appears; «Вернуть» brings it
   back. The change is visible in the Hermes Tasks web UI at `http://127.0.0.1:8787/`.
4. Skip a recurring task; it moves to its next occurrence.
5. «→» on a row moves the task to tomorrow; in the panel «Сегодня», «Завтра», «След. неделя», the date and the
   time inputs reschedule it.
6. In the panel, change the title, add and remove a tag (the datalist offers existing tags), change the
   priority, the project and the note; each shows «Сохранение…» briefly and the list reflects it.
7. Quick add «Проверка виджета #тест завтра» creates a task due tomorrow with tag `тест` (visible in «Скоро»).
   Delete it afterwards through the Hermes Tasks web UI.
8. Change a task title in the Hermes Tasks web UI; the widget shows it within about 10 s.
9. Switch the network grant to «Спрашивать каждый раз» in «Виджеты»: completing a task opens the host dialog
   showing `POST http://127.0.0.1:8787/api/v1/occurrences/…`; «Отклонить» leaves the row in place with no toast.
   Switch back to «Разрешить».
10. Resize the widget to 6 columns: tabs and chips replace the rail; the panel slides over 82 % of the width.
    Resize to the 3×4 minimum: nothing overflows the frame.
11. Switch the board theme to Glass, Obsidian and Paper: text, chips and the panel stay readable.
12. `orca console --limit 50` shows no errors from the widget frame.

Do not stop the Hermes Tasks container for the banner check; the banner is covered by the client tests
(`UNAVAILABLE`) and by Task 4 (`UPSTREAM_ERROR`). Report it as not checked live.

- [ ] **Step 4: Record and commit**

Append to this plan:

```markdown
## Acceptance results (YYYY-MM-DD)

- `pnpm typecheck && pnpm test`: <result, counts>
- Browser checks 1–12: <pass/fail with one line each>
- Not checked live: the «Hermes Tasks недоступен» banner (container left running).
```

```bash
git add docs/superpowers/plans/2026-10-11-hermes-tasks-widget.md
git commit -m "docs: record Hermes Tasks widget acceptance results"
```

## Acceptance results (2026-10-11)

- `pnpm typecheck && pnpm test`: exit 0 — contracts 254 tests / 5 files, widget-sdk 42 / 4,
  examples/widgets/hermes-tasks 28 / 3, ui 329 / 18, api 248 / 13 (901 tests, 43 files).
- Browser checks 1–12 (live install in Orca's browser; review showed
  «Доступ к сети: http://127.0.0.1:8787» with «Спрашивать каждый раз» default, installed with «Разрешить»):
  1. PASS — «Сегодня» count 3: «ПРОСРОЧЕНО · 1» («Акцептанс просрочка», «вчера») + «СЕГОДНЯ · 2»; no task twice
     (live data had nothing overdue; verified with a temporary overdue fixture, since removed).
  2. PASS — «Скоро» (0), «Входящие» (8), «Все» (12) load; chip «книги 4» filters to «Входящие · #книги» (4 rows);
     «все» clears the filter.
  3. PASS — the row disappeared and the toast «Выполнено · Вернуть» appeared; the completion showed in the Hermes
     web UI («Выполненные»); the «Вернуть» click raced the 5 s toast expiry, so the restore was done in the Hermes
     web UI (un-complete) — the row returned.
  4. PASS — skipping the recurring fixture moved it out of «Сегодня» to its next occurrence (due tomorrow,
     visible in «Скоро»).
  5. PARTIAL — «→» moved a row to «завтра»; panel «Сегодня»/«Завтра»/«След. неделя» reschedule (12.10);
     the date input accepted a typed date visually (13.10.2026) but synthetic input fires no `change`, so the
     date/time input commits could not be exercised through automation (no `http.send` observed).
  6. PARTIAL — priority («Высокий») and project («Время кино») committed and are reflected in the list; the tag
     datalist offers existing tags (близкие, кино, книги); title/tag/note edits could not be committed — synthetic
     text insertion never fires `change` in the sandboxed frame (drafts update, no `http.send`); «Сохранение…»
     exists in the panel (DetailPanel.vue status) but the send completes faster than a snapshot can capture it.
  7. FAIL — quick add cannot submit: the sandbox host renders the frame with `sandbox="allow-scripts"` and the
     platform contract (docs/widget-sdk/README.md) forbids `allow-forms`, so the `<form @submit.prevent="add">`
     in examples/widgets/hermes-tasks/src/ui/components/TaskList.vue never fires. Typing works (v-model updates),
     Enter issues no `http.send` and creates nothing. The form should submit via a keydown handler, not form
     submission. Nothing to delete afterwards (no task was created).
  8. PASS — an external title change («Акцептанс извне») appeared in the widget within ~2 s (change made through
     the Hermes HTTP API because the web UI task dialog stopped opening under automation).
  9. PASS — with the grant at «Спрашивать каждый раз», completing a task opened the host dialog showing
     `POST http://127.0.0.1:8787/api/v1/occurrences/…/complete`; «Отклонить» left the row in place, no toast,
     server state stayed open; the grant was switched back to «Разрешить».
  10. PASS — at 6 columns tabs and chips replaced the rail and the panel slid over ~82 % of the width (the list
      remains as a narrow left strip); at the 3×4 minimum nothing overflows the frame (the chips row scrolls
      inside it).
  11. PASS — Стекло, Обсидиан and Бумага all keep text, chips and the panel readable (screenshot-verified).
  12. PASS — `orca console --limit 50` shows only Nuxt/Vite boot messages; no errors from the host or the widget.
- Not checked live: the «Hermes Tasks недоступен» banner (container left running).
