# Widget SDK acceptance run — frozen outcome

Feature ID: widget-sdk-acceptance
Status: incomplete-evidence
Completed at: 2026-10-21
Archived at: 2026-10-22T05:24:58Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Acceptance run of the widget SDK: 10 headless agent sessions (clock, counter, decorative, HTTP and secret widgets, each in Claude Code and Codex) against tarballs of @lifedashboard/widget-sdk and @lifedashboard/create-widget, then imported into the desktop app and checked in the Orca browser. (evidence: [ev-plan], [ev-report-r5])
- Final full rerun (round 5, main at f7ddb99): 10 of 10 runs pass every acceptance criterion; every deliverable passed check and build, matched the control build and imported on the first attempt; every agent kept its title; 0 forbidden reads. (evidence: [ev-report-r5])
- Earlier rounds, superseded by round 5: round 1 (report f94471d) had 3 of 10 passing runs, 5 runs that read compiled SDK files, codex-1 blank and codex-4 clipped. Round 2 (report 8f66234, Codex results f7ddb99) had 8 of 10 passing, codex-1 clipped when wider than tall and codex-4 overlapping at 4x4. (evidence: [ev-report-r1], [ev-report-r2])
- SDK and docs changes made between rounds to close the gaps the reports recorded: 373f0fb, 02d5ea5, f781bc4, 93da11a, 699b073, e9760b0. (evidence: [ev-report-r2], [ev-commits])
- Committed reports: docs/superpowers/reports/2026-10-20-widget-sdk-acceptance-report.md, docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round2-report.md and docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round5-report.md. Raw logs, generated projects and screenshots stay outside the repository in /Volumes/ExtendSSD/ld-acceptance-2026-10-20 and are not archived. (evidence: [ev-report-r1], [ev-report-r5], [ev-commits])

