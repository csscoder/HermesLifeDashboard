# LifeDashboard

Personal AI environment around Hermes Agent: Nuxt UI + Fastify API.
Design: `docs/base-2026-10-04-lifegamehermes-design.md`.

## Requirements

- Node.js 24 LTS (`.nvmrc`)
- pnpm 10.30.2 (`corepack enable` picks it from `packageManager`)

## Setup

```bash
pnpm install
cp .env.example .env   # optional; defaults work without it
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the API (`127.0.0.1:3001`) and the UI (`127.0.0.1:3000`) together |
| `pnpm build` | Compiles the API to `apps/api/dist` and generates the static UI in `apps/ui/.output/public` |
| `pnpm typecheck` | Type-checks all packages |
| `pnpm test` | Runs Vitest suites |

## Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `LIFEDASHBOARD_API_PORT` | `3001` | API listen port and the UI dev proxy target |
| `LIFEDASHBOARD_DATA_DIR` | OS data directory (macOS: `~/Library/Application Support/LifeDashboard`) | Absolute directory of `lifedashboard.db` |
| `LIFEDASHBOARD_UI_ORIGINS` | `http://127.0.0.1:3000` | Comma-separated browser origins allowed to call the API |

Values from the process environment override the root `.env`.

## Pairing

The API prints `LifeDashboard pairing code: NNNNNN` in the `pnpm dev` terminal. Open
`http://127.0.0.1:3000` (not `localhost`, unless it is added to `LIFEDASHBOARD_UI_ORIGINS`) and
enter the code once. A code is valid for 10 minutes; «Новый код» prints a fresh one. The browser
then stays signed in while it is used at least once in 29 days.

## Layout

- `apps/api` — Fastify API: `GET /health`, pairing, rooms and boards, widget packages, widget sessions and the widget gateway in SQLite (`node:sqlite`); sandbox documents under `/sandbox`.
- `packages/contracts` — grid, board, widget package and gateway contracts shared by the API, the UI and the SDK.
- `packages/widget-sdk` — `useWidget()`, the sandbox runtime (`dist/sandbox.js`) and the `ld-widget` CLI.
- `apps/ui` — Nuxt 4 SPA; `/api`, `/health` and `/sandbox` are proxied to the API in development.
- `examples/widgets` — `hello` (state and a notification) and `hostile` (probes the sandbox boundary).

## Widget packages

An installed widget is a Vue SFC packaged as one `*.ldwidget.json` file. It runs in a sandboxed
iframe and reaches data only through the API's widget gateway, with the permissions accepted at
install (`docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md`).

A widget project holds `widget.json` (the manifest: `id`, `version`, `title`, `author`, `sdk`,
`entry`, `styles`, `sizing`, `permissions`) and `src/index.vue`. Build it with `ld-widget build`
(from `@lifedashboard/widget-sdk`):

```bash
pnpm -C examples/widgets/hello build   # → examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json
```

Widget code imports only `vue` and `@lifedashboard/widget-sdk`: `useWidget()` gives `context`
(size, `sizeClass`, theme, `rootFontSize`, config, locale, visibility), `state.get()` /
`state.set(data, expectedRevision)`, `notify({ title, body })` and `call(op, input)`. Style with the
theme's `var(--ld-…)` tokens; UnoCSS classes are not available in the sandbox.

Install: «Виджеты» → «Установить из файла», check the permissions screen, «Установить». Place it
from «Добавить виджет…». A package with widgets on the board cannot be deleted.

`pnpm dev` also rebuilds the sandbox runtime `packages/widget-sdk/dist/sandbox.js`, which the API
serves at `/sandbox/runtime/sdk.js`; `pnpm build` builds it once.
