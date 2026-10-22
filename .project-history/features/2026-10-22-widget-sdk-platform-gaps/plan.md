# Widget SDK Platform Gaps Implementation Plan (plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the platform gaps the agent-ready SDK depends on: the `sdk` protocol level, settings with a schema and a form, secret settings injected by the API, typed HTTP in the SDK, the frame signal, and shared rate limits.

**Architecture:** All rules live in `packages/contracts` as pure functions (manifest parsing, config normalization, secret injection and redaction), so the API, the UI and later the dev gateway (plan 2) run the same code. The API stores secrets per widget instance in a new table, injects them in the HTTP handler and redacts echoes. The UI builds `context.config` with `normalizeConfig`, renders a settings form from the schema and saves secrets through write-only endpoints.

**Tech Stack:** TypeScript strict, Vue 3, Nuxt 4 SPA, Fastify, `node:sqlite`, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md` (sections 2, 3; Constraints).

**Plan series:** 1 — platform gaps and compatibility (this plan). 2 — SDK as a package (publish shape, `create`, `dev`, `check`, safe `source/`, declaration file, WebM/Opus for `hello`). 3 — agent knowledge (docs, `AGENTS.md`, skill, generated numbers). 4 — acceptance run. Plans 2–4 are written after this one lands, because they consume its interfaces.

## Global Constraints

- No new dependency without explicit user approval.
- Existing installed widgets (`sdk: 1`) keep working, including `widget.call`.
- `sdk` levels accepted by the dashboard: `1` and `2`. `ld-widget build` writes `2`.
- Settings subset per property: `type` (`string`, `number`, `integer`, `boolean`), `title`, `description`, `default` (mandatory), `enum` (strings), `minimum`, `maximum`, `maxLength`. No `$ref`, nesting, arrays or formats. `default` must satisfy type and every declared constraint.
- Secret property: `type: "secret"`, no `default`, no constraints; bound to one origin from `network` and one injection point (header with optional prefix, or query parameter).
- Secret origin must be `https:`; `http:` only for `127.0.0.1`, `localhost`, `[::1]`.
- Entered secret: at least 16 characters.
- Widget never receives a secret; `context.config[key]` for a secret is a `boolean` (set or not).
- Secret not set → request not sent, widget gets `UNAVAILABLE` with a message naming the setting.
- Query injection point already present in the widget's URL → `INVALID_INPUT`.
- Echo redaction: every literal occurrence of the secret value in the response body and `contentType` becomes `[REDACTED]`.
- Widget-supplied headers stay `accept` and `content-type` only.
- Secret keyed by stable instance id; survives board saves that keep the instance; deleted when a saved board no longer has the instance.
- Secret never returned to the UI, never logged, never in a board export or a built folder.
- `minimumSystemVersion: "15.7"` in `apps/desktop/src-tauri/tauri.conf.json`.

## Review Focus

- A widget instance switched or reloaded with a stale `config` (keys from an older schema, wrong types) → widget gets defaults for invalid values and no unknown keys. Test in Task 3.
- A board save that moves widgets around → secrets of kept instances survive; removed instance's secrets are gone. Test in Task 5.
- A secret that appears inside a JSON response body → replaced by `[REDACTED]`, rest of the body intact. Test in Task 6.
- A user pastes a 10-character key → API refuses with a message about 16 characters, UI shows it. Test in Task 5.
- A secret widget placed but not saved yet (no row) → setting the secret answers 404; UI tells the user to save the board first. Test in Task 5 (API side).

---

### Task 1: `sdk` protocol levels in the manifest

**Files:**
- Modify: `packages/contracts/src/widget-package.ts` (manifest type and `parseManifest`)
- Modify: `packages/contracts/src/widget-gateway.ts` (level constants next to `SDK_VERSION`)
- Test: `packages/contracts/test/widget-package.test.ts`

**Interfaces:**
- Produces: `export const SDK_LEVELS = [1, 2] as const`, `export type SdkLevel = (typeof SDK_LEVELS)[number]`, `export const SDK_TARGET_LEVEL: SdkLevel = 2` in `widget-gateway.ts`; `WidgetPackageManifest.sdk: SdkLevel`.

- [ ] **Step 1: Replace the existing `['sdk 2', …, /manifest\.sdk must be 1/]` case and add tests**

```ts
it('accepts sdk 1 and 2', () => {
  expect(parseWidgetManifest({ ...manifest(), sdk: 2 }).ok).toBe(true)
  expect(parseWidgetManifest({ ...manifest(), sdk: 1 }).ok).toBe(true)
})
it('rejects a newer sdk level with an update hint', () => {
  const result = parseWidgetManifest({ ...manifest(), sdk: 3 })
  expect(result).toEqual({ ok: false, error: 'manifest.sdk 3 needs a newer LifeDashboard (this one supports 1–2)' })
})
it('rejects a non-integer sdk', () => {
  expect(parseWidgetManifest({ ...manifest(), sdk: '2' })).toMatchObject({ ok: false, error: 'manifest.sdk must be an integer level' })
})
```
(`manifest()` is the file's existing manifest fixture; reuse its name.)

- [ ] **Step 2: Run** `pnpm -C packages/contracts exec vitest run test/widget-package.test.ts` — Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the constants and the `sdk` check in `parseManifest`: integer in `SDK_LEVELS` passes; integer above `SDK_LEVELS.at(-1)` gives the update hint; anything else gives `manifest.sdk must be an integer level`. Fix type errors in the API/UI where `sdk: 1` was a literal.
- [ ] **Step 4: Run** the same command and `pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): accept sdk levels 1 and 2`

### Task 2: Settings schema in the manifest

**Files:**
- Create: `packages/contracts/src/widget-settings.ts`
- Modify: `packages/contracts/src/widget-package.ts` (`MANIFEST_KEYS` gets `settings`; `parseManifest` calls `parseSettingsSchema`)
- Test: `packages/contracts/test/widget-settings.test.ts`

**Interfaces:**
- Produces (in `widget-settings.ts`):
  ```ts
  export type PlainSettingType = 'string' | 'number' | 'integer' | 'boolean'
  export interface PlainSetting { type: PlainSettingType; title: string; description?: string; default: string | number | boolean; enum?: string[]; minimum?: number; maximum?: number; maxLength?: number }
  export type SecretBinding = { origin: string; header: string; prefix?: string } | { origin: string; query: string }
  export interface SecretSetting { type: 'secret'; title: string; description?: string; bind: SecretBinding }
  export type Setting = PlainSetting | SecretSetting
  export interface SettingsSchema { type: 'object'; properties: Record<string, Setting>; required?: string[] }
  export const SETTINGS_LIMITS = { properties: 32, descriptionLength: 200, enumItems: 50, maxLength: 1000 } as const
  export function parseSettingsSchema(raw: unknown, network: readonly string[]): ParseResult<SettingsSchema>
  export function isValidSettingValue(setting: PlainSetting, value: unknown): boolean
  export function isSecretOriginAllowed(origin: string): boolean
  ```
- Produces: `WidgetPackageManifest.settings?: SettingsSchema`.

Rules the parser enforces (decided here, not in the spec):
- key: `/^[A-Za-z][A-Za-z0-9_]{0,39}$/`; `title` plain text 1–60 (move `isPlainText` from `widget-package.ts` to `parse.ts` to reuse it without a circular import); `description` ≤ 200.
- `enum` only on `string`, 1–50 distinct strings; `minimum`/`maximum` only on `number`/`integer`, finite, `minimum ≤ maximum`; `maxLength` only on `string`, integer 1–1000. A string without `maxLength` is capped at 1000.
- `default` must pass `isValidSettingValue`.
- `required`: distinct keys of `properties`. Meaning: the settings form marks the field as required.
- secret `bind.origin` must be in `network` and pass `isSecretOriginAllowed`; `header` matches `/^[A-Za-z0-9-]{1,64}$/` and is not `accept`, `content-type`, `host`, `cookie`, `content-length` (case-insensitive); `prefix` ≤ 32 chars without control characters; `query` matches `/^[A-Za-z0-9_.-]{1,64}$/`.
- A manifest with `settings` must declare `sdk: 2`.

- [ ] **Step 1: Write failing tests**, one `it` per rule. Required assertions:

```ts
expect(parseSettingsSchema({ type: 'object', properties: { city: { type: 'string', title: 'Город', default: 'Москва' } } }, [])).toMatchObject({ ok: true })
expect(parseSettingsSchema({ type: 'object', properties: { n: { type: 'integer', title: 'N', default: 50, minimum: 1, maximum: 10 } } }, [])).toEqual({ ok: false, error: 'settings.n.default must satisfy its own type and constraints' })
expect(parseSettingsSchema({ type: 'object', properties: { key: { type: 'secret', title: 'Ключ', bind: { origin: 'http://api.example.com', header: 'Authorization', prefix: 'Bearer ' } } } }, ['http://api.example.com'])).toEqual({ ok: false, error: 'settings.key.bind.origin must be https, or http on 127.0.0.1, localhost or [::1]' })
expect(parseSettingsSchema({ type: 'object', properties: { key: { type: 'secret', title: 'Ключ', bind: { origin: 'https://a.example', header: 'Accept' } } } }, ['https://a.example'])).toMatchObject({ ok: false })
expect(parseSettingsSchema({ type: 'object', properties: { key: { type: 'secret', title: 'Ключ', bind: { origin: 'https://b.example', query: 'apikey' } } } }, ['https://a.example'])).toEqual({ ok: false, error: 'settings.key.bind.origin must be one of manifest.network' })
expect(isSecretOriginAllowed('http://127.0.0.1:8787')).toBe(true)
expect(isSecretOriginAllowed('http://[::1]:8787')).toBe(true)
expect(isSecretOriginAllowed('http://192.168.1.2')).toBe(false)
```
plus in `widget-package.test.ts`: a manifest with `settings` and `sdk: 1` → `{ ok: false, error: 'manifest.settings needs sdk 2' }`.

- [ ] **Step 2: Run** `pnpm -C packages/contracts exec vitest run test/widget-settings.test.ts test/widget-package.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `widget-settings.ts` with the hand-written parser style of `widget-package.ts` (`fail`, `isRecord`, `unknownKey` from `parse.ts`; unknown keys rejected), and wire `settings` into `parseManifest` (kept out of the parsed value when absent, like `network`, so the canonical JSON and hash of existing manifests stay the same).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): parse widget settings schema with secret bindings`

### Task 3: `normalizeConfig`

**Files:**
- Modify: `packages/contracts/src/widget-settings.ts`
- Test: `packages/contracts/test/widget-settings.test.ts`

**Interfaces:**
- Produces: `export function normalizeConfig(schema: SettingsSchema | undefined, raw: Record<string, unknown>, secretsSet: ReadonlySet<string>): Record<string, unknown>` — result has exactly the schema keys in schema order; plain key: `raw[key]` if `isValidSettingValue`, else `default`; secret key: `secretsSet.has(key)`. No schema → `{}`.

- [ ] **Step 1: Failing tests**

```ts
const schema = { type: 'object', properties: {
  city: { type: 'string', title: 'Город', default: 'Москва', maxLength: 40 },
  days: { type: 'integer', title: 'Дни', default: 3, minimum: 1, maximum: 7 },
  key: { type: 'secret', title: 'Ключ', bind: { origin: 'https://a.example', header: 'Authorization' } },
} } as const satisfies SettingsSchema
expect(normalizeConfig(schema, { city: 'Казань', days: 9, legacy: true, key: 'leak' }, new Set())).toEqual({ city: 'Казань', days: 3, key: false })
expect(normalizeConfig(schema, {}, new Set(['key']))).toEqual({ city: 'Москва', days: 3, key: true })
expect(normalizeConfig(undefined, { a: 1 }, new Set())).toEqual({})
```
- [ ] **Step 2: Run** `pnpm -C packages/contracts exec vitest run test/widget-settings.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `normalizeConfig`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): normalize widget config against its schema`

### Task 4: Shared secret injection, redaction and rate limits

**Files:**
- Create: `packages/contracts/src/widget-secrets.ts`
- Modify: `packages/contracts/src/widget-gateway.ts` (move `RATE_LIMITS` here, unchanged values)
- Modify: `apps/api/src/widget-gateway.ts` (import `RATE_LIMITS` from contracts)
- Test: `packages/contracts/test/widget-secrets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SECRET_MIN_LENGTH = 16
  export const REDACTED = '[REDACTED]'
  export interface BoundSecret { key: string; title: string; bind: SecretBinding }
  export function secretsOf(schema: SettingsSchema | undefined): BoundSecret[]
  export function injectSecret(request: { url: string; headers: Record<string, string> }, bind: SecretBinding, value: string): { url: string; headers: Record<string, string> } | { error: 'QUERY_COLLISION' }
  export function redactSecrets(text: string, values: readonly string[]): string
  export const RATE_LIMITS: Record<GatewayOp, { max: number; windowMs: number }>  // in widget-gateway.ts
  ```
- Consumes: `SettingsSchema`, `SecretBinding` (Task 2).

- [ ] **Step 1: Failing tests**

```ts
expect(injectSecret({ url: 'https://a.example/v1?q=1', headers: {} }, { origin: 'https://a.example', header: 'Authorization', prefix: 'Bearer ' }, 'k'.repeat(16)))
  .toEqual({ url: 'https://a.example/v1?q=1', headers: { authorization: `Bearer ${'k'.repeat(16)}` } })
