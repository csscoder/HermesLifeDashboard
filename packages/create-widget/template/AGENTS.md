# LifeDashboard widget

This project is one LifeDashboard widget: the Vue 3 component `src/index.vue` and its manifest `widget.json`.
The output is the folder `dist/<id>-<version>/`, which the user imports.

Docs: `node_modules/@lifedashboard/widget-sdk/docs/index.md`, available after dependencies are installed.
Read it when a rule below is unclear or a task is not covered here.

## Rules behind most failures

- No browser storage (`localStorage`, `sessionStorage`, IndexedDB, cookies). Persist with `widget.state` and declare `state` in `permissions`.
- External HTTP only through `widget.http.get` and `widget.http.send`. Declare `network` in `permissions` and list each origin in `network`.
- Files only from the widget folder. fetch, XHR and WebSocket reach only the widget's own files.
- Media by URL from `assets/`: WebM (VP9 + Opus) for video, Opus for audio. Create `assets/` when you add media.
- Style with `var(--ld-…)` theme tokens only.
- Adapt to `context.size` and `context.sizeClass`. Read `context.frame`.
- Pause animation while `context.visible` is false.
- Object-like widgets (clocks, gauges, stickers) set `"frame": "frameless"` in `widget.json` and draw no card background.
- The widget root fills the frame: give it `height: 100%`. At the `default` size the essential content is visible without scrolling.
- Keep `title` and `id` in `widget.json` as created, unless the user asks to change them.
- Read only this project's files, the SDK docs and the `.d.ts` types. Do not read the compiled files of the SDK: the docs cover the dev shell URL, themes and limits.

## Workflow

1. `npx ld-widget dev`: open the shell at min, default and max size, in every theme, framed and frameless. Without a browser, take headless screenshots as `workflow.md` shows and look at each one.
2. After each change, read `.ld-widget/dev.log` and fix every entry in it.
3. `npx ld-widget check`: fix every problem it reports.
4. `npx ld-widget build`: writes `dist/<id>-<version>/`.
5. Hand over `dist/<id>-<version>/`. The user imports it with «Виджеты → Выбрать папку».
