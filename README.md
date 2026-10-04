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

Values from the process environment override the root `.env`.

## Layout

- `apps/api` — Fastify API (`GET /health`).
- `apps/ui` — Nuxt 4 SPA; `/api` and `/health` are proxied to the API in development.
