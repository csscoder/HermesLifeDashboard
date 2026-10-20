# Settings

Settings let the user configure a widget without changing its code. Declare them in `widget.json` under `settings`, which needs sdk 2.

## Schema

`settings` is an object schema with `type: "object"`, `properties` and an optional `required` list of setting keys from `properties`.

```json
"settings": {
  "type": "object",
  "properties": {
    "city": { "type": "string", "title": "City", "default": "Berlin", "maxLength": 80 },
    "units": { "type": "string", "title": "Units", "enum": ["metric", "imperial"], "default": "metric" },
    "refreshMinutes": { "type": "integer", "title": "Refresh (minutes)", "minimum": 1, "maximum": 60, "default": 15 },
    "showSeconds": { "type": "boolean", "title": "Show seconds", "default": false },
    "apiKey": { "type": "secret", "title": "API key", "bind": { "origin": "https://api.example.com", "header": "X-Api-Key" } }
  },
  "required": ["city"]
}
```

Limits:

- At most {{SETTINGS_PROPERTIES}} properties. Each key starts with a letter and uses only letters, digits and `_`.
- `title`: 1 to {{TITLE_MAX}} characters of plain text.
- `description`: at most {{SETTINGS_DESCRIPTION_LENGTH}} characters.
- `enum`: 1 to {{SETTINGS_ENUM_ITEMS}} distinct strings, on a `string` setting only.
- `maxLength`: 1 to {{SETTINGS_MAX_LENGTH}}, on a `string` setting only. A string setting without `maxLength` is capped at {{SETTINGS_MAX_LENGTH}} characters.
- `minimum` and `maximum`: finite numbers, on `number` and `integer` settings only. `minimum` must not exceed `maximum`.
- `default`: must satisfy the setting's own type and constraints.

Types: `string`, `number`, `integer`, `boolean` and `secret`.

## Reading settings

`widget.context.config` holds the values, typed from the schema. Missing or invalid values fall back to `default`. `config` is `{}` when the manifest declares no settings.

`widget-env.d.ts` in the project declares the types of `config`. `ld-widget check` and `ld-widget build` regenerate it from `widget.json`. Do not edit it.

## Secret settings

A secret setting holds a credential that the widget must not see.

- `bind` names where the host injects the value: `origin` (one of the manifest `network` origins) and exactly one of `header` (with optional `prefix`) or `query`.
- `origin` must be `https`, or `http` on `127.0.0.1`, `localhost` or `[::1]`.
- `header` names an allowed header. Names the host controls are rejected.
- `prefix` is optional short plain text and is only allowed with `header`.
- The widget reads a secret as a boolean in `config`: `true` when the user has set it, `false` otherwise. The value never reaches the widget.
- A secret value must be at least {{SECRET_MIN_LENGTH}} characters, with no control characters and no surrounding spaces. A header secret uses only Latin-1 characters.
- The host injects the value into HTTP requests to the bound origin. Responses are scanned: an exact or URL-encoded copy of the secret in the body or content type becomes {{REDACTED}}. Other modified copies are not redacted.
- A request that needs a missing secret fails with `UNAVAILABLE`, and the message names the setting. See [errors.md](errors.md).

Two secret settings may not bind the same origin and injection point.
