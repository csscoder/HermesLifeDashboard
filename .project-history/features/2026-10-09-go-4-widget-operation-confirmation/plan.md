# Widget Operation Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permitted gateway operation can require the user's explicit confirmation of the exact call: the API issues and checks single-use, input-bound confirmation ids, and the host asks the user in a dialog outside the widget frame.

**Architecture:** `packages/contracts` gives every gateway op a `confirm` policy (`never` / `optional` / `always`) and every package grant a mode (`allow` / `ask`). The API stores the mode in `widget_grants` (migration 3), reads it on every gateway call, and for a call that needs confirmation either answers `428 CONFIRMATION_REQUIRED` with a fresh id (stored on the in-memory widget session) or spends the id the call carries. The UI broker turns a `428` into a question to a FIFO queue (`confirmations.ts`) that `ConfirmDialog.vue` shows in the main document; an approval repeats the call once with the id, anything else declines it. The packages dialog lets the user pick the mode at install and switch it later.

**Tech Stack:** Node 24 (`node:sqlite`, `node:crypto`), Fastify 5.12.5, Nuxt 4.5.2 / Vue 3.5.43, TypeScript 6.0.3 strict, Vitest 5.0.3, pnpm 10.30.2 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-09-widget-op-confirmation-design.md` (read it before starting). It builds on `docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md` and the base design `docs/base-2026-10-04-lifegamehermes-design.md` §13.3.

## Global Constraints

- No new dependencies. No jsdom, happy-dom or `@vue/test-utils`: Vue components stay thin, logic lives in `.ts` modules with Vitest tests, components are checked in the browser (Task 11).
- TypeScript strict everywhere (`noUncheckedIndexedAccess` is on). `apps/api`, `packages/contracts`, `packages/widget-sdk` use `erasableSyntaxOnly` (no constructor parameter properties, no `enum`) and import relative modules with the `.ts` extension. UI files import relative modules without an extension and import every Vue API and component explicitly (`imports.autoImport: false`, `components: false`).
- Gateway policy (verbatim): `'state.get': { permission: 'state', confirm: 'never' }`, `'state.set': { permission: 'state', confirm: 'never' }`, `'notifications.send': { permission: 'notifications', confirm: 'optional' }`. `confirmablePermissions()` returns `['notifications']`.
- Timing (verbatim): `CONFIRMATION_TTL_MS = 120_000`, `CONFIRMATION_DIALOG_MS = 110_000`, `BRIDGE_LIMITS.confirmTimeoutMs: 250_000` (bridge timeout for ops with `confirm !== 'never'`; other ops keep `requestTimeoutMs` 10 s).
- Wire format: header `x-widget-confirmation`; `428 CONFIRMATION_REQUIRED` with `error.confirmationId`; `409 CONFIRMATION_INVALID` (no new id); a second confirmable call while one is pending → `429 RATE_LIMITED` «A confirmation is already pending»; `DELETE /api/v1/widget-gateway/confirmations/:id` with `x-widget-session` (unknown id → no-op `200`); `PUT /api/v1/widget-packages/:id/grants/:permission` body `{ mode: 'allow' | 'ask' }`. Confirmation id is `randomBytes(32).toString('base64url')`; input binding is `sha256(canonicalJson(parsed input))`.
- Migration 3 (verbatim): `ALTER TABLE widget_grants ADD COLUMN mode TEXT NOT NULL DEFAULT 'allow';`. Install inserts a new confirmable grant as `ask`, others as `allow`; `INSERT OR IGNORE` keeps an existing grant's mode. Built-in widgets count as `allow`; `always` ops are confirmed for every widget.
- `WidgetSessionResponse.grants` stays `WidgetPermission[]`. `InstalledPackage.grants` becomes `Grant[]` (`{ permission, mode }`). `WidgetErrorCode` gains `DECLINED`.
- Spec copy (exact): «Спрашивать каждый раз», «Разрешить» (mode switch options; the mode is called «Спрашивать» in prose), «Разрешить один раз», «Отклонить», «Виджет «{title}» хочет показать уведомление».
- Plan-chosen copy (the spec gives none; the user may veto in review): install-screen hint for an already-held confirmable grant «{mode} — меняется в списке виджетов»; mode switch `aria-label` «{permission text}: режим»; after a failed mode `PUT` on install «Виджет установлен, но режим «Разрешить» не сохранён»; after a failed switch in the list «Не удалось сохранить режим»; `hello` example status after a decline «Уведомление отклонено»; widget-side `DECLINED` messages «The user declined the call», «The confirmation expired», «The widget was closed».
- Widget-controlled text (package title, notification title and body) renders only through `{{ }}`, never `v-html`.
- Code, comments, commit messages in English; the base design stays Russian. Commit format `type(scope): subject`, no attribution trailers. Work on branch `alex/go-4-povisit-bezopasnost`; never commit to `main`.
- Run commands from the repository root. Browser checks use Orca's built-in browser through `orca-cli` only.

## Review Focus

1. **The user switches the mode in the list while the widget is running** — the next call must follow the new mode without a reload or a new widget session (the session snapshots grants at creation, the mode must not be). Pinned in Task 4 («reads the grant mode on every call of a live session»).
2. **The widget is removed or restarted while its dialog is open or queued** — the entry must leave the queue, the broker must not send a decline (spec: unmount audits only `CONFIRMATION_REQUIRED`) and nothing may hang. Pinned in Task 6 (`cancelConfirmations`) and Task 7 («declines nothing when the widget closes while the user is asked»).
3. **A double click or a late answer** — a second answer to the same entry, or an answer after its deadline, does nothing. Pinned in Task 6 («the first answer wins»). A double click that lands on the *next* queued entry is guarded by a 500 ms arm delay on «Разрешить один раз» (plan-chosen, Task 8, checked in the browser in Task 11).
4. **The dialog previews something other than what runs** — the dialog must show exactly the parsed input the id is bound to. Pinned in Task 7 (`confirm` receives the same object the gateway call sent).
5. **A malformed `428` (no `confirmationId`)** — must fail closed: no dialog, no repeat. Pinned in Task 5 (maps to `invalid`) and Task 7 (`confirm` is never called for it).

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `packages/contracts/src/widget-gateway.ts` | 1 | `ConfirmPolicy`, `confirm` per op, `confirmablePermissions()`, `DECLINED`, timing constants, `confirmTimeoutMs` |
| `packages/contracts/src/api.ts`, `apps/api/src/errors.ts` | 1 | New error codes and statuses; `confirmationId` in the error envelope |
| `apps/api/src/migrations.ts` | 2 | Migration 3 |
| `packages/contracts/src/widget-package.ts` | 3 | `GrantMode`, `Grant`, `InstalledPackage.grants: Grant[]` |
| `apps/api/src/widget-packages.ts` | 3 | Install modes, `grantsOf(): Grant[]`, `PUT …/grants/:permission` |
| `apps/api/src/widget-gateway.ts` | 3, 4 | `needsConfirmation`, mode read per call, issue/spend ids, `DELETE …/confirmations/:id` |
| `apps/ui/app/api.ts` | 5 | `428` and `CONFIRMATION_INVALID` mapping, `gateway(…, confirmationId?)`, `declineConfirmation`, `setGrantMode` |
| `apps/ui/app/confirmations.ts` (new) | 6 | FIFO queue with per-entry deadline and cancel by `widgetId` |
| `apps/ui/app/widgets/broker.ts` | 7 | Ask, repeat once, decline; confirm-op bridge timeout |
| `apps/ui/app/widgets/SandboxWidget.vue`, `WidgetHost.vue` | 7 | Pass `confirm`; cancel on teardown and unmount |
| `apps/ui/app/ConfirmDialog.vue` (new), `apps/ui/app/app.vue` | 8 | Host dialog for the queue head |
| `examples/widgets/hello/src/index.vue` | 8 | Handle `DECLINED` instead of crashing the frame (deviation, see Task 8) |
| `apps/ui/app/widgets/PackagesDialog.vue` | 3, 9 | `Grant[]` shape; mode switch at install and in the list |
| `apps/ui/app/widgets/catalog.ts` | 9 | Follows `Grant[]` (types only in Task 3); pure grant-mode helpers for the install screen |
| `docs/base-2026-10-04-lifegamehermes-design.md`, sandbox spec | 10 | §13.3 row; «Operation confirmation» pointer |

---

### Task 1: Confirmation policy, timing and error codes in contracts

**Files:**
- Modify: `packages/contracts/src/widget-gateway.ts:5-9` (ops), `:118-127` (`WidgetErrorCode`), `:162-168` (`BRIDGE_LIMITS`)
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/api/src/errors.ts`
- Test: `packages/contracts/test/widget-gateway.test.ts`, `apps/api/test/errors.test.ts`

**Interfaces:**
- Produces (`@lifedashboard/contracts/widget-gateway`):
  ```ts
  export type ConfirmPolicy = 'never' | 'optional' | 'always'
  export const GATEWAY_OPS: { 'state.get': { permission: 'state'; confirm: 'never' }; 'state.set': {…'never'}; 'notifications.send': { permission: 'notifications'; confirm: 'optional' } }
  export function confirmablePermissions(): WidgetPermission[]
  export const CONFIRMATION_TTL_MS = 120_000
  export const CONFIRMATION_DIALOG_MS = 110_000
  BRIDGE_LIMITS.confirmTimeoutMs === 250_000
  WidgetErrorCode includes 'DECLINED'
  ```
- Produces (`@lifedashboard/contracts/api`): `ErrorCode` includes `'CONFIRMATION_REQUIRED' | 'CONFIRMATION_INVALID'`; `ErrorEnvelope['error'].confirmationId?: string`.
- Produces (`apps/api/src/errors.ts`): `new ApiError(code: ErrorCode, message: string, confirmationId?: string)` with `readonly confirmationId: string | undefined`; statuses `CONFIRMATION_REQUIRED: 428`, `CONFIRMATION_INVALID: 409`; the envelope carries `confirmationId` only when set.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/test/widget-gateway.test.ts`, extend the import and add a describe block at the end:

```ts
import {
  BRIDGE_LIMITS,
  CONFIRMATION_DIALOG_MS,
  CONFIRMATION_TTL_MS,
  confirmablePermissions,
  GATEWAY_OPS,
  isGatewayOp,
  parseGatewayInput,
  parseSandboxMessage,
  sizeClass,
} from '../src/widget-gateway.ts'
```

```ts
describe('confirmation policy', () => {
  it('asks only for notifications.send, so only notifications offers a mode', () => {
    expect(Object.fromEntries(Object.entries(GATEWAY_OPS).map(([op, spec]) => [op, spec.confirm]))).toEqual({
      'state.get': 'never',
      'state.set': 'never',
      'notifications.send': 'optional',
    })
    expect(confirmablePermissions()).toEqual(['notifications'])
  })

  it('lets the dialog deadline, not the transport, end an unanswered call', () => {
    expect(CONFIRMATION_DIALOG_MS).toBeLessThan(CONFIRMATION_TTL_MS)
    // Spec «Contracts»: two dialogs and five API calls of 5 s (the UI's API_TIMEOUT_MS) fit inside the bridge timeout.
    expect(2 * CONFIRMATION_DIALOG_MS + 5 * 5_000).toBeLessThan(BRIDGE_LIMITS.confirmTimeoutMs)
  })
})
```

In `apps/api/test/errors.test.ts`, add two rows to the status table (after `['PACKAGE_IN_USE', 409],`):

```ts
    ['CONFIRMATION_REQUIRED', 428],
    ['CONFIRMATION_INVALID', 409],
