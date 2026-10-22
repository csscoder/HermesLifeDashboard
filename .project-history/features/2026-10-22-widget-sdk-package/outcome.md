# Widget SDK: package and build CLI — frozen outcome

Feature ID: widget-sdk-package
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-22T05:24:55Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- source/ is an allow-list: widget.json, package and lock files, tsconfig, AGENTS.md, CLAUDE.md, README, widget-env.d.ts, src/ and test/; dotfiles are never copied (commit f210b1f; fix 3c57251). (evidence: [ev-commits])
- context.config typed from the manifest settings through a generated widget-env.d.ts; the secret key is typed boolean (commit 2548153). (evidence: [ev-commits])
- Publishable @lifedashboard/widget-sdk 0.1.0: publishConfig exports, bin and types; dist/ with index.js, cli.js, types and sandbox.js; contracts bundled; scripts/build.ts and rewrite-declarations.ts (commit 94a17e2). (evidence: [ev-commits])
- ld-widget check: manifest, types through the project's vue-tsc, forbidden-API scan on the TypeScript AST, network origins, media containers, and build (commits 360dd55, c7654ea). (evidence: [ev-commits])
- @lifedashboard/create-widget 0.1.0 scaffold with template and SDK specifier (ba5e50e; test order 2eb8c9e). (evidence: [ev-commits])
- Examples hello and hermes-tasks: WebM source for hello video, tsconfig, typed devDependencies and check script (commit c8c7f0e). (evidence: [ev-commits])

