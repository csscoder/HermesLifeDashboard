# Widget Modal Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after the user selects an execution method. Track steps with checkboxes. Do not implement before plan review.

**Goal:** Let installed widgets open Vue application screens in a dashboard modal with the same API/state identity and an automatic caller restart on every close.

**Architecture:** Keep modal components in an optional named `modals` export of the package entry. The sandbox selects and mounts a component locally; only a validated view identifier and JSON props cross the existing authenticated bridge. Dashboard and dev shell reuse one host lifecycle controller, while each modal has its own sandbox/session for the existing widget ID.

**Tech Stack:** TypeScript strict, Vue 3, Nuxt 4, native dialog, MessageChannel, existing Fastify gateway, Vitest and Orca's embedded browser. No dependencies.

**Spec:** [Approved design](../specs/2026-10-23-widget-modals-design.md).

## Global Constraints

- Work in the current checkout. No branches, commits, staging, push or PR. Preserve pre-existing changes, including the `pnpm dev` fix and other uncommitted dashboard work.
- Installed package widgets only. No new permission, backend gateway operation, database migration or package manifest field. API production code stays unchanged.
- Support SDK levels 1–4, `SDK_TARGET_LEVEL = 4`, retain wire version 1.
- Exactly one application modal globally; no nested opens or backdrop dismissal. Close through host ×, Escape or SDK.
- Keep opaque-origin `sandbox="allow-scripts"`, CSP, source/port ownership, secret redaction and per-widget quotas intact.
- View IDs: `^[a-z][a-z0-9-]{0,63}$`; title: 1–80 plain-text characters, default the package title; props: finite JSON object, depth at most 32, encoded size at most 65536 bytes. Preserve the bridge's 131072-byte message limit.
- Allow 10 accepted modal opens per widget per minute, surviving caller remount. Busy/nested/unavailable opens use `UNAVAILABLE`; bad inputs/views use `INVALID_INPUT`; quota uses `RATE_LIMITED`.
- Default window: `min(1120px, viewport width - 48px)` × `min(780px, viewport height - 48px)`.
- After any close of an accepted modal (including one showing an error), restart exactly the caller runtime/session. Preserve board identity/configuration and persisted state. Never resurrect a removed or replaced caller.
- Drain dispatched calls while rejecting new calls during closing; bound waiting with 5000 ms (`API_TIMEOUT_MS` in the dashboard, an equal constant in the dev shell). Report uncertain completion explicitly.
- Follow RED → GREEN → REFACTOR per behavior: every test below is written and seen failing before the code that satisfies it. Characterization tests of existing behavior are marked and may pass immediately. Use existing Vitest and SFC test patterns; browser work uses only Orca.

## Decisions fixed by this plan

- **Open acceptance.** `open` validates, checks quota, reserves the slot and calls `deps.mount(record)`, which resolves once the host dialog shows its loading shell. If `mount` rejects, the reservation is released, the open does not count against the quota, `open` rejects `UNAVAILABLE` and no refresh happens. Once `open` has resolved, every later failure (handshake timeout, missing view in the modal runtime, runtime error, session loss) is shown in the dialog with retry/close; closing it runs the normal finalization, including caller refresh.
- **Caller removal.** `removeCaller(widgetId)` is called only by `WidgetHost` on its own unmount (widget removal, screen/space unmount, logout, app teardown) and when its pinned source/version changes. A `SandboxWidget` unmount caused by a `runtimeVersion` increment never calls it. `removeCaller` during `refreshing` cancels the restart.
- **Escape consumption.** The modal runtime listens to `keydown` on `window` in the bubble phase and forwards `{ t: 'modal-close', reason: 'escape' }` only when `event.key === 'Escape'`, `!event.defaultPrevented` and `!event.isComposing`. Authors consume Escape by calling `event.preventDefault()` in a handler on an element or `document`. Document this rule.
- **Drain deadline.** The dashboard passes `API_TIMEOUT_MS`; the dev shell passes `DEV_MODAL_DRAIN_MS = 5000`, pinned equal to `API_TIMEOUT_MS` by a test.
- **Modal context.** It copies the caller's effective theme, config/settings, locale, secret-set flags and root font size and follows their updates; `visible` follows the dialog/document; `frame: 'frameless'`; `size`/`sizeClass` stay the owner's board geometry.

## Review Focus

- A late close/session response from generation A must not close or refresh generation B; tests in Tasks 3 and 6.
- A permission dialog above a modal must stay actionable, and dismissing it with Escape must not close the application; tests in Tasks 4 and 5 plus live verification.
- Closing during a dispatched write must not mount a fresh caller before the known write settles; a timeout stays an explicit uncertainty notice; tests in Tasks 3 and 8.
- Two placed instances of one package keep their state and restart targets distinct, including after a source change during refresh; tests in Tasks 3 and 6.
- The global 200-session FIFO eviction in `apps/api/src/widget-gateway.ts` may evict one surface's session while the other lives; the broker's existing one-time renewal must recover it without affecting the other surface; test in Task 6.

## File map and sequencing

Contracts: `packages/contracts/src/widget-modal.ts`. Public widget helpers: `packages/widget-sdk/src/modal.ts`. Host lifecycle: `packages/widget-sdk/src/modal-host.ts`, exported through `src/host.ts`. Dashboard dialog and reactive adapter: `apps/ui/app/widgets/WidgetModal.vue` and `apps/ui/app/widgets/modals.ts`. Confirmations stay in `apps/ui/app/confirmations.ts` and `apps/ui/app/ConfirmDialog.vue`.

