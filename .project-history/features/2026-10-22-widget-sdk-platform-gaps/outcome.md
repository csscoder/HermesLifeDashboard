# Widget SDK: platform gaps — frozen outcome

Feature ID: widget-sdk-platform-gaps
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-22T05:24:50Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- sdk protocol levels 1 and 2 accepted by the manifest parser, and ld-widget build writes sdk 2 (commits aed5132, cabd8cb). (evidence: [ev-commits])
- Manifest settings schema with secret bindings parsed by hand-written parser; normalizeConfig gives widgets a complete, valid config and a boolean for each secret (commits e33d3fa, 48eb357). (evidence: [ev-commits])
- Shared secret injection, echo redaction and RATE_LIMITS in contracts (commit 21cd676); per-instance secret storage with GET, PUT and DELETE endpoints in apps/api/src/widget-secrets.ts (commit e0059f3). (evidence: [ev-commits])
- Secret injection into HTTP calls and redaction of literal echoes in the API gateway (commits 1dade32, 1b0a9ae). (evidence: [ev-commits])
- Secret bindings shown in the widget import review (commit 1c1a9db); context.frame and normalized config in WidgetHost (commit be9eb9d); settings form in the widget settings panel (commit 225f8ed). (evidence: [ev-commits])
- Typed widget.http.get and widget.http.send with JSDoc, documented in the SDK (commits 5cd58d2, 2f03546); macOS minimumSystemVersion 15.7 (commit cabd8cb). (evidence: [ev-commits])

