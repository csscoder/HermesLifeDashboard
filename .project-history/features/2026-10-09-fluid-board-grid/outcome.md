# Fluid 24-column board grid with per-screen rows — frozen outcome

Feature ID: fluid-board-grid
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-09T09:48:26Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Grid rules in packages/contracts/src/grid.ts: 24 columns, rows 4..100 (default 12), hard 24x100 bound, occupiedRows/gridRows, and move/resize/findFreeRect limited by max(rows, current bottom) so red-zone widgets can only move out. (evidence: [code-vs-spec], [git-history])
- Per-screen rows: ScreenBoard.rows in contracts, screens.rows column via migration 3 with CHECK 4..100, read and saved by apps/api/src/rooms.ts. (evidence: [code-vs-spec], [git-history])
- Fluid board UI: html font-size 100vw/80, board as an inline-size container with stable scrollbar gutter and square --ld-cell, rendered rows held during pointer operations, green/red dots, exposed setRows, active-rect dragging state and ResizeObserver. (evidence: [code-vs-spec], [git-history])
- Base design section 7.4 updated to the 24-column fluid grid in commit 26cb754. (evidence: [git-history])

## Accepted decisions
- Cell size is pure CSS: the board is an inline-size container and --ld-cell = (100cqw - 23 gaps) / 24, so no measuring code is needed and it follows the board scrollbar. scrollbar-gutter: stable avoids layout jumps; a classic scrollbar costs under 1% of proportionality. (evidence: [spec-doc])
- Red-zone rule is one formula, limit = max(rows, current bottom) of the rect before the step: a red widget can move up, sideways, shrink or widen but never lower its bottom edge. Lowering rows never moves or hides widgets; the grid renders down to the lowest widget. The server checks only the hard 24x100 bound because it does not know where a widget stood before the session. (evidence: [spec-doc], [code-vs-spec])
- Rows are stored per screen and saved with the layout under expectedRevision in one PUT; the rows field lives in the edit-mode working copy so Cancel reverts it. (evidence: [spec-doc])
- Migration 3 deletes all placed widgets and widget state because 12-column coordinates are not carried over (requested by the user); it is irreversible for those rows, while packages, versions, grants and widget_audit stay. (evidence: [spec-doc], [code-vs-spec])
- Scale is html font-size calc(100vw / 80) without a cap (16 px at 1280), so text, gaps and cells scale together; sandbox frames already take rootFontSize from the host. sizeClass thresholds stay unchanged in cells. (evidence: [spec-doc])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-09-fluid-board-grid-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-09-fluid-board-grid.md` → [plan](plan.md)

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
- Command/check: pnpm test and pnpm typecheck on the tree merged with main, as attested in the GO-4 archive
  Result: unverified; exit code: not recorded; evidence: [go4-postmerge-tests].
- Command/check: Manual check in Orca's built-in browser from the spec's Testing section (1280/1920 px, 30-row scroll, 30 to 10 rows red zone, resize, empty board, rows field, sandbox scaling)
  Result: not-run; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: unverified; evidence: not recorded.

## Deviations from plan
- Change: Migration 3 bumps the revision only of rooms that had widgets, not every room as the spec states.
  Reason: Stated in the plan: bumping every room would also bump the fresh seed room and break API fixtures, while an empty room has no layout to overwrite and a pre-migration tab sends screens without rows, which the API rejects with 400.
  Effect: Pre-migration tabs of rooms with widgets get 409 and reload; empty rooms keep their revision.
  Evidence: [plan-doc], [code-vs-spec].

## Consciously excluded scope
- Out of scope per the spec: auto-scroll while dragging near the board edge, configurable column count, larger sizeClass thresholds, server-side enforcement of the red-zone rule, mobile layout. (evidence: [spec-doc])

## Confirmed follow-ups
Not recorded.

## Limitations and unresolved risks
- No implementation-review report, test log or manual browser report was found for this feature; the spec's manual browser checks are unrecorded. (evidence: [git-history])

## Evidence register
- [spec-doc] file: docs/superpowers/specs/2026-10-09-fluid-board-grid-design.md
  Approved design: 24 fixed columns filling the width with square cells, rows 4..100 per screen, red zone below configured rows with limit = max(rows, current bottom), migration 3 resetting widgets, html font-size 100vw/80, acceptance criteria and a manual browser check list.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: d6cc369fe865ea6f4eb1391d74838c557efc484f25ee1ceb643f6cfdc1efe712
- [plan-doc] file: docs/superpowers/plans/2026-10-09-fluid-board-grid.md
  Five-task TDD plan (grid rules, ScreenBoard.rows and 24x100 sizing, migration 3 and screens.rows, pointer mechanics, fluid board/dots/rows field/scale). All checkboxes are unticked; that is not evidence of the implementation state. It states one deviation from the spec: migration 3 bumps only rooms that had widgets.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: f44157635b48336588fa8be938766311d2e6a41ffc9fb9f0f47c6587f771eb1a
- [git-history] session: This session: git log, git diff --stat 618e688^..22c23d6, git merge-base --is-ancestor 22c23d6 main
  Commits 618e688 (spec), b694c74 (spec Codex-review corrections), b67199f (plan), 36fb095, 53a078a, 48fadbb, e4c9684, c65e607 (one feat commit per plan task), 26cb754 (base design update) and 22c23d6 (test fix) are all dated 2026-10-09 and 22c23d6 is an ancestor of main. The range touches contracts, api and ui sources and tests (25 files).
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [code-vs-spec] session: This session: reads and greps of packages/contracts/src/grid.ts, apps/api/src/migrations.ts, apps/api/src/rooms.ts, apps/ui/app/board/WidgetBoard.vue, apps/ui/app/app.vue, apps/ui/app/board/use-active-rect.ts at HEAD f4ab72c
  grid.ts matches the spec and plan (GRID_COLS 24, ROWS 4/100/12, inBounds hard bound, occupiedRows, gridRows, limitFor = max(rows, bottom) in moveTo/resizeTo, findFreeRect within rows). Migration 3 adds screens.rows with CHECK 4..100 default 12, bumps the revision only for rooms that had widgets, deletes widget_state and widgets. rooms.ts reads and saves rows. WidgetBoard.vue has container-type inline-size, scrollbar-gutter stable, --ld-cell, --grid-rows, held rendered rows, green/red dots with --ld-success/--ld-danger and an exposed setRows; app.vue has font-size calc(100vw / 80); use-active-rect.ts has a dragging ref and a ResizeObserver. Test bodies and the rows-field markup details beyond a grep hit were not read.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [go4-postmerge-tests] session: This session: read of evidence entry tests-postmerge in the frozen GO-4 archive metadata (.project-history/features/2026-10-09-go-4-widget-operation-confirmation/metadata.json)
  Evidence entry tests-postmerge of the GO-4 archive, attested by another session: on the tree merged with main (which contained this feature) the per-package suites reported contracts 141, widget-sdk 19, api 160, ui 264 passed, 0 failed and pnpm typecheck exit 0; the test exit code was not printed. This is indirect evidence about the whole tree, not a run of this feature.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
The user named the spec explicitly. The plan names it as its Spec and was committed in b67199f after the spec's Codex-review corrections (b694c74); neither file changed after that (git diff b67199f..HEAD is empty for both), and neither carries a draft/obsolete/superseded marker. The spec was read in full; the plan's goal, constraints, review focus, file structure and Tasks 1-2 were read in full and Tasks 3-5 by structure (headings, steps), with a grep scan of both files for secret patterns (no hits). The feature has no tracker key in the materials, so the ID is the spec slug. Implementation evidence: commits 36fb095..22c23d6 are on main and the current code at f4ab72c was read against the spec. No implementation-review report, test log or manual-browser report exists for this feature; verification and review are therefore recorded as unverified. Areas come from the paths changed by those commits. No completion date is recorded.
Evidence: [spec-doc], [plan-doc], [git-history], [code-vs-spec].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Working tree was dirty; uncommitted changes are not attributed to this feature automatically.
- Completion date not recorded; completedAt remains null.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User authorized archiving with incomplete evidence: no implementation review, test log or manual browser report exists for this feature

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
