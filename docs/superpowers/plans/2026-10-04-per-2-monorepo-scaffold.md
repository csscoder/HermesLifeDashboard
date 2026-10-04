# PER-2 Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable pnpm workspace with a Fastify API (`/health`) and a Nuxt SPA that shows API health through the dev proxy.

**Architecture:** Two workspace packages: `apps/api` (Fastify 5, run directly from `.ts` by Node 24 type stripping in dev, compiled by `tsc` for build) and `apps/ui` (Nuxt 4 SPA, `ssr: false`, explicit imports, static `nuxt generate` build). Both read the API port from one repository-root `.env`. Root scripts fan out with `pnpm -r`.

**Tech Stack:** Node 24 LTS, pnpm 10.30.2, TypeScript 6.0.3, Fastify 5.12.5, Nuxt 4.5.2, Vue 3.5.43, Vitest 5.0.3, pixi.js 8.22.0, gsap 3.15.0, reka-ui 2.10.5.

**Spec:** `docs/superpowers/specs/2026-10-04-per-2-monorepo-scaffold-design.md` (Linear PER-2). Base design: `docs/base-2026-10-04-lifegamehermes-design.md`.

## Global Constraints

- All dependency versions exact: no `^`, `~`, `latest`.
- `typescript@6.0.3` everywhere; TypeScript 7 is rejected (`vue-tsc@3.3.12` incompatibility).
- TypeScript `strict: true` in every package.
- API host is fixed to `127.0.0.1`; port from `LIFEGAME_API_PORT`, default `3001`.
- UI dev server `127.0.0.1:3000`; `ssr: false`; `imports: { autoImport: false }`; `components: false`; no files in a Nuxt `server/` directory.
- Root `.env` is shared by API and UI; variables already in the process environment win over the file.
- User-facing UI strings in Russian; code, comments, commits and docs in English.
- Commit messages: short conventional subject, no attribution trailers.
- No new dependencies beyond the spec's version table.

## Deviations from the spec (for review)

1. **`apps/api/tsconfig.build.json` added.** The spec has one `tsconfig.json` for both typecheck and build, which would leave `test/` un-typechecked. Here `tsconfig.json` (noEmit) covers `src` + `test`; `tsconfig.build.json` emits only `src` to `dist/`.
2. **Empty `LIFEGAME_API_PORT=` is treated as unset** (default `3001`). The spec only defines absent and invalid values; an empty value is common in copied env templates.
3. **Initial UI label «API: проверка…»** is shown until the first `/health` response.

## Review Focus

1. API stopped while the UI is open → page shows «API: недоступен», no uncaught error (Task 2, Step 9).
2. Non-default port in root `.env` → API and proxy both follow it (Task 2, Step 10).
3. `LIFEGAME_API_PORT=` empty, as in a copied template → API starts on `3001` (Task 1, Step 3 test).
4. Port already in use → API logs the error and exits with code 1 instead of hanging (Task 1, Step 11).
5. Ctrl+C on `pnpm dev` → no process keeps listening on 3000/3001 (Task 2, Step 11).

---

