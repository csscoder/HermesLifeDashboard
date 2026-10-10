# LifeDashboard

Product overview, current state, architecture, run instructions and configuration: `README.md`.
The implementation and test suites define current behavior; the README defines product direction.

## Repository

pnpm monorepo, Node.js 24 (`.nvmrc`), pnpm 10.30.2 via Corepack.
TypeScript (strict) is the primary language for all packages.

| Path | Responsibility |
| --- | --- |
| `apps/ui` | Nuxt 4 / Vue 3 SPA: board editor, widgets, appearance, package UI, sandbox host. |
| `apps/api` | Fastify API: authentication, SQLite persistence, package management, widget gateway. |
| `packages/contracts` | Shared TypeScript contracts, validation, grid and package formats. |
| `packages/widget-sdk` | Public widget API, sandbox runtime, `ld-widget` build CLI. |
| `examples/widgets` | Example and security-test widget projects. |
| `docs/theme-contract.md` | Theme token contract and validation rules. |

Commands (repository root): `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm test` (Vitest).
Narrow a run to one package with `pnpm -C <path> <script>`.

## Specs and plans

Active Superpowers specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.
Completed features are archived to `.project-history/features/<date>-<slug>/` (`spec.md`, `plan.md`, `outcome.md`, `metadata.json`).

## Browser

Always use Orca's built-in browser for browser work in this project, including previews,
UI checks, and browser debugging. Control it through `orca-cli`; do not launch an external browser.
