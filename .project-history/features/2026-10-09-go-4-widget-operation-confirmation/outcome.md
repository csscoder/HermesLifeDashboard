# Widget operation confirmation (GO-4 «Повысить безопасность») — frozen outcome

Feature ID: GO-4
Status: completed
Completed at: 2026-10-09
Archived at: 2026-10-09T09:46:00Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- API: GATEWAY_OPS carries a confirm policy (never/optional/always); widget_grants.mode (allow/ask) with PUT /widget-packages/:id/grants/:permission; the gateway issues a single-use, session/op/input-bound confirmation id (428 CONFIRMATION_REQUIRED), checks it on repeat (409 CONFIRMATION_INVALID), and audits issue, use and decline, with a DELETE decline route. (evidence: [ledger], [git-merge])
- Host UI: confirmation queue with a per-request 110 s deadline, a modal ConfirmDialog in the main document (focus on «Отклонить», Esc declines, «Разрешить один раз» armed after 500 ms), broker that repeats a confirmed call once with the id, and a grant mode switch on the install screen and in the installed list. (evidence: [ledger], [task11-report])
- Existing grants migrate to mode allow; docs updated (base design row, sandbox spec section); 11 plan tasks implemented with per-task reviews. (evidence: [ledger], [git-merge])

## Accepted decisions
- Enforcement is split: the API decides which calls need confirmation and issues and checks single-use, input-bound ids; the host obtains the user's consent. Rationale: policy and mode live in one place, a client that ignores 428 fails closed, and every issue, decline and use is audited. The server cannot tell a click from a client echoing the id, so consent rests on the trusted host. (evidence: [spec-doc])
- A room id attached by the host was rejected as a guard: the host attaches it to every call, including a malicious one, and room ids are not secret. The widget session token, held only by the host broker, is the identity. (evidence: [spec-doc])
- Grant mode is per package grant, only for permissions with an optional operation, default «Спрашивать» at install; the migration sets existing grants to allow so behaviour does not change silently. The dialog offers only «Разрешить один раз» and «Отклонить»; 'always allow' lives in the installed list, not in a prompt a widget can trigger repeatedly. (evidence: [spec-doc])
- Timing: confirmation TTL 120 s, dialog deadline 110 s from the request, bridge timeout 250 s for confirmable operations; the worst case with one session renewal is 245 s, so a dialog deadline, not the transport timeout, ends an unanswered call. (evidence: [spec-doc], [ledger])
- Rulings made during execution: no component unit test for ConfirmDialog (R1), built-in path covered only by the needsConfirmation matrix (R2), plan-chosen UI copy kept (R4), no attribution trailers in commits (R5), DECLINED stays out of the API code list (R7), R9 closed by the final fix, two-line list rows accepted. (evidence: [ledger])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-09-widget-op-confirmation-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-09-widget-op-confirmation.md` → [plan](plan.md)

## Areas and modules
api, ui, contracts, docs

## Git state
Repository root: .
Branch: alex/go-4-povisit-bezopasnost
HEAD commit: f4ab72c41c5e8d1033e37f1daa3bc8bb0e6af8c3
Describe: f4ab72c
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [ledger], [git-merge].

## Verification
Reported status: passed.
- Command/check: pnpm test (repo root, at 7ab8960 before the merge)
  Result: passed; exit code: 0; evidence: [tests-premerge].
- Command/check: pnpm typecheck (repo root, at 7ab8960 before the merge)
  Result: passed; exit code: 0; evidence: [tests-premerge].
- Command/check: pnpm test (repo root, merged tree with main, before commit f4ab72c)
  Result: passed; exit code: not recorded; evidence: [tests-postmerge].
- Command/check: pnpm typecheck (repo root, merged tree with main)
  Result: passed; exit code: 0; evidence: [tests-postmerge].
- Command/check: Manual browser acceptance checks 1-10 plus re-checks of installed-list layout and focus in Orca's browser via orca-cli, per the spec's browser acceptance list
  Result: passed; exit code: not recorded; evidence: [task11-report], [ledger].
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: approved; evidence: [ledger], [final-fix-report].

## Deviations from plan
- Change: The mode-column migration is migration 4, not migration 3 as the spec and plan say; db.test.ts pins earlier steps with MIGRATIONS.slice and has a 3-to-4 upgrade test.
  Reason: main added its own migration 3 (fluid 24-column grid) before the merge.
  Effect: Same SQL, shifted by one version; hand-resolved merge conflicts in migrations.ts and db.test.ts.
  Evidence: [git-merge].
- Change: Broker guards a closed client: no dialog after close and no new widget session once closed; a session created after close is ended.
  Reason: Task 7 review found a closed client could open a dialog or create an orphan session, blocking the queue up to 110 s.
  Effect: Two small guards plus tests in broker.ts; not in the original plan code.
  Evidence: [ledger].
- Change: The hello example catches DECLINED and the approve button is disabled for the first 500 ms.
  Reason: Declared plan additions (rulings R3); the spec is silent on the example and the arm delay guards against double clicks.
  Effect: An example change and a delayed button the spec did not request.
  Evidence: [ledger].
- Change: Installed-list rows are two lines tall: grants sit on their own full-width row under the name.
  Reason: Browser acceptance found a clipped «Удалить» and then a select overlapping it; the full-width row is the only layout verified to prevent the overlap.
  Effect: Visible layout change; commits 3b66e1e and 73ab02e; focus returns to the select after a mode change.
  Evidence: [task11-report], [ledger].
- Change: A confirmation id is spent when the mode flipped to allow mid-dialog, and an empty confirmationId in a 428 is treated as absent.
  Reason: Final whole-branch review minors: R9 parked ruling and a fail-closed tightening.
  Effect: Commit 7ab8960 with two tests; the allow-branch repeat still charges the rate limit.
  Evidence: [ledger], [final-fix-report].

## Consciously excluded scope
- A CSP for the main document and a compromised-UI scenario are out of scope per the spec; no unit test for ConfirmDialog.vue (plan forbids a DOM harness), and no gateway test for the built-in widget path (no built-in holds notifications and no always operation exists). (evidence: [spec-doc], [ledger])

## Confirmed follow-ups
- Parked follow-ups from the final review: hello double click can hit the pending 429 and show «Ошибка виджета»; two misleading messages on fail-closed paths; test gaps (bak-v2 on upgrade, PUT without body); PackagesDialog cosmetics (aria-label without title, tab order versus visual order, stale list after two failures); ConfirmDialog polish (title overflow-wrap, aria-describedby). (evidence: [ledger])
- Unrelated observation: hostile-1.0.0 never completed the sandbox handshake in the embedded browser while a copy with a changed hash did. Suspected cause, unproven: sandbox.ts bakes request-host absolute URLs into an immutable-cached document. Suggested a separate ticket. (evidence: [task11-report], [ledger])

## Limitations and unresolved risks
- Not verified in a browser: a long unbroken package title in the dialog, a multi-line notification body, select contrast outside the Glass theme, list layout at widths other than 1440, and the merged result with the new 24-column board. (evidence: [task11-report], [ledger])
- The shell did not print the exit code of pnpm test on the merged tree; the result rests on per-package summaries with 0 failures. (evidence: [tests-postmerge])

## Evidence register
- [spec-doc] file: docs/superpowers/specs/2026-10-09-widget-op-confirmation-design.md
  Accepted design: confirm policy per gateway operation, per-grant allow/ask mode, single-use input-bound confirmation id issued by the API, host dialog, five acceptance criteria.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 119476ef5314db0bdbc4705c7320d71aa3b8d53ed91fae287f606a5a2c2f47f7
- [ledger] file: .superpowers/sdd/2026-10-09-widget-op-confirmation/progress.md
  SDD controller ledger: pre-flight scan, rulings R1-R9, per-task implement/review/fix-round records for Tasks 1-11, final whole-branch review (Ready to merge: Yes, Critical 0, Important 0), final fix wave 7ab8960 and its clean re-review. The ledger is git-ignored scratch.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: d6937cc51e9da498c10d87a8be402933fcfaf2eb6c92e22c46ef6764f7aef1e6
- [task11-report] file: .superpowers/sdd/2026-10-09-widget-op-confirmation/task-11-report.md
  Browser acceptance in Orca's built-in browser via orca-cli: checks 1-10 passed (audit: CONFIRMATION_REQUIRED 7, DECLINED 6, ok 3, PERMISSION_DENIED 1); check 9 needed a workaround (hostile-1.0.0 never completed the handshake, a copy with a changed hash worked); installed-list layout and focus defects found, then fixed in 3b66e1e and 73ab02e; long unbroken title, multi-line body and select contrast outside the Glass theme were not verified.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 5ea118c2fec4ff9c32502d227cfcd8ee80eebb78b05f5f969646449016191752
- [final-fix-report] file: .superpowers/sdd/2026-10-09-widget-op-confirmation/final-fix-report.md
  Final fix wave 7ab8960: an approved confirmation id is spent when the mode flipped to allow mid-dialog; an empty-string confirmationId is treated as absent; both new tests RED then GREEN.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 08c83a0cc6031cdfc78431675715a55e7deb30c8b1fd7a408d3d36492f91e077
- [git-merge] session: This session: git log, merge-tree, merge and ff-only commands after the final review
  Branch alex/go-4-povisit-bezopasnost (17 commits from 983d06a to 7ab8960 plus merge commit f4ab72c) merged main into the branch and main was fast-forwarded to f4ab72c. main had gained its own migration 3 (fluid 24-column grid), so the confirmation mode column became migration 4; migrations.ts and db.test.ts conflicts were resolved by hand.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [tests-premerge] session: This session: pnpm test and pnpm typecheck at 7ab8960 before the merge
  pnpm test exit 0 (contracts 123, widget-sdk 19, ui 248, api 154 passed); pnpm typecheck exit 0; tree clean except the then-untracked plan file.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [tests-postmerge] session: This session: pnpm test and pnpm typecheck on the merged tree before commit f4ab72c
  Per-package summaries: contracts 141, widget-sdk 19, api 160, ui 264 passed, 0 failed; pnpm typecheck exit 0. The shell did not print the test exit code.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
Spec header links Linear GO-4 and status 'approved design, 2026-10-09'; the plan (11 tasks) was executed against this spec, and the SDD ledger line 1 names this plan and line 5 this spec. Both files were read in full in this session; spec was revised after a Codex review before the plan (git: 983d06a, a26f4a5). The ledger, the browser acceptance report and the final fix report were read; the final merged tree was tested in this session. Completion date 2026-10-09 is the day the branch was merged into main in this session. Areas are the packages touched by the branch diff. No credentials appear in the spec, plan or evidence files (read in full; scanned for key/token assignments).
Evidence: [spec-doc], [ledger], [task11-report], [final-fix-report], [git-merge], [tests-premerge], [tests-postmerge].

## Archive notes
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