Reuse existing `SandboxWidget.vue`, `WidgetHost.vue`, `broker.ts`, `shell/App.vue` and the example counter. Tasks run in order 1 → 8; each depends on the Interfaces of the previous ones.

### Task 1: Validated modal protocol and SDK level 4

**Files:** Create `packages/contracts/src/widget-modal.ts`, `packages/contracts/test/widget-modal.test.ts`. Modify `packages/contracts/src/widget-gateway.ts`, `packages/contracts/test/widget-gateway.test.ts`, `packages/contracts/test/widget-package.test.ts`, `packages/widget-sdk/test/build.test.ts:45`, `packages/create-widget/test/create.test.ts:54`.

**Interfaces:**
- Produces from `widget-modal.ts`: recursive `JsonValue`; `ModalOpenInput { view: string; title?: string; props: Record<string, JsonValue> }`; `ModalMount { view: string; props: Record<string, JsonValue> }`; `MODAL_VIEW_PATTERN = /^[a-z][a-z0-9-]{0,63}$/`; `MODAL_LIMITS = { propsBytes: 65536, propsDepth: 32, titleLength: 80, opens: 10, windowMs: 60000 } as const`; `parseModalOpen(input: unknown): ParseResult<ModalOpenInput>`; `parseModalMount(input: unknown): ParseResult<ModalMount>`.
- Produces in `widget-gateway.ts`: `SDK_LEVELS = [1, 2, 3, 4]`, `SDK_TARGET_LEVEL = 4`; `InitMessage.mount?: ModalMount`; `ModalCloseMessage { t: 'modal-close'; reason: 'sdk' | 'escape' }`; `parseSandboxMessage` returns `RequestMessage | ErrorReportMessage | ModalCloseMessage | null`.

- [x] **RED (levels).** In `widget-package.test.ts` change the two newer-SDK cases to `sdk: 5` expecting `'manifest.sdk 5 needs a newer LifeDashboard (this one supports 1–4)'` and add `it('accepts sdk 4')`. Change `build.test.ts:45` to expect `sdk: 4` and `create.test.ts:54` to `sdk: 4`. Run `pnpm -C packages/contracts test test/widget-package.test.ts`; expect FAIL on `supports 1–3` and on rejected `sdk: 4`.
- [x] **GREEN.** Set `SDK_LEVELS = [1, 2, 3, 4]` and `SDK_TARGET_LEVEL = 4`. Rerun; expect PASS.
- [x] **RED (close control).** In `widget-gateway.test.ts` add `it('parses a modal-close control')`: `parseSandboxMessage({ t: 'modal-close', reason: 'sdk' })` and `reason: 'escape'` equal the input; `{ t: 'modal-close', reason: 'other' }`, `{ t: 'modal-close' }` and `{ t: 'modal-close', reason: 'sdk', widgetId: 'x' }` return `null`; existing `req`/`error` cases unchanged. Run `pnpm -C packages/contracts test test/widget-gateway.test.ts`; expect FAIL on the first assertion (returns `null`).
- [x] **GREEN.** Extend `parseSandboxMessage` with exact-key checking (`unknownKey`). Rerun; expect PASS.
- [x] **RED (open input).** In `widget-modal.test.ts` write `describe('parseModalOpen')` with these cases, each asserting `ok` and, for failures, a non-empty `error`:
  - `{ view: 'workspace' }` → `{ view: 'workspace', props: {} }`;
  - views `'a'`, 64-char `'a' + 'b'.repeat(63)` accepted; `''`, `'A'`, `'1a'`, 65 chars, `'__proto__'`, `'constructor'` rejected;
  - titles of 1 and 80 characters accepted; `''`, 81 characters and non-plain text rejected (use `isPlainText`);
  - props encoded at exactly 65536 UTF-8 bytes accepted and 65537 rejected, built with a non-ASCII string (`'й'`);
  - depth 32 accepted, depth 33 rejected;
  - `NaN`, `Infinity`, `undefined`, a function, a `Date`, a `Map`, an object with a non-`Object.prototype` prototype, a cycle and an array at the top level rejected;
  - unknown keys `widgetId`, `url`, `token`, `entry`, `hash` at the top level rejected.
  
  Add `describe('parseModalMount')`: valid view and props accepted, `title` key rejected. Run `pnpm -C packages/contracts test test/widget-modal.test.ts`; expect FAIL: module cannot be resolved.
- [x] **GREEN.** Implement `widget-modal.ts` with `ParseResult`, `byteLength`, `isRecord`, `unknownKey`, `isPlainText` from `parse.ts`. Measure props with `byteLength(JSON.stringify(props))` after the structural walk. Never stringify unsupported values. Rerun; expect PASS.
- [x] **RED (init mount).** If `InitMessage` has a parser, add a test that `mount` passes when valid and makes the message invalid when malformed. Otherwise add a type-level test in `widget-modal.test.ts` building an `InitMessage` with `mount`. Run and see it fail, then add the field. Rerun; expect PASS.
- [x] **Verify.** Run `pnpm -C packages/contracts test`, `pnpm -C packages/contracts typecheck`, `pnpm -C packages/create-widget test`, `pnpm -C packages/widget-sdk test test/build.test.ts`; all PASS.

### Task 2: Widget API and isolated component mounting