expect(injectSecret({ url: 'https://a.example/v1?q=1', headers: {} }, { origin: 'https://a.example', query: 'apikey' }, 'k'.repeat(16)).url).toBe(`https://a.example/v1?q=1&apikey=${'k'.repeat(16)}`)
expect(injectSecret({ url: 'https://a.example/v1?apikey=x', headers: {} }, { origin: 'https://a.example', query: 'apikey' }, 'k'.repeat(16))).toEqual({ error: 'QUERY_COLLISION' })
expect(redactSecrets('{"echo":"SECRETSECRETSECRET1","n":15}', ['SECRETSECRETSECRET1'])).toBe('{"echo":"[REDACTED]","n":15}')
expect(redactSecrets('abc', [])).toBe('abc')
```
- [ ] **Step 2: Run** `pnpm -C packages/contracts exec vitest run test/widget-secrets.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; header names are written lower-case; `redactSecrets` uses `replaceAll` and skips empty values. Move `RATE_LIMITS` and update the API import.
- [ ] **Step 4: Run** the command, then `pnpm -C apps/api test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): share secret injection, redaction and rate limits`

### Task 5: Secret storage and endpoints in the API

**Files:**
- Modify: `apps/api/src/migrations.ts` (append one migration)
- Create: `apps/api/src/widget-secrets.ts`
- Modify: `apps/api/src/app.ts` (register), `apps/api/src/rooms.ts` (cleanup after save)
- Modify: `apps/api/src/widget-gateway.ts` (export `resolveWidget` returning the manifest `settings` too)
- Test: `apps/api/test/widget-secrets.test.ts`

