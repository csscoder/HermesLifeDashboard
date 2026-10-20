---
name: lifedashboard-widget
description: Build or change a LifeDashboard widget in this project and check it before handing the built folder to the user. Use when editing src/index.vue or widget.json, adding permissions or network origins, or preparing dist output for import.
---

# LifeDashboard widget

Use this skill in a `lifedashboard-<slug>/` project. `AGENTS.md` holds the rules; this file holds the steps.

## Steps

1. Edit `src/index.vue` and `widget.json`. Declare every permission and every network origin the code uses.
2. Run `npx ld-widget dev`. Open the dev shell at min, default and max size, in every theme, framed and frameless.
3. After each change, read `.ld-widget/dev.log` and fix every entry it lists.
4. Run `npx ld-widget check` and fix every reported problem.
5. Run `npx ld-widget build`. The output is `dist/<id>-<version>/`.
6. Hand over `dist/<id>-<version>/`. The user imports it with «Виджеты → Выбрать папку».

## Docs

The docs live in `node_modules/@lifedashboard/widget-sdk/docs/`. Open the page that matches the task:

- `index.md`: start here; lists all pages.
- `api.md`: `useWidget()`, context fields, `state`, `notify`, `http`, `call`, permissions and limits, `sdk` levels.
- `runtime.md`: sandbox, CSP, storage and media rules, runtime baseline.
- `errors.md`: what each `WidgetError` code means and what the widget should do.
- `design.md`: theme tokens, grid sizing, size classes, `rootFontSize`, framed vs frameless.
- `settings.md`: settings schema, secret settings, `REDACTED`.
- `recipes.md`: visibility-aware animation, adapting to size class, HTTP retry, revision conflicts.
- `workflow.md`: `dev`, `check`, `build`, handover, and engine checks for media widgets.

If the docs in `node_modules` differ from this skill, the docs win.
