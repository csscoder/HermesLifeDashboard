# LifeDashboard widget

This project is a Vue widget for LifeDashboard. Edit `src/index.vue` and configure its manifest in `widget.json`.
The API reference is the JSDoc in `node_modules/@lifedashboard/widget-sdk/dist/types`, available after `npm install`.

- Do not use browser storage. Use `widget.state` for persistent state and declare the `state` permission in `widget.json`.
- External HTTP must use widget.http.get/send, with the `network` permission and the origin listed in `network` in `widget.json`.
- fetch/XHR/WebSocket can reach only the widget's own files.
- Store media as WebM/Opus in `assets/`; create that directory when adding media.
- Style the widget with LifeDashboard `var(--ld-…)` theme tokens.

Run `npx ld-widget check`, then `npx ld-widget build`.
Give the user `dist/<id>-<version>/` to import via «Виджеты → Выбрать папку».