**Interfaces:**
- Produces: table `widget_secrets (widget_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (widget_id, key))`, no foreign key (same reason as `widget_state`).
- Produces endpoints (dashboard session required, like other routes):
  - `GET /api/v1/widgets/:widgetId/secrets` → `Record<string, boolean>` for every secret key in the instance's manifest.
  - `PUT /api/v1/widgets/:widgetId/secrets/:key` body `{ value: string }` → same map.
  - `DELETE /api/v1/widgets/:widgetId/secrets/:key` → same map.
- Produces: `export function secretValues(db: DatabaseSync, widgetId: string): Map<string, string>` for Task 6.
- Errors: unknown widget → 404 `NOT_FOUND` (`Widget not found`); key not a secret of the instance → 404 `NOT_FOUND`; value not a string, shorter than `SECRET_MIN_LENGTH`, or with control characters → 400 `VALIDATION_ERROR` `The secret must be at least 16 characters without control characters`.
- Consumes: `secretsOf` (Task 4).

- [ ] **Step 1: Failing tests** (use `testApp`, `installPackage`, existing board-save helpers): PUT then GET gives `{ apiKey: true }`; the response never contains the value; PUT with 10 characters → 400 with the message above; PUT for a widget id with no row → 404; a board save that keeps the instance keeps the secret (`GET` still `true`); a board save without the instance deletes the row (`SELECT count(*) FROM widget_secrets` is 0); DELETE gives `{ apiKey: false }`.
- [ ] **Step 2: Run** `pnpm -C apps/api exec vitest run test/widget-secrets.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**: migration (append, never edit released ones); routes in `widget-secrets.ts`; in `saveBoard` add `DELETE FROM widget_secrets WHERE widget_id NOT IN (SELECT id FROM widgets)` next to the `widget_state` cleanup. Values are never written to logs or audit.
- [ ] **Step 4: Run** the command and `pnpm -C apps/api test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): store widget secrets per instance`

### Task 6: Inject and redact secrets in the HTTP gateway

**Files:**
- Modify: `apps/api/src/widget-gateway.ts` (`GatewayContext` gets `secrets: BoundSecret[]`; `http.get`/`http.send` handlers)
- Test: `apps/api/test/widget-gateway.test.ts` (new `describe('secrets')`, local echo server like the existing HTTP tests)

**Interfaces:**
- Consumes: `secretsOf`, `injectSecret`, `redactSecrets` (Task 4); `secretValues` (Task 5); `proxyHttp` unchanged.

Behaviour per call to an origin that has bound secrets: for each binding on that origin, missing value → `ApiError('UPSTREAM_ERROR', 'Secret «<title>» is not set')` before any request (the broker maps it to `UNAVAILABLE` with this message); `QUERY_COLLISION` → `ApiError('INVALID_INPUT', 'The URL already contains the secret parameter "<name>"')`; otherwise inject, call `proxyHttp`, and return the output with `body` and `contentType` passed through `redactSecrets` with all secret values of the instance. Values are read at call time, so a secret set after the session was created works.

- [ ] **Step 1: Failing tests**: echo server returns request headers and URL in the body; with secret set → upstream saw `authorization: Bearer <value>` and the widget's body contains `[REDACTED]` instead of the value; without secret → 502 `UPSTREAM_ERROR` with `Secret «Ключ» is not set` and the echo server got no request; query binding with `?apikey=x` in the widget URL → 400 `INVALID_INPUT`; a call to another approved origin carries no secret.
- [ ] **Step 2: Run** `pnpm -C apps/api exec vitest run test/widget-gateway.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): inject and redact widget secrets in HTTP calls`

### Task 7: Secret bindings in the import review

**Files:**
- Modify: `packages/contracts/src/widget-package.ts` (`PackageInspection.newSecretBindings: BoundSecret[]`)
- Modify: `apps/api/src/widget-packages.ts` (`newSecretBindingsOf(db, manifest)`), `apps/api/src/widget-uploads.ts` (fill it; `commit` returns `[]`)
- Create: `apps/ui/app/widgets/secret-binding.ts`
- Modify: `apps/ui/app/widgets/PackagesDialog.vue`
- Test: `apps/api/test/widget-uploads.test.ts`, `apps/ui/test/secret-binding.test.ts`

**Interfaces:**
- Produces: `export function bindingLine(secret: BoundSecret): string` in `secret-binding.ts`, e.g. `Секрет «Ключ» отправляется на https://a.example (заголовок Authorization)` or `(параметр apikey)`.
- Produces: `newSecretBindingsOf(db, manifest): BoundSecret[]` — bindings whose `canonicalJson({ key, bind })` is absent from every installed version of the package (stored manifests read without re-validation; absent `settings` means none).

