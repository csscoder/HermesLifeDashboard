# Monorepo scaffold — Nuxt UI + Fastify API (TypeScript) — frozen outcome

Feature ID: PER-2
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-04T07:48:26Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- pnpm workspace root: package.json (packageManager pnpm@10.30.2, engines node >=24, dev/build/typecheck/test fan-out scripts), pnpm-workspace.yaml (apps/*, saveExact), strict tsconfig.base.json, .gitignore, .env.example, .nvmrc. (evidence: [git-implementation-commits], [code-vs-plan-comparison])
- apps/api (@lifedashboard/api): Fastify 5.12.5 GET /health -> {status:'ok'}; loadConfig with fixed 127.0.0.1 host and validated LIFEDASHBOARD_API_PORT (default 3001); server entry with SIGINT/SIGTERM close and exit 1 on config/listen errors; Vitest tests for config and health; tsconfig.json (typecheck src+test) and tsconfig.build.json (emit src). (evidence: [git-implementation-commits], [code-vs-plan-comparison])
- apps/ui (@lifedashboard/ui): Nuxt 4.5.2 SPA (ssr:false, auto-imports and component auto-registration off, telemetry off, dev server 127.0.0.1:3000, nitro.devProxy for /api and /health reading the root .env); app.vue shows API health with a 5 s timeout; pixi.js, gsap, reka-ui installed at exact versions. (evidence: [git-implementation-commits], [code-vs-plan-comparison])
- README.md with requirements, setup, commands, configuration and layout. (evidence: [git-implementation-commits])

## Accepted decisions
- TypeScript pinned to 6.0.3 in all packages: typescript@7.0.2 breaks vue-tsc@3.3.12 (ERR_PACKAGE_PATH_NOT_EXPORTED, checked 2026-10-04 per spec). Moving to TS 7 is a separate task. (evidence: [code-vs-plan-comparison])
- pnpm only (no Turborepo/Nx): two packages need no build cache. API runs .ts directly via Node 24 type stripping (no tsx/ts-node) and builds with tsc using rewriteRelativeImportExtensions + erasableSyntaxOnly. (evidence: [code-vs-plan-comparison])
- Nuxt auto-imports and component auto-registration disabled so the base-design §4.3 UI import boundary stays checkable; UI built with nuxt generate as a static SPA (no Nitro server in production). (evidence: [code-vs-plan-comparison])
- One repository-root .env shared by API (--env-file-if-exists) and UI proxy (process.loadEnvFile); process environment wins over the file. (evidence: [code-vs-plan-comparison])
- Product and env names changed from LifeGame/LIFEGAME_API_PORT/@lifegame/* to LifeDashboard/LIFEDASHBOARD_API_PORT/@lifedashboard/* mid-implementation; spec and plan were updated in the same commit, so the archived documents carry the new names. Rationale not recorded beyond the commit subject. (evidence: [git-implementation-commits])
- Plan-level deviations from the spec accepted after Codex plan review: separate apps/api/tsconfig.build.json so tests are type-checked; initial 'API: проверка…' label; telemetry:false (base design §13.5); 5 s /health timeout (base design §14.3). (evidence: [git-doc-history], [code-vs-plan-comparison])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-04-per-2-monorepo-scaffold-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-04-per-2-monorepo-scaffold.md` → [plan](plan.md)

## Areas and modules
apps/api, apps/ui

## Git state
Repository root: .
Branch: csscoder/feat-widget-builder-add
HEAD commit: 9c5615e10f7a13c68d8ebb7300290b3682e88312
Describe: 9c5615e
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [git-implementation-commits], [code-vs-plan-comparison].

## Verification
Reported status: missing.
- Command/check: pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build (plan Task 3 clean-clone acceptance)
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: Manual: pnpm dev, curl http://127.0.0.1:3000/health via proxy, browser shows API status, API-down/stalled, non-default port, no orphan listeners (plan Task 2 Steps 8-11)
  Result: unverified; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: [git-doc-history].

## Deviations from plan
- Change: Added '/apps/ui/dist' to .gitignore (commit e471a19).
  Reason: Commit subject: ignore generated Nuxt dist symlink.
  Effect: not recorded
  Evidence: [git-implementation-commits].
- Change: No onlyBuiltDependencies entry added to pnpm-workspace.yaml.
  Reason: not recorded
  Effect: not recorded
  Evidence: [code-vs-plan-comparison].

## Consciously excluded scope
- Per spec: SQLite/Drizzle and migrations, auth/pairing, error envelope, packages/* (contracts, SDK), lint, Playwright e2e, production static serving from Fastify, CI, actual usage of pixi.js/gsap/reka-ui; no UI unit tests (@nuxt/test-utils would be a new dependency). (evidence: [code-vs-plan-comparison])

## Confirmed follow-ups
- Move to TypeScript 7 once vue-tsc supports it (spec decision). (evidence: [code-vs-plan-comparison])
- Linear PER-2 still in Backlog with no task report; plan Task 3 report was not found. (evidence: [linear-per-2])

## Limitations and unresolved risks
Not recorded.

## Evidence register
- [git-implementation-commits] session: Current session: git log / git show --stat for 7f082ba, dcf76d4, fc56d56, e471a19 on main (HEAD e471a19, 2026-10-04)
  7f082ba adds workspace root files and apps/api (config, app, server, 2 test files, tsconfig.json + tsconfig.build.json). dcf76d4 renames LifeGame/LIFEGAME_API_PORT/@lifegame to LifeDashboard/LIFEDASHBOARD_API_PORT/@lifedashboard in code, spec, plan and base design. fc56d56 adds apps/ui (package.json, tsconfig.json, nuxt.config.ts, app/app.vue), README.md and lockfile. e471a19 adds /apps/ui/dist to .gitignore ('ignore generated Nuxt dist symlink').
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [code-vs-plan-comparison] session: Current session: read of tracked files at HEAD e471a19 compared with plan Task 1-2 file contents
  config.ts, app.ts, server.ts, config.test.ts, apps/api/package.json, apps/ui/package.json, nuxt.config.ts, app.vue, root package.json and tsconfig.base.json match the plan's code (tsconfig/package JSON differ only in array/object formatting). pnpm-workspace.yaml has no onlyBuiltDependencies. .gitignore has an extra '/apps/ui/dist' line not in the plan.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [git-doc-history] session: Current session: git log -- docs/superpowers/ (f51cae4, ce7ce67, 7045f66, 6a2b516, dcf76d4)
  Spec created f51cae4 and revised ce7ce67 'address Codex review (E0 relation, root .env, components)'. Plan created 7045f66 and revised 6a2b516 'address Codex review (port, timeout, telemetry)'. Only the commit subjects record these reviews; the review reports themselves are not in the repo.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [linear-per-2] session: Current session: orca linear issue PER-2 --comments (workspace f643af3d-0981-453b-9851-48f9aaa1abe6)
  PER-2 'E1.1: Monorepo scaffold — Nuxt UI + Fastify API (TypeScript)', state Backlog, unassigned, 0 comments. No task report posted.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
Both documents name Linear PER-2 and the plan links the spec path. Spec is marked 'approved design, 2026-10-04'; both were revised after Codex review (ce7ce67, 6a2b516) and last edited by dcf76d4 (LifeGame -> LifeDashboard rename applied to code and docs together), so the HEAD versions match the committed code. Implementation commits 7f082ba, dcf76d4, fc56d56, e471a19 are on main (HEAD e471a19); tracked files were compared with the plan's file contents. No test/build/manual-check logs, implementation review or task report are in the repo, and Linear PER-2 is in Backlog with 0 comments, so review and verification are not evidenced. No secrets found: .env is gitignored, .env.example holds only the port.
Evidence: [git-implementation-commits], [code-vs-plan-comparison], [git-doc-history], [linear-per-2].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: No implementation review, test/build logs or task report exist; implementation evidenced by commits only. User authorized incomplete-evidence archive on 2026-10-04.

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