## Accepted decisions
- Plan 4 measures and reports; it does not fix. Fixes are a later plan that the user decides on after reading the report. Rationale: user decision, recorded in the spec's Intent. (evidence: [ev-spec])
- Success: the widget is created and imports into the main dashboard on the first attempt. Failure: the agent reads dashboard sources outside the allowed list (the generated project's own files, node_modules/@lifedashboard/*/docs/, and .d.ts files), check or build fails, the folder does not import, or the widget fails the pass criteria. Rationale: user's words in the spec. (evidence: [ev-spec])
- Agents get no browser, as a new user's terminal agent has none; an agent may not install one. Rationale: the setup must match a new user. Any attempt is recorded as a finding. (evidence: [ev-spec])
- On a failed run the controller does not fix or rerun; it completes all 10 runs and writes one report. Rationale: user decision (decision 4). Later rounds departed from this; see deviations. (evidence: [ev-spec], [ev-report-r2])
- Clean profiles: no user-level CLAUDE.md, AGENTS.md, plugins, skills, hooks or MCP servers, so each run matches a new user. Codex uses a fresh CODEX_HOME with the auth file only, because --ignore-user-config alone does not stop the user's global AGENTS.md in ~/.codex from loading. Rationale: spec Constraints. (evidence: [ev-spec], [ev-plan])
- Clock and counter from both agents stay on the main screen as the kept widgets; decorative, HTTP and secret are checks and are removed after the report. Rationale: the user chose free space on the main screen because the board has no screen management. (evidence: [ev-spec])
- Pass criteria: the clock is frameless on first placement (builtin:bare, no card frame), follows the theme, shows the local time and moves; the counter changes value, keeps it across an app reload, and changes its title from settings; decorative animates and fills its rectangle at every size; HTTP shows data, refreshes and shows a readable failure; secret shows UNAVAILABLE before entry and [REDACTED] after. (evidence: [ev-spec])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-20-widget-sdk-acceptance-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-20-widget-sdk-acceptance.md` → [plan](plan.md)

## Areas and modules
widget-sdk

## Git state
Repository root: .
Branch: main
HEAD commit: 5cecd9dfb0f62024ebe306c36cb42a9d020cfdc5
Describe: 5cecd9d
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [ev-commits], [ev-report-r1], [ev-report-r2], [ev-report-r5].

## Verification
Reported status: passed.
- Command/check: ld-widget check and ld-widget build on each of the 10 generated projects, controller re-runs on separate copies (round 5). The report records 'ok' for each; numeric exit codes are not recorded.
  Result: passed; exit code: not recorded; evidence: [ev-report-r5].
- Command/check: Import of each built dist folder through the desktop app's folder import on http://127.0.0.1:3101, on the first attempt (round 5, observed in the Orca browser; manual check).
  Result: passed; exit code: not recorded; evidence: [ev-report-r5].
- Command/check: Acceptance criteria per widget (clock, counter, decorative, HTTP, secret) observed in the Orca browser on the app origin (round 5, manual check). All 10 runs pass every criterion.
  Result: passed; exit code: not recorded; evidence: [ev-report-r5].
- Command/check: Forbidden-read audit of the 10 agent session logs (round 5). Result: 0 forbidden reads.
  Result: passed; exit code: not recorded; evidence: [ev-report-r5].
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
- Change: Rounds 2 to 5 changed SDK and docs and repeated all 10 runs after round-1 failures. Spec decision 4 forbids fixes and reruns after a failed run.
  Reason: Round 2 report: the rerun was to close the round-1 gaps. The reports do not record an explicit user ruling that overrides decision 4.
  Effect: The final result is round 5 on SDK f7ddb99, not the single full run the spec defines. Round 1 and round 2 results are kept in their reports.
  Evidence: [ev-spec], [ev-report-r2], [ev-report-r5].
- Change: Round 1 Claude Code runs used the user's account and real HOME with --setting-sources project,local and --strict-mcp-config, not a clean profile. Those runs saw the user's Playwright and npm caches.
  Reason: At the user's request (round 1 report).
  Effect: Round 1 Claude results do not come from a clean profile. The round 5 report does not describe the Claude profile.
  Evidence: [ev-report-r1], [ev-report-r5].
- Change: Round 5 Codex runs ran without the Codex sandbox. Rounds 1 and 2 used the default workspace-write sandbox.
  Reason: Round 2 comparison was unequal, since Claude ran without a sandbox, and Chrome cannot start in the macOS workspace-write sandbox. Ruling recorded in the round 5 report.
  Effect: Round 5 Codex results do not show the default sandboxed setup.
  Evidence: [ev-report-r2], [ev-report-r5].
- Change: Round 5 Codex profile copied config.toml as well as the auth file (plan Task 3 says copy nothing else).
  Reason: Not recorded. The round 5 report says only that the earlier profile held history and memories of earlier runs, so it was replaced with a fresh one.
  Effect: Effect on the round 5 Codex runs is not assessed.
  Evidence: [ev-plan], [ev-report-r5].
- Change: Widget titles differ from the plan table. Round 1 agents renamed four titles. Rounds 2 to 5 added suffixes (« 2» to « 5») to the titles.
  Reason: Round 2 report ruling: suffixes keep package ids from colliding with earlier rounds. Title drift is not a pass criterion.
  Effect: Titles of the rerun packages are not the titles in the plan table.
  Evidence: [ev-plan], [ev-report-r1], [ev-report-r2], [ev-report-r5].
- Change: Round 5: the test HOME's Library/Keychains was linked to the real keychain during codex-2.
  Reason: To stop a Keychain Not Found dialog from headless Chrome (round 5 report).
  Effect: codex-2 ran with a linked keychain, so the clean-profile rule was not fully kept for that run.
  Evidence: [ev-spec], [ev-report-r5].

## Consciously excluded scope
- Fixing docs, types, the skill or the SDK inside plan 4; the spec assigns fixes to a later plan. Rounds 2 to 5 nevertheless changed docs and SDK (see deviations). (evidence: [ev-spec])
- Publishing to npm. Packages were tested as tarballs, so a real npm create command was not run. (evidence: [ev-spec], [ev-report-r2])
- Windows and Linux, and agents other than Claude Code and Codex. (evidence: [ev-spec])
- Judging the code quality of generated widgets beyond the pass criteria. (evidence: [ev-spec])

## Confirmed follow-ups
- Headless screenshot recipe is unreliable: blank or loading frames, parallel Chrome hangs, claude-4 spent most of 40 minutes on them. Proposed fix: ld-widget shot. Commit 2c118a4 adds it after the round 5 report; no recorded run exercises it. (evidence: [ev-report-r5], [ev-commits])
- False dev-shell overflow record before the first measure (round 5 finding). Commit bbf3f7f, subject 'skip the overflow probe until the frame has a size', comes after the round 5 report; no recorded run covers it. (evidence: [ev-report-r5], [ev-commits])
- Headless Chrome raises a macOS Keychain dialog under a test HOME. Proposed --use-mock-keychain in the recipe; not recorded as applied. (evidence: [ev-report-r5])
- No message reaches the user when auto-placement finds no free space at a widget's default size; the widget was not placed and the report did not investigate further. (evidence: [ev-report-r5])

## Limitations and unresolved risks
- Round 5 Codex runs were unsandboxed, so their results may overstate the default sandboxed Codex setup. The report records this as a ruling. (evidence: [ev-report-r5], [ev-report-r2])
- Each widget and agent pair ran once per round, so each round 5 pass is a single run. (evidence: [ev-spec], [ev-report-r5])
- Agents obtained a headless browser despite decision 9 (Playwright from caches or /tmp, or system Chrome). The reports record these attempts as findings. (evidence: [ev-report-r1], [ev-report-r2], [ev-spec])
- Infrastructure faults in rounds 1 and 2: a contaminated Codex profile stopped codex-3 in round 1; codex-1 reused leftovers in /tmp; a bundled-node network outage in round 2 held HTTP checks for about 6 hours (cause inferred). The round 5 report lists no infrastructure fault. (evidence: [ev-report-r1], [ev-report-r2], [ev-report-r5])
- The desktop app's own WKWebView window was not checked; all checks ran in the Orca browser on the app origin. (evidence: [ev-report-r1], [ev-report-r2])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-20-widget-sdk-acceptance-design.md
  Plan 4 is a measurement, not a fix: 10 headless runs (5 widgets x Claude Code and Codex) on the packed SDK, imported into the desktop app; the result is one report. Decisions: controller launches agents; all 10 runs; keep clock and counter on the main screen, other three are checks; no fixes or reruns after a failed run (decision 4); default models; clean profiles; no browser for agents (decision 9). Success: widget created and imports on the first attempt. Failure: agent reads dashboard sources outside the allowed list, check/build fails, no import, or pass criteria not met. Non-goals: fixing docs/types/skill/SDK, npm publishing, Windows and Linux, agents other than Claude Code and Codex, code quality beyond pass criteria. Status line: approved (changed 2026-10-22, commit c6cda69).
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: f78ccb045eec82382f7fe59e57735c27e3a1a0005bd4eb592fa4820af444c4dc
- [ev-plan] file: docs/superpowers/plans/2026-10-20-widget-sdk-acceptance.md
  Plan for the spec above: run root outside the repository; tooling (echo server, runner, read audit); clean Claude Code and Codex profiles; the five run sentences; setup, runs, import through the Orca browser on http://127.0.0.1:3101; one committed report (Task 7). Its Codex profile step copies only the auth file. Plan has no results section.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: d5e31e82f3d8a3a124aa3f17bfd78e5a1f55d0df633d42ce40a6adac08dac2cd
- [ev-report-r1] file: docs/superpowers/reports/2026-10-20-widget-sdk-acceptance-report.md
  Round 1 verdict: fail. 3 of 10 runs pass every criterion (claude-4, codex-2 under a contaminated profile, codex-5). Five runs read compiled SDK files (claude-1, claude-2, claude-3, claude-5, codex-1). codex-1 renders blank; codex-4 does not fit its 4x4 default size; codex-3 produced nothing (infrastructure fault, contaminated Codex profile). Every deliverable passed check and build and imported on the first attempt. Infrastructure faults: contaminated Codex profile, shared /tmp leftovers, Claude run on the user's account and real HOME at the user's request.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 1d5cc7144eaaeedc97af098d081b91b173cd31c9e54aa78346f58b86c84f236b
- [ev-report-r2] file: docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round2-report.md
  Round 2 on branch fix/widget-sdk-acceptance-gaps: verdict fail. 8 of 10 runs pass every criterion; 0 forbidden reads; 0 questions. codex-1 fails (clock clipped when wider than tall); codex-4 fails (JPY hidden and error line overlaps rates at 4x4). Round-1 gaps closed by SDK and docs changes (373f0fb, 02d5ea5). A false 8 px dev-shell overflow before mount was found and fixed after the run (f781bc4). Follow-up reruns: codex-1 pass after 699b073; codex-4 fail at 4x4 in sandboxed Codex, pass at 4x4 without the sandbox (e9760b0 advice). Chrome cannot start inside the Codex macOS workspace-write sandbox. HTTP checks waited about 6 hours on a bundled-node network outage (infrastructure, cause inferred). Not checked: the desktop app's own WKWebView window; npm create with published packages (packages were tarballs).
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: b76a84acc83fd0364c6283e5e5a108c22f03753cd4216fc33e6941f2ce3e3788
- [ev-report-r5] file: docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round5-report.md
  Round 5, full rerun of all 10 runs on main at f7ddb99 (SDK and create-widget tarballs and desktop app rebuilt from that commit). Verdict: pass on the acceptance criteria; 10 of 10 runs pass every criterion. Every deliverable passed check and build, matched the control build and imported on the first attempt. Every agent kept its title; 0 forbidden reads. Each agent took screenshots of its widget with the documented recipe. claude-4 took 40.3 minutes; no run hit the 45-minute cap. Open findings: headless screenshot recipe unreliable; false dev-shell overflow before first measure; macOS Keychain dialog from headless Chrome; no message when auto-placement finds no free space. Rulings: Codex ran without its sandbox; fresh Codex profile with auth.json and config.toml. The report lists no infrastructure faults.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 4ce79e6e8d0532e05f0ebdea98a940802f23567ce88c48a618254c7714dddd98
- [ev-commits] session: This archive session, read-only Bash: git log --oneline --date=short --format='%h %ad %s' -- <spec path>; git log --oneline --format='%h %ad %s' --date=short -- <plan path>; git log --stat --format='%h %ad %s' --date=short -- docs/superpowers/reports; git log -S 'Status: draft for approval' -- <spec path>; git show --stat c6cda69; git merge-base --is-ancestor for 373f0fb 02d5ea5 f781bc4 93da11a 699b073 e9760b0 cbd1f33 2c118a4 bbf3f7f; ls docs/superpowers/reports; ls .project-history/features.
  Spec: 9e88de1 added it; 711d3f8 and 13c3d09 applied Codex and zclaude review fixes; ebfa811 applied Codex plan-review fixes and also edited the spec; c6cda69 (2026-10-22) changed the status line to approved. Plan: 67b99a0 added it; ebfa811, 501cc32 and d83fcf5 applied plan review fixes. Reports: f94471d (round 1, 2026-10-20), 8f66234 (round 2, 2026-10-21), 52c5f89, 179e86e and f7ddb99 (round 2 updates, including Codex rerun results), cbd1f33 (round 5 full rerun, 2026-10-21). SDK and docs commits cited by the reports, all ancestors of HEAD: 373f0fb, 02d5ea5, f781bc4, 93da11a, 699b073, e9760b0. Commits after the round 5 report, no recorded run covers them: 2c118a4 (ld-widget shot) and bbf3f7f (overflow probe fix). No archive for this feature exists in .project-history/features.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-doc-reviews] session: This archive session, read-only Bash: git log --format='%h %ad %s' -- <spec path> and -- <plan path>.
  Commit messages record review fixes applied to the spec (Codex in 711d3f8 and ebfa811; zclaude in 13c3d09) and to the plan (Codex in ebfa811 and 501cc32; zclaude in d83fcf5). These reviews covered the spec and plan documents only. No code review of the acceptance work is recorded. The review text itself was not inspected.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
Read the full spec, the full plan and the three committed acceptance reports. Final spec: HEAD c6cda69. Its status line was changed by the controller from 'Status: draft for approval.' to 'Status: approved (implemented by plan 2026-10-20-widget-sdk-acceptance).' on 2026-10-22 at the user's archival request (commit c6cda69). No draft, obsolete or superseded marker remains. Final plan: last changed in d83fcf5; it has no status marker and no results section. Links: the spec links the plan by path, the plan links the spec, and the reports link both by path; all use slug widget-sdk-acceptance. The spec's parent specs (2026-10-18-widget-sdk-agent-ready-design.md, 2026-10-20-widget-sdk-agent-knowledge-design.md) are linked, not bundled. Implementation: the plan's repository deliverables, the three report files, exist in the tree and are committed (f94471d, 8f66234, cbd1f33). The run artifacts (logs, generated projects, screenshots) were kept outside the repository and were not inspected. Review: no code review of the acceptance work is recorded. Commits 711d3f8, 13c3d09, ebfa811, 501cc32 and d83fcf5 are document review fixes only, so review is missing. Verification: the final full rerun (round 5, report ev-report-r5) records passing check and build, import, acceptance criteria and zero forbidden reads for all 10 runs. These are recorded results read from the report, not re-executed. Round 1 and round 2 failures are recorded in outcome, not as verification checks, because the final verification is round 5. completedAt 2026-10-21 is the date of commit cbd1f33, the final full-rerun report. Areas come from the spec title. secretsReviewed: grep over the spec, plan and reports found no credentials; the only secret-like value is a throwaway local test value in the plan, omitted here. Archive mode is incomplete-evidence: review is missing, and the user asked to archive every completed feature on 2026-10-22.
Evidence: [ev-spec], [ev-plan], [ev-report-r1], [ev-report-r2], [ev-report-r5], [ev-commits], [ev-doc-reviews].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