**Files:** Create `packages/widget-sdk/src/modal.ts`, `packages/widget-sdk/test/modal.test.ts`, `packages/widget-sdk/test/fixtures/modal/` (same layout as `fixtures/vue-lib`). Modify `src/widget.ts`, `src/index.ts`, `src/sandbox.ts`, `src/env.d.ts`, `src/host.ts`, `src/port-client.ts` only as needed, plus `test/widget.test.ts`, `test/host.test.ts`, `test/build.test.ts`, `test/sandbox-root.test.ts`, `test/pack.test.ts`.

**Interfaces:**
- Consumes: Task 1 `ModalOpenInput`, `ModalMount`, `parseModalOpen`, `parseModalMount`, `MODAL_VIEW_PATTERN`, `ModalCloseMessage`.
- Produces: `interface WidgetModal { open(view: string, options?: { title?: string; props?: Record<string, JsonValue> }): Promise<void>; close(): void }`; `Widget.modal: WidgetModal` (readonly); `createWidget(call: WidgetCall, context: WidgetContext, modal?: WidgetModal): Widget`, where an absent `modal` yields `unavailableModal` (open rejects, close throws, both `WidgetError('UNAVAILABLE')`).
- Produces: `createWidgetModal(call: WidgetCall, options: { views: readonly string[]; surface: 'widget' | 'modal'; sendClose(reason: 'sdk' | 'escape'): void }): WidgetModal`. On `widget`: `open` runs `parseModalOpen`, rejects `INVALID_INPUT` for a view outside `views`, then `call('modal.open', input)`; `close` throws `UNAVAILABLE`. On `modal`: `open` rejects `UNAVAILABLE`; `close` calls `sendClose('sdk')` once (later calls are no-ops).
- Produces: optional bridge dependency `onModalClose(reason: 'sdk' | 'escape'): void` in `createBridge`. Package identity stays in the host closure, never in request input.
- Runtime entry shape: `{ default: Component; modals?: Record<string, Component> }`. With `init.mount`, the runtime revalidates with `parseModalMount`, takes `Object.hasOwn(entry.modals, view)`, and calls `createApp(component, props)`. A missing registry or view reports an error to the host and mounts nothing.

- [x] **RED (unavailable default).** In `widget.test.ts` add `it('exposes an unavailable modal without transport support')`: `await expect(createWidget(call, context).modal.open('x')).rejects.toMatchObject({ code: 'UNAVAILABLE' })`, and `expect(() => widget.modal.close()).toThrow(expect.objectContaining({ code: 'UNAVAILABLE' }))`. Also check that `provideInProcessWidget` gives the same result. Run `pnpm -C packages/widget-sdk test test/widget.test.ts`; expect FAIL (`modal` undefined).
- [x] **GREEN.** Add `modal` to `Widget` and the optional third argument. Rerun; expect PASS.
- [x] **RED (client API).** In `modal.test.ts` over a real `MessageChannel`:
  - `it('sends a validated modal.open and resolves on acceptance')`: one `req` with `op: 'modal.open'` and normalized input; resolves when the host answers `ok`;
  - `it('rejects unknown views locally')`: `INVALID_INPUT`, nothing posted;
  - `it('rejects invalid props locally')`: a function prop gives `INVALID_INPUT`;
  - `it('closes one-way from a modal surface')`: exactly one `{ t: 'modal-close', reason: 'sdk' }`, no pending request left, second `close()` posts nothing;
  - `it('throws UNAVAILABLE on compact close and on modal open')`.
  
  Run `pnpm -C packages/widget-sdk test test/modal.test.ts`; expect FAIL: cannot resolve `../src/modal.ts`.
- [x] **GREEN.** Implement `src/modal.ts` and export `WidgetModal`, `createWidgetModal` from `src/index.ts`. Rerun; expect PASS.
- [x] **RED (bridge control).** In `host.test.ts` add `it('routes modal-close to onModalClose and counts malformed controls')`: a valid control calls `onModalClose('escape')` once; a malformed one counts toward `maxMalformed` and calls nothing; without `onModalClose` a valid control is ignored. Run `pnpm -C packages/widget-sdk test test/host.test.ts`; expect FAIL.
- [x] **GREEN.** Extend `createBridge`. Rerun; expect PASS.
- [x] **RED (runtime mount).** In `sandbox-root.test.ts` add:
  - `it('mounts the selected modal view with its props')`;
  - `it('does not mount the default component in a modal')`;
  - `it('reports a missing registry or view and mounts nothing')`;
  - `it('ignores inherited registry keys')` (`toString`, `__proto__`);
  - `it('forwards unconsumed Escape only')`: dispatching `keydown` `Escape` sends `reason: 'escape'`; with `preventDefault()` in an element handler it sends nothing; `isComposing: true` sends nothing; a compact surface never forwards.
  
  Run `pnpm -C packages/widget-sdk test test/sandbox-root.test.ts`; expect FAIL.
- [x] **GREEN.** Implement mount selection and the Escape listener in `src/sandbox.ts`; wire `widget.modal` with `views = Object.keys(entry.modals ?? {})` (own keys). Rerun; expect PASS.
- [x] **RED (packaging).** Create fixture `fixtures/modal`: an `index.vue` with both `<script>` and `<script setup>`, `export const modals = { workspace: Workspace }`, an imported child component, scoped CSS and an imported asset. In `build.test.ts` add `it('preserves the modals export, imported components, styles and assets')`. It builds the fixture, imports the built ES module, and asserts `typeof mod.default === 'object'`, `Object.keys(mod.modals) === ['workspace']`, CSS that contains the child's style, and the asset file in the output. In `pack.test.ts`, assert that the packed declarations contain `WidgetModal` and `modal: WidgetModal`. Run both; expect FAIL (missing fixture/declaration).
- [x] **GREEN.** Fix only what the build needs. If the existing library build already preserves the named export, the build test turns green with the fixture alone; record that.
- [x] **Verify.** Run `pnpm -C packages/widget-sdk test test/widget.test.ts test/modal.test.ts test/host.test.ts test/build.test.ts test/sandbox-root.test.ts test/pack.test.ts` and `pnpm -C packages/widget-sdk typecheck`; all PASS.

