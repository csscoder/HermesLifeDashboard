# PER-2: Monorepo scaffold — Nuxt UI + Fastify API

- **Linear:** [PER-2](https://linear.app/csscoder-hse/issue/PER-2/e11-monorepo-scaffold-nuxt-ui-fastify-api-typescript)
- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§3.1, §3.3, §4.1, §4.3, §13.1, §16 E1)
- **Status:** approved design, 2026-10-04

## Goal

A runnable, empty application skeleton that later E1 tasks (SQLite, auth, contracts) and E2 tasks
(widget board) build on. TypeScript (strict) is the primary language for every package.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Layout | pnpm workspace with `apps/ui` and `apps/api` | Base design §4.1; Fastify is a separate process that will own SQLite (ARCH-02/03) |
| Monorepo tooling | pnpm only (`pnpm -r`, `pnpm --parallel`) | Two packages need no build cache; no Turborepo/Nx |
| TypeScript | `typescript@6.0.3` in all packages | `typescript@7.0.2` breaks `vue-tsc@3.3.12` (`ERR_PACKAGE_PATH_NOT_EXPORTED`, verified 2026-10-04); 6.0.3 type-checks `.vue` correctly. Moving to TS 7 is a separate task once `vue-tsc` supports it |
| API dev runner | `node --watch src/server.ts` via Node 24 native type stripping | No `tsx`/`ts-node` dependency |
| API build | `tsc` to `dist/` with `rewriteRelativeImportExtensions` and `erasableSyntaxOnly` | Source imports use `.ts` extensions so the same files run in Node and compile with `tsc` |
| Nuxt auto-imports | Disabled (`imports: { autoImport: false }`) | Explicit imports keep the §4.3 UI import boundary checkable and prepare for `component` widgets that may import only `vue` and the SDK |
| UI build | `nuxt generate` (static SPA) | Base design §3.1: static frontend, no Nitro server in production |
| Dev proxy | `nitro.devProxy` for `/api` and `/health` | Base design §3.1: UI reaches the API through the dev proxy |
| UI libraries | `pixi.js@8.22.0`, `gsap@3.15.0`, `reka-ui@2.10.5` installed in `apps/ui` | Same versions as the `26_HermesPersonalOS` prototype; first usage comes with E2 tasks |

## Exact versions

Runtime: Node 24 LTS (verified locally: v24.21.0), `packageManager: pnpm@10.30.2`.

| Package | Version | Where |
| --- | --- | --- |
| `fastify` | 5.12.5 | `apps/api` |
| `nuxt` | 4.5.2 | `apps/ui` |
| `vue` | 3.5.43 | `apps/ui` |
| `pixi.js` | 8.22.0 | `apps/ui` |
| `gsap` | 3.15.0 | `apps/ui` |
| `reka-ui` | 2.10.5 | `apps/ui` |
| `typescript` | 6.0.3 | `apps/api`, `apps/ui` (dev) |
| `vue-tsc` | 3.3.12 | `apps/ui` (dev) |
| `vitest` | 5.0.3 | `apps/api` (dev) |
| `@types/node` | 24.19.1 | `apps/api` (dev) |

All versions are exact (no `^`, `~`, `latest`).

## Structure

```text
package.json          # root scripts, packageManager, engines.node >= 24
pnpm-workspace.yaml   # packages: apps/*
tsconfig.base.json    # shared strict compiler options
.gitignore
.env.example          # LIFEGAME_API_PORT=3001
.nvmrc                # 24
README.md             # requirements and commands
apps/api/
  package.json        # @lifegame/api
  tsconfig.json
  src/config.ts       # loadConfig(env): ApiConfig
  src/app.ts          # buildApp(): FastifyInstance
  src/server.ts       # process entry point
  test/config.test.ts
  test/health.test.ts
apps/ui/
  package.json        # @lifegame/ui
  tsconfig.json       # references to Nuxt-generated configs
  nuxt.config.ts
  app/app.vue         # placeholder page
```

`packages/` (contracts, sdk, database, …) is not created in this task; each package appears with its
first real consumer.

## Components

### `apps/api`

