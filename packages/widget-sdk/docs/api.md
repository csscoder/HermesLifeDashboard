# API

Exact signatures: `dist/types/widget-sdk/src/index.d.ts` (and `widget.d.ts` next to it). This page lists behavior and limits.

## Access

```ts
import { useWidget } from '@lifedashboard/widget-sdk'
const widget = useWidget() // call inside component setup; throws outside a widget
```

`useWidget()` returns a `Widget` with `context`, `state`, `notify`, `http` and `call`.

## Context

`widget.context` is reactive and read-only. It needs no permission, has no limits and never rejects.

| Field | Meaning |
| --- | --- |
| `size` | `{ w, h }` in grid cells: the current size |
| `sizeClass` | `xs`, `s`, `m`, `l` or `xl`, from the smaller side of `size`. Read it instead of computing a class |
| `frame` | `framed` or `frameless`, the host-selected frame. Since sdk 2 |
| `theme` | `{ id, scheme, tokens }`: `scheme` is `light` or `dark`; `tokens` maps each `--ld-*` name to its resolved value |
| `rootFontSize` | the dashboard's root font size in px, so `rem` in the frame matches the board |
| `config` | the manifest settings, with defaults for missing or invalid values. A secret setting is a boolean: `true` when set |
| `locale` | the dashboard locale |
| `visible` | `false` while the widget is not visible to the user. Pause animation and polling then |

`config` is typed from the settings schema by `widget-env.d.ts`, which `check` and `build` generate. See [settings.md](settings.md).

## state

Requires permission `state`. Persists JSON for this widget instance.

- `widget.state.get<T>()` returns `{ data, revision }`. `data` is `null` before the first write.
- `widget.state.set(data, expectedRevision)` writes and returns `{ revision }`. Pass the revision you read.
- `data` must be JSON of at most 65536 bytes.
- A stale `expectedRevision` rejects with `CONFLICT`. Read again, merge, and retry. See [recipes.md](recipes.md).

## notify

Requires permission `notifications`. `widget.notify({ title, body? })`.

- `title`: 1 to 80 characters.
- `body`: at most 300 characters. Omitted means empty.
- Counts are JavaScript `string.length`.
- The host may ask the user to confirm, depending on the grant mode.
- Web Notifications (`Notification`) do not work in the sandbox. Use `notify`.

## http

Requires permission `network` and an origin listed in the manifest `network` array. Since sdk 2.

- `widget.http.get(url, { accept? })` sends a GET without a confirmation dialog.
- `widget.http.send({ url, method, headers?, body? })` sends `POST`, `PUT`, `PATCH` or `DELETE`. `method` is one of `POST`, `PUT`, `PATCH`, `DELETE`. The host may ask for confirmation.
- Both return `{ status, contentType, body }`. Any HTTP status is a result, including client and server errors. Redirects are not followed; the redirect status is returned.
- Limits: URL at most 2048 characters, with no credentials. Header values at most 200 characters. Widget headers are limited to `accept` (get and send) and `content-type` (send). Request body at most 65536 bytes. Response body at most 102400 bytes. The whole answer at most 122880 bytes of JSON. Upstream deadline 4000 ms.
- Secrets: the host injects bound secrets into the request. A secret value that appears in the response body or content type becomes `[REDACTED]`. See [settings.md](settings.md).

## call

`widget.call(op, input)` calls a gateway operation directly. It is kept for sdk 1 widgets; new code uses the typed members above.

Gateway operations, their permission and their confirmation policy:

| Operation | Permission | Confirmation policy |
| --- | --- | --- |
| `state.get` | `state` | `never` |
| `state.set` | `state` | `never` |
| `notifications.send` | `notifications` | `optional` |
| `http.get` | `network` | `never` |
| `http.send` | `network` | `optional` |

- `never`: never asks the user.
- `optional`: asks the user only when the grant for the permission is `ask`.
- `always`: asks the user on every call.

Rate limits per widget instance:

| Operation | Max calls | Window (ms) |
| --- | --- | --- |
| `state.get` | 120 | 60000 |
| `state.set` | 60 | 60000 |
| `notifications.send` | 10 | 3600000 |
| `http.get` | 120 | 60000 |
| `http.send` | 60 | 60000 |

Calls share the bridge limits:

- A message to or from the host is at most 131072 bytes.
- At most 16 calls in flight. More are rejected with `RATE_LIMITED`.
- A call times out after 10000 ms. A confirmable call (`optional` or `always`) waits up to 250000 ms, because the user may answer the dialog.
- A confirmation dialog expires after 120000 ms. An expired confirmation rejects with `DECLINED`.

Errors are `WidgetError` objects with a `code`. See [errors.md](errors.md).

## sdk levels

`ld-widget check` and `build` write the `sdk` level into the built manifest. It is the target level of this SDK, 3. Do not set `sdk` in `widget.json`. The dashboard supports the levels 1, 2, 3, so folders built with older SDKs keep working.

- Level 1: `context`, `state`, `notify` and `call`.
- Level 2: the settings schema (`settings`), typed HTTP (`http.get`, `http.send`) and `context.frame`.
- Level 3: the manifest `frame` field.