### Task 3: Shared host lifecycle, quota and bounded close

**Files:** Create `packages/widget-sdk/src/modal-host.ts`, `packages/widget-sdk/test/modal-host.test.ts`. Export from `src/host.ts`.

**Interfaces:**
- Consumes: Task 1 `ModalOpenInput`, `MODAL_LIMITS`; `WidgetError` codes.
- Produces: `ModalOwner = { runtimeId: string; widgetId: string; hash: string; packageId: string; version: string; title: string }` (`title` is the package title, the default dialog title).
- Produces: `ModalRecord = { id: string; owner: ModalOwner; input: ModalOpenInput; state: 'open' | 'error' | 'closing' | 'refreshing' }`. `id` is the modal surface ID; the compact surface ID is `owner.runtimeId`.
- Produces: `createModalHost(deps: { mount(record: ModalRecord): Promise<void>; dispose(record: ModalRecord): void; refresh(owner: ModalOwner): Promise<void>; notice(message: string): void; onChange(record: ModalRecord | null): void; drainTimeoutMs: number; now?: () => number })`. It returns:
  - `open(owner, input): Promise<void>`;
  - `fail(surfaceId, message): void`, which moves the current record to `error`;
  - `close(surfaceId): Promise<void>`;
  - `removeCaller(widgetId): void`;
  - `track<T>(surfaceId: string, run: () => Promise<T>): Promise<T>`;
  - `dispose(): void`, for app teardown.
- Rules:
  - `close` acts only on the current record's `id`; stale or foreign IDs are no-ops.
  - `track` rejects `UNAVAILABLE` for either surface of a record in `closing`/`refreshing`.
  - Quota keys are widget IDs. Only opens whose `mount` resolved are counted. The controller lives at app level and survives compact remounts.

- [x] **RED (exactly once).** Using deferred promises and `vi.useFakeTimers()`, write:
  - `it('finalizes a close exactly once')`: an accepted open, then `close(id)` twice concurrently gives `dispose` ×1, `refresh` ×1, `onChange(null)` last;
  - `it('refreshes only after a tracked write settles')`: a write tracked on the compact surface sets `storage.count = 9` after a deferred resolve; close; `refresh` sees `storage.count === 9`.
  
  Run `pnpm -C packages/widget-sdk test test/modal-host.test.ts`; expect FAIL: module cannot be resolved.
- [x] **GREEN.** Implement the record state machine with atomic slot reservation and per-widget accepted-open timestamps. Rerun; expect PASS.
- [x] **RED (acceptance).** Add:
  - `it('rejects a busy or nested open with UNAVAILABLE')`, covering a second widget and the modal's own owner;
  - `it('releases the slot and the quota when mount rejects')`: `open` rejects `UNAVAILABLE`, no refresh, the next open succeeds and the quota count is unchanged;
  - `it('closes an errored modal and refreshes the caller')`: `fail(id, 'x')`, then `close(id)`, gives `refresh` ×1.
  
  Run; expect FAIL on the new cases. Implement. Rerun; expect PASS.
- [x] **RED (quota).** Add `it('allows 10 accepted opens per widget per minute across remounts')`. Open and close ten times for widget `w1`, changing `runtimeId` each time; the 11th open rejects `RATE_LIMITED`; widget `w2` is unaffected; after `vi.advanceTimersByTime(60000)` an open succeeds. Run; expect FAIL. Implement. Rerun; expect PASS.
- [x] **RED (drain).** Add:
  - `it('rejects new tracked calls from both surfaces while closing')`;
  - `it('refreshes after a rejected write')`;
  - `it('notices and refreshes once after the drain deadline')`: a never-settling write, `advanceTimersByTime(drainTimeoutMs)`, `notice` ×1, `refresh` ×1, and a later settle does nothing.
  
  Run; expect FAIL. Implement. Rerun; expect PASS.
- [x] **RED (removal and generations).** Add:
  - `it('removeCaller during mount cancels the open without refresh')`;
  - `it('removeCaller during refreshing cancels the restart')`;
  - `it('ignores a close from an earlier generation')`: close A, open B, then a late `close(A.id)` leaves B open and `refresh` count unchanged;
  - `it('keeps two instances of one package independent')`: `w1` and `w2` with the same `packageId`, and close refreshes only `w1`;
  - `it('dispose cancels pending and mounted modals without refresh')`.
  
  Run; expect FAIL. Implement. Rerun; expect PASS.
- [x] **Verify.** Run `pnpm -C packages/widget-sdk test test/modal-host.test.ts test/host.test.ts` and `pnpm -C packages/widget-sdk typecheck`; all PASS.

### Task 4: Surface-scoped confirmation ownership

**Files:** Modify `apps/ui/app/confirmations.ts`, `apps/ui/app/ConfirmDialog.vue`, `apps/ui/test/confirmations.test.ts`, and the existing `ConfirmDialog` test if present.