- [ ] **Step 1: Failing tests**: first upload of a manifest with one secret → `newSecretBindings` has it; second upload of a new version with the same binding → `[]`; changed `bind.origin` → listed again. Update the existing `toEqual` at `widget-uploads.test.ts:79` with `newSecretBindings: []`. In `secret-binding.test.ts`: `bindingLine` for a header binding and for a query binding gives the two strings above.
- [ ] **Step 2: Run** `pnpm -C apps/api exec vitest run test/widget-uploads.test.ts` and `pnpm -C apps/ui exec vitest run test/secret-binding.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the API part and `bindingLine`. In `PackagesDialog.vue`, show `bindingLine` for every secret in `manifest.settings`, mark the ones in `newSecretBindings` on an update like new origins, and add once: «Сервер может вернуть ключ в ответе; LifeDashboard заменяет точные совпадения на [REDACTED], но изменённые копии скрыть не может».
- [ ] **Step 4: Run** the command and `pnpm -C apps/ui test` — Expected: PASS. Check the dialog in Orca's browser with a test package (`pnpm dev`).
- [ ] **Step 5: Commit** `feat: show secret bindings in the widget import review`

### Task 8: Frame signal and normalized config in the widget context

**Files:**
- Modify: `packages/contracts/src/widget-gateway.ts` (`WidgetContext.frame: 'framed' | 'frameless'`)
- Modify: `apps/ui/app/widgets/context.ts` (source gets `frame: () => 'framed' | 'frameless'`)
- Modify: `apps/ui/app/widgets/catalog.ts` (`describeSource` also returns `settings?: SettingsSchema`)
- Create: `apps/ui/app/widgets/secret-flags.ts`
- Modify: `apps/ui/app/api.ts` (three secret calls), `apps/ui/app/widgets/WidgetHost.vue`
- Test: `apps/ui/test/widget-context.test.ts`, `apps/ui/test/secret-flags.test.ts`

**Interfaces:**
- Produces in `api.ts`: `widgetSecrets(widgetId)`, `setWidgetSecret(widgetId, key, value)`, `clearWidgetSecret(widgetId, key)` → `ApiResult<Record<string, boolean>>`.
- Produces in `secret-flags.ts`: `useSecretFlags(widgetId: () => string | undefined): Ref<ReadonlySet<string>>` (loads once per widget id; empty set without id) and `refreshSecretFlags(widgetId: string, flags: Record<string, boolean>): void` (called by Task 9 after PUT/DELETE so open widgets update).
- `WidgetHost` passes `config: () => normalizeConfig(info.settings, props.config ?? {}, flags.value)` and `frame: () => (props.skin === 'bare' ? 'frameless' : 'framed')`.

- [ ] **Step 1: Failing tests**: context reports `frame: 'frameless'` and switches to `'framed'` when the source changes; `secret-flags` loads `{ apiKey: true }` from a stubbed api into `Set(['apiKey'])` and `refreshSecretFlags` updates it.
- [ ] **Step 2: Run** `pnpm -C apps/ui exec vitest run test/widget-context.test.ts test/secret-flags.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the command and `pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): give widgets a normalized config and the frame signal`

