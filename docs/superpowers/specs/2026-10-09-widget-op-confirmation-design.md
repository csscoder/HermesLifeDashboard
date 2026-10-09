# Widget operation confirmation

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§13.3 Permissions)
- **Builds on:** `docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md`
- **Linear:** GO-4 «Повысить безопасность»
- **Status:** approved design, 2026-10-09

## Goal

Foreign package code must not run a permitted gateway operation on its own. Example: a simple
mail widget must not send or forward a letter the moment it loads. A gateway operation can require
the user's explicit confirmation of the exact call. The server enforces it; the host asks the user
in a dialog outside the widget frame.

Success: with the grant in «Спрашивать» mode, `notifications.send` from a package widget shows a
host dialog; «Отклонить» means no toast and the widget gets `DECLINED`; «Разрешить один раз» runs
exactly that call once. Without the confirmation the API never runs the operation, whatever the
client does.

## Why not a room id

GO-4 proposed that the host attach the room id to every widget request and the gateway reject
requests without it. The host attaches it to every bridged call, including a malicious one, so the
check passes for exactly the calls the ticket wants to stop. Calls that bypass the host are already
impossible: the frame has an opaque origin (`sandbox="allow-scripts"`), its CSP has
`connect-src 'none'`, the dashboard cookie has `Path=/api; SameSite=Strict`, and the
`x-widget-session` token lives only in the host broker. That token is already the unguessable,
host-held identity, bound in the database to widget → screen → room. Room ids are not secret:
`GET /api/v1/rooms` lists them.

A permitted operation is guarded today only by grant, rate limit and audit. Confirmation closes
that gap.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Policy unit | `confirm` per operation in `GATEWAY_OPS`: `never`, `optional`, `always` | Asking on `state.get` would be absurd; future mail needs a confirmation the user cannot switch off |
| User choice | `GrantMode = 'allow' \| 'ask'` per package grant, only for permissions with an `optional` operation | Mirrors browser permissions; the mode belongs to the grant the user approved |
| Where the mode is set | Install screen (default «Спрашивать») and the installed packages list | The user can relax or tighten it without reinstalling |
| Dialog buttons | «Разрешить один раз» and «Отклонить» | «Always allow» lives in the list, not in a prompt the widget can trigger repeatedly |
| Enforcement | Server: the gateway issues and checks single-use confirmations | One place for the policy; a broker bug or another client (in-process widget, future MCP) cannot skip it |
| Existing grants | Migration sets `allow` | The user already approved them; behaviour does not change silently |
| Built-in widgets | Mode `allow`; `always` operations are confirmed for every widget | Build-time code is trusted, but `always` means always |

Not covered: a compromised main document (XSS in the UI) holds the cookie and can answer the
dialog itself. That is the job of a CSP for the UI, a separate task.

## Contracts

`packages/contracts/src/widget-gateway.ts`:

```ts
export type ConfirmPolicy = 'never' | 'optional' | 'always'

export const GATEWAY_OPS = {
  'state.get': { permission: 'state', confirm: 'never' },
  'state.set': { permission: 'state', confirm: 'never' },
  'notifications.send': { permission: 'notifications', confirm: 'optional' },
} as const satisfies Record<string, { permission: WidgetPermission; confirm: ConfirmPolicy }>

/** Permissions with at least one `optional` operation: only these offer a mode. */
export function confirmablePermissions(): WidgetPermission[]
```

`WidgetErrorCode` gains `DECLINED`.

`packages/contracts/src/widget-package.ts`:

```ts
export type GrantMode = 'allow' | 'ask'
export interface Grant { permission: WidgetPermission; mode: GrantMode }
// InstalledPackage.grants: Grant[] (was WidgetPermission[])
```

`WidgetSessionResponse.grants` stays `WidgetPermission[]`: the broker does not need the mode.

`packages/contracts/src/api.ts`: `ErrorCode` gains `CONFIRMATION_REQUIRED` and
`CONFIRMATION_INVALID`; `ErrorEnvelope.error` gains optional `confirmationId: string`.

## Data

Migration 3:

```sql
ALTER TABLE widget_grants ADD COLUMN mode TEXT NOT NULL DEFAULT 'allow';
```

- Install inserts a new grant with `ask` when the permission is confirmable, otherwise `allow`.
  Updating a package keeps the mode of an existing grant (`INSERT OR IGNORE`, as today).
- `PUT /api/v1/widget-packages/:id/grants/:permission`, body `{ mode: 'allow' | 'ask' }`:
  `404 NOT_FOUND` for an unknown package or a permission the package does not hold;
  `400 VALIDATION_ERROR` for another mode or a non-confirmable permission. Returns the package's
  `Grant[]`.
- The install screen installs first (grants come out as `ask`), then sends `PUT` for each
  permission the user switched to «Разрешить». A failed `PUT` leaves the safer `ask`.

## Gateway pipeline

The existing steps stay: dashboard session, widget session, known op, permission, input. Then:

1. **Needs confirmation?** Yes when `confirm === 'always'`, or `confirm === 'optional'` and the
   grant mode is `ask`. The mode is read from `widget_grants` on every call, so a switch in the list
   takes effect at once. Built-in widgets count as `allow`.
2. **No `x-widget-confirmation` header:**
   - the widget session already has an unexpired pending confirmation → `429 RATE_LIMITED`
     «A confirmation is already pending»;
   - otherwise apply the operation's rate limit, store
     `{ id, widgetSession, op, inputHash, expiresAt: now + 2 min }` and answer
     `428 CONFIRMATION_REQUIRED` with `confirmationId`. Audit `CONFIRMATION_REQUIRED`.