**Interfaces:**
- Produces: `ConfirmationRequest.ownerId?: string` (surface ID); `cancelSurfaceConfirmations(ownerId: string): void`. `cancelConfirmations(widgetId)` keeps cancelling every surface of the widget.
- Produces: `ConfirmationRequest.returnFocus?: () => HTMLElement | null`, called after the answer; focus returns there only while the element is connected.

- [x] **RED.** In `confirmations.test.ts` add:
  - `it('cancels only one surface')`: requests from `ownerId: 'c1'` and `'m1'` for widget `w1`; `cancelSurfaceConfirmations('m1')` declines only `m1`;
  - `it('cancels every surface on widget removal')`: `cancelConfirmations('w1')` declines both.
  
  Run `pnpm -C apps/ui test test/confirmations.test.ts`; expect FAIL (`cancelSurfaceConfirmations` is not a function).
- [x] **GREEN.** Implement. Rerun; expect PASS, with existing cases unchanged.
- [x] **RED (stacking).** Add `it('stays above an open application dialog and handles Escape first')`. Render `ConfirmDialog` while a native `<dialog>` is open with `showModal()`. Assert the confirmation is the top layer or receives focus. Escape declines it, and the underlying dialog's `cancel` handler is not invoked. Focus then returns to `returnFocus()` when it is connected and to the stable fallback otherwise. Run; expect FAIL. Implement the minimal `ConfirmDialog.vue` change (for example, open it with `showModal()` after the app dialog and stop Escape propagation). Rerun; expect PASS.
- [x] **Verify.** Run `pnpm -C apps/ui test test/confirmations.test.ts`; all PASS.

### Task 5: Dashboard modal dialog component

**Files:** Create `apps/ui/app/widgets/WidgetModal.vue`, `apps/ui/test/widget-modal-dialog.test.ts`. Use `apps/ui/test/helpers/sfc-renderer.ts`.

**Interfaces:**
- Consumes: Task 3 `ModalRecord`.
- Produces: `WidgetModal.vue` props `{ record: ModalRecord | null; error: string | null }` and emits `close(id: string)`, `retry(id: string)`. The default slot receives the modal `SandboxWidget`. The header shows `owner.title` as the source and `input.title ?? owner.title` as text. The dialog has `aria-labelledby` pointing at the header.

- [x] **RED.** In `widget-modal-dialog.test.ts` add:
  - `it('opens a native modal dialog for a record and closes it for null')`;
  - `it('renders the package source and title as text')`: a title `'<b>x</b>'` shows literally;
  - `it('falls back to the package title')`;
  - `it('emits close once from the close button and from Escape')`: the `cancel` event is prevented and emits `close`;
  - `it('ignores backdrop clicks')`;
  - `it('applies the default dimensions')`: the inline/CSS values are `min(1120px, 100vw - 48px)` and `min(780px, 100vh - 48px)`, the header stays visible and the body flexes;
  - `it('shows loading, then error with retry and close')`;
  - `it('marks the board inert while open and restores it on close')`;
  - `it('moves focus into the dialog on open')`.
  
  Run `pnpm -C apps/ui test test/widget-modal-dialog.test.ts`; expect FAIL: cannot resolve `WidgetModal.vue`.
- [x] **GREEN.** Implement with the project's existing native `<dialog>` pattern and theme tokens. Rerun; expect PASS.
- [x] **Verify.** Run `pnpm -C apps/ui test test/widget-modal-dialog.test.ts` and `pnpm -C apps/ui typecheck`.

### Task 6: Dashboard wiring, surface sessions and caller-only restart

**Files:** Create `apps/ui/app/widgets/modals.ts`, `apps/ui/test/widget-modal-controller.test.ts`. Modify `apps/ui/app/widgets/SandboxWidget.vue`, `apps/ui/app/widgets/WidgetHost.vue`, `apps/ui/app/widgets/broker.ts` only if needed, `apps/ui/app/app.vue`, `apps/ui/test/widget-host.test.ts`, `apps/ui/test/broker.test.ts`, `apps/ui/test/widget-context.test.ts`. Add a characterization test to `apps/api/test/widget-gateway.test.ts`.

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces in `modals.ts`: the app-level controller created with `drainTimeoutMs: API_TIMEOUT_MS`; shallow-reactive `activeModal: ShallowRef<ModalRecord | null>`; `registerCaller(entry: { owner: ModalOwner; context: () => WidgetContext; restart(): Promise<void> }): () => void`; `runtimeVersion(widgetId): number`.
- `WidgetHost` keys its `SandboxWidget` by `hash + ':' + runtimeVersion`. `restart` revalidates the pinned source against the current board widget, then increments the version. `removeCaller(widgetId)` is called per «Decisions fixed by this plan».
- `SandboxWidget` takes optional props `surface: 'widget' | 'modal'`, `surfaceId: string` and `mount?: ModalMount`. It owns its own `GatewayClient` and session, wraps calls in `controller.track(surfaceId, …)`, handles `op === 'modal.open'` locally before `broker.call`, binds `onModalClose` to `controller.close(surfaceId)`, passes `ownerId: surfaceId` to confirmations and calls `cancelSurfaceConfirmations(surfaceId)` and ends its session on unmount.
- `app.vue` mounts one `WidgetModal` that renders a modal `SandboxWidget` for `activeModal`, with the context rules from «Decisions fixed by this plan».