### Task 9: Settings form in the widget settings panel

**Files:**
- Create: `apps/ui/app/board/config-form.ts`, `apps/ui/app/board/WidgetConfigForm.vue`
- Modify: `apps/ui/app/board/WidgetSettings.vue` (renders the form under the appearance controls when the instance has `settings`)
- Modify: `apps/ui/app/board/edit-session.ts` (`setConfig`), `apps/ui/app/board/WidgetBoard.vue` (wire like `setAppearance`)
- Test: `apps/ui/test/edit-session.test.ts`, `apps/ui/test/config-form.test.ts`

**Interfaces:**
- Produces in `config-form.ts` (pure, tested; the component only renders them):
  ```ts
  export type FieldControl = 'text' | 'select' | 'number' | 'checkbox' | 'secret'
  export function controlFor(setting: Setting): FieldControl
  export function parseFieldInput(setting: PlainSetting, raw: string | boolean): { ok: true; value: string | number | boolean } | { ok: false }
  export function plainConfig(schema: SettingsSchema, config: Record<string, unknown>): Record<string, unknown>  // drops secret keys
  export function secretStatusMessage(result: ApiResult<unknown> | null): string | null
  ```
  `secretStatusMessage`: `null` result (no widget id) or 404 → `Сохраните доску, чтобы задать секрет`; 400 → the API message; success → `null`.