3. **With the header:** the id must exist, belong to this widget session, match `op` and
   `sha256(canonicalJson(parsed input))`, and not be expired. On a match delete it (single use),
   skip the rate limit (spent at issue) and run the handler; audit `ok`. Otherwise
   `409 CONFIRMATION_INVALID` and no new confirmation.

`id` is `randomBytes(32).toString('base64url')`. Pending confirmations live in memory beside the
widget sessions; ending or evicting a session drops its confirmation; an API restart drops all.

`DELETE /api/v1/widget-gateway/confirmations/:id` with `x-widget-session`: deletes the pending
confirmation of that session and audits `DECLINED`; an unknown id is a no-op `200`.

## Host UI

All paths are in `apps/ui/app/`.

| File | Change |
| --- | --- |
| `confirmations.ts` (new) | FIFO queue like `toasts.ts`: `requestConfirmation({ source, op, input }): Promise<boolean>`, `cancelConfirmations(source)` |
| `ConfirmDialog.vue` (new) | Modal `<dialog>` in the main document for the queue head: «Виджет «{title}» хочет показать уведомление», a preview of the input (notification title and body), «Разрешить один раз», «Отклонить». Focus starts on «Отклонить»; Esc declines |
| `app.vue` | Mounts `ConfirmDialog` |
| `api.ts` | `428` → `{ kind: 'confirmation-required', confirmationId }`; a `409` with `CONFIRMATION_INVALID` → `{ kind: 'invalid', code, message }`, not `conflict`; `gateway()` takes an optional confirmation id for the header; `declineConfirmation(token, id)`; `setGrantMode(id, permission, mode)` |
| `widgets/broker.ts` | `createGatewayClient` takes `confirm(op, input): Promise<boolean>`. On `confirmation-required`: approved → repeat the call with the header; declined → `declineConfirmation`, throw `DECLINED`. `CONFIRMATION_INVALID` → `DECLINED` «The confirmation expired». `createBridge` uses a 2-minute timeout for operations with `confirm !== 'never'` |
| `widgets/SandboxWidget.vue`, `widgets/WidgetHost.vue` | Pass `confirm` bound to the widget title; teardown and unmount cancel that widget's dialog |
| `widgets/PackagesDialog.vue` | Permission screen: a «Спрашивать каждый раз / Разрешить» switch per confirmable permission, default «Спрашивать»; installed list: the same switch, calling `setGrantMode` |
| `widgets/catalog.ts` | Follows the `Grant[]` shape |

The frame cannot click or read the host dialog (cross-origin). A fake dialog drawn inside the frame
approves nothing.

`BRIDGE_LIMITS` gains `confirmTimeoutMs: 120_000`.

## Error handling

| Situation | Widget sees | Audit |
| --- | --- | --- |
| User declines | `DECLINED` | `CONFIRMATION_REQUIRED`, `DECLINED` |
| Dialog open longer than 2 minutes, then approved | `DECLINED` «The confirmation expired» | `CONFIRMATION_REQUIRED`, `CONFIRMATION_INVALID` |
| Second confirmable call while one is pending | `RATE_LIMITED` | `RATE_LIMITED` |
| Widget unmounted with an open dialog | — (bridge closed) | `CONFIRMATION_REQUIRED` |
| Session expired while the dialog was open | `SESSION_EXPIRED` after the usual single renewal; the new session asks again | as today |

## Documents

- Base design §13.3: the «Операция widget gateway» row mentions the confirmation policy and
  grant mode.
- Sandbox spec: a short «Operation confirmation» section pointing to this spec.

## Testing

TDD with the project's Vitest suites.

- `apps/api/test/widget-gateway.test.ts`: confirmation issued for `ask`; `allow` runs without one;
  single use; bound to input and to the widget session; expiry; one pending per session; decline
  audits and frees the slot; invalid header gives `CONFIRMATION_INVALID` without a new
  confirmation; rate limit spent once; built-in widget is `allow`.
- `apps/api/test/widget-packages.test.ts`: confirmable grant installs as `ask`; non-confirmable as
  `allow`; `PUT` changes the mode and validates; a package update keeps the mode; list returns
  `Grant[]`.
- `apps/api/test/db.test.ts`: migration 3 gives existing grants `allow`.
- `packages/contracts`: `confirmablePermissions()` returns `['notifications']`.
- `apps/ui/test/broker.test.ts`: approve repeats with the header; decline calls
  `declineConfirmation` and throws `DECLINED`; `CONFIRMATION_INVALID` maps to `DECLINED`; long
  timeout for confirmable operations.
- `apps/ui/test/api.test.ts`: `428` and `409 CONFIRMATION_INVALID` mapping.
- `apps/ui/test/confirmations.test.ts` (new): FIFO order, cancel by source.

Browser acceptance in Orca's built-in browser through `orca-cli`:

- install `examples/widgets/hello` keeping «Спрашивать», place it, press «Напомнить» → the host
  dialog shows the notification text; «Отклонить» → no toast; «Разрешить один раз» → one toast;
- switch the grant to «Разрешить» in the list → «Напомнить» shows a toast without a dialog;
- `examples/widgets/hostile` still shows the blocked probes from the sandbox spec.

## Acceptance criteria

1. A package widget's `notifications.send` in «Спрашивать» mode never runs without the user's
   «Разрешить один раз» for that exact input.
2. A confirmation works once, only for its widget session, op and input, and only within 2 minutes.
3. The install screen defaults confirmable permissions to «Спрашивать»; the list switches the
   mode and the switch takes effect on the next call.
4. Grants installed before this change keep working without a dialog.
5. Decline, issue and use of a confirmation appear in `widget_audit`.