- [x] **Characterization (API, may pass immediately).** In `apps/api/test/widget-gateway.test.ts` add `it('serves two concurrent sessions of one widget with shared state and rate limit')`. Create sessions A and B for one widget. A sets state, B reads the same data and revision, and B's `set` with a stale revision gives `CONFLICT`. Calls from both sessions count toward one per-widget limit. `DELETE` of A keeps B valid. Run `pnpm -C apps/api test test/widget-gateway.test.ts`; record the result. If it fails, stop: that is the spec's narrow API-fix case and needs user input.
- [x] **RED (controller adapter).** In `widget-modal-controller.test.ts` add:
  - `it('opens from a registered caller and exposes activeModal')`;
  - `it('restarts only the caller on close')`: two registered instances; close restarts `w1` only, and the board key is unchanged;
  - `it('does not restart a caller whose source changed')`;
  - `it('does not call removeCaller on a runtimeVersion remount')`;
  - `it('cancels on logout and app unmount')`.
  
  Run `pnpm -C apps/ui test test/widget-modal-controller.test.ts`; expect FAIL: cannot resolve `modals.ts`.
- [x] **GREEN.** Implement `modals.ts`. Rerun; expect PASS.
- [x] **RED (surfaces).** In `widget-host.test.ts` and `broker.test.ts` add:
  - `it('gives the modal surface its own session and keeps tokens host-only')`: two session tokens, and none appears in any posted message;
  - `it('closing the modal ends only the modal session')`;
  - `it('recovers an evicted session on one surface without touching the other')`: the first call gives `SESSION_EXPIRED`, a single renewal follows, and the other surface's token is unchanged;
  - `it('routes modal.open locally and never to the gateway')`;
  - `it('remounts only the caller SandboxWidget on restart')`: a sibling instance and the board are not remounted;
  - `it('returns focus to the new caller iframe, else the board fallback')`.
  
  In `widget-context.test.ts` add `it('copies theme, config, locale, secret flags and root font size to the modal and follows updates')` and `it('keeps modal visible while the caller is offscreen')`. Run these files; expect FAIL on the new cases.
- [x] **GREEN.** Implement `SandboxWidget`, `WidgetHost` and `app.vue` wiring. Reuse the broker; keep API production code unchanged. Guard async session start against unmount. Rerun; expect PASS.
- [x] **Verify.** Run `pnpm -C apps/ui test test/confirmations.test.ts test/widget-modal-dialog.test.ts test/widget-modal-controller.test.ts test/widget-host.test.ts test/broker.test.ts test/widget-context.test.ts`, `pnpm -C apps/ui typecheck`, `pnpm -C apps/api test test/widget-gateway.test.ts`. Record pre-existing failures separately.

### Task 7: Equivalent modal support in the development shell

**Files:** Create `packages/widget-sdk/shell/ModalHost.vue`, `packages/widget-sdk/test/dev-modal.test.ts`. Modify `shell/App.vue`; change `src/dev/shell-state.ts` only if its frame-session abstraction needs a focused extension. Tests: `dev-parity.test.ts`, `shell-state.test.ts`, `dev-assets.test.ts`.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `DEV_MODAL_DRAIN_MS = 5000`, passed as `drainTimeoutMs`. Dev modal calls use the existing `api('call', …)` development gateway. Caller refresh disposes and re-handshakes the compact frame and increments its version; it never calls `api('reset')`.

- [x] **RED.** In `dev-modal.test.ts` add:
  - `it('keeps shared dev state across modal save, close and compact remount')`: the modal writes `{ count: 9 }`, closes, and the new compact frame reads 9 with the next revision;
  - `it('pins DEV_MODAL_DRAIN_MS to API_TIMEOUT_MS')`, importing `API_TIMEOUT_MS` from `apps/ui/app/api.ts` as `test/host.test.ts` already does.
  
  Run `pnpm -C packages/widget-sdk test test/dev-modal.test.ts`; expect FAIL: missing modal support.
- [x] **GREEN.** Implement `ModalHost.vue` and authenticated frame selection with the shared controller. Route reports by registered frame source, not by a single-frame assumption. Rerun; expect PASS.
- [x] **RED (lifecycle).** Add:
  - `it('disposes the modal and its port on HMR or full reload')`;
  - `it('ignores unknown and stale frame messages')`;
  - `it('invalidates the modal before dev reset clears gateway state')`;
  - `it('retains opening quotas across compact refresh')`;
  - `it('cleans up on shell unmount')`.
  
  In `dev-parity.test.ts`, assert that modal support adds no new allowlist entry. Run; expect FAIL. Implement. Rerun; expect PASS.
- [x] **Verify.** Run `pnpm -C packages/widget-sdk test test/dev-modal.test.ts test/dev-parity.test.ts test/shell-state.test.ts test/dev-assets.test.ts`, `pnpm -C packages/widget-sdk typecheck`, `pnpm -C packages/widget-sdk build`; all PASS, including packaged shell assets and declarations.

### Task 8: Working example, documentation and end-to-end evidence

**Files:** Add `examples/widgets/showcase-counter/src/CounterWorkspace.vue`, `examples/widgets/showcase-counter/test/modal.test.ts`. Modify `src/index.vue`, and `src/counter.ts`/`test/counter.test.ts` only to reuse the existing count validation, and `README.md`. Modify SDK `docs-src/api.md`, `runtime.md`, `workflow.md`, `recipes.md`, `index.md`, `errors.md` as relevant; extend `scripts/docs.ts` and `test/docs.test.ts` (key list at line 12) with `MODAL_LIMITS`; regenerate `docs/`. Update the optional-modal guidance in `packages/create-widget/skill/lifedashboard-widget/SKILL.md`, and in template `AGENTS.md`/`CLAUDE.md` only where they describe a single-root runtime. Keep the generated starter widget unchanged.

