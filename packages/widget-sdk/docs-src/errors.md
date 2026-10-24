# Errors

Every failed call rejects with a `WidgetError`. Its `code` is one of: {{ERROR_CODES}}.

Handle a code with `error.code`. Treat a message as a debugging hint only: its wording can change.

```ts
import { WidgetError } from '@lifedashboard/widget-sdk'

try {
  await widget.http.get(url)
} catch (error) {
  if (error instanceof WidgetError && error.code === 'RATE_LIMITED') {
    // back off, then retry
  }
}
```

Each code below says when it happens and what the widget should do.

### SESSION_EXPIRED

When it happens: the host dropped the widget session, for example after a session token failure.

Widget: call again once. If it fails again, show a message that asks the user to reload the dashboard.

### UNKNOWN_OP

When it happens: `widget.call` names an operation that does not exist. Only untyped callers see it.

Widget: use the operation names in [api.md](api.md), or use the typed members `state`, `notify` and `http` instead.

### PERMISSION_DENIED

When it happens: the operation needs a permission that the manifest `permissions` array does not declare, or the grant was removed.

Widget: add the permission to `widget.json` and rebuild. Do not retry until the grant exists.

### INVALID_INPUT

When it happens: the input breaks a limit or a rule. Examples: a URL longer than the limit or with credentials, a body or state over its byte limit, a header outside the allowed names, a message over the bridge limit, or input that cannot be sent to the host. Modal opens also reject invalid options and unknown views.

Widget: fix the input. Retrying the same input fails again. The limits are in [api.md](api.md).

### RATE_LIMITED

When it happens: the operation exceeded its rate limit, or too many calls are in flight. Accepted modal opens have a per-instance quota that survives caller remount.

Widget: back off before the next call. Do not retry in a loop. The limits are in [api.md](api.md). See [recipes.md](recipes.md) for backoff.

### CONFLICT

When it happens: `state.set` used a revision that is no longer current, because the state changed after it was read.

Widget: read the state again. For a form, ask the user to review the reloaded value before saving; for an atomic action, apply the change to the new data and write with the new revision. See [recipes.md](recipes.md).

### TIMEOUT

When it happens: the host did not answer within the bridge deadline. A confirmable call uses the longer confirmation deadline.

Widget: for a read, retry later with backoff. For `state.set`, read the state again before writing, because the write may have happened.

### BRIDGE_CLOSED

When it happens: the host closes the bridge. Pending and subsequent bridge calls reject with this code. If the connection disappears without a close message, a pending call ends with `TIMEOUT`.

Widget: stop calling. Do not retry in a loop; the widget must be mounted again.

### UNAVAILABLE

When it happens: a modal is already open, a nested modal is requested, the host lacks modal support, or the upstream request failed. Examples: the upstream timed out, the host is unreachable, the response is over its byte limit, or a bound secret is missing. The message names the missing setting when a secret is missing.

Widget: if the message names a setting, tell the user to set it in the widget settings. Otherwise back off and retry later.

### DECLINED

When it happens: the user declined the confirmation dialog, the confirmation expired, or the widget was closed while the call waited.

Widget: do not repeat the call automatically. Tell the user that the action did not happen, and let the user start it again.