### Task 1: Workspace root and Fastify API

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `.nvmrc`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`
- Create: `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): ApiConfig`, `interface ApiConfig { host: '127.0.0.1'; port: number }` in `apps/api/src/config.ts`.
  - `buildApp(options?: { logger?: boolean }): FastifyInstance` in `apps/api/src/app.ts`.
  - HTTP `GET /health` → `200 {"status":"ok"}` on `127.0.0.1:$LIFEGAME_API_PORT` (default 3001).
  - Root scripts `dev`, `build`, `typecheck`, `test` (Task 2 relies on them fanning out to `apps/*`).

- [ ] **Step 1: Create the workspace root files**

`package.json`:

```json
{
  "name": "lifegame",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.2",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "pnpm --parallel -r run dev",
    "build": "pnpm -r run build",
    "typecheck": "pnpm -r run typecheck",
    "test": "pnpm -r --if-present run test"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*

saveExact: true
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

`.gitignore`:

```gitignore
# macOS
.DS_Store

# Dependencies and build output
node_modules/
dist/
.nuxt/
.output/
.data/

# Secrets
.env
.env.*
!.env.example

# Logs
*.log

# Claude Code local settings
.claude/settings.local.json
```

`.env.example`:

```dotenv
# Port of the LifeGame API (Fastify). The UI dev proxy reads the same value.
LIFEGAME_API_PORT=3001
```

`.nvmrc`:

```text
24
```

- [ ] **Step 2: Create the API package and install**

`apps/api/package.json`:

```json
{
  "name": "@lifegame/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch --env-file-if-exists=../../.env src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node --env-file-if-exists=../../.env dist/server.js",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "5.12.5"
  },
  "devDependencies": {
    "@types/node": "24.19.1",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

`apps/api/tsconfig.json` (typecheck: sources and tests, no output):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "rewriteRelativeImportExtensions": true,
    "erasableSyntaxOnly": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`apps/api/tsconfig.build.json` (build: sources only):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

Run: `pnpm install`
Expected: lockfile `pnpm-lock.yaml` created, exit 0. If pnpm prints "Ignored build scripts", note the package names; do not allow them unless a later step fails because of them.

- [ ] **Step 3: Write the failing config test**

`apps/api/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

describe('loadConfig', () => {
  it('defaults to loopback and port 3001', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3001 })
  })

  it('treats an empty LIFEGAME_API_PORT as unset', () => {
    expect(loadConfig({ LIFEGAME_API_PORT: '' })).toEqual({ host: '127.0.0.1', port: 3001 })
  })

  it('reads LIFEGAME_API_PORT', () => {
    expect(loadConfig({ LIFEGAME_API_PORT: '4010' })).toEqual({ host: '127.0.0.1', port: 4010 })
  })

  it.each(['abc', '0', '65536', '3001.5', ' 4010', '-1'])('rejects %j', (value) => {
    expect(() => loadConfig({ LIFEGAME_API_PORT: value })).toThrow(
      `Invalid LIFEGAME_API_PORT: "${value}"`,
    )
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @lifegame/api test`
Expected: FAIL — cannot resolve `../src/config.ts`.

- [ ] **Step 5: Implement `loadConfig`**

`apps/api/src/config.ts`:

```ts
export interface ApiConfig {
  host: '127.0.0.1'
  port: number
}

const DEFAULT_PORT = 3001

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const raw = env.LIFEGAME_API_PORT
  if (raw === undefined || raw === '') return { host: '127.0.0.1', port: DEFAULT_PORT }

  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid LIFEGAME_API_PORT: "${raw}"`)
  }
  return { host: '127.0.0.1', port }
}
```

- [ ] **Step 6: Write the failing health test**

`apps/api/test/health.test.ts`:

```ts
import { expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'

it('GET /health returns status ok', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/health' })

  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({ status: 'ok' })
  await app.close()
})
```

Run: `pnpm --filter @lifegame/api test`
Expected: config tests PASS; health test FAIL — cannot resolve `../src/app.ts`.

- [ ] **Step 7: Implement `buildApp`**

`apps/api/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'

export function buildApp({ logger = false }: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger })
  app.get('/health', async () => ({ status: 'ok' as const }))
  return app
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @lifegame/api test`
Expected: PASS — 10 tests in 2 files (config: 3 named cases + 6 `it.each` cases; health: 1).

- [ ] **Step 9: Implement the server entry point**

`apps/api/src/server.ts`:

```ts
import { buildApp } from './app.ts'
import { type ApiConfig, loadConfig } from './config.ts'

let config: ApiConfig
try {
  config = loadConfig(process.env)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const app = buildApp({ logger: true })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
```

- [ ] **Step 10: Typecheck and build**

Run: `pnpm --filter @lifegame/api typecheck`
Expected: exit 0, no output.

Run: `pnpm --filter @lifegame/api build && ls apps/api/dist`
Expected: `app.js config.js server.js`; `grep "from './app.js'" apps/api/dist/server.js` prints one line (extension rewritten).

- [ ] **Step 11: Manual checks of the running API**

Run in one terminal: `pnpm --filter @lifegame/api dev`
Expected: Fastify log line `Server listening at http://127.0.0.1:3001`.

In another terminal:
- `curl -s http://127.0.0.1:3001/health` → `{"status":"ok"}`.
- `cd apps/api && node src/server.ts; echo "exit=$?"` while the dev server is still running → logged `EADDRINUSE` error, `exit=1`, returns promptly.
- `cd apps/api && LIFEGAME_API_PORT=abc node src/server.ts; echo "exit=$?"` → `Invalid LIFEGAME_API_PORT: "abc"`, `exit=1`.
- `cd apps/api && pnpm start` after the build, with the dev server stopped (Ctrl+C) → listens on 3001; Ctrl+C exits.

Record the outputs for the task report.

- [ ] **Step 12: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore .env.example .nvmrc apps/api
git commit -m "feat(api): scaffold pnpm workspace and Fastify health API"
```

---

### Task 2: Nuxt UI with dev proxy

**Files:**
- Create: `apps/ui/package.json`, `apps/ui/tsconfig.json`, `apps/ui/nuxt.config.ts`, `apps/ui/app/app.vue`
- Create: `README.md`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Consumes: API `GET /health` → `200 {"status":"ok"}` on `127.0.0.1:$LIFEGAME_API_PORT` (Task 1); root scripts from Task 1.
- Produces: UI at `http://127.0.0.1:3000`; dev proxy `/api/*` and `/health` → API; static build in `apps/ui/.output/public`.

- [ ] **Step 1: Create the UI package**

`apps/ui/package.json`:

```json
{
  "name": "@lifegame/ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt generate",
    "typecheck": "nuxt typecheck",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {
    "gsap": "3.15.0",
    "nuxt": "4.5.2",
    "pixi.js": "8.22.0",
    "reka-ui": "2.10.5",
    "vue": "3.5.43"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vue-tsc": "3.3.12"
  }
}
```

`apps/ui/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

- [ ] **Step 2: Create the Nuxt config**

`apps/ui/nuxt.config.ts`:

```ts
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'

// The root .env is shared with the API; variables already set in the environment win.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

const apiOrigin = `http://127.0.0.1:${process.env.LIFEGAME_API_PORT || '3001'}`

export default defineNuxtConfig({
  compatibilityDate: '2026-10-04',
  ssr: false,
  imports: { autoImport: false },
  components: false,
  devServer: { host: '127.0.0.1', port: 3000 },
  typescript: { strict: true },
  nitro: {
    devProxy: {
      '/api': { target: `${apiOrigin}/api`, changeOrigin: true },
      '/health': { target: `${apiOrigin}/health`, changeOrigin: true },
    },
  },
})
```

- [ ] **Step 3: Create the placeholder page**

`apps/ui/app/app.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'

type ApiState = 'checking' | 'ok' | 'unavailable'

const labels: Record<ApiState, string> = {
  checking: 'API: проверка…',
  ok: 'API: работает',
  unavailable: 'API: недоступен',
}

const apiState = ref<ApiState>('checking')

async function isApiHealthy(): Promise<boolean> {
  try {
    const response = await fetch('/health')
    if (!response.ok) return false
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}

onMounted(async () => {
  apiState.value = (await isApiHealthy()) ? 'ok' : 'unavailable'
})
</script>

<template>
  <main>
    <h1>LifeGame</h1>
    <p>{{ labels[apiState] }}</p>
  </main>
</template>
```

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: exit 0; `nuxt prepare` runs in `apps/ui` and creates `apps/ui/.nuxt/`. If pnpm prints "Ignored build scripts", record the names; allow a package in `pnpm-workspace.yaml` under `onlyBuiltDependencies:` only if Step 5–8 fail because its script did not run, and record which failure required it.

- [ ] **Step 5: Verify UI libraries resolve**

Run: `cd apps/ui && node --input-type=module -e "for (const p of ['pixi.js', 'gsap', 'reka-ui']) console.log(import.meta.resolve(p))"`
Expected: three `file://…/node_modules/…` URLs, exit 0.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @lifegame/ui typecheck`
Expected: exit 0, no errors.

Negative check (do not commit): change `const apiState = ref<ApiState>('checking')` to `ref<ApiState>('nope')`, run the typecheck again → TS2322 error in `app/app.vue`; revert the change.

- [ ] **Step 7: Build**

Run: `pnpm --filter @lifegame/ui build`
Expected: exit 0; `apps/ui/.output/public/index.html` exists.

- [ ] **Step 8: Run both apps through the root script**

Run: `pnpm dev`
Expected: API log `Server listening at http://127.0.0.1:3001` and Nuxt `Local: http://127.0.0.1:3000/`.

Then: `curl -s http://127.0.0.1:3000/health` → `{"status":"ok"}` (served by the API through the proxy).
Open `http://127.0.0.1:3000` in a browser → «API: работает».

- [ ] **Step 9: API down while UI is open**

Stop only the API: `kill $(lsof -tiTCP:3001 -sTCP:LISTEN)`. Reload the browser page → «API: недоступен»; browser console shows no uncaught error. Stop `pnpm dev` (Ctrl+C).

- [ ] **Step 10: Non-default port from root `.env`**

Run: `test ! -e .env && printf 'LIFEGAME_API_PORT=4010\n' > .env && pnpm dev`
(If `.env` already exists, stop and ask the user instead of overwriting it.)
Expected: API listens on `127.0.0.1:4010`; `curl -s http://127.0.0.1:3000/health` → `{"status":"ok"}`.
Stop `pnpm dev`, then remove the test file: `rm .env`.

- [ ] **Step 11: No orphan listeners after Ctrl+C**

After stopping `pnpm dev`, run: `lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:4010 -sTCP:LISTEN`
Expected: no output.

- [ ] **Step 12: Write the README**

`README.md`:

````markdown
# LifeGameHermes

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
| `LIFEGAME_API_PORT` | `3001` | API listen port and the UI dev proxy target |

Values from the process environment override the root `.env`.

## Layout

- `apps/api` — Fastify API (`GET /health`).
- `apps/ui` — Nuxt 4 SPA; `/api` and `/health` are proxied to the API in development.
````

- [ ] **Step 13: Commit**

```bash
git add apps/ui pnpm-lock.yaml README.md
git add pnpm-workspace.yaml   # only if Step 4 required onlyBuiltDependencies
git commit -m "feat(ui): scaffold Nuxt SPA with API health via dev proxy"
```

---

### Task 3: Clean-checkout acceptance and task report

**Files:** none changed.

**Interfaces:**
- Consumes: everything committed in Tasks 1–2.
- Produces: the PER-2 task report (in chat; posted to Linear only if the user asks).

- [ ] **Step 1: Verify from a clean clone**

```bash
CLEAN="$(mktemp -d)/lifegame"
git clone --quiet "$(git rev-parse --show-toplevel)" "$CLEAN"
cd "$CLEAN"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0; `pnpm test` reports 10 passed tests in `@lifegame/api`.

- [ ] **Step 2: Check exact versions**

Run: `grep -nE '"[~^]|"latest"' package.json apps/*/package.json`
Expected: no output.

- [ ] **Step 3: Check the strict setting**

Run: `grep -n '"strict": true' tsconfig.base.json && grep -n "strict: true" apps/ui/nuxt.config.ts`
Expected: one match in each file.

- [ ] **Step 4: Write the task report**

Report in chat: what changed, exact commands run with their results (Tasks 1–3), manual checks (Task 1 Step 11, Task 2 Steps 8–11), ignored build scripts and any `onlyBuiltDependencies` decision, deviations (this plan's list), remaining limitations. Ask the user whether to post it to PER-2 and move the issue state.