**Interfaces:** `modals = { workspace: CounterWorkspace }`. The compact button awaits `widget.modal.open('workspace', { title: 'Focus sessions' })` and shows a rejection. The modal:
- reads `{ count }` and the revision;
- shows `config.goal` read-only;
- validates nonnegative safe integers with the existing `createCounter` rules;
- saves with `widget.state.set({ count }, revision)`;
- calls `widget.modal.close()` only after a confirmed save.

On `CONFLICT` it reloads and asks the user to review. Existing compact increment/decrement retry semantics are unchanged.

- [x] **RED.** In `test/modal.test.ts` write:
  - `it('saves the edited count and the fresh counter reads it')`: stateful storage `{ count: 8 }` at revision 2; edit 9 and save; revision 3; `close` called once; a fresh `createCounter` reads 9;
  - `it('refuses malformed persisted state')`;
  - `it('rejects invalid counts')`: `-1`, `1.5` and `2 ** 53`;
  - `it('reloads on CONFLICT without overwriting')`;
  - `it('stays open and reports an unknown save outcome')` for a timeout;
  - `it('ignores repeated save clicks while saving')`;
  - `it('does not close before the write completes')`.
  
  Run `pnpm -C examples/widgets/showcase-counter test test/modal.test.ts`; expect FAIL: cannot resolve `CounterWorkspace.vue`.
- [x] **GREEN.** Implement with existing tokens and accessible controls; no generic form/state abstraction. Rerun; expect PASS.
- [x] **RED (docs).** Add `MODAL_LIMITS` to the `docs.test.ts` key list. Run `pnpm -C packages/widget-sdk test test/docs.test.ts`; expect FAIL. Extend `scripts/docs.ts`, then write the docs-src text. Cover:
  - the full authoring recipe and the named registry;
  - independent memory and ordinary props;
  - shared persistence and permissions;
  - the remount rule and awaiting writes;
  - the close paths and the Escape `preventDefault()` rule;
  - unavailable nested modals, errors and limits, and no return value;
  - viewport sizing through CSS/container queries.
  
  Run `pnpm -C packages/widget-sdk docs`, then the docs test; expect PASS.
- [x] **Verify example.** Run `pnpm -C examples/widgets/showcase-counter test`, `typecheck`, `check`, `build`; all PASS, and the package contains the modal assets.
- [x] **Verify workspace.** Run `pnpm typecheck`, `pnpm test`, `pnpm -C packages/widget-sdk build`, `git diff --check`. The test command must finish; name unrelated failures without repairing them. Review the named files/hunks against the starting dirty checkout.
- [ ] **Live (Orca).** Start `pnpm dev` in an Orca terminal. In Orca's embedded browser, install and place the built example on task-created instances, preserving the user's widgets/data. Verify that save → close → caller remount reads the count back, for ×, SDK close and Escape focused inside the iframe, and that Escape consumed by an in-modal control does not close.
- [ ] **Live matrix.** Verify:
  - two instances and one-modal busy behavior;
  - repeated opening and error/retry;
  - closing during a pending write;
  - caller removal and source change;
  - keyboard focus and confirmation stacking;
  - all three themes, 1280 px width and a short viewport.
  
  Repeat the save/refresh and state-retention flow under `ld-widget dev` on a free port. Inspect screenshots and the console.
- [x] **Review.** Request an independent read-only review of the named changes, resolve substantive in-scope findings, and rerun the affected checks. Record RED/GREEN evidence, commands/results, browser flows, review decisions and unverified limits in this plan. Do not commit or publish.

## Plan self-review

- Spec coverage:
  - authoring/API and compatibility: Tasks 1, 2, 8;
  - identity/security and sessions: Tasks 2, 3, 6;
  - closing/drain/quota: Tasks 3, 6;
  - confirmations: Task 4;
  - dialog/focus/context: Tasks 5, 6;
  - development parity: Task 7;
  - example/docs/live acceptance: Task 8.
- Every behavior change has a RED step before its implementation; the only test allowed to pass at once is the Task 6 API characterization.
- Names are consistent across tasks: `createModalHost`, `ModalOwner`, `ModalRecord`, `track`, `removeCaller(widgetId)`, `fail`, `cancelSurfaceConfirmations`, `DEV_MODAL_DRAIN_MS`, `parseModalOpen`, `parseModalMount`.
- No task needs new dependencies or API production edits; Task 6 stops for user input if the API characterization fails.

## Execution choice and results

The user approved execution with GPT roles in the existing checkout. Tasks 1–7 were implemented and independently reviewed; no open Important/Critical findings were handed to Task 8. No branch, commit, staging, push, PR or publication was performed.

Task 8 implementation and automated verification are complete. The compiled counter workspace tests passed (10 new tests, 24 example tests total), as did example typecheck/check/build, SDK docs generation and docs tests (17), workspace typecheck and the completed workspace test run (2160 tests), SDK build and `git diff --check`. The built example includes modal code/styles and the CounterWorkspace source. Task-only deltas preserve pre-existing README and dashboard edits. See `.superpowers/sdd/2026-10-23-widget-modals/task-8-report.md` for commands, logs and the exact live evidence boundary.