```

and a new test after that table:

```ts
  it('adds the confirmation id to the envelope only when the error has one', async () => {
    const app = Fastify({ genReqId: newRequestId })
    registerErrorHandling(app)
    app.get('/x', async () => {
      throw new ApiError('CONFIRMATION_REQUIRED', 'm', 'c1')
    })
    const response = await app.inject({ url: '/x' })
    expect(response.statusCode).toBe(428)
    expect(response.json().error).toMatchObject({ code: 'CONFIRMATION_REQUIRED', message: 'm', retryable: false, confirmationId: 'c1' })
    await app.close()
  })
```

(The existing `REVISION_CONFLICT` test uses `toEqual` on the whole envelope, so it already pins that no `confirmationId` key appears otherwise.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-gateway.test.ts; pnpm -C apps/api exec vitest run test/errors.test.ts`
Expected: FAIL — `confirmablePermissions is not a function` / `CONFIRMATION_DIALOG_MS` undefined; the new error codes answer `500` (`STATUS[code]` is undefined) and no `confirmationId`.

- [ ] **Step 3: Implement**

`packages/contracts/src/widget-gateway.ts` — replace the `GATEWAY_OPS` block (lines 5-9) with:

```ts
export type ConfirmPolicy = 'never' | 'optional' | 'always'

// `confirm` (spec 2026-10-09): `optional` asks when the grant mode is `ask`, `always` asks every widget.
export const GATEWAY_OPS = {
  'state.get': { permission: 'state', confirm: 'never' },
  'state.set': { permission: 'state', confirm: 'never' },
  'notifications.send': { permission: 'notifications', confirm: 'optional' },
} as const satisfies Record<string, { permission: WidgetPermission; confirm: ConfirmPolicy }>
```

After `export type GatewayOp = keyof typeof GATEWAY_OPS` add:

```ts
/** Permissions with at least one `optional` operation: only these offer a mode. */
export function confirmablePermissions(): WidgetPermission[] {
  const permissions = Object.values(GATEWAY_OPS).flatMap((spec): WidgetPermission[] => (spec.confirm === 'optional' ? [spec.permission] : []))
  return [...new Set(permissions)]
}

export const CONFIRMATION_TTL_MS = 120_000
// The host closes an unanswered dialog this long after the 428 arrived, before the id expires.
export const CONFIRMATION_DIALOG_MS = 110_000
```

Add `| 'DECLINED'` as the last member of `WidgetErrorCode`. Replace `BRIDGE_LIMITS` with:

```ts
export const BRIDGE_LIMITS = {
  maxMessageBytes: 131_072,
  maxInFlight: 16,
  requestTimeoutMs: 10_000,
  // For ops with confirm !== 'never'. Worst case, one session renewal after an approval: two dialogs
  // (2 × CONFIRMATION_DIALOG_MS) and five API calls of 5 s (call, repeat, session, call, repeat) is 245 s,
  // so a dialog deadline, not this timeout, ends an unanswered call.
  confirmTimeoutMs: 250_000,
  helloTimeoutMs: 10_000,
  maxMalformed: 20,
} as const
```

`packages/contracts/src/api.ts` — add after `| 'PACKAGE_IN_USE'`:

```ts
  // Widget operation confirmation (spec 2026-10-09).
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_INVALID'
```

and change `ErrorEnvelope` to:

```ts
export interface ErrorEnvelope {
  // confirmationId: only on CONFIRMATION_REQUIRED.
  error: { code: ErrorCode; message: string; requestId: string; retryable: boolean; confirmationId?: string }
}
```

`apps/api/src/errors.ts` — add to `STATUS` after `PACKAGE_IN_USE: 409,`:

```ts
  CONFIRMATION_REQUIRED: 428,
  CONFIRMATION_INVALID: 409,
```

replace `ApiError` and `envelope` with:

```ts
export class ApiError extends Error {
  readonly code: ErrorCode
  // Only CONFIRMATION_REQUIRED carries one.
  readonly confirmationId: string | undefined

  constructor(code: ErrorCode, message: string, confirmationId?: string) {
    super(message)
    this.code = code
    this.confirmationId = confirmationId
  }
}
```

```ts
function envelope(code: ErrorCode, message: string, requestId: string, confirmationId?: string): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = { code, message, requestId, retryable: code === 'RATE_LIMITED' }
  if (confirmationId !== undefined) error.confirmationId = confirmationId
  return { error }
}
```

and in `registerErrorHandling` pass the id for an `ApiError`:

```ts
      return reply.status(STATUS[error.code]).send(envelope(error.code, error.message, request.id, error.confirmationId))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C packages/contracts exec vitest run && pnpm -C apps/api exec vitest run test/errors.test.ts && pnpm typecheck`
