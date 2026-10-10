# Board storage in SQLite behind a paired API (GO-3 step 1) — frozen outcome

Feature ID: GO-3-step-1
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-09T10:04:31Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- packages/contracts workspace package with the grid, board types and parseScreenBoard, and API envelope and error-code types shared by API and UI. (evidence: [code-vs-spec], [git-history])
- API: configuration for data directory and UI origins; node:sqlite database with numbered migrations, WAL and backup before migrating; error envelope with request ids; Host/Origin/content-type checks, pairing code and sliding sessions; room list and board routes with revision checks. (evidence: [code-vs-spec], [git-history])
- UI: fetch wrapper with typed failures and a 5000 ms timeout, room sync, pairing form and app states, and the board loaded and saved through the API with a visibilitychange reload; README and .env.example describe the variables and pairing. (evidence: [code-vs-spec], [git-history])

## Accepted decisions
- SQLite through built-in node:sqlite with hand-written SQL and numbered migrations (PRAGMA user_version), not better-sqlite3 + Drizzle from the base design: no native addon to package for Tauri and no new dependency; five tables need no ORM. The module is marked Release Candidate in Node 24 docs and provides backup(), transactions and PRAGMA. (evidence: [spec-doc], [code-vs-spec])
- One revision per room covering all its screens, placement as x/y/w/h columns on the widget row, and one PUT /rooms/:roomId/board that replaces the room's widgets under expectedRevision (stale save gets 409 REVISION_CONFLICT). Grid bounds and overlap are validated in contracts, not by SQL CHECK, because the row count may change. (evidence: [spec-doc], [code-vs-spec])
- Pairing: six-digit code from crypto.randomInt valid 10 minutes and one use, burnt by the fifth wrong attempt, pair-code limited to once per 10 seconds; success sets an HttpOnly SameSite=Strict Path=/api session cookie with a hashed token stored in SQLite and no Secure flag on loopback HTTP. (evidence: [spec-doc], [code-vs-spec])
- Sessions slide for 30 days and renew at most once a day (when 29 days or less remain), so the guaranteed idle gap is 29 days and no absolute limit exists; renewing on every request was rejected to avoid a write per request. (evidence: [spec-doc], [code-vs-spec])
- No CSRF token (deviation from base design section 13.1): a cross-site request must defeat SameSite=Strict, an allowlisted Origin and a JSON content type that forces a preflight with no CORS allowed. Cookie parsing and rate limits are hand-written; the API sends no CORS headers. (evidence: [spec-doc])
- The localStorage board is not migrated or read; no offline mode (a failed load shows 'API: недоступен' and disables the modes, a failed save keeps the working copy); the UI never shows an unsaved change as saved; the board reloads on visibilitychange outside edit modes. (evidence: [spec-doc], [code-vs-spec])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-05-db-storage-and-pairing-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-05-db-storage-and-pairing.md` → [plan](plan.md)

## Areas and modules
contracts, api, ui

## Git state
Repository root: .
Branch: alex/go-4-povisit-bezopasnost
HEAD commit: f4ab72c41c5e8d1033e37f1daa3bc8bb0e6af8c3
Describe: f4ab72c
Working tree: dirty
Uncommitted changes are not attributed to this feature automatically.

## Implementation evidence
Reported status: completed; evidence: [git-history], [code-vs-spec].

## Verification
Reported status: unverified.
- Command/check: pnpm typecheck, pnpm test and pnpm build (plan Task 10 step 1), as covered by the GO-4 post-merge run of test and typecheck
  Result: unverified; exit code: not recorded; evidence: [go4-postmerge-tests].
- Command/check: Browser acceptance of plan Task 10 (pairing, persistence across API restart, 401/403 curl checks, two-tab 409, API stopped during load and save, pending-save input lock, newer-schema startup failure)
  Result: not-run; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: unverified; evidence: not recorded.

## Deviations from plan
Deviations: not recorded / unverified. No absence claim is made.

## Consciously excluded scope
- Out of scope per the spec: rooms UI and room routes beyond the list (step 2); screens UI, pager and screen creation (step 3); logout, session list, Settings; serving the generated UI from Fastify; moving the theme to the database; Secure cookies, HTTPS, remote Core; domain events, idempotency receipts, SSE. (evidence: [spec-doc])

## Confirmed follow-ups
- Steps 2 (rooms UI) and 3 (screens in a room) of GO-3 are separate specs. (evidence: [spec-doc])

## Limitations and unresolved risks
- No implementation-review report, test log or Task 10 browser acceptance report was found for this feature. (evidence: [git-history])
- Spec-stated risk: the API runs TypeScript through Node type stripping and builds with tsc, so importing .ts sources from the workspace package must work in dev, build and start. (evidence: [spec-doc])
- Later work changed parts of this storage: migrations 2, 3 and 4 add widget packages, per-screen rows and grant modes, and ScreenBoard gained rows; the spec's migration 1 text is otherwise historical. (evidence: [git-history])

## Evidence register
- [spec-doc] file: docs/superpowers/specs/2026-10-05-db-storage-and-pairing-design.md
  Approved design: board moves from localStorage to SQLite (node:sqlite, numbered migrations by PRAGMA user_version, backup before migrating) behind a Fastify API with one-time pairing code, HttpOnly SameSite=Strict session cookie with sliding 30-day expiry renewed at most daily, Host/Origin/content-type checks instead of a CSRF token, one PUT /rooms/:roomId/board guarded by a per-room revision, shared packages/contracts, UI states checking/pairing/ready/unavailable, ten acceptance criteria.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: d13c0a6ba493d128ebdf775d7c0e7b5ce41c4636fcf1b665409dc811e237b2ee
- [plan-doc] file: docs/superpowers/plans/2026-10-05-db-storage-and-pairing.md
  Ten-task plan (contracts package, API configuration, database and migrations, error envelope, request checks pairing and sessions, room routes, UI API client, room sync and pairing form, board on the API, full verification and browser acceptance). All checkboxes are unticked; that is not evidence of the implementation state. Global constraints repeat the spec's session, pairing and UI copy rules; no new dependencies.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 4268ddee88801a93eb91be816eee741ef90042b0a11f87d16bea620a4cff4a65
- [git-history] session: This session: git log for both source files, git log fd1b6ec^..37af818, git diff --stat fd1b6ec^..37af818, git merge-base --is-ancestor 37af818 main
  Implementation commits fd1b6ec (contracts), d6111f3 (config), c140d41 (database and migrations), 510b208 (errors), 97283c6 (pairing and sessions), 894d0d3 (room routes), 4765687 (UI api client), 8a6861f (room sync and pairing form), 37af818 (board on the API), all 2026-10-05, 44 files changed; 37af818 is an ancestor of main.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [code-vs-spec] session: This session: greps of apps/api/src/{db,auth,rooms}.ts, apps/ui/app/api.ts, WidgetBoard.vue, README.md, .env.example and directory listings of apps/api/test, apps/ui/app, packages/contracts/src at HEAD f4ab72c
  Present and matching the spec at the grep level: db.ts uses node:sqlite DatabaseSync and backup() to <file>.bak-v<version>, PRAGMA journal_mode WAL, synchronous FULL, foreign_keys ON, busy_timeout 5000; auth.ts has randomInt six-digit code with padStart, timingSafeEqual, 30-day TTL with a 29-day renewal threshold, cookie HttpOnly; SameSite=Strict; Path=/api; rooms.ts rejects a stale expectedRevision with REVISION_CONFLICT; api.ts uses AbortSignal.timeout with a 5000 ms timeout; WidgetBoard.vue listens to visibilitychange; README and .env.example document LIFEDASHBOARD_DATA_DIR and LIFEDASHBOARD_UI_ORIGINS; test files exist for db, auth, rooms, config, errors; PairingForm.vue and room-sync.ts exist. Test bodies and most code were not read.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [go4-postmerge-tests] session: This session: read of evidence entry tests-postmerge in the frozen GO-4 archive metadata (.project-history/features/2026-10-09-go-4-widget-operation-confirmation/metadata.json)
  Attested by another session: on the tree merged with main (which contained this feature) the per-package suites reported contracts 141, widget-sdk 19, api 160, ui 264 passed, 0 failed and pnpm typecheck exit 0; the test exit code was not printed. Indirect evidence about the whole tree, not a run of this feature.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
The user named the spec explicitly. The spec names Linear GO-3 'Организация хранения в БД', step 1 of 3 (steps 2 and 3 get their own specs), so the ID is GO-3-step-1 to keep later steps distinct. The plan names the spec as its Spec and shares its title and scope. Spec history: 498a39c, Codex-review fix 96cf8f5, boundary fix 61aca39; plan history: 190b9fe, Codex-review rounds ffafae7 and 3d0a806; neither file has uncommitted changes or a draft/obsolete/superseded marker, and both predate the implementation commits fd1b6ec..37af818 (2026-10-05), which are ancestors of main. The spec was read in full. The plan's goal, constraints, review focus, file map, task headings and Task 10 were read; the bodies of Tasks 1-9 were not read line by line. Both files were grep-scanned for secret patterns with no hits. Implementation evidence: the nine commits and the current code at f4ab72c, read at grep level against the spec. No implementation-review report, test log or Task 10 acceptance report exists for this feature, so review and verification are recorded as unverified. No completion date is recorded. Areas come from the paths changed by the implementation commits.
Evidence: [spec-doc], [plan-doc], [git-history], [code-vs-spec].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Working tree was dirty; uncommitted changes are not attributed to this feature automatically.
- Completion date not recorded; completedAt remains null.
- Deviations from plan were not recorded; absence of deviations is not claimed.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User authorized archiving with incomplete evidence: no implementation review, test log or Task 10 acceptance report exists for this feature

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