Live Orca verification used independent localhost ports and task-owned SQLite/package data. The real CounterWorkspace in a task-only instrumented package exercised actual SDK/API persistence, caller remount, two instances/global busy, nested rejection, repeated opening/save, pending-write drain, error/retry, caller source replacement/removal, confirmation stacking/native inertness, three themes and 1280×420 sizing. Equivalent dev save/refresh/state retention and source HMR with the existing `--poll` option were verified. Native opaque-iframe input/keyboard and final uninstrumented save paths remain unverified due Orca input behavior; the full live checkboxes remain pending. Controller independent Task 8 code review and final broad scoped re-review are Approved; aggregate native live acceptance remains pending.

Preserved process deviations: Task 6 initially added context/remount/focus tests after implementation; the controller required deletion and fresh reimplementation following genuine RED. A later audit likewise restarted mount/routing/tracking, SDK-close and paused-handshake paths with compiled SFCs and real bridge/message ports. These are documented as deviations and fresh corrections, not first-pass TDD, in `task-6-report.md` and `progress.md`. Task 6's API characterization was an intentional characterization, not an implementation RED. Task 8's native form-submit defect was discovered live, then corrected after a new failing rendered-control activation test. Test harness failures are distinguished from meaningful RED in the Task 8 report.


Task 8 follow-up live evidence: task-only fixture1.0.2 demonstrated successful Retry after a one-shot actual runtime failure (real SDK guard write, host error, rendered Retry, fresh CounterWorkspace, persisted9/rev9 retained). A real state.set committed14/rev10 before its answer was held until the real API AbortSignal deadline; modal showed unknown outcome, one write only, SQLite confirmed14/rev10. Rendered Reload recovered14/rev10; next Save15/rev11 closed/remounted and read back15/rev11. Evidence: `task8-live-unknown-outcome.json`, `task8-live-after-unknown-reload.json`, `task8-recoverable-error.json`, `task8-recoverable-current.json`, and `task8-matrix-results.json` beside the report. Documented `focus @e6` → `inserttext 6` fallback focused the real opaque INPUT but left15 unchanged; before/after snapshots and result are recorded. Native input/Escape/Tab and final uninstrumented acceptance remain unchecked. User tab restored and task-owned services preserved for controller review. Production stayed frozen.

Final review fix wave (2026-10-23): implemented I1/I2 and concrete M1 from `final-review.md` with fresh meaningful RED before each production fix. I1's real `apiRequest`/broker/controller abort-deadline regression initially lost the host notice; the controller now inspects settled `UNAVAILABLE` calls during drain while confirmed `CONFLICT`/`DECLINED` remain no-notice. I2's compiled real dialogs failed confirmation-first and both co-scheduled orders; app-level modal ID coordination now promotes the existing permission dialog after application opening without changing acceptance, queue, arming or return-focus semantics. M1's compiled dev-shell reset rejection left zero frames; generation-checked finalization now restores one fresh compact frame while preserving persisted state and cancelling the modal.

Final fix validation: affected UI tests 37 passed, SDK modal/dev tests 31 passed; affected SDK/UI typechecks, full `pnpm typecheck`, full `pnpm test` (2168 tests/102 files), SDK build, counter example build/check and `git diff --check` passed sequentially. The final typed-fixture confirmation rerun passed all 12 tests. Evidence and self-review: `.superpowers/sdd/2026-10-23-widget-modals/final-fix-report.md` and its named RED/GREEN logs. Production was frozen and the controller notified for reverse-order Orca verification and independent scoped re-review. No API production/dependency/git operation was performed. Native iframe input/Escape/consumed Escape/Tab and final uninstrumented save acceptance remain **UNCHECKED**; no live gate checkbox was changed by this wave.

Controller-requested documentation correction in the same wave: README build-output `widget.json` SDK now says 4; preceding `frame` minimum SDK 3 and all other README content are preserved. Scoped before/after content assertions and `git diff --check` passed; no application retest was needed for the single prose value correction.

Final Task8 live regressions after controller fixes/build freeze: real confirmation first, then modal.open, retained same armed confirmation on top/focused; one trusted native host Escape declined it while app stayed open and second queued confirmation remained focused/unarmed, then actual Allow once succeeded. Real API write committed21/rev12; host× at506.6ms preceded actual5004.7ms AbortSignal deadline. One uncertainty toast appeared, old iframe disconnected, caller remounted, SDK+SQLite read-back21/rev12. Toast at4507.6ms afterclose; closed observed by5014.9ms (tool observation upper bound). Inspected screenshots and exact evidence reside in `task-8-report.md`, `task8-final-*.json/png`, and `task8-matrix-results.json`. Controller reported final root2168/typecheck GREEN. These regressions passed; native opaque-iframe input/Escape/Tab and uninstrumented acceptance remain unchecked.


Final controller status: I1, I2 and M1 are ADDRESSED; final code review is Approved with no new fix-diff findings (`final-fix-review.md`). The final real Orca confirmation-first regression preserved topmost confirmation, native host Escape, queue and arming. Closing before a real API timeout produced exactly one host uncertainty notice, one caller remount and persisted SDK/SQLite read-back21/rev12. Latest automated evidence remains workspace typecheck, completed2168 tests, SDK/example builds and diff check PASS. All63 protected pre-existing files and all16 API production files match the initial snapshot; HEAD/index are unchanged. Native opaque-iframe input/Escape/consumed Escape/Tab and the final uninstrumented installed-example edited-save flow remain unverified due the documented Orca delivery limitation. Both aggregate live checkboxes intentionally remain unchecked. All records remain in this plan workspace; no branch, commit, staging, push, publication or integration was performed.
