# Widget SDK: dev shell — frozen outcome

Feature ID: widget-sdk-dev-shell
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-22T05:24:52Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Production rules moved to shared code: sandbox document and CSP (450bd59); gateway checks, rate limits, HTTP proxying, secret checks and error mapping (4932b12); host bridge in the SDK (bac322d). Both hosts call the same functions. (evidence: [ev-commits])
- Dev assets built with the SDK: built-in theme tokens, dev Vue runtime, frame CSS copied from production rules, and the probe for CSP and overflow reports (496060b). (evidence: [ev-commits])
- Dev gateway running the production gateway rules, with secrets read from .env.local as LD_SECRET_<key> (3a3b966); later fixes for rate-limit parity (d92da22) and .env.local problems logged once (7c36ed4, aa28377). (evidence: [ev-commits])
- ld-widget dev: Vite server under /@ld/pkg/, sandbox document with dev additions, dev API, widget.json watch with last-good manifest, and .ld-widget/dev.log (1d8604d); cross-site rejection and terminal-escape stripping (8426c9d); log bounded (9f761bd). (evidence: [ev-commits])
- Dev shell page with frame sized in grid cells, themes, framed and frameless, settings, secret flags, log and URL state (d201f46; 585847c reuses the production theme class). (evidence: [ev-commits])
- Divergence test that fails on any undeclared difference, with DEV_SANDBOX_DIFFERENCES listing six entries (fa3992f). (evidence: [ev-commits])