## Accepted decisions
- Widgets never receive a secret value; context.config carries a boolean for each secret key. The API adds the secret to requests to the bound origin only (spec section 3). (evidence: [ev-spec])
- A secret is bound to one origin from the manifest network list and to one injection point (header or query). Secret origins must be https, or http on loopback (spec section 3). (evidence: [ev-spec])
- Manifest sdk is the runtime protocol level. Dashboards accept 1 and 2; new members need level 2; no capability flags (spec section 2). (evidence: [ev-spec])
- Settings are a self-contained JSON Schema subset without $ref, nesting, arrays or formats; the defaults must satisfy every declared constraint (spec section 3, plan Global Constraints). (evidence: [ev-spec], [ev-plan])
- The frame signal is derived from the bare theme; no pixel size is added, because the iframe viewport is the widget box (spec section 3). (evidence: [ev-spec])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-18-widget-sdk-platform-gaps.md` → [plan](plan.md)

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
- Command/check: Per-task vitest runs and 'pnpm test && pnpm -r typecheck' (plan Tasks 1-11, Step 2 and Step 4 of each task)
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: Orca built-in browser checks of the settings form, save and reload, and secret status (plan Task 7 Step 4, Task 9 Step 4)
  Result: unverified; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
Deviations: not recorded / unverified. No absence claim is made.

## Consciously excluded scope
- Dev shell, dev gateway, package and publish shape, ld-widget check, create-widget, agent docs and acceptance run (plans 2a, 2b, 3, 4 per the plan's series note). (evidence: [ev-plan])
- Spec non-goals: CLI install into a running dashboard, Windows and Linux builds, MCP server, marketplace, headless browser automation. (evidence: [ev-spec])

## Confirmed follow-ups
- Record results of the plan's per-task test runs and the Orca browser checks for settings and secrets. No result is recorded in the repository. (evidence: [ev-plan])

## Limitations and unresolved risks
- Secret redaction covers literal echoes only. A server that transforms the secret can still expose it to the widget; the spec accepts this and the import review shows it. (evidence: [ev-spec])
- No code review record exists for this scope. Manual browser checks for the settings and secret UI are unrecorded. (evidence: [ev-plan], [ev-commits])
- The tree accepts sdk levels 1 to 3 (bed22eb, 2026-10-20), so the plan's 'sdk levels 1 and 2' rule is no longer the complete accepted set. (evidence: [ev-commits])
- Acceptance round 5 exercised these features end to end on f7ddb99 and passed; that report is not a plan-level check. (evidence: [ev-acceptance-r5])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md
  Approved design dated 2026-10-18. Status line changed to approved in 2d3a66d (2026-10-22); content unchanged since 88378e1. Sections: 1 package shape and distribution; 2 sdk level compatibility; 3 platform gaps (settings, secret settings, typed gateway, frame signal); 4 dev shell and dev gateway; 5 ld-widget check; 6 agent knowledge; 7 runtime baseline; 8 portable built folder. Non-goals include CLI install into a running dashboard, Windows and Linux builds, MCP server, headless browser automation, npm publishing, and new gateway capabilities.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: a3542a858187e1fc37c96251c92af47ebd7b61b46f322dc564830838db73164c
- [ev-plan] file: docs/superpowers/plans/2026-10-18-widget-sdk-platform-gaps.md
  Plan 1 of 4 with 11 tasks: sdk levels, settings schema, normalizeConfig, shared secret injection and redaction, secret storage endpoints, HTTP secret injection, import review bindings, frame signal and normalized config, settings form, typed SDK HTTP, build level 2 and macOS 15.7 minimum. Each task has failing tests, implementation and a commit message. Global Constraints list the secret rules. Manual Orca checks in Tasks 7 and 9 have no recorded result.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: cbe87b9736bfe04a0ad348fb57c1117f7268c8df4a4e15d47342ae4f8ef3e046
- [ev-commits] session: This archive session, Bash: git log --reverse --format='%h %ad %s' --date=short 159ebc2^..cbd1f33; git show --stat --format='%h %s' bed22eb; git grep -n -E 'SDK_LEVELS = |export function (normalizeConfig|parseSettingsSchema|injectSecret|redactSecrets)|export const RATE_LIMITS' -- packages apps; git grep -n minimumSystemVersion -- apps/desktop/src-tauri/tauri.conf.json; ls of the named widget-settings, widget-secrets, widget-secrets routes, secret-binding, secret-flags and config-form files
  Commits per plan task: Task 1 aed5132; Task 2 e33d3fa; Task 3 48eb357; Task 4 21cd676; Task 5 e0059f3; Task 6 1dade32 with fix 1b0a9ae; Task 7 1c1a9db; Task 8 be9eb9d; Task 9 225f8ed; Task 10 5cd58d2 with docs fix 2f03546; Task 11 cabd8cb; review fixes f12e0e2 and a5b5c23 ('close final review findings for widget settings and secrets'). Present in tree: packages/contracts/src/widget-settings.ts, widget-secrets.ts; RATE_LIMITS in packages/contracts/src/widget-gateway.ts; apps/api/src/widget-secrets.ts (table widget_secrets in apps/api/src/migrations.ts); apps/ui/app/widgets/secret-binding.ts, secret-flags.ts; apps/ui/app/board/config-form.ts; minimumSystemVersion 15.7 in tauri.conf.json. Deviation from plan text, from a later commit: SDK_LEVELS is [1, 2, 3] in widget-gateway.ts (line 339), added by bed22eb (2026-10-20, frame field at sdk 3). No test results recorded in these commits.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-acceptance-r5] file: docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round5-report.md
  Committed acceptance report (plan 4, full rerun on f7ddb99, 2026-10-21): 10 of 10 runs pass the acceptance criteria; every deliverable passed ld-widget check and build and imported on the first attempt; 0 forbidden reads. Runs exercised settings (counter title from settings), typed HTTP with rate limits and recovery, secret settings (UNAVAILABLE before the secret is set, header reaches the server, [REDACTED] in the echo), and framed and frameless widgets. The report lists two open SDK defects before publishing: an unreliable headless screenshot recipe and a false overflow before the first measure. This is an acceptance-run result, not a plan-level test or browser-check result.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 4ce79e6e8d0532e05f0ebdea98a940802f23567ce88c48a618254c7714dddd98

## Source assessment
Shared parent spec (docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md), used by three plans. Its status line read 'Status: draft for approval.' until commit 2d3a66d (2026-10-22, controller change), which sets 'Status: approved (implemented by plans ...)'. The spec text is unchanged since 88378e1 ('apply glm review fixes'), and 2d3a66d changes only that line. The archive uses the file at HEAD 2d3a66d. Plan Widget SDK: platform gaps links the spec by path and covers sections 2 and 3 and the Constraints section (the plan header names 'sections 2, 3; Constraints') (plan header: 'Spec: ... (sections 2, 3; Constraints)'). Final plan: the plan has no draft, obsolete or superseded marker. Implementation: the commits and symbols listed in ev-commits exist in the tree at HEAD 2d3a66d. No code review record exists for these changes, and no recorded result exists for the plan's own test or browser-check steps. Archive mode is incomplete-evidence by explicit user request.
Evidence: [ev-spec], [ev-plan], [ev-commits], [ev-acceptance-r5].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- Deviations from plan were not recorded; absence of deviations is not claimed.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