## Accepted decisions
- source/ uses an allow-list, so credentials in dotfiles are never shared in a built folder (spec section 8). (evidence: [ev-spec])
- check runs without a browser; forbidden names and URLs are matched on the TypeScript AST, not in comments or strings (plan Global Constraints; spec section 5). (evidence: [ev-spec], [ev-plan])
- Media rule: an MP4 without a WebM source is an error; audio needs an Opus source (spec section 5). (evidence: [ev-spec])
- Packages version 0.1.0 in lockstep; manifest sdk level stays 2 and is independent of the npm version; @lifedashboard/contracts stays private and is bundled (plan Global Constraints; spec section 1). (evidence: [ev-plan], [ev-spec])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-19-widget-sdk-package.md` → [plan](plan.md)

## Areas and modules
Not recorded.

## Git state
Repository root: .
Branch: main
HEAD commit: 5cecd9dfb0f62024ebe306c36cb42a9d020cfdc5
Describe: 5cecd9d
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [ev-commits].

## Verification
Reported status: unverified.
- Command/check: pnpm -C packages/widget-sdk test && pnpm -C packages/create-widget test && pnpm -r typecheck (plan Tasks 1-5, Step 4 and Step 5 of each task)
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: Pack and consumer test: pnpm pack of both packages, extracted tarball, tsc in an out-of-workspace project (plan Task 3 Step 1 and Task 4 integration)
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: Controller-run check: npm exec --package=<create-widget tgz> -- create-widget demo --sdk <sdk tgz>; npm install; ld-widget check; ld-widget build (plan Task 5 Step 6)
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: pnpm install && ld-widget check in examples/widgets/hello and examples/widgets/hermes-tasks (plan Task 6 Step 3)
  Result: unverified; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
Deviations: not recorded / unverified. No absence claim is made.

## Consciously excluded scope
- Dev shell and dev gateway (plan 2b); docs, AGENTS.md, skill and starter prompt (plan 3); acceptance run (plan 4). (evidence: [ev-plan])
- Publishing to npm and the release pipeline (spec decision 11; plan Global Constraints). (evidence: [ev-spec], [ev-plan])

## Confirmed follow-ups
- Record the plan's test runs, pack test and controller-run create, check and build results. None are recorded in the repository. (evidence: [ev-plan])
- Later commits db9ca19, 47a5682 and 88ec5d5 changed create-widget (title prompt, slug, skill install, AGENTS.md). They belong to plan 3 and are not part of this plan's scope. (evidence: [ev-commits])

## Limitations and unresolved risks
- No code review record exists for this scope. (evidence: [ev-plan])
- Round 5 acceptance runs used create-widget, check and build on all ten runs and passed; that report is not a plan-level check. (evidence: [ev-acceptance-r5])
- The forbidden-API scan covers the listed APIs only. The media check is a container check; codecs are not verified (plan Task 4; spec section 5). (evidence: [ev-plan], [ev-spec])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md
  Approved design dated 2026-10-18. Status line changed to approved in 2d3a66d (2026-10-22); content unchanged since 88378e1. Sections: 1 package shape and distribution; 2 sdk level compatibility; 3 platform gaps (settings, secret settings, typed gateway, frame signal); 4 dev shell and dev gateway; 5 ld-widget check; 6 agent knowledge; 7 runtime baseline; 8 portable built folder. Non-goals include CLI install into a running dashboard, Windows and Linux builds, MCP server, headless browser automation, npm publishing, and new gateway capabilities.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: a3542a858187e1fc37c96251c92af47ebd7b61b46f322dc564830838db73164c
- [ev-plan] file: docs/superpowers/plans/2026-10-19-widget-sdk-package.md
  Plan 2a with 6 tasks: safe source/ allow-list, typed config and generated declaration, publishable SDK package, ld-widget check, create-widget scaffold, examples pass check. Controller-run checks in Task 5 Step 6 and Task 6 Step 3 have no recorded result in the repository.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: eb4d4d7dea53cdfdc62ed0d8b4aed83f5b01b4204219a6be7c91a78e9f2e1c9e
- [ev-commits] session: This archive session, Bash: git log --reverse --format='%h %ad %s' --date=short 159ebc2^..cbd1f33; git grep -n -E 'export function (keepInSource|renderConfigDeclaration|writeConfigDeclaration|scanSource|checkWidget|packageRoot|createWidgetProject|sdkSpecifier)' -- packages; grep of version, private, bin, prepack and publishConfig in packages/widget-sdk/package.json, packages/create-widget/package.json, packages/contracts/package.json; ls of packages/create-widget/template and scripts/build.ts, scripts/rewrite-declarations.ts
  Commits per plan task: Task 1 f210b1f (allow-list source/); Task 2 2548153 (typed config and declaration); Task 3 94a17e2 (publishable package); Task 4 360dd55 with fix c7654ea (ld-widget check); Task 5 ba5e50e with test order fix 2eb8c9e (create-widget); Task 6 c8c7f0e (examples pass check). Fix 3c57251 (keeps .env out of builds, directed check output) falls in the same window. Present in tree: packages/widget-sdk/src/build.ts (keepInSource), config-declaration.ts, check.ts, source-scan.ts, package-root.ts, scripts/build.ts, scripts/rewrite-declarations.ts; packages/create-widget/src/create.ts, cli.ts, template/ (gitignore, widget.json, package.json, tsconfig.json, widget-env.d.ts, AGENTS.md, CLAUDE.md, src/index.vue); publishConfig and version 0.1.0 in widget-sdk package.json; create-widget version 0.1.0. Later commits outside this plan change create-widget: db9ca19, 47a5682, 88ec5d5 (plan 3 scope). No test result recorded in these commits.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-acceptance-r5] file: docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round5-report.md
  Committed acceptance report (plan 4, full rerun on f7ddb99, 2026-10-21): 10 of 10 runs pass the acceptance criteria; every deliverable passed ld-widget check and build and imported on the first attempt; 0 forbidden reads. Runs exercised settings (counter title from settings), typed HTTP with rate limits and recovery, secret settings (UNAVAILABLE before the secret is set, header reaches the server, [REDACTED] in the echo), and framed and frameless widgets. The report lists two open SDK defects before publishing: an unreliable headless screenshot recipe and a false overflow before the first measure. This is an acceptance-run result, not a plan-level test or browser-check result.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 4ce79e6e8d0532e05f0ebdea98a940802f23567ce88c48a618254c7714dddd98

## Source assessment
Shared parent spec (docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md), used by three plans. Its status line read 'Status: draft for approval.' until commit 2d3a66d (2026-10-22, controller change), which sets 'Status: approved (implemented by plans ...)'. The spec text is unchanged since 88378e1 ('apply glm review fixes'), and 2d3a66d changes only that line. The archive uses the file at HEAD 2d3a66d. Plan Widget SDK: package and build CLI links the spec by path and covers section 1 (package shape and distribution), the generated config declaration from section 3, section 5 (check), section 8 (safe source/), and the create part of 'Bootstrapping' (Success and failure section) (plan header lists sections 1, 3 (declaration), 5, 8 and the create part of Bootstrapping). Final plan: the plan has no draft, obsolete or superseded marker. Implementation: the commits and symbols listed in ev-commits exist in the tree at HEAD 2d3a66d. No code review record exists for these changes, and no recorded result exists for the plan's own test or browser-check steps. Archive mode is incomplete-evidence by explicit user request.
Evidence: [ev-spec], [ev-plan], [ev-commits], [ev-acceptance-r5].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- Deviations from plan were not recorded; absence of deviations is not claimed.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