## Accepted decisions
- Production rules are shared code, not re-implemented in the dev shell. A test fails when dev and production diverge beyond the declared list (plan Global Constraints; spec section 4). (evidence: [ev-spec], [ev-plan])
- Six declared dev-only differences: vue-dev-build, vite-client, probe, hmr-websocket, styles-via-vite, frame-reload (plan Global Constraints). (evidence: [ev-plan])
- Dev runtime feedback goes to the terminal and .ld-widget/dev.log, not a headless browser. Shell state (size, theme, frame) sits in the URL (spec section 4). (evidence: [ev-spec])
- Dev secrets come from .env.local as LD_SECRET_<key>, read on every call; a secret value never appears in the terminal, the log or the shell (plan Global Constraints; spec 'Secret settings'). (evidence: [ev-spec], [ev-plan])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-19-widget-sdk-dev-shell.md` → [plan](plan.md)

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
- Command/check: pnpm -C packages/widget-sdk build && pnpm -C packages/widget-sdk test; dev-parity divergence test (plan Task 8 Step 2)
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: Controller-run tests (*controller-run*): dev-server listen test, echo cases in dev-gateway and widget-gateway, and the performHttp listener cases (plan Tasks 2, 5, 6)
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: Orca built-in browser end-to-end checks 1-9 of the dev shell, including hot reload, full reload, overflow, secrets and .ld-widget/dev.log (plan Task 8 Step 3; the plan asks for a ledger, which is not committed)
  Result: unverified; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
Deviations: not recorded / unverified. No absence claim is made.

## Consciously excluded scope
- Plan 3 items: package docs, full AGENTS.md, skill, starter prompt, README SDK section (plan 2b 'Deferred to other plans'). (evidence: [ev-plan])
- Plan 4 acceptance run (plan 2b 'Deferred to other plans'). (evidence: [ev-plan])
- Spec non-goals: hot reload inside the installed dashboard; headless browser automation (spec decision 8). (evidence: [ev-spec])

## Confirmed follow-ups
- Record the controller-run listen and echo tests and the Orca end-to-end checks. The plan asks for a ledger; no ledger or result is committed. (evidence: [ev-plan])
- The round 5 report lists a false overflow before the first measure as open. Later commits bbf3f7f (overflow probe skips until the frame has a size) and 2c118a4 (ld-widget shot) address it; no later report records a rerun. (evidence: [ev-acceptance-r5], [ev-commits])

## Limitations and unresolved risks
- No code review record exists for this scope. Dev-shell behaviour in Orca and the controller-run tests are unrecorded. (evidence: [ev-plan], [ev-commits])
- The dev shell matches production only within the six declared differences. The divergence test result is unrecorded. (evidence: [ev-plan], [ev-spec])
- Round 5 acceptance runs used the dev shell and passed their criteria, with two open SDK defects named in the report. (evidence: [ev-acceptance-r5])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md
  Approved design dated 2026-10-18. Status line changed to approved in 2d3a66d (2026-10-22); content unchanged since 88378e1. Sections: 1 package shape and distribution; 2 sdk level compatibility; 3 platform gaps (settings, secret settings, typed gateway, frame signal); 4 dev shell and dev gateway; 5 ld-widget check; 6 agent knowledge; 7 runtime baseline; 8 portable built folder. Non-goals include CLI install into a running dashboard, Windows and Linux builds, MCP server, headless browser automation, npm publishing, and new gateway capabilities.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: a3542a858187e1fc37c96251c92af47ebd7b61b46f322dc564830838db73164c
- [ev-plan] file: docs/superpowers/plans/2026-10-19-widget-sdk-dev-shell.md
  Plan 2b with 8 tasks: shared sandbox document, shared gateway core, host bridge in the SDK, dev assets, dev gateway, dev server and ld-widget dev, shell app, divergence test and end-to-end check. Global Constraints declare six dev-only differences. Task 8 Step 3 is an Orca browser run with no recorded result.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 1ead697b6deb70665631824e9470fb1b82307b443bc435993abb11b58502dcee
- [ev-commits] session: This archive session, Bash: git log --reverse --format='%h %ad %s' --date=short 159ebc2^..cbd1f33; git grep -n -E 'export function (createDevGateway|readDevSecrets|startDevServer|createDevLog|createDevApi|parseShellState|createFrameSession|checkGatewayCall|createRateLimiter|widgetFailure|performHttp|secretValueError|extractThemeTokens|overflowReport)|DEV_SANDBOX_DIFFERENCES' -- packages; ls of packages/widget-sdk/src/dev/*, src/host.ts, shell/App.vue, test/dev-parity.test.ts, packages/contracts/src/sandbox-document.ts, widget-http.ts
  Commits per plan task: Task 1 450bd59; Task 2 4932b12; Task 3 bac322d; Task 4 496060b; Task 5 3a3b966; Task 6 1d8604d; Task 7 d201f46 (titled 'add the dev shell page and its state helpers'); Task 8 fa3992f. Fix commits within the plan window: 8426c9d, 585847c, 8664b47, 71f22f6, 2b889cf, 6ec5108, d92da22, 9f761bd, 7c36ed4, fc3e397, aa28377. Present in tree: packages/contracts/src/sandbox-document.ts, widget-http.ts; packages/widget-sdk/src/host.ts, src/dev/gateway.ts, secrets.ts, server.ts (DEV_SANDBOX_DIFFERENCES), log.ts, shell-state.ts, themes.ts, probe.ts, shell/App.vue, test/dev-parity.test.ts. Later commits outside this plan: 4e0d426 (dev shell starts in manifest frame), 2c118a4 (ld-widget shot). No test result recorded in these commits.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-acceptance-r5] file: docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round5-report.md
  Committed acceptance report (plan 4, full rerun on f7ddb99, 2026-10-21): 10 of 10 runs pass the acceptance criteria; every deliverable passed ld-widget check and build and imported on the first attempt; 0 forbidden reads. Runs exercised settings (counter title from settings), typed HTTP with rate limits and recovery, secret settings (UNAVAILABLE before the secret is set, header reaches the server, [REDACTED] in the echo), and framed and frameless widgets. The report lists two open SDK defects before publishing: an unreliable headless screenshot recipe and a false overflow before the first measure. This is an acceptance-run result, not a plan-level test or browser-check result.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 4ce79e6e8d0532e05f0ebdea98a940802f23567ce88c48a618254c7714dddd98

## Source assessment
Shared parent spec (docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md), used by three plans. Its status line read 'Status: draft for approval.' until commit 2d3a66d (2026-10-22, controller change), which sets 'Status: approved (implemented by plans ...)'. The spec text is unchanged since 88378e1 ('apply glm review fixes'), and 2d3a66d changes only that line. The archive uses the file at HEAD 2d3a66d. Plan Widget SDK: dev shell links the spec by path and covers section 4 (dev shell and dev gateway) and the dev part of 'Secret settings' (plan header: 'Spec: ... section 4, plus the dev part of «Secret settings»'). Final plan: the plan has no draft, obsolete or superseded marker. Implementation: the commits and symbols listed in ev-commits exist in the tree at HEAD 2d3a66d. No code review record exists for these changes, and no recorded result exists for the plan's own test or browser-check steps. Archive mode is incomplete-evidence by explicit user request.
Evidence: [ev-spec], [ev-plan], [ev-commits], [ev-acceptance-r5].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- Deviations from plan were not recorded; absence of deviations is not claimed.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