- **`src/config.ts`** — `loadConfig(env: NodeJS.ProcessEnv): ApiConfig` where
  `ApiConfig = { host: '127.0.0.1'; port: number }`. `host` is fixed to loopback (base design §13.1)
  and not configurable. `port` comes from `LIFEGAME_API_PORT`, default `3001`. A value that is not an
  integer in `1..65535` throws `Error('Invalid LIFEGAME_API_PORT: "<value>"')`.
- **`src/app.ts`** — `buildApp(): FastifyInstance` registers `GET /health` returning
  `200 { "status": "ok" }`. No private details (base design §11.2). Logger is off in tests.
- **`src/server.ts`** — loads config, builds the app with the Fastify logger enabled, listens on
  `host:port`, closes the app on `SIGINT`/`SIGTERM`. A config error prints the message and exits
  with code 1.
- **Scripts:**
  - `dev`: `node --watch --env-file-if-exists=../../.env src/server.ts`
  - `build`: `tsc -p tsconfig.json` (emits `dist/`, excludes `test/`)
  - `start`: `node --env-file-if-exists=../../.env dist/server.js`
  - `typecheck`: `tsc -p tsconfig.json --noEmit`
  - `test`: `vitest run`

### `apps/ui`

- **`nuxt.config.ts`** — `ssr: false`, `imports: { autoImport: false }`,
  `devServer: { host: '127.0.0.1', port: 3000 }`, `typescript: { strict: true }`,
  `nitro.devProxy` mapping `/api` → `http://127.0.0.1:<port>/api` and
  `/health` → `http://127.0.0.1:<port>/health`, where `<port>` is `LIFEGAME_API_PORT` or `3001`.
  No files in a Nuxt `server/` directory.
- **`app/app.vue`** — on mount requests `/health` and shows «API: работает» on `200` with
  `status: "ok"`, otherwise «API: недоступен». A network error is caught and rendered as
  unavailable; the page never throws.
- **Scripts:** `dev`: `nuxt dev`; `build`: `nuxt generate`; `typecheck`: `nuxt typecheck`;
  `postinstall`: `nuxt prepare`.

### Root

- `dev`: `pnpm --parallel -r run dev`
- `build`: `pnpm -r run build`
- `typecheck`: `pnpm -r run typecheck`
- `test`: `pnpm -r --if-present run test`

If pnpm 10 reports ignored dependency build scripts during install, the required packages are
listed in `onlyBuiltDependencies` in `pnpm-workspace.yaml`; nothing else is allowed to run scripts.

## Error handling

| Condition | Behavior |
| --- | --- |
| API not running while UI is open | UI shows «API: недоступен» |
| Invalid `LIFEGAME_API_PORT` | API exits with code 1 and the message from `loadConfig` |
| Port already in use | Fastify `listen` error is logged; process exits with code 1 |

## Testing

- **Vitest, `apps/api`:**
  - `GET /health` via `app.inject` returns `200` and `{ status: 'ok' }`.
  - `loadConfig({})` returns `{ host: '127.0.0.1', port: 3001 }`.
  - `loadConfig({ LIFEGAME_API_PORT: '4010' })` returns port `4010`.
  - `loadConfig` throws for `'abc'`, `'0'`, `'65536'`, `'3001.5'`.
- **No UI unit tests in this task:** they need `@nuxt/test-utils`, a new dependency outside this scope.
- **Manual verification (recorded in the task report):**
  - `pnpm install` on a clean checkout;
  - `pnpm dev`, then `curl http://127.0.0.1:3000/health` returns the API response through the proxy;
  - the browser page shows «API: работает»; after stopping the API it shows «API: недоступен» on reload;
  - `pnpm typecheck`, `pnpm test`, `pnpm build` pass.

## Acceptance criteria

Same as PER-2:

- Clean `pnpm install` succeeds.
- `pnpm dev` starts UI and API; the UI page shows API health via the dev proxy.
- `pnpm typecheck`, `pnpm test`, `pnpm build` pass.
- TypeScript strict is enabled in all packages.
- `pixi.js`, `gsap`, `reka-ui` are installed in `apps/ui` and resolvable.
- TypeScript version is compatible with `vue-tsc` (TS 6.0.3; TS 7 rejection recorded above).

## Out of scope

SQLite/Drizzle and migrations, auth/pairing, error envelope, `packages/*` (contracts, SDK),
lint, Playwright e2e, production static serving from Fastify, CI, usage of pixi.js/gsap/reka-ui.
