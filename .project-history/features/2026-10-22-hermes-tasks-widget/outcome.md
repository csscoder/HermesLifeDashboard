# Hermes Tasks widget — frozen outcome

Feature ID: hermes-tasks-widget
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-22T05:24:47Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Manifest network field and network permission, with origin validation and normalization (commit a83fbae). (evidence: [ev-commits])
- Network origins approved per package in widget_network_origins; install stores the version's origins (commit d6daf17). (evidence: [ev-commits])
- Bounded upstream HTTP proxy with redirects not followed and a 4 s timeout (commit aacbbcb; moved to packages/contracts by 4932b12, see ev-later-commits), and the http.get and http.send gateway operations (commit 52ce207). (evidence: [ev-commits], [ev-later-commits])
- Install review shows network origins; widget UI maps UPSTREAM_ERROR to a message (commit 745b6ce). (evidence: [ev-commits])
- Hermes Tasks widget package examples/widgets/hermes-tasks: pure modules for dates, views, quick add and layout (commit ed67b5c); Hermes Tasks client over the gateway (commit 7181bb6); autosave queue (commit 03be180); Vue UI with rail and stacked layouts, list, detail panel and toasts (commit e4a5c26); widget tests run outside dist (commit 387302f). (evidence: [ev-commits])
- Post-acceptance fixes: quick add submits on Enter in the input, Esc closes the panel from anywhere in the frame, and a lost write keeps its retry (commit f66f225); gateway test pins for the timeout chain, send limit and origin rejection (commit 6accb6a); README origin wording (commit c5892fd). (evidence: [ev-post-acceptance])