Expected: PASS, no type errors (no consumer switches exhaustively over `WidgetErrorCode` or `ErrorCode` outside `STATUS`).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/widget-gateway.ts packages/contracts/src/api.ts packages/contracts/test/widget-gateway.test.ts apps/api/src/errors.ts apps/api/test/errors.test.ts
git commit -m "feat(contracts): confirmation policy per gateway operation"
```

---

### Task 2: Migration 3 — grant mode

**Files:**
- Modify: `apps/api/src/migrations.ts` (append to `MIGRATIONS`)
- Test: `apps/api/test/db.test.ts`

**Interfaces:**
- Produces: column `widget_grants.mode TEXT NOT NULL DEFAULT 'allow'`; `MIGRATIONS.length === 3`.

- [ ] **Step 1: Write the failing test and fix the version-2 assertions**

In `apps/api/test/db.test.ts`, the test «migrates a version 1 database with widgets and sessions to version 2» asserts `toBe(2)` with the default migrations; it becomes «…to the latest version»:

```ts
  it('migrates a version 1 database with widgets and sessions to the latest version', async () => {
```

and both `expect(userVersion(db)).toBe(2)` and `expect(userVersion(again)).toBe(2)` in it become `toBe(MIGRATIONS.length)`. Leave `bak-v1` / `bak-v2` assertions as they are (a 1 → 3 upgrade writes only `bak-v1`).

Add after it:

```ts
  it('gives grants of a version 2 database the mode allow', async () => {
    const v2 = await openDatabase(file, MIGRATIONS.slice(0, 2))
    v2.exec(`
      INSERT INTO widget_packages (id, title, author, created_at) VALUES ('dev.a.b', 'A', 'a', 'x');
      INSERT INTO widget_grants (package_id, permission, granted_at) VALUES ('dev.a.b', 'notifications', 'x');
    `)
    v2.close()

    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(3)
    expect(db.prepare('SELECT permission, mode FROM widget_grants').all()).toEqual([{ permission: 'notifications', mode: 'allow' }])
    db.close()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/db.test.ts`
Expected: FAIL — the new test gets version `2` and `no such column: mode`.

- [ ] **Step 3: Implement**

Append a third element to `MIGRATIONS` in `apps/api/src/migrations.ts` (after the closing backtick of migration 2, before `]`):

```ts
  `
-- Spec 2026-10-09: grants approved before confirmation keep working without a dialog.
ALTER TABLE widget_grants ADD COLUMN mode TEXT NOT NULL DEFAULT 'allow';
`,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run`
Expected: PASS (all API tests; nothing reads `mode` yet).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migrations.ts apps/api/test/db.test.ts
git commit -m "feat(api): grant mode column (migration 3)"
```

---

### Task 3: Grant modes in the packages API

**Files:**
- Modify: `packages/contracts/src/widget-package.ts:52-59` (`InstalledPackage`)
- Modify: `apps/api/src/widget-packages.ts`
- Modify: `apps/api/src/widget-gateway.ts:143` (`resolveWidget` maps `Grant[]` to permissions)
- Modify: `apps/ui/app/widgets/PackagesDialog.vue:135` (one-line shape fix)
- Test: `apps/api/test/widget-packages.test.ts`

**Interfaces:**
- Consumes: `confirmablePermissions()` (Task 1); column `mode` (Task 2).
- Produces (`@lifedashboard/contracts/widget-package`):
  ```ts
  export type GrantMode = 'allow' | 'ask'
  export interface Grant { permission: WidgetPermission; mode: GrantMode }
  // InstalledPackage.grants: Grant[]
  ```
- Produces (`apps/api/src/widget-packages.ts`): `grantsOf(db: DatabaseSync, packageId: string): Grant[]` (ordered by permission). Callers that need permissions map `.map((grant) => grant.permission)`.
- Produces (HTTP): `PUT /api/v1/widget-packages/:id/grants/:permission`, body `{ mode }` → `200` with the package's `Grant[]`. Check order (pinned by tests): permission not held by the package (including an unknown package or permission) → `404 NOT_FOUND`; held but not confirmable → `400 VALIDATION_ERROR`; mode other than `allow`/`ask` → `400 VALIDATION_ERROR`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/widget-packages.test.ts`, update the existing expectations to the `Grant[]` shape:

- in «stores the version, files, hash and grants»: `grants: ['state'],` → `grants: [{ permission: 'state', mode: 'allow' }],`
- in «lists versions newest first and adds new permissions to the package grants»: `expect(pkg.grants).toEqual(['notifications', 'state'])` →

```ts
    // A new confirmable permission asks, also when the package is an update.
    expect(pkg.grants).toEqual([{ permission: 'notifications', mode: 'ask' }, { permission: 'state', mode: 'allow' }])
```

Add helpers after `count()`:

```ts
function setMode(permission: string, mode: unknown, id = 'dev.test.hello') {
  return call(t.app, { method: 'PUT', url: `${PACKAGES}/${id}/grants/${permission}`, cookie, payload: { mode } })
}

const withNotifications = () => widgetPackage((p) => { p.manifest.permissions = ['state', 'notifications'] })
```

Add a describe block at the end of the file:

```ts
describe('grant modes', () => {
  it('installs a confirmable grant as ask and another as allow', async () => {
    await installPackage(t, cookie, withNotifications())
    expect((await list())[0].grants).toEqual([{ permission: 'notifications', mode: 'ask' }, { permission: 'state', mode: 'allow' }])
  })

  it('switches the mode of a confirmable grant and returns the grants', async () => {
    await installPackage(t, cookie, withNotifications())
    const allowed = await setMode('notifications', 'allow')
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json().data).toEqual([{ permission: 'notifications', mode: 'allow' }, { permission: 'state', mode: 'allow' }])
    expect((await setMode('notifications', 'ask')).json().data[0]).toEqual({ permission: 'notifications', mode: 'ask' })
    expect((await list())[0].grants[0]).toEqual({ permission: 'notifications', mode: 'ask' })
  })

  it('answers 404 for an unknown package or a permission the package does not hold', async () => {
    await installPackage(t, cookie)
    for (const response of [
      await setMode('notifications', 'allow', 'dev.test.none'),
      await setMode('notifications', 'allow'),
      await setMode('http', 'allow'),
    ]) {
      expect([response.statusCode, errorCode(response)]).toEqual([404, 'NOT_FOUND'])
    }
  })

  it('answers 400 for a held permission without a mode and for another mode, and changes nothing', async () => {
    await installPackage(t, cookie, withNotifications())
    for (const response of [
      await setMode('state', 'ask'),
      await setMode('notifications', 'never'),
      await setMode('notifications', undefined),
    ]) {
      expect([response.statusCode, errorCode(response)]).toEqual([400, 'VALIDATION_ERROR'])
    }
    expect((await list())[0].grants).toEqual([{ permission: 'notifications', mode: 'ask' }, { permission: 'state', mode: 'allow' }])
  })

  it('keeps the mode of an existing grant when the package is updated', async () => {
    await installPackage(t, cookie, widgetPackage((p) => { p.manifest.permissions = ['notifications'] }))
    expect((await setMode('notifications', 'allow')).statusCode).toBe(200)
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['notifications', 'state']
    }))
    expect((await list())[0].grants).toEqual([{ permission: 'notifications', mode: 'allow' }, { permission: 'state', mode: 'allow' }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/widget-packages.test.ts`
Expected: FAIL — grants are still plain strings; `PUT` answers `404 Route not found` for every case (so the 404 test may pass by accident; the others fail).

- [ ] **Step 3: Implement**

`packages/contracts/src/widget-package.ts` — after `export type WidgetPermission = …` add:

```ts
// Spec 2026-10-09: `ask` confirms each call of an `optional` operation in a host dialog.
export type GrantMode = 'allow' | 'ask'

export interface Grant {
  permission: WidgetPermission
  mode: GrantMode
}
```

and in `InstalledPackage` change `grants: WidgetPermission[]` to `grants: Grant[]`.

`apps/api/src/widget-packages.ts`:

Imports — add `confirmablePermissions` and `Grant`/`GrantMode`:

```ts
import { confirmablePermissions } from '@lifedashboard/contracts/widget-gateway'
import {
  canonicalJson,
  compareVersions,
  PACKAGE_LIMITS,
  parseWidgetPackage,
  type Grant,
  type InstalledPackage,
  type PackageInspection,
  type WidgetPackage,
  type WidgetPackageManifest,
  type WidgetPermission,
} from '@lifedashboard/contracts/widget-package'
```

Register the route inside `registerWidgetPackages` (after the `GET` route):

```ts
  app.put<{ Params: { id: string; permission: string }; Body: { mode?: unknown } | undefined }>(
    '/api/v1/widget-packages/:id/grants/:permission',
    async (request) => ok(request, setGrantMode(db, request.params.id, request.params.permission, request.body?.mode)),
  )
```

Replace `grantsOf`:

```ts
export function grantsOf(db: DatabaseSync, packageId: string): Grant[] {
  return db.prepare('SELECT permission, mode FROM widget_grants WHERE package_id = ? ORDER BY permission').all(packageId) as unknown as Grant[]
}
```

In `inspect`, the granted set maps permissions:

```ts
  const granted = new Set(grantsOf(db, manifest.id).map((grant) => grant.permission))
```

In `install`, replace the two grant lines with:

```ts
      // A new confirmable grant asks; OR IGNORE keeps the mode of a grant the package already holds.
      const confirmable = new Set<WidgetPermission>(confirmablePermissions())
      const grant = db.prepare('INSERT OR IGNORE INTO widget_grants (package_id, permission, granted_at, mode) VALUES (?, ?, ?, ?)')
      for (const permission of manifest.permissions) grant.run(manifest.id, permission, at, confirmable.has(permission) ? 'ask' : 'allow')
```

Add after `deletePackage`:

```ts
function setGrantMode(db: DatabaseSync, packageId: string, permission: string, mode: unknown): Grant[] {
  if (!grantsOf(db, packageId).some((grant) => grant.permission === permission)) {
    throw new ApiError('NOT_FOUND', 'The package holds no such permission')
  }
  if (!(confirmablePermissions() as string[]).includes(permission)) throw new ApiError('VALIDATION_ERROR', 'This permission has no mode')
  if (mode !== 'allow' && mode !== 'ask') throw new ApiError('VALIDATION_ERROR', 'mode must be allow or ask')
  db.prepare('UPDATE widget_grants SET mode = ? WHERE package_id = ? AND permission = ?').run(mode, packageId, permission)
  return grantsOf(db, packageId)
}
```

`listPackages` keeps `grants: grantsOf(db, pkg.id)` (now `Grant[]`).

`apps/api/src/widget-gateway.ts:143` — the session keeps permissions only:

```ts
    return { packageId: row.source_type, grants: grantsOf(db, row.source_type).map((grant) => grant.permission) }
```

`apps/ui/app/widgets/PackagesDialog.vue:135` — the list text follows the new shape (Task 9 replaces this cell):

```vue
          <span>{{ permissionList(pkg.grants.map((grant) => grant.permission)) || 'Без разрешений' }}</span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run && pnpm -C apps/ui exec vitest run test/catalog.test.ts && pnpm typecheck`
Expected: PASS (the gateway tests still pass: the gateway does not read `mode` yet; `catalog.test.ts`'s `grants: []` is a valid `Grant[]`), no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/widget-package.ts apps/api/src/widget-packages.ts apps/api/src/widget-gateway.ts apps/api/test/widget-packages.test.ts apps/ui/app/widgets/PackagesDialog.vue
git commit -m "feat(api): grant modes on install and PUT grants/:permission"
```

---

### Task 4: Confirmation in the gateway pipeline

**Files:**
- Modify: `apps/api/src/widget-gateway.ts`
- Test: `apps/api/test/widget-gateway.test.ts`

**Interfaces:**
- Consumes: `GATEWAY_OPS[op].confirm`, `CONFIRMATION_TTL_MS`, `ConfirmPolicy` (Task 1); `ApiError(code, message, confirmationId)` (Task 1); `GrantMode`, `canonicalJson` (contracts); `widget_grants.mode` (Tasks 2–3).
- Produces (`apps/api/src/widget-gateway.ts`): `export function needsConfirmation(policy: ConfirmPolicy, mode: GrantMode | null): boolean` — `mode` is `null` for a built-in widget (counts as `allow`).
- Produces (HTTP): the pipeline of spec «Gateway pipeline» steps 1–3; `DELETE /api/v1/widget-gateway/confirmations/:id` with `x-widget-session` → `200` (`DECLINED` audited only when the id was this session's pending one).

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/widget-gateway.test.ts`, import the pure function:

```ts
import { needsConfirmation } from '../src/widget-gateway.ts'
```

The existing `describe('notifications')` installs 1.1.0 with a *new* `notifications` grant, which now comes in as `ask`. Its tests cover the call itself, so switch the grant to `allow` at the end of its `beforeEach`:

```ts
    // These tests cover the call itself; describe('confirmation') covers the «ask» mode a new grant gets.
    t.db.prepare("UPDATE widget_grants SET mode = 'allow'").run()
```

Add at the end of the file:

```ts
describe('needsConfirmation', () => {
  it.each([
    ['never', 'ask', false],
    ['never', 'allow', false],
    ['never', null, false],
    ['optional', 'ask', true],
    ['optional', 'allow', false],
    // A built-in widget (mode null) counts as allow.
    ['optional', null, false],
    ['always', 'ask', true],
    ['always', 'allow', true],
    ['always', null, true],
  ] as const)('%s with mode %s → %s', (policy, mode, expected) => {
    expect(needsConfirmation(policy, mode)).toBe(expected)
  })
})

describe('confirmation', () => {
  const note = { title: 'Hi', body: 'there' }

  beforeEach(async () => {
    // A new confirmable grant installs as «ask».
    await installPackage(t, cookie, widgetPackage((p) => {
      p.manifest.version = '1.1.0'
      p.manifest.permissions = ['state', 'notifications']
    }))
  })

  function send(token: string, confirmationId?: string, payload: unknown = note) {
    return call(t.app, {
      method: 'POST',
      url: '/api/v1/widget-gateway/notifications.send',
      cookie,
      payload,
      headers: confirmationId === undefined ? { 'x-widget-session': token } : { 'x-widget-session': token, 'x-widget-confirmation': confirmationId },
    })
  }

  async function issue(token: string): Promise<string> {
    const response = await send(token)
    expect([response.statusCode, errorCode(response)]).toEqual([428, 'CONFIRMATION_REQUIRED'])
    const id: string = response.json().error.confirmationId
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    return id
  }

  function decline(token: string, id: string) {
    return call(t.app, { method: 'DELETE', url: `/api/v1/widget-gateway/confirmations/${id}`, cookie, payload: {}, headers: { 'x-widget-session': token } })
  }

  function setMode(mode: string) {
    return call(t.app, { method: 'PUT', url: '/api/v1/widget-packages/dev.test.hello/grants/notifications', cookie, payload: { mode } })
  }

  function outcomes(): string[] {
    return (auditRows() as { outcome: string }[]).map((row) => row.outcome)
  }

  it('runs an asked call once with its confirmation and audits issue, use and reuse', async () => {
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    expect((await send(token, id)).json().data).toEqual({ ok: true })
    const reused = await send(token, id)
    expect([reused.statusCode, errorCode(reused)]).toEqual([409, 'CONFIRMATION_INVALID'])
    expect(reused.json().error.confirmationId).toBeUndefined()
    expect(auditRows()).toEqual(
      ['CONFIRMATION_REQUIRED', 'ok', 'CONFIRMATION_INVALID'].map((outcome) => ({
        widget_id: PKG_WIDGET,
        package_id: 'dev.test.hello',
        op: 'notifications.send',
        outcome,
      })),
    )
  })

  it('reads the grant mode on every call of a live session', async () => {
    const token = await openSession(PKG_WIDGET)
    expect((await setMode('allow')).statusCode).toBe(200)
    expect((await send(token)).json().data).toEqual({ ok: true })
    expect((await setMode('ask')).statusCode).toBe(200)
    await issue(token)
  })

  it('binds a confirmation to its input and its widget session', async () => {
    const token = await openSession(PKG_WIDGET)
    const other = await openSession(PKG_WIDGET)
    const id = await issue(token)
    for (const response of [await send(token, id, { title: 'Hi', body: 'other' }), await send(other, id)]) {
      expect([response.statusCode, errorCode(response)]).toEqual([409, 'CONFIRMATION_INVALID'])
    }
    // The same input with its keys in another order is the same call.
    expect((await send(token, id, { body: 'there', title: 'Hi' })).statusCode).toBe(200)
  })

  it('expires a confirmation after CONFIRMATION_TTL_MS and frees the slot', async () => {
    const token = await openSession(PKG_WIDGET)
    const first = await issue(token)
    t.clock.now += 120_000 - 1
    expect((await send(token, first)).statusCode).toBe(200)
    const second = await issue(token)
    t.clock.now += 120_000
    expect(errorCode(await send(token, second))).toBe('CONFIRMATION_INVALID')
    await issue(token)
  })

  it('keeps one pending confirmation per session; a decline audits it and frees the slot', async () => {
    const token = await openSession(PKG_WIDGET)
    const id = await issue(token)
    const second = await send(token)
    expect([second.statusCode, errorCode(second)]).toEqual([429, 'RATE_LIMITED'])
    expect(second.json().error.message).toBe('A confirmation is already pending')
    // Another session of the same widget has its own slot.
    await issue(await openSession(PKG_WIDGET))
    expect((await decline(token, 'nope')).statusCode).toBe(200)
    expect((await decline(token, id)).statusCode).toBe(200)
    expect(errorCode(await send(token, id))).toBe('CONFIRMATION_INVALID')
    await issue(token)
    expect(outcomes()).toEqual([
      'CONFIRMATION_REQUIRED',
      'RATE_LIMITED',
      'CONFIRMATION_REQUIRED',
      'DECLINED',
      'CONFIRMATION_INVALID',
      'CONFIRMATION_REQUIRED',
    ])
  })

  it('spends the rate limit once per confirmed call', async () => {
    const token = await openSession(PKG_WIDGET)
    for (let index = 0; index < 10; index++) {
      expect((await send(token, await issue(token))).statusCode).toBe(200)
    }
    expect(errorCode(await send(token))).toBe('RATE_LIMITED')
  })
})
```

(`op` binding is enforced in code but not observable here: `notifications.send` is the only op that needs confirmation today.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/widget-gateway.test.ts`
Expected: FAIL — `needsConfirmation` is not exported; `notifications.send` in «ask» mode answers `200` instead of `428`.

- [ ] **Step 3: Implement**

`apps/api/src/widget-gateway.ts`:

Imports:

```ts
import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'
import {
  CONFIRMATION_TTL_MS,
  GATEWAY_OPS,
  isGatewayOp,
  parseGatewayInput,
  type ConfirmPolicy,
  type GatewayInputs,
  type GatewayOp,
  type WidgetSessionResponse,
} from '@lifedashboard/contracts/widget-gateway'
import { canonicalJson, type GrantMode, type WidgetPermission } from '@lifedashboard/contracts/widget-package'
```

Session shape (replace `interface WidgetSession`):

```ts
interface PendingConfirmation {
  id: string
  op: GatewayOp
  inputHash: string
  expiresAt: number
}

interface WidgetSession extends GatewayContext {
  // Hash of the dashboard session that created it; a call must carry the same cookie.
  dashboard: string
  lastUsedAt: number
  // At most one; it ends with the session (DELETE, idle expiry, eviction, API restart).
  confirmation: PendingConfirmation | null
}
```

Exported pure policy (after `type Handlers …`):

```ts
/** Spec 2026-10-09 «Gateway pipeline» step 1. `mode` is null for a built-in widget, which counts as `allow`. */
export function needsConfirmation(policy: ConfirmPolicy, mode: GrantMode | null): boolean {
  return policy === 'always' || (policy === 'optional' && mode === 'ask')
}
```

Inside `registerWidgetGateway`, after `const handlers = …`:

```ts
  const readMode = db.prepare('SELECT mode FROM widget_grants WHERE package_id = ? AND permission = ?')

  // Read on every call, so a switch in the packages list takes effect at once. A missing row asks (fail closed).
  function grantMode(session: WidgetSession, permission: WidgetPermission): GrantMode | null {
    if (session.packageId === null) return null
    const row = readMode.get(session.packageId, permission) as { mode: string } | undefined
    return row?.mode === 'allow' ? 'allow' : 'ask'
  }

  // Steps 2–3: without the header, issue a single-use id (428); with it, spend the matching id or answer 409.
  function confirmCall(session: WidgetSession, op: GatewayOp, input: unknown, header: unknown): void {
    const t = now().getTime()
    const inputHash = createHash('sha256').update(canonicalJson(input)).digest('hex')
    const pending = session.confirmation !== null && session.confirmation.expiresAt > t ? session.confirmation : null
    if (typeof header === 'string') {
      if (!pending || pending.id !== header || pending.op !== op || pending.inputHash !== inputHash) {
        throw new ApiError('CONFIRMATION_INVALID', 'The confirmation is not valid for this call')
      }
      // Single use; the rate limit was spent when the id was issued.
      session.confirmation = null
      return
    }
    if (pending) throw new ApiError('RATE_LIMITED', 'A confirmation is already pending')
    rateLimit(session.widgetId, op)
    const id = randomBytes(32).toString('base64url')
    session.confirmation = { id, op, inputHash, expiresAt: t + CONFIRMATION_TTL_MS }
    throw new ApiError('CONFIRMATION_REQUIRED', 'The user must confirm this call', id)
  }
```

In `POST /api/v1/widget-sessions`, the new session starts without a confirmation:

```ts
    sessions.set(token, {
      dashboard: request.sessionHash,
      widgetId,
      packageId,
      grants: new Set(grants),
      lastUsedAt: now().getTime(),
      confirmation: null,
    })
```

In the gateway route, replace the lines from `const { permission } = GATEWAY_OPS[op]` through `rateLimit(session.widgetId, op)` with:

```ts
      const { permission, confirm } = GATEWAY_OPS[op]
      if (!session.grants.has(permission)) throw new ApiError('PERMISSION_DENIED', `The widget has no "${permission}" permission`)
      const input = parseGatewayInput(op, request.body)
      if (!input.ok) throw new ApiError('INVALID_INPUT', input.error)
      if (needsConfirmation(confirm, grantMode(session, permission))) {
        confirmCall(session, op, input.value, request.headers['x-widget-confirmation'])
      } else {
        rateLimit(session.widgetId, op)
      }
```

(The `catch`/`finally` already audits `CONFIRMATION_REQUIRED`, `CONFIRMATION_INVALID` and `RATE_LIMITED` as the error code.)

Add the decline route after the gateway route:

```ts
  // The host declines (user, dialog deadline). An unknown or foreign id is a no-op.
  app.delete<{ Params: { id: string } }>('/api/v1/widget-gateway/confirmations/:id', async (request) => {
    const session = useSession(request)
    const pending = session.confirmation
    if (pending !== null && pending.id === request.params.id) {
      session.confirmation = null
      audit(session, pending.op, 'DECLINED')
    }
    return ok(request, null)
  })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run && pnpm -C apps/api typecheck`
Expected: PASS (all API tests, including the unchanged session, state and audit tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/widget-gateway.ts apps/api/test/widget-gateway.test.ts
git commit -m "feat(api): single-use confirmation ids in the widget gateway"
```

---

### Task 5: UI API client for confirmations and grant modes

**Files:**
- Modify: `apps/ui/app/api.ts`
- Test: `apps/ui/test/api.test.ts`

**Interfaces:**
- Consumes: `Grant`, `GrantMode`, `WidgetPermission` (Task 3).
- Produces (`apps/ui/app/api.ts`):
  ```ts
  ApiFailure gains { kind: 'confirmation-required'; confirmationId: string }
  // 428 with a string error.confirmationId → confirmation-required; 428 without one → invalid (fail closed)
  // 409 with code CONFIRMATION_INVALID → { kind: 'invalid', code, message }; any other 409 → conflict
  api.gateway(op: string, token: string, input: unknown, confirmationId?: string): Promise<ApiResult<unknown>>
  api.declineConfirmation(token: string, id: string): Promise<ApiResult<null>>   // DELETE, body {}
  api.setGrantMode(id: string, permission: WidgetPermission, mode: GrantMode): Promise<ApiResult<Grant[]>>
  ```

- [ ] **Step 1: Write the failing tests**

Add to `describe('apiRequest')` in `apps/ui/test/api.test.ts`:

```ts
  it('maps 428 to confirmation-required with its id, and a 428 without an id to invalid', async () => {
    vi.stubGlobal('fetch', respond(428, { error: { code: 'CONFIRMATION_REQUIRED', message: 'm', requestId: 'x', retryable: false, confirmationId: 'c1' } }))
    expect(await api.gateway('notifications.send', 'tok', {})).toEqual({ ok: false, kind: 'confirmation-required', confirmationId: 'c1' })
    vi.stubGlobal('fetch', respond(428, { error: { code: 'CONFIRMATION_REQUIRED', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('notifications.send', 'tok', {})).toEqual({ ok: false, kind: 'invalid', code: 'CONFIRMATION_REQUIRED', message: 'm' })
  })

  it('maps 409 CONFIRMATION_INVALID to invalid, not to a state conflict', async () => {
    vi.stubGlobal('fetch', respond(409, { error: { code: 'CONFIRMATION_INVALID', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('notifications.send', 'tok', {}, 'c1')).toEqual({ ok: false, kind: 'invalid', code: 'CONFIRMATION_INVALID', message: 'm' })
  })

  it('sends the confirmation header only with a confirmation id', async () => {
    const fetchMock = respond(200, { data: { ok: true }, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.gateway('notifications.send', 'tok', { title: 'Hi', body: '' }, 'c1')
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-widget-session': 'tok',
      'x-widget-confirmation': 'c1',
    })
  })

  it('declines a confirmation with the widget session and an empty JSON body', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.declineConfirmation('tok', 'c1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-gateway/confirmations/c1')
    expect(init?.method).toBe('DELETE')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-widget-session': 'tok' })
    expect(init?.body).toBe('{}')
  })

  it('sets a grant mode', async () => {
    const fetchMock = respond(200, { data: [{ permission: 'notifications', mode: 'allow' }], meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.setGrantMode('dev.a.clock', 'notifications', 'allow')).toEqual({ ok: true, data: [{ permission: 'notifications', mode: 'allow' }] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-packages/dev.a.clock/grants/notifications')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe('{"mode":"allow"}')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/api.test.ts`
Expected: FAIL — `428` maps to `invalid` without the id; `409 CONFIRMATION_INVALID` maps to `conflict`; `declineConfirmation` / `setGrantMode` are not functions; no confirmation header.

- [ ] **Step 3: Implement**

`apps/ui/app/api.ts`:

```ts
import type { Grant, GrantMode, InstalledPackage, PackageInspection, WidgetPermission } from '@lifedashboard/contracts/widget-package'
```

Add to `ApiFailure` (after `rate-limited`):

```ts
  // The gateway asks the user first (spec 2026-10-09); the id goes back on one repeat of the call.
  | { kind: 'confirmation-required'; confirmationId: string }
```

In `apiRequest`, replace the `409` line with:

```ts
  if (response.status === 428) {
    const confirmationId = errorField(payload, 'confirmationId')
    // Without an id there is nothing to confirm: fall through to a rejected call (fail closed).
    if (confirmationId !== undefined) return { ok: false, kind: 'confirmation-required', confirmationId }
  }
  if (response.status === 409 && errorField(payload, 'code') !== 'CONFIRMATION_INVALID') return { ok: false, kind: 'conflict' }
```

Widen `errorField`:

```ts
function errorField(payload: unknown, field: 'code' | 'message' | 'confirmationId'): string | undefined {
```

Replace `gateway` and add the two calls in `api`:

```ts
  gateway: (op: string, token: string, input: unknown, confirmationId?: string) =>
    apiRequest<unknown>('POST', `/widget-gateway/${encodeURIComponent(op)}`, input, API_TIMEOUT_MS, {
      'x-widget-session': token,
      ...(confirmationId === undefined ? {} : { 'x-widget-confirmation': confirmationId }),
    }),
  declineConfirmation: (token: string, id: string) =>
    apiRequest<null>('DELETE', `/widget-gateway/confirmations/${encodeURIComponent(id)}`, {}, API_TIMEOUT_MS, { 'x-widget-session': token }),
  setGrantMode: (id: string, permission: WidgetPermission, mode: GrantMode) =>
    apiRequest<Grant[]>('PUT', `/widget-packages/${encodeURIComponent(id)}/grants/${encodeURIComponent(permission)}`, { mode }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/ui exec vitest run && pnpm -C apps/ui typecheck`
Expected: PASS (existing gateway header test still sees only `x-widget-session`), no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/api.ts apps/ui/test/api.test.ts
git commit -m "feat(ui): API client for confirmations and grant modes"
```

---

### Task 6: Confirmation queue

**Files:**
- Create: `apps/ui/app/confirmations.ts`
- Test: `apps/ui/test/confirmations.test.ts`

**Interfaces:**
- Consumes: `CONFIRMATION_DIALOG_MS`, `GatewayOp` (Task 1).
- Produces (`apps/ui/app/confirmations.ts`):
  ```ts
  export type ConfirmationAnswer = 'approved' | 'declined' | 'expired'
  export interface ConfirmationRequest { widgetId: string; title: string; op: GatewayOp; input: unknown }
  export interface Confirmation extends ConfirmationRequest { id: number; answer(result: ConfirmationAnswer): void }
  export const confirmations: Ref<Confirmation[]>        // oldest first; the dialog shows [0]
  export function requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationAnswer>
  export function cancelConfirmations(widgetId: string): void   // entries of that widget resolve 'declined'
  ```

- [ ] **Step 1: Write the failing tests**

Create `apps/ui/test/confirmations.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIRMATION_DIALOG_MS } from '@lifedashboard/contracts/widget-gateway'
import { cancelConfirmations, confirmations, requestConfirmation } from '../app/confirmations'

const note = { title: 'Hi', body: '' }

function ask(widgetId: string) {
  return requestConfirmation({ widgetId, title: 'Привет', op: 'notifications.send', input: note })
}

function queued(): string[] {
  return confirmations.value.map((item) => item.widgetId)
}

afterEach(() => {
  cancelConfirmations('a')
  cancelConfirmations('b')
  vi.useRealTimers()
})

describe('confirmations', () => {
  it('queues requests first in, first out', async () => {
    const first = ask('a')
    const second = ask('b')
    expect(queued()).toEqual(['a', 'b'])
    expect(confirmations.value[0]).toMatchObject({ widgetId: 'a', title: 'Привет', op: 'notifications.send', input: note })
    confirmations.value[0]!.answer('approved')
    expect(await first).toBe('approved')
    expect(queued()).toEqual(['b'])
    confirmations.value[0]!.answer('declined')
    expect(await second).toBe('declined')
    expect(confirmations.value).toEqual([])
  })

  it('lets the first answer win', async () => {
    const first = ask('a')
    ask('b')
    const head = confirmations.value[0]!
    head.answer('approved')
    head.answer('declined')
    expect(await first).toBe('approved')
    // A second answer to a settled entry never touches the next one.
    expect(queued()).toEqual(['b'])
  })

  it('cancels by widgetId and keeps another widget with the same title', async () => {
    const a = ask('a')
    ask('b')
    cancelConfirmations('a')
    expect(await a).toBe('declined')
    expect(queued()).toEqual(['b'])
  })

  it('expires each entry CONFIRMATION_DIALOG_MS after its request, shown or still queued', async () => {
    vi.useFakeTimers()
    const shown = ask('a')
    vi.advanceTimersByTime(1_000)
    const waiting = ask('b')
    vi.advanceTimersByTime(CONFIRMATION_DIALOG_MS - 1_001)
    expect(queued()).toEqual(['a', 'b'])
    const head = confirmations.value[0]!
    vi.advanceTimersByTime(1)
    expect(await shown).toBe('expired')
    // An answer after the deadline does nothing.
    head.answer('approved')
    expect(queued()).toEqual(['b'])
    vi.advanceTimersByTime(1_000)
    expect(await waiting).toBe('expired')
    expect(confirmations.value).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/confirmations.test.ts`
Expected: FAIL — `Failed to load url ../app/confirmations` (module missing).

- [ ] **Step 3: Implement**

Create `apps/ui/app/confirmations.ts`:

```ts
import { ref } from 'vue'
import { CONFIRMATION_DIALOG_MS, type GatewayOp } from '@lifedashboard/contracts/widget-gateway'

export type ConfirmationAnswer = 'approved' | 'declined' | 'expired'

export interface ConfirmationRequest {
  // Keys the entry: two instances of one package share a title.
  widgetId: string
  // Shown only.
  title: string
  op: GatewayOp
  // The parsed input the API bound the confirmation id to; the dialog previews it.
  input: unknown
}

export interface Confirmation extends ConfirmationRequest {
  id: number
  // The first answer wins; a double click or the deadline after it does nothing.
  answer(result: ConfirmationAnswer): void
}

let nextId = 0

/** Waiting confirmations, oldest first; ConfirmDialog shows the head. */
export const confirmations = ref<Confirmation[]>([])

/**
 * Asks the user in the host dialog. The deadline counts from the request, shown or still queued, so an
 * approval always reaches the API before the id expires (CONFIRMATION_TTL_MS).
 */
export function requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationAnswer> {
  return new Promise((resolve) => {
    const id = nextId++
    let settled = false
    const answer = (result: ConfirmationAnswer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      confirmations.value = confirmations.value.filter((item) => item.id !== id)
      resolve(result)
    }
    const timer = setTimeout(() => answer('expired'), CONFIRMATION_DIALOG_MS)
    confirmations.value = [...confirmations.value, { ...request, id, answer }]
  })
}

/** Widget teardown and unmount: its entries leave the queue declined. */
export function cancelConfirmations(widgetId: string): void {
  for (const item of confirmations.value.filter((entry) => entry.widgetId === widgetId)) item.answer('declined')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/ui exec vitest run test/confirmations.test.ts && pnpm -C apps/ui typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/confirmations.ts apps/ui/test/confirmations.test.ts
git commit -m "feat(ui): confirmation queue with per-request deadline"
```

---

### Task 7: Broker asks, repeats once, declines; widget hosts wire it

**Files:**
- Modify: `apps/ui/app/widgets/broker.ts`
- Modify: `apps/ui/app/widgets/SandboxWidget.vue`, `apps/ui/app/widgets/WidgetHost.vue`
- Test: `apps/ui/test/broker.test.ts`

**Interfaces:**
- Consumes: `api.gateway(…, confirmationId?)`, `api.declineConfirmation` (Task 5); `requestConfirmation`, `cancelConfirmations`, `ConfirmationAnswer` (Task 6); `GATEWAY_OPS[op].confirm`, `BRIDGE_LIMITS.confirmTimeoutMs`, `DECLINED` (Task 1).
- Produces (`apps/ui/app/widgets/broker.ts`):
  ```ts
  export type GatewayApi = Pick<typeof api, 'createWidgetSession' | 'endWidgetSession' | 'gateway' | 'declineConfirmation'>
  createGatewayClient(deps: {
    api: GatewayApi
    widgetId: string
    confirm(op: GatewayOp, input: unknown): Promise<ConfirmationAnswer>
    onNotify(message: NotificationInput): void
    onSessionLost(): void
  }): GatewayClient
  ```
  Behaviour: on `confirmation-required` → `approved` repeats once with the id; `declined` / `expired` → `declineConfirmation(token, id)` (not awaited) and `DECLINED`; closed while asking → `DECLINED`, no decline call; `CONFIRMATION_INVALID` or a `428` on the repeat → `DECLINED` «The confirmation expired», no decline call, no second prompt for that id. A session renewal resends without an id (so the user is asked again), at most one renewal per call. `createBridge` uses `confirmTimeoutMs` for ops with `confirm !== 'never'`.

- [ ] **Step 1: Write the failing tests**

In `apps/ui/test/broker.test.ts`:

Imports:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIRMATION_DIALOG_MS, type GatewayOp } from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import { API_TIMEOUT_MS, type ApiResult } from '../app/api'
import { cancelConfirmations, confirmations, requestConfirmation, type ConfirmationAnswer } from '../app/confirmations'
import { createBridge, createGatewayClient, createHandshakes, type GatewayApi } from '../app/widgets/broker'
```

Replace `fakeApi`, `setup` and `answers` with:

```ts
type Answer = (op: string, token: string, input: unknown, confirmationId?: string) => Promise<ApiResult<unknown>>
type Confirm = (op: GatewayOp, input: unknown) => Promise<ConfirmationAnswer>

function fakeApi(answer: Answer) {
  let created = 0
  return {
    createWidgetSession: vi.fn(async (_widgetId: string) => ({ ok: true as const, data: { widgetSession: `s${++created}`, grants: [] } })),
    endWidgetSession: vi.fn(async (_token: string) => ({ ok: true as const, data: null })),
    gateway: vi.fn(answer),
    declineConfirmation: vi.fn(async (_token: string, _id: string) => ({ ok: true as const, data: null })),
  } satisfies GatewayApi
}

function setup(answer: Answer, confirmAnswer: Confirm = async () => 'approved') {
  const api = fakeApi(answer)
  const onNotify = vi.fn()
  const onSessionLost = vi.fn()
  const confirm = vi.fn(confirmAnswer)
  return { api, onNotify, onSessionLost, confirm, client: createGatewayClient({ api, widgetId: 'w1', confirm, onNotify, onSessionLost }) }
}

function answers(...results: ApiResult<unknown>[]) {
  return async () => results.shift()!
}

const note = { title: 'Hi', body: '' }

function asked(confirmationId: string): ApiResult<unknown> {
  return { ok: false, kind: 'confirmation-required', confirmationId }
}

// The real queue and its deadline, as SandboxWidget wires it.
const askUser: Confirm = (op, input) => requestConfirmation({ widgetId: 'w1', title: 'Привет', op, input })
```

The gateway client now always passes the optional fourth argument. Update the two existing assertions:

```ts
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: { n: 1 }, expectedRevision: 0 }, undefined)
```

```ts
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: exactly64k, expectedRevision: 0 }, undefined)
```

Add inside `describe('createGatewayClient')`:

```ts
  it('asks with the parsed input and repeats the call once with the id after an approval', async () => {
    const { api, client, confirm, onNotify } = setup(answers(asked('c1'), { ok: true, data: { ok: true } }))
    expect(await client.call('notifications.send', note)).toEqual({ ok: true })
    expect(api.gateway.mock.calls).toEqual([
      ['notifications.send', 's1', note, undefined],
      ['notifications.send', 's1', note, 'c1'],
    ])
    // The dialog previews exactly the value the API bound the id to.
    expect(confirm).toHaveBeenCalledWith('notifications.send', note)
    expect(confirm.mock.calls[0]![1]).toBe(api.gateway.mock.calls[0]![2])
    expect(onNotify).toHaveBeenCalledTimes(1)
    expect(api.declineConfirmation).not.toHaveBeenCalled()
  })

  it.each([
    ['declined', 'The user declined the call'],
    ['expired', 'The confirmation expired'],
  ] as const)('declines the id and throws DECLINED when the answer is %s', async (answer, message) => {
    const { api, client, onNotify } = setup(answers(asked('c1')), async () => answer)
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'DECLINED', message })
    expect(api.declineConfirmation).toHaveBeenCalledWith('s1', 'c1')
    expect(api.gateway).toHaveBeenCalledTimes(1)
    expect(onNotify).not.toHaveBeenCalled()
  })

  it('maps CONFIRMATION_INVALID on the repeat to DECLINED without declining', async () => {
    const { api, client } = setup(answers(asked('c1'), { ok: false, kind: 'invalid', code: 'CONFIRMATION_INVALID', message: 'm' }))
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'DECLINED', message: 'The confirmation expired' })
    expect(api.declineConfirmation).not.toHaveBeenCalled()
  })

  it('never asks twice for one call on one session: a 428 on the repeat ends it', async () => {
    const { client, confirm } = setup(answers(asked('c1'), asked('c2')))
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'DECLINED' })
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('never asks for a 428 without an id', async () => {
    const { client, confirm } = setup(answers({ ok: false, kind: 'invalid', code: 'CONFIRMATION_REQUIRED', message: 'm' }))
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('resends without the id after a session renewal and asks again', async () => {
    const { api, client, confirm } = setup(
      answers(asked('c1'), { ok: false, kind: 'session-expired' }, asked('c2'), { ok: true, data: { ok: true } }),
    )
    expect(await client.call('notifications.send', note)).toEqual({ ok: true })
    expect(api.gateway.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ['s1', undefined],
      ['s1', 'c1'],
      ['s2', undefined],
      ['s2', 'c2'],
    ])
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('declines nothing when the widget closes while the user is asked', async () => {
    let answer: ((result: ConfirmationAnswer) => void) | undefined
    const { api, client, confirm } = setup(answers(asked('c1')), () => new Promise((resolve) => { answer = resolve }))
    const pending = client.call('notifications.send', note)
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    await client.close()
    answer!('declined')
    await expect(pending).rejects.toMatchObject({ code: 'DECLINED' })
    expect(api.declineConfirmation).not.toHaveBeenCalled()
  })
```

In `describe('createBridge')`, extend the `afterEach` (before `vi.useRealTimers()`):

```ts
    cancelConfirmations('w1')
```

and add:

```ts
  it('ends an unanswered confirmation DECLINED before the bridge timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { api, client } = setup(answers(asked('c1')), askUser)
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 1, op: 'notifications.send', input: note })
    await vi.waitFor(() => expect(confirmations.value).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(CONFIRMATION_DIALOG_MS)
    // With the 10 s request timeout the first answer would be TIMEOUT.
    expect(await frame.next()).toMatchObject({ t: 'res', id: 1, ok: false, error: { code: 'DECLINED', message: 'The confirmation expired' } })
    expect(api.declineConfirmation).toHaveBeenCalledWith('s1', 'c1')
  })

  it('ends DECLINED before the bridge timeout after a late approval, a session renewal and an unanswered second dialog', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Every API call takes the whole API_TIMEOUT_MS: the worst case of spec «Contracts».
    const slow = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), API_TIMEOUT_MS))
    const results: ApiResult<unknown>[] = [asked('c1'), { ok: false, kind: 'session-expired' }, asked('c2')]
    const { api, client } = setup(() => slow(results.shift()!), askUser)
    let sessions = 0
    api.createWidgetSession.mockImplementation(() => slow({ ok: true as const, data: { widgetSession: `s${++sessions}`, grants: [] } }))
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 1, op: 'notifications.send', input: note })
    await vi.waitFor(() => expect(api.createWidgetSession).toHaveBeenCalled())
    // vi.waitFor advances fake time by its interval on each check, so the steps below keep a 1 s margin.
    await vi.advanceTimersByTimeAsync(2 * API_TIMEOUT_MS)
    await vi.waitFor(() => expect(confirmations.value).toHaveLength(1))
    // A late approval, 1 s before the dialog deadline.
    await vi.advanceTimersByTimeAsync(CONFIRMATION_DIALOG_MS - 1_000)
    confirmations.value[0]!.answer('approved')
    // Repeat (session expired), new session, call (asked again).
    await vi.advanceTimersByTimeAsync(3 * API_TIMEOUT_MS)
    await vi.waitFor(() => expect(confirmations.value).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(CONFIRMATION_DIALOG_MS)
    expect(await frame.next()).toMatchObject({ t: 'res', id: 1, ok: false, error: { code: 'DECLINED' } })
    expect(api.declineConfirmation).toHaveBeenCalledWith('s2', 'c2')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/broker.test.ts`
Expected: FAIL — `confirmation-required` maps to `UNAVAILABLE`, `confirm` and `declineConfirmation` are never called, the bridge answers `TIMEOUT` after 10 s.

- [ ] **Step 3: Implement the broker**

`apps/ui/app/widgets/broker.ts`:

Imports:

```ts
import {
  BRIDGE_LIMITS,
  GATEWAY_OPS,
  isGatewayOp,
  parseGatewayInput,
  parseSandboxMessage,
  SDK_VERSION,
  type GatewayOp,
  type NotificationInput,
  type WidgetContext,
  type WidgetErrorCode,
} from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import type { api, ApiFailure, ApiResult } from '../api'
import type { ConfirmationAnswer } from '../confirmations'

export type GatewayApi = Pick<typeof api, 'createWidgetSession' | 'endWidgetSession' | 'gateway' | 'declineConfirmation'>
```

In `toWidgetError`, replace the `invalid` case and add one:

```ts
    case 'invalid':
      if (failure.code === 'CONFIRMATION_INVALID') return new WidgetError('DECLINED', 'The confirmation expired')
      return new WidgetError(GATEWAY_CODES.has(failure.code) ? (failure.code as WidgetErrorCode) : 'INVALID_INPUT', failure.message)
    // Only a repeat that carried an id gets here: it is never asked again.
    case 'confirmation-required':
      return new WidgetError('DECLINED', 'The confirmation expired')
```

Replace `createGatewayClient` with:

```ts
/**
 * A widget's way to the gateway, shared by both hosts. It holds the widget session (the frame never
 * sees the token), checks op and input with the shared contracts, and renews an expired session once:
 * a session failure happens before the operation runs, so one repeat is safe. When the API asks for a
 * confirmation, the user answers in the host dialog; only an approval sends the id, on one repeat.
 */
export function createGatewayClient(deps: {
  api: GatewayApi
  widgetId: string
  // The host dialog (confirmations.ts); `input` is the parsed value the API binds the id to.
  confirm(op: GatewayOp, input: unknown): Promise<ConfirmationAnswer>
  onNotify(message: NotificationInput): void
  onSessionLost(): void
}): GatewayClient {
  let token: string | null = null
  let closed = false

  async function start(): Promise<boolean> {
    const result = await deps.api.createWidgetSession(deps.widgetId)
    token = result.ok ? result.data.widgetSession : null
    return token !== null
  }

  async function send(op: string, input: unknown, confirmationId?: string): Promise<ApiResult<unknown> | null> {
    if (token === null && !(await start())) return null
    return deps.api.gateway(op, token!, input, confirmationId)
  }

  function lost(): WidgetError {
    token = null
    deps.onSessionLost()
    return new WidgetError('SESSION_EXPIRED', 'Widget session expired')
  }

  // One call on the current session; a 428 asks the user, and an approval repeats it once with the id.
  async function attempt(op: GatewayOp, input: unknown): Promise<ApiResult<unknown> | null> {
    const result = await send(op, input)
    if (!result || result.ok || result.kind !== 'confirmation-required') return result
    const owner = token
    const answer = await deps.confirm(op, input)
    // Closed meanwhile: ending the session drops the id, so nothing is declined (spec «Error handling»).
    if (closed) throw new WidgetError('DECLINED', 'The widget was closed')
    if (answer === 'approved') return send(op, input, result.confirmationId)
    if (owner !== null) void deps.api.declineConfirmation(owner, result.confirmationId)
    throw new WidgetError('DECLINED', answer === 'expired' ? 'The confirmation expired' : 'The user declined the call')
  }

  async function call(op: string, input: unknown): Promise<unknown> {
    if (!isGatewayOp(op)) throw new WidgetError('UNKNOWN_OP', `Unknown operation "${op.slice(0, 100)}"`)
    const parsed = parseGatewayInput(op, input)
    if (!parsed.ok) throw new WidgetError('INVALID_INPUT', parsed.error)
    let result = await attempt(op, parsed.value)
    if (result && !result.ok && result.kind === 'session-expired') {
      // The renewal resends without an id: the new session gets a new 428 and the user is asked again.
      token = null
      result = await attempt(op, parsed.value)
    }
    if (!result || (!result.ok && result.kind === 'session-expired')) throw lost()
    if (!result.ok) throw toWidgetError(result)
    if (op === 'notifications.send') deps.onNotify(parsed.value as NotificationInput)
    return result.data
  }

  async function close(): Promise<void> {
    closed = true
    const current = token
    token = null
    if (current !== null) await deps.api.endWidgetSession(current)
  }

  return { start, call, close }
}
```

In `createBridge`'s `run`, replace the `const timer = …` line with:

```ts
    // A confirmable op waits for the user; its dialog deadline ends it first (BRIDGE_LIMITS comment).
    const timeoutMs = isGatewayOp(op) && GATEWAY_OPS[op].confirm !== 'never' ? BRIDGE_LIMITS.confirmTimeoutMs : BRIDGE_LIMITS.requestTimeoutMs
    const timer = setTimeout(() => settle({ error: new WidgetError('TIMEOUT', 'The request timed out') }), timeoutMs)
```

- [ ] **Step 4: Wire the widget hosts**

`apps/ui/app/widgets/SandboxWidget.vue` — import the queue:

```ts
import { cancelConfirmations, requestConfirmation } from '../confirmations'
```

In `teardown()`, before `void client?.close()`:

```ts
  // An open or queued dialog of this widget closes; its id dies with the session.
  cancelConfirmations(props.widgetId)
```

In `start()`, add `confirm` to `createGatewayClient`'s deps (after `widgetId`):

```ts
    confirm: (op, input) => requestConfirmation({ widgetId: props.widgetId, title: props.title, op, input }),
```

`apps/ui/app/widgets/WidgetHost.vue` — import:

```ts
import { cancelConfirmations, requestConfirmation } from '../confirmations'
```

and replace the built-in block with:

```ts
if (props.widgetId && props.source.kind === 'builtin') {
  const widgetId = props.widgetId
  const client = createGatewayClient({
    api,
    widgetId,
    // Built-ins count as `allow`; only `always` operations ask.
    confirm: (op, input) => requestConfirmation({ widgetId, title: title.value, op, input }),
    onNotify: (message) => showToast({ source: title.value, ...message }),
    // ponytail: no error state for built-ins; the rejected call reaches the widget. Add one with the first built-in that uses the gateway.
    onSessionLost: () => {},
  })
  provideInProcessWidget({ call: client.call, context })
  onUnmounted(() => {
    cancelConfirmations(widgetId)
    void client.close()
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C apps/ui exec vitest run && pnpm -C apps/ui typecheck`
Expected: PASS (all UI tests, including the unchanged `times out a request after 10 s` for `state.get`), no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/ui/app/widgets/broker.ts apps/ui/app/widgets/SandboxWidget.vue apps/ui/app/widgets/WidgetHost.vue apps/ui/test/broker.test.ts
git commit -m "feat(ui): broker asks the user before a confirmable call"
```

---

### Task 8: Host confirmation dialog and the `hello` example

No unit harness exists for Vue components (Global Constraints); the dialog is a thin view over `confirmations.ts` (tested in Task 6) and is checked in the browser in Task 11.

**Deviations from the spec (flag in the final report):**
- `examples/widgets/hello` catches `DECLINED` in «Напомнить». Without it, a decline rejects the click handler, the sandbox runtime reports the error and the host puts the widget into «Ошибка виджета».
- «Разрешить один раз» stays disabled for 500 ms after a new entry reaches the head, so a double click on the previous entry cannot approve the next one (Review Focus 3).

**Files:**
- Create: `apps/ui/app/ConfirmDialog.vue`
- Modify: `apps/ui/app/app.vue`
- Modify: `examples/widgets/hello/src/index.vue`

**Interfaces:**
- Consumes: `confirmations` (Task 6); `NotificationInput`, `GatewayOp` (contracts).
- Produces: `<ConfirmDialog />` (no props, no emits) mounted once in `app.vue`.

- [ ] **Step 1: Create the dialog**

Create `apps/ui/app/ConfirmDialog.vue`:

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { GatewayOp, NotificationInput } from '@lifedashboard/contracts/widget-gateway'
import { confirmations } from './confirmations'

// «Виджет «…» хочет …»; a Record so a new op cannot reach the dialog without its text.
const ACTIONS: Record<GatewayOp, string> = {
  'state.get': 'прочитать свои данные',
  'state.set': 'сохранить свои данные',
  'notifications.send': 'показать уведомление',
}
// A double click on the previous entry must not approve the next one.
const ARM_MS = 500

// Template ref keys differ from setup bindings (see WidgetBoard.vue).
const dialog = useTemplateRef<HTMLDialogElement>('dialogBox')
const declineButton = useTemplateRef<HTMLButtonElement>('declineBox')
const current = computed(() => confirmations.value[0] ?? null)
const notification = computed(() => (current.value?.op === 'notifications.send' ? (current.value.input as NotificationInput) : null))
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | undefined

// The modal lives in the main document: the frame can neither see nor click it.
watch(
  () => current.value?.id,
  (id) => {
    clearTimeout(armTimer)
    armed.value = false
    const box = dialog.value
    if (!box) return
    if (id === undefined) {
      if (box.open) box.close()
      return
    }
    if (!box.open) box.showModal()
    declineButton.value?.focus()
    armTimer = setTimeout(() => (armed.value = true), ARM_MS)
  },
  { flush: 'post' },
)

// Esc closes the dialog and declines the shown entry. The close event is queued, so a dialog that
// was reopened for a new entry before it fired is still open and its entry stays.
function onClose() {
  if (!dialog.value?.open) current.value?.answer('declined')
}

onUnmounted(() => clearTimeout(armTimer))
</script>

<template>
  <dialog ref="dialogBox" class="confirm" aria-labelledby="confirm-title" @close="onClose">
    <template v-if="current">
      <h2 id="confirm-title" class="confirm__title">Виджет «{{ current.title }}» хочет {{ ACTIONS[current.op] }}</h2>
      <div v-if="notification" class="confirm__preview">
        <p class="confirm__preview-title">{{ notification.title }}</p>
        <p v-if="notification.body">{{ notification.body }}</p>
      </div>
      <div class="confirm__actions">
        <button type="button" class="confirm__button" :disabled="!armed" @click="current.answer('approved')">Разрешить один раз</button>
        <button ref="declineBox" type="button" class="confirm__button" @click="current.answer('declined')">Отклонить</button>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.confirm {
  width: 28rem;
  max-width: calc(100vw - 2rem);
  padding: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.confirm::backdrop {
  background: var(--ld-scrim);
}

.confirm__title {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}

.confirm__preview {
  padding: 0.75rem 1rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-control);
  overflow-wrap: anywhere;
}

.confirm__preview p {
  margin: 0;
}

.confirm__preview-title {
  font-weight: var(--ld-weight-strong);
}

.confirm__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.confirm__button {
  height: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.confirm__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.confirm__button:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
```

- [ ] **Step 2: Mount it**

`apps/ui/app/app.vue` — import after `PairingForm`:

```ts
import ConfirmDialog from './ConfirmDialog.vue'
```

and in the template after `<PackagesDialog … />`:

```vue
    <ConfirmDialog />
```

- [ ] **Step 3: Let `hello` handle a decline**

`examples/widgets/hello/src/index.vue` — replace `remind`:

```ts
async function remind() {
  try {
    await widget.notify({ title: 'Напоминание', body: `Счётчик: ${count.value}` })
    status.value = ''
  } catch (error) {
    // The user declined in the host dialog, or the dialog expired.
    if (!(error instanceof WidgetError) || error.code !== 'DECLINED') throw error
    status.value = 'Уведомление отклонено'
  }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm -C apps/ui typecheck && pnpm -C apps/ui exec vitest run && pnpm -C examples/widgets/hello build`
Expected: no type errors; UI tests PASS; `examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json` is written. Behaviour is checked in Task 11.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/ConfirmDialog.vue apps/ui/app/app.vue examples/widgets/hello/src/index.vue
git commit -m "feat(ui): host dialog for widget operation confirmation"
```

---

### Task 9: Grant mode in the packages dialog

The decisions (which permissions offer a mode, which `PUT`s follow an install, which saved mode to show) live in `catalog.ts` with tests; a regression there would silently relax grants. The component itself is checked in the browser in Task 11.

**Files:**
- Modify: `apps/ui/app/widgets/catalog.ts`
- Modify: `apps/ui/app/widgets/PackagesDialog.vue`
- Test: `apps/ui/test/catalog.test.ts`

**Interfaces:**
- Consumes: `api.setGrantMode` (Task 5); `confirmablePermissions()` (Task 1); `Grant`, `GrantMode` (Task 3); `PackageInspection.newPermissions` from the inspect call (the install answer returns `newPermissions: []`).
- Produces (`apps/ui/app/widgets/catalog.ts`):
  ```ts
  export type GrantModes = Partial<Record<WidgetPermission, GrantMode>>
  export const CONFIRMABLE_PERMISSIONS: ReadonlySet<WidgetPermission>
  export function initialModes(newPermissions: readonly WidgetPermission[]): GrantModes        // new confirmable → 'ask'
  export function relaxedPermissions(newPermissions: readonly WidgetPermission[], modes: GrantModes): WidgetPermission[]  // new confirmable switched to 'allow'
  export function savedMode(grants: readonly Grant[], permission: WidgetPermission): GrantMode | null  // held confirmable grant's mode
  ```

- [ ] **Step 1: Write the failing tests**

In `apps/ui/test/catalog.test.ts`, extend the imports:

```ts
import type { Grant, InstalledPackage, WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import {
  describeSource,
  findBuiltinWidget,
  initialModes,
  installedPackages,
  loadPackages,
  pickerEntries,
  readPackageFile,
  relaxedPermissions,
  savedMode,
} from '../app/widgets/catalog'
```

and add at the end:

```ts
describe('grant modes on the install screen', () => {
  it('starts new confirmable permissions as ask and offers no mode for others', () => {
    expect(initialModes(['state', 'notifications'])).toEqual({ notifications: 'ask' })
    expect(initialModes(['state'])).toEqual({})
  })

  it('sends a PUT only for a new confirmable permission switched to allow', () => {
    expect(relaxedPermissions(['state', 'notifications'], { notifications: 'allow' })).toEqual(['notifications'])
    expect(relaxedPermissions(['notifications'], { notifications: 'ask' })).toEqual([])
    // A held grant is not new: the install screen never touches it, whatever the modes say.
    expect(relaxedPermissions([], { notifications: 'allow' })).toEqual([])
    expect(relaxedPermissions(['state'], { state: 'allow' })).toEqual([])
  })

  it('shows the saved mode of a held confirmable grant only', () => {
    const grants: Grant[] = [{ permission: 'notifications', mode: 'allow' }, { permission: 'state', mode: 'allow' }]
    expect(savedMode(grants, 'notifications')).toBe('allow')
    expect(savedMode(grants, 'state')).toBeNull()
    expect(savedMode([], 'notifications')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/catalog.test.ts`
Expected: FAIL — `initialModes is not a function` (and the other two).

- [ ] **Step 3: Implement the helpers**

`apps/ui/app/widgets/catalog.ts` — imports:

```ts
import { confirmablePermissions } from '@lifedashboard/contracts/widget-gateway'
import { PACKAGE_LIMITS, type Grant, type GrantMode, type InstalledPackage, type WidgetPermission } from '@lifedashboard/contracts/widget-package'
```

Append:

```ts
export type GrantModes = Partial<Record<WidgetPermission, GrantMode>>

/** Permissions that offer «Спрашивать каждый раз / Разрешить». */
export const CONFIRMABLE_PERMISSIONS: ReadonlySet<WidgetPermission> = new Set(confirmablePermissions())

/** Install screen: a new confirmable permission starts as «Спрашивать»; others offer no mode. */
export function initialModes(newPermissions: readonly WidgetPermission[]): GrantModes {
  return Object.fromEntries(newPermissions.filter((permission) => CONFIRMABLE_PERMISSIONS.has(permission)).map((permission) => [permission, 'ask']))
}

/** After an install: new confirmable permissions the user switched to «Разрешить». Held grants are never touched. */
export function relaxedPermissions(newPermissions: readonly WidgetPermission[], modes: GrantModes): WidgetPermission[] {
  return newPermissions.filter((permission) => CONFIRMABLE_PERMISSIONS.has(permission) && modes[permission] === 'allow')
}

/** The saved mode of a confirmable grant the package holds; null for other permissions. */
export function savedMode(grants: readonly Grant[], permission: WidgetPermission): GrantMode | null {
  if (!CONFIRMABLE_PERMISSIONS.has(permission)) return null
  return grants.find((grant) => grant.permission === permission)?.mode ?? null
}
```

Run: `pnpm -C apps/ui exec vitest run test/catalog.test.ts`
Expected: PASS.

- [ ] **Step 4: Component script**

`apps/ui/app/widgets/PackagesDialog.vue` — imports:

```ts
import { computed, ref, useTemplateRef, watch } from 'vue'
import type { Grant, GrantMode, PackageInspection, WidgetPermission } from '@lifedashboard/contracts/widget-package'
import { api, type ApiFailure } from '../api'
import {
  CONFIRMABLE_PERMISSIONS,
  initialModes,
  installedPackages,
  loadPackages,
  readPackageFile,
  relaxedPermissions,
  savedMode,
  type GrantModes,
} from './catalog'
```

After `PERMISSIONS` add:

```ts
const MODES: Record<GrantMode, string> = {
  ask: 'Спрашивать каждый раз',
  allow: 'Разрешить',
}
```

After `pending` add:

```ts
// Modes the user picks for new confirmable permissions on the install screen.
const modes = ref<GrantModes>({})
```

After `isUpdate` add:

```ts
const heldGrants = computed(() => installedPackages.value.find((pkg) => pkg.id === manifest.value?.id)?.grants ?? [])
```

In `chooseFile`, replace `if (result.ok) pending.value = { body: read.body, inspection: result.data }` with:

```ts
  if (result.ok) {
    pending.value = { body: read.body, inspection: result.data }
    modes.value = initialModes(result.data.newPermissions)
  }
```

Replace `install`:

```ts
async function install() {
  const current = pending.value
  if (!current) return
  busy.value = true
  const result = await api.installPackage(current.body)
  if (!result.ok) {
    busy.value = false
    message.value = failureText(result, VERSION_CONFLICT)
    return
  }
  // New confirmable grants come out as «ask»; a failed PUT leaves that safer mode.
  const relaxed = relaxedPermissions(current.inspection.newPermissions, modes.value)
  const saved = await Promise.all(relaxed.map((permission) => api.setGrantMode(current.inspection.manifest.id, permission, 'allow')))
  busy.value = false
  pending.value = null
  message.value = saved.every((item) => item.ok) ? 'Виджет установлен' : 'Виджет установлен, но режим «Разрешить» не сохранён'
  await loadPackages(api)
}
```

Add after `remove`:

```ts
async function changeMode(packageId: string, grant: Grant, event: Event) {
  const select = event.target as HTMLSelectElement
  busy.value = true
  const result = await api.setGrantMode(packageId, grant.permission, select.value as GrantMode)
  busy.value = false
  if (!result.ok) {
    // The list keeps showing the saved mode.
    select.value = grant.mode
    message.value = 'Не удалось сохранить режим'
    return
  }
  message.value = null
  await loadPackages(api)
}
```

- [ ] **Step 5: Template**

Install screen — replace the permissions `<ul>`:

```vue
      <ul class="packages__permissions">
        <li v-for="permission in manifest.permissions" :key="permission" class="packages__grant">
          {{ PERMISSIONS[permission] }}
          <select
            v-if="modes[permission]"
            v-model="modes[permission]"
            class="packages__select"
            :aria-label="`${PERMISSIONS[permission]}: режим`"
          >
            <option value="ask">{{ MODES.ask }}</option>
            <option value="allow">{{ MODES.allow }}</option>
          </select>
          <span v-else-if="savedMode(heldGrants, permission)" class="packages__hint">
            {{ MODES[savedMode(heldGrants, permission)!] }} — меняется в списке виджетов
          </span>
        </li>
        <li v-if="manifest.permissions.length === 0">Без разрешений</li>
      </ul>
```

Installed list — replace the permissions `<span>` of each item (the one Task 3 changed) with:

```vue
          <span class="packages__grants">
            <template v-if="pkg.grants.length === 0">Без разрешений</template>
            <span v-for="grant in pkg.grants" :key="grant.permission" class="packages__grant">
              {{ PERMISSIONS[grant.permission] }}
              <select
                v-if="CONFIRMABLE_PERMISSIONS.has(grant.permission)"
                class="packages__select"
                :aria-label="`${PERMISSIONS[grant.permission]}: режим`"
                :value="grant.mode"
                :disabled="busy"
                @change="changeMode(pkg.id, grant, $event)"
              >
                <option value="ask">{{ MODES.ask }}</option>
                <option value="allow">{{ MODES.allow }}</option>
              </select>
            </span>
          </span>
```

- [ ] **Step 6: Styles**

Add to the scoped `<style>`:

```css
.packages__grants {
  display: grid;
  gap: 0.25rem;
}

.packages__grant {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.packages__select {
  height: var(--ld-control-height);
  padding: 0 0.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
}

.packages__select:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.packages__hint {
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}
```

- [ ] **Step 7: Verify**

Run: `pnpm -C apps/ui typecheck && pnpm -C apps/ui exec vitest run`
Expected: no type errors; UI tests PASS. The dialog itself is checked in Task 11.

- [ ] **Step 8: Commit**

```bash
git add apps/ui/app/widgets/catalog.ts apps/ui/test/catalog.test.ts apps/ui/app/widgets/PackagesDialog.vue
git commit -m "feat(ui): grant mode switch at install and in the packages list"
```

---

### Task 10: Documents

**Files:**
- Modify: `docs/base-2026-10-04-lifegamehermes-design.md:787` (§13.3 table row)
- Modify: `docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md` (new subsection before `## Sandbox serving`)

- [ ] **Step 1: Base design §13.3 row (Russian)**

Replace the row `| Операция widget gateway | … |` with:

```markdown
| Операция widget gateway | Только по разрешению пакета (`state`, `notifications`), с rate limit и audit; встроенные виджеты — по своему манифесту. У каждой операции политика подтверждения (`never`, `optional`, `always`), у гранта пакета — режим «Спрашивать» / «Разрешить». Подтверждаемый вызов выполняется только после «Разрешить один раз» в диалоге хоста, по одноразовому confirmation id, привязанному к вызову (`docs/superpowers/specs/2026-10-09-widget-op-confirmation-design.md`) |
```

- [ ] **Step 2: Sandbox spec pointer**

Insert directly before the line `## Sandbox serving`:

```markdown
### Operation confirmation

A gateway operation can also require the user's confirmation of the exact call: `GATEWAY_OPS` gives
each op a `confirm` policy and each package grant has a mode (`allow` / `ask`). The pipeline then issues
and checks a single-use, input-bound confirmation id, and the host asks the user in a dialog outside the
frame. See `docs/superpowers/specs/2026-10-09-widget-op-confirmation-design.md`.

```

- [ ] **Step 3: Commit**

```bash
git add docs/base-2026-10-04-lifegamehermes-design.md docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md
git commit -m "docs: widget operation confirmation in the base design and sandbox spec"
```

---

### Task 11: Full verification and browser acceptance

**Files:** none changed (a failure found here is fixed in the task that owns the code, with its own test where one is possible).

- [ ] **Step 1: Whole test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS in every package, no type errors. Record the test counts per package.

- [ ] **Step 2: Build example packages, including a newer `hello`**

```bash
pnpm -C examples/widgets/hello build
pnpm -C examples/widgets/hostile build
# A newer version with the same permissions; widget.json is restored right after.
sed -i '' 's/"version": "1.0.0"/"version": "1.0.1"/' examples/widgets/hello/widget.json
pnpm -C examples/widgets/hello build
git checkout -- examples/widgets/hello/widget.json
git status --short examples/   # must print nothing
```

Expected: `examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json`, `…-1.0.1.ldwidget.json` and the hostile package exist (`dist/` is git-ignored).

- [ ] **Step 3: Start the app on an empty data directory**

```bash
export LIFEDASHBOARD_DATA_DIR="$(mktemp -d)"
pnpm dev
```

Run it in a background terminal; note the pairing code and `LIFEDASHBOARD_DATA_DIR`.

- [ ] **Step 4: Browser acceptance in Orca's built-in browser**

Load the `orca-cli` skill and control Orca's built-in browser through `orca` (project rule: no external browser). Open `http://127.0.0.1:3000`, pair, and check in order.

Budget: `notifications.send` allows 10 calls an hour per widget and every dialog spends one (decline and Esc included). Steps 2–8 use 7 on the first «Привет». If a step must be repeated, place a fresh «Привет» (a new widget has its own limit) instead of retrying on the same one; a `RATE_LIMITED` answer would put `hello` into «Ошибка виджета» and look like a regression.

1. **Install screen default** — «Виджеты» → «Установить из файла» → `hello-1.0.0`: «Показывать уведомления» has a select showing «Спрашивать каждый раз»; «Хранить собственные данные виджета» has none. «Установить» → message «Виджет установлен»; the list shows the select on «Показывать уведомления» with «Спрашивать каждый раз» (acceptance 3).
2. **Decline** — place «Привет»; «Напомнить» → a modal in the main document (not inside the iframe; check with an `orca` snapshot) reads «Виджет «Привет» хочет показать уведомление» with «Напоминание» / «Счётчик: 0»; `document.activeElement` is «Отклонить»; «Разрешить один раз» is disabled for about half a second, then enabled. «Отклонить» → no toast; the widget shows «Уведомление отклонено» and stays usable («+1» still works, no «Ошибка виджета»).
3. **Approve once** — «Напомнить» → «Разрешить один раз» → exactly one toast «Привет» / «Напоминание» / «Счётчик: …» (acceptance 1).
4. **Esc** — «Напомнить» → Esc → the dialog closes, no toast, «Уведомление отклонено».
5. **Deadline** — «Напомнить» and wait 110 s without answering → the dialog closes by itself and the widget shows «Уведомление отклонено» (acceptance 2).
6. **Switch in the list** — «Виджеты» → «Разрешить» on «Показывать уведомления» → close the dialog → «Напомнить» shows a toast without a dialog, without a reload (acceptance 3).
7. **Update keeps the mode** — install `hello-1.0.1`: the permission screen shows «Показывать уведомления» with «Разрешить — меняется в списке виджетов» and no select; install; «Напомнить» still shows a toast without a dialog.
8. **The board is blocked while asking** — switch the grant back to «Спрашивать каждый раз». «Напомнить» → while the dialog is open, click «+1» in the widget and «Изменить» in the header: nothing changes (the modal makes the rest of the document inert). «Отклонить». FIFO order and cancel-on-unmount cannot be reached by clicking for this reason; they are covered by the unit tests of Tasks 6 and 7 — say so in the report.
9. **Hostile** — install and place `examples/widgets/hostile`: its probe list still shows the blocked results of the sandbox spec, including `notifications.send → blocked: PERMISSION_DENIED`; no confirmation dialog appears.
10. **Audit** — with the app still running, in a shell where `LIFEDASHBOARD_DATA_DIR` is the directory from Step 3:

    ```bash
    node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.env.LIFEDASHBOARD_DATA_DIR + '/lifedashboard.db', { readOnly: true }); console.table(db.prepare(\"SELECT op, outcome, count(*) AS n FROM widget_audit WHERE op = 'notifications.send' GROUP BY outcome\").all())"
    ```

    Expected: rows for `CONFIRMATION_REQUIRED`, `DECLINED`, `ok` and `PERMISSION_DENIED` (hostile) (acceptance 5).

Stop `pnpm dev`.

- [ ] **Step 5: Report**

Write the final report in the session: test counts from Step 1, each browser check with pass/fail and evidence (snapshot or screenshot reference), and anything not verified. List the deviations: `hello` catches `DECLINED` (Task 8); the 500 ms arm delay on «Разрешить один раз» (Task 8); plan-chosen copy (Global Constraints); `ConfirmDialog.vue` and the `hello` change have no unit test (no component harness), only the browser checks. List the limitations: `op` binding of a confirmation has no test because only one op needs confirmation today; the built-in path (`grantMode` returns `null`) is covered only by the `needsConfirmation` matrix, because no built-in holds `notifications`; FIFO and cancel-on-unmount are unit-tested only (step 8). Do not mark this task done if a check failed.
