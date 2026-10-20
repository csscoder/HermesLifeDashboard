# LifeDashboard widget SDK

Docs for `@lifedashboard/widget-sdk`, matched to this version. Target `sdk` level: {{SDK_TARGET_LEVEL}}.
Open the page that matches your task:

- [api.md](api.md): `useWidget()`, context fields, `state`, `notify`, `http`, `call`, permissions, limits, `sdk` levels.
- [runtime.md](runtime.md): sandbox, CSP, storage and media rules, runtime baseline, dependencies.
- [errors.md](errors.md): every `WidgetError` code, when it happens and what the widget should do.
- [design.md](design.md): theme tokens, grid sizing, size classes, `rem` and `rootFontSize`, framed vs frameless.
- [settings.md](settings.md): settings schema, secret settings, `REDACTED`.
- [recipes.md](recipes.md): visibility-aware animation, size classes, HTTP retry, revision conflicts.
- [workflow.md](workflow.md): `dev`, `check`, `build`, handover, engine checks.

Exact signatures live in the installed package: `dist/types/widget-sdk/src/index.d.ts` and the files it references under `dist/types/`.
Do not read other files of the package to learn the API.

## Project layout

A widget project is one folder:

```
widget.json          manifest
package.json
tsconfig.json
src/index.vue        the widget component
assets/              media files, only when the widget uses media
AGENTS.md            rules for coding agents
```

## Manifest

`widget.json` example. `ld-widget check` and `build` set `format` and `sdk` (target level {{SDK_TARGET_LEVEL}}), so do not write them:

```json
{
  "id": "com.example.counter",
  "version": "1.0.0",
  "title": "Counter",
  "author": "Example",
  "entry": "index.js",
  "styles": [],
  "sizing": { "default": { "w": 2, "h": 2 }, "min": { "w": 1, "h": 1 }, "max": { "w": 4, "h": 4 } },
  "permissions": ["state"],
  "frame": "framed"
}
```

- `id`, `version` (MAJOR.MINOR.PATCH), `title` and `author`: `title` and `author` are plain text of 1 to {{TITLE_MAX}} characters.
- `permissions`: any of {{PERMISSIONS}}. Declare each permission the code uses.
- `network`: optional HTTP origins, at most {{NETWORK_ORIGINS_MAX}}. A present list needs at least one origin. Only these origins are reachable through `widget.http`.
- `sizing`: `min`, `default` and `max` in grid cells. See [design.md](design.md).
- `settings`: see [settings.md](settings.md).
- `frame`: `framed` (default) or `frameless`; needs sdk 3. See [design.md](design.md).