## Accepted decisions
- The API calls Hermes Tasks with Node fetch and the widget calls the gateway, because the sandbox origin is opaque and Hermes Tasks rejects Origin null with 403 ORIGIN_NOT_ALLOWED (checked 2026-10-11). Server-side requests send no Origin header and work in the Tauri build. (evidence: [ev-spec])
- Generic HTTP proxy with an exact-origin allowlist per package, reviewed at install, so other widgets can reuse it. Origins are stored normalized with new URL(x).origin. Loopback and private hosts are allowed when listed and approved. (evidence: [ev-spec])
- A new origin in a new package version is shown at install as a new permission, so a version never widens network access silently. (evidence: [ev-spec])
- http.get is confirm never so polling never opens a dialog; http.send is confirm optional, so writes follow the grant mode (ask mode confirms each write). (evidence: [ev-spec])
- Any upstream HTTP status is a successful gateway result, so the widget handles service errors such as 409 VERSION_CONFLICT itself. Redirects are not followed, because a redirect could leave the allowlist. (evidence: [ev-spec])
- No secrets in this feature; Hermes Tasks on localhost needs no token. (evidence: [ev-spec])
- Reschedule changes the current occurrence, not the series schedule; recurrence rules are shown read-only and changed through Hermes. (evidence: [ev-spec])
- Widget tests use Vitest for pure modules only; the Vue components are checked in the browser against the live service. (evidence: [ev-spec], [ev-plan])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-11-hermes-tasks-widget-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-11-hermes-tasks-widget.md` → [plan](plan.md)

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
Reported status: failed.
- Command/check: pnpm typecheck && pnpm test (recorded in the plan's acceptance results at commit 8f2b6ef; not rerun)
  Result: passed; exit code: 0; evidence: [ev-acceptance].
- Command/check: Manual browser check 1 (plan Task 10, Orca built-in browser): live tasks listed; Сегодня shows overdue under Просрочено with no duplicates
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 2: Скоро, Входящие and Все load; tag filter and все clear it
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 3: complete a task; row leaves, toast Выполнено · Вернуть; completion visible in Hermes Tasks web UI; restore done in web UI because the Вернуть click raced toast expiry
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 4: skip a recurring task; it moves to its next occurrence
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 5: reschedule via row arrow and panel chips; panel date and time input commits
  Result: unverified; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 6: panel edits of title, tags and note; priority and project committed and reflected
  Result: unverified; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 7: quick add «Проверка виджета #тест завтра» creates a task due tomorrow
  Result: failed; exit code: not recorded; evidence: [ev-acceptance], [ev-post-acceptance].
- Command/check: Manual browser check 8: external title change in Hermes appears in widget within about 10 s (observed about 2 s)
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 9: grant set to ask mode; completing opens host dialog for POST; Отклонить leaves row, no toast
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 10: 6-column layout uses tabs and chips; panel slides over about 82 percent; 3x4 minimum has no overflow
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 11: Glass, Obsidian and Paper themes keep text, chips and panel readable
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual browser check 12: orca console --limit 50 shows no errors from the widget frame
  Result: passed; exit code: not recorded; evidence: [ev-acceptance].
- Command/check: Manual check: the «Hermes Tasks недоступен» banner with the Hermes Tasks container stopped (not run; the plan leaves the container running)
  Result: unverified; exit code: not recorded; evidence: [ev-acceptance].
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
- Change: Quick add submits on Enter in the input instead of a form submit handler. Esc closes the task panel through a document keydown listener instead of a keydown handler on the panel.
  Reason: The sandbox omits allow-forms, so the form submit did not fire (acceptance check 7).
  Effect: Not re-verified in the browser after f66f225.
  Evidence: [ev-post-acceptance], [ev-acceptance].

## Consciously excluded scope
- Secrets and token substitution for HTTP requests (spec sub-project 3). (evidence: [ev-spec])
- Streaming, binary bodies and response headers other than content-type. (evidence: [ev-spec])
- Counters for views in the rail, recurrence editing, archive and restore, project management, several tags at once, and a completed list. (evidence: [ev-spec])
- Runtime configuration of the Hermes Tasks address; changing it requires rebuilding the widget with another origin. (evidence: [ev-spec])

## Confirmed follow-ups
- Rerun pnpm typecheck and pnpm test after the commits that followed the acceptance run (f66f225, 6accb6a, c5892fd and later widget and gateway commits); no result is recorded. (evidence: [ev-post-acceptance], [ev-later-commits])
- Recheck in the browser quick add, Esc and lost-write retry after f66f225 (acceptance check 7 failed before it). (evidence: [ev-acceptance], [ev-post-acceptance])
- Check live the reschedule date and time commits and the title, tag and note autosave commits (acceptance checks 5 and 6 were partial). (evidence: [ev-acceptance])
- Check the Hermes Tasks unavailable banner with the container stopped. (evidence: [ev-acceptance])

## Limitations and unresolved risks
- A listed hostname is resolved at request time, so DNS decides the address; the spec recommends IP literals, as Hermes Tasks uses 127.0.0.1. (evidence: [ev-spec])
- A write whose answer is lost to a timeout may already have run upstream; the widget retries it with the same idempotency key. (evidence: [ev-spec])
- Quick add, Esc and lost-write retry changed after the last recorded acceptance run and have no recorded browser result. (evidence: [ev-post-acceptance], [ev-acceptance])
- Later commits changed the gateway and widget beyond this feature: secret injection (1dade32, 1b0a9ae) and the proxy move (4932b12). This record covers the feature's own commits, not current gateway behaviour. (evidence: [ev-later-commits])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-11-hermes-tasks-widget-design.md
  Approved design. Part 1 network gateway: network permission, per-package exact-origin allowlist, http.get (confirm never) and http.send (confirm optional), no redirects, 4 s upstream timeout, 100 KB body, 120 KB answer, no secrets. Part 2 Hermes Tasks widget in examples/widgets/hermes-tasks: views, tags, complete/skip/undo, reschedule, autosave edits, quick add, 10 s polling, theme tokens only. Out of scope: secrets, streaming and binary bodies, recurrence editing, archive, project management.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 9a228869c28f75dfafa07806f5ccef8d3a02ddd60ce33ca8ab8d09e1a34966e5
- [ev-plan] file: docs/superpowers/plans/2026-10-11-hermes-tasks-widget.md
  Ten tasks. Tasks 1-9 implement the gateway and widget with one commit each. Task 10 is full verification and browser acceptance, with results appended under «Acceptance results (2026-10-11)». The plan's Task 9 quick add uses a form submit handler.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: f03519ae8f3ad866685f1a74b51f075e34972e019574e582c5b45d453b578228
- [ev-commits] session: Bash in this session: git log --date=short --format='%h %ad %s' -- examples/widgets/hermes-tasks; git log --oneline --date=short --format='%h %ad %s' --since=2026-10-10 --until=2026-10-13; git grep -n on apps, packages and examples for widget_network_origins, http.send, UPSTREAM_ERROR, parseHttpGet, parseHttpSend, proxyHttp, layoutFor, createAutosave, parseQuickAdd; ls of examples/widgets/hermes-tasks/src and test.
  Plan Task 1 a83fbae feat(contracts): declare network origins in widget manifests. Task 2 d6daf17 feat(api): store the network origins approved per package. Task 3 aacbbcb feat(api): proxy bounded HTTP requests to approved origins. Task 4 52ce207 feat(api): add http.get and http.send gateway operations. Task 5 745b6ce feat(ui): show network origins and upstream errors for widgets. Task 6 ed67b5c feat(widgets): scaffold the Hermes Tasks widget with dates and quick add. Task 7 7181bb6 feat(widgets): add the Hermes Tasks client over the network gateway. Task 8 03be180 feat(widgets): queue Hermes Tasks edits for autosave. Task 9 e4a5c26 feat(widgets): build the Hermes Tasks widget UI. Also 387302f fix(widgets): run widget tests only outside dist. Spot checks: widget_network_origins in apps/api/src/migrations.ts; http.get and http.send in packages/contracts/src/widget-gateway.ts; UPSTREAM_ERROR in apps/api/src/errors.ts and apps/ui/app/api.ts; proxyHttp in packages/contracts/src/widget-http.ts; widget src and test files exist.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-acceptance] session: Read tool in this session: docs/superpowers/plans/2026-10-11-hermes-tasks-widget.md, lines 3842-3879 («Acceptance results (2026-10-11)»), commit 8f2b6ef.
  Recorded result: pnpm typecheck && pnpm test exit 0 (contracts 254, widget-sdk 42, examples/widgets/hermes-tasks 28, ui 329, api 248; 901 tests in 43 files). Browser checks in Orca's built-in browser: 1 PASS, 2 PASS, 3 PASS, 4 PASS, 5 PARTIAL (date and time input commits not exercised), 6 PARTIAL (title, tag and note commits not exercised), 7 FAIL (quick add form did not submit in the sandbox, no http.send), 8 PASS, 9 PASS, 10 PASS, 11 PASS, 12 PASS. Not checked live: the «Hermes Tasks недоступен» banner.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-post-acceptance] session: Bash in this session: git merge-base --is-ancestor f66f225 8f2b6ef (not an ancestor); git show --stat and git show f66f225 -- examples/widgets/hermes-tasks/src/TaskList.vue examples/widgets/hermes-tasks/src/use-tasks.ts examples/widgets/hermes-tasks/src/DetailPanel.vue; git show --stat 6accb6a c5892fd.
  Commits after the acceptance run: f66f225 fix(widgets): make Esc, quick add and lost-write retry work in the sandbox (removes the quick add form and submits on Enter in the input; moves Esc handling to a document keydown listener; keeps a lost-write retry when an unrelated action succeeds; adds a WORKSPACE_EPOCH_MISMATCH toast; version update made monotonic). 6accb6a test: pin the gateway timeout chain, send limit and origin rejection. c5892fd docs: state the origin review accurately in the README. No browser or test result is recorded for these commits.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-later-commits] session: Bash in this session: git log --format='%h %ad %s' --date=short -- apps/api/src/widget-gateway.ts; git log -- packages/contracts/src/widget-http.ts apps/api/src/widget-packages.ts; git log -- examples/widgets/hermes-tasks; git merge-base --is-ancestor checks for 5cd58d2 and c8c7f0e.
  Later commits touching this feature's code, not part of the plan: 5cd58d2 feat(widget-sdk): typed http helpers and documented widget API (changes the widget api.ts); c8c7f0e chore(examples): add WebM media and type checking; 4932b12 refactor: share gateway checks, HTTP proxying, rate limits and error mapping through contracts (moves the proxy to packages/contracts); 1dade32 feat(api): inject and redact widget secrets in HTTP calls and 1b0a9ae fix(api): redact URL-encoded secret echoes and deny unapproved origins first (secret injection, which the spec excludes).
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
The spec (status: approved design, 2026-10-11) and the plan were read in full. Neither has a draft, obsolete or superseded marker. The plan's last commit 8f2b6ef appends the acceptance results. Both documents cover one feature in two parts: the network gateway and the Hermes Tasks widget. Implementation commits map to plan Tasks 1-9 (ev-commits); the symbols and files named in the plan exist in the working tree. The only recorded verification is the acceptance section (ev-acceptance), which predates commits f66f225, 6accb6a and c5892fd (ev-post-acceptance) and later commits that change the gateway and widget (ev-later-commits). No code review is recorded. Source grep for credential-like terms found only test fixtures and design text, no secrets. Archive mode is incomplete-evidence by explicit user request.
Evidence: [ev-spec], [ev-plan], [ev-commits], [ev-acceptance], [ev-post-acceptance], [ev-later-commits].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