- Produces: `export function setConfig(board: ScreenBoard, instanceId: string, config: Record<string, unknown>): ScreenBoard` in `edit-session.ts`, same shape as `setAppearance`.
- `WidgetConfigForm` props `{ schema: SettingsSchema; config: Record<string, unknown>; widgetId: string | null; secrets: ReadonlySet<string> }`, emits `change: [config: Record<string, unknown>]` with plain keys only (`plainConfig`): the booleans `normalizeConfig` adds for secrets are never written back into the stored `config`. Controls: `string` → text input (`maxlength`), with `enum` → select; `number`/`integer` → number input with `min`/`max`/`step` (`1` for integer); `boolean` → checkbox. Invalid input is not emitted (`isValidSettingValue`). Secret → password input plus «Задать» / «Очистить»; status «задан» / «не задан» from `secrets`; calls `setWidgetSecret`/`clearWidgetSecret` immediately, then `refreshSecretFlags`. Without `widgetId` (unsaved instance) or on 404 the secret control is disabled with «Сохраните доску, чтобы задать секрет». A 400 shows the API message.
- Consumes: `normalizeConfig`, `isValidSettingValue` (Tasks 2–3), api calls and `refreshSecretFlags` (Task 8).

- [ ] **Step 1: Failing tests**: `setConfig` replaces only the target instance's `config`, keeps `configVersion` and appearance; `controlFor` gives `select` for a string with `enum`, `number` for `integer`, `secret` for a secret; `parseFieldInput` on an integer setting with `minimum: 1` gives `{ ok: false }` for `'0'` and `'1.5'` and `{ ok: true, value: 3 }` for `'3'`; `plainConfig` drops secret keys; `secretStatusMessage` gives the save hint for `null` and for a 404 failure and the API message for a 400.
- [ ] **Step 2: Run** `pnpm -C apps/ui exec vitest run test/edit-session.test.ts test/config-form.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `setConfig`, the form and the wiring.
- [ ] **Step 4: Run** the command, `pnpm -C apps/ui test`, `pnpm typecheck` — Expected: PASS. In Orca's browser, install a test package with one string, one integer and one secret setting: change values, save the board, reload — values persist; secret shows «задан» and never its value.
- [ ] **Step 5: Commit** `feat(ui): edit widget settings from its schema`

### Task 10: Typed HTTP and documented members in the SDK

**Files:**
- Modify: `packages/contracts/src/widget-gateway.ts` (`GatewayOutputs`)
- Modify: `packages/widget-sdk/src/widget.ts`, `packages/widget-sdk/src/index.ts`
- Modify: `examples/widgets/hermes-tasks/src/api.ts` (`Call` type), `examples/widgets/hermes-tasks/src/use-tasks.ts:42` (use `widget.http`)
- Test: `packages/widget-sdk/test/widget.test.ts`

**Interfaces:**
- Produces on `Widget`:
  ```ts
  http: {
    get(url: string, options?: { accept?: string }): Promise<HttpOutput>
    send(request: HttpSendInput): Promise<HttpOutput>
  }
  call<Op extends GatewayOp>(op: Op, input: GatewayInputs[Op]): Promise<GatewayOutputs[Op]>
  ```
  `GatewayOutputs` in `widget-gateway.ts`: `state.get` → `StateGetOutput`, `state.set` → `StateSetOutput`, `notifications.send` → `{ ok: true }`, `http.get`/`http.send` → `HttpOutput`.
  `call` stays in the runtime for `sdk: 1` widgets (typed now). Re-export `GatewayOp`, `GatewayInputs`, `HttpOutput`, `SettingsSchema`, `SdkLevel` from `index.ts`.
- Every public member gets JSDoc: permission, limits (from the constants, by name), error codes, `@since sdk 2` for new members.

- [ ] **Step 1: Failing tests**: `widget.http.get('https://a.example/x', { accept: 'application/json' })` calls `call('http.get', { url, headers: { accept: 'application/json' } })`; `http.get(url)` sends no `headers` key; `http.send(...)` passes the request through; `call('state.get', {})` still works.
- [ ] **Step 2: Run** `pnpm -C packages/widget-sdk exec vitest run test/widget.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Migrate `hermes-tasks`**: its `Call` type becomes `{ get: Widget['http']['get']; send: Widget['http']['send'] }` (or the narrowest equivalent its `api.ts` needs) and `use-tasks.ts` passes `widget.http`. Run the command, `pnpm -C examples/widgets/hermes-tasks test` and `pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(widget-sdk): typed http helpers and documented widget API`

### Task 11: Build writes the target level; desktop and README fixes

**Files:**
- Modify: `packages/widget-sdk/src/build.ts` (manifest gets `sdk: SDK_TARGET_LEVEL`)
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (`bundle.macOS.minimumSystemVersion: "15.7"`)
- Modify: `README.md` (Security and privacy: permissions `state`, `notifications`, `network`; mention secret settings)
- Modify: `examples/widgets/*/widget.json` (`"sdk": 2` and version `1.0.1`: an installed 1.0.0 with a changed manifest would be refused as `CONFLICT`)
- Test: `packages/widget-sdk/test/build.test.ts`

- [ ] **Step 1: Failing test**: building the `counter` fixture whose `widget.json` says `"sdk": 1` produces `dist/.../widget.json` with `"sdk": 2`.
- [ ] **Step 2: Run** `pnpm -C packages/widget-sdk exec vitest run test/build.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; edit config and README.
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck` at the root — Expected: PASS. Confirm `tauri.conf.json` is valid JSON (`node -e "JSON.parse(require('fs').readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8'))"`).
- [ ] **Step 5: Commit** `feat: build widgets at sdk level 2; set macOS 15.7 minimum`
