# Board edit mode: move, resize and delete placed widgets — frozen outcome

Feature ID: board-edit-mode
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-09T10:10:45Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Pure edit-session helpers in apps/ui/app/board/edit-session.ts: BoardMode type, setPlacement, removeInstance, isSameBoard, plus reading-order focus helpers, with unit tests. (evidence: [code-vs-spec], [git-history])
- The useActiveRect composable (use-active-rect.ts) extracted from the builder draft mechanics, with unit tests. (evidence: [code-vs-spec], [git-history])
- Edit mode in WidgetBoard.vue and app.vue: an 'Изменить' header button, a mode ref replacing the building flag, move/resize/delete of placed widgets by pointer and keyboard on a working copy, 'Готово' and 'Отмена'. (evidence: [code-vs-spec], [git-history])

## Accepted decisions
- Scope is move, resize and delete, saved as a batch: 'Готово' writes once and 'Отмена' discards everything including deletions, which protects against accidental deletion and maps to a single future write. The hover delete button exists only in edit mode. (evidence: [spec-doc])
- Builder draft mechanics are extracted into one composable (useActiveRect) used by build and edit modes, so drag, resize, keyboard and GSAP motion have one implementation and WidgetBoard.vue stops growing; document operations live in a pure edit-session module. (evidence: [spec-doc], [code-vs-spec])
- Mode state is one BoardMode value ('view' | 'build' | 'edit') replacing a boolean, so impossible combinations cannot be expressed. (evidence: [spec-doc], [code-vs-spec])
- Native Pointer Events and existing GSAP motion are used instead of a drag/resize library (grid-layout-plus candidate in the base design), because libraries tend to push neighbours, contradicting 'block, don't shift'; no new dependency. Move and resize never enter occupied cells. (evidence: [spec-doc])
- Cross-tab conflicts (DATA-06): the original design compared the stored document with an entry snapshot on 'Готово' and refused to write on mismatch, showing 'Доска изменена в другой вкладке'; widget content gets pointer-events: none in edit mode so dragging never conflicts with future interactive widgets. A widget of an unknown type can move and be deleted but not resized. (evidence: [spec-doc])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-05-board-edit-mode-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-05-board-edit-mode.md` → [plan](plan.md)

## Areas and modules
ui

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
- Command/check: pnpm typecheck and pnpm test (plan Task 3 steps 4-5), as covered by the GO-4 post-merge run
  Result: unverified; exit code: not recorded; evidence: [go4-postmerge-tests].
- Command/check: Manual check in Orca's built-in browser from the plan's Task 3 step 7 (view mode, drag/resize, delete, keyboard, cancel and save, delete all, two-tab conflict, storage failures, unknown widget type)
  Result: not-run; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: unverified; evidence: not recorded.

## Deviations from plan
Deviations: not recorded / unverified. No absence claim is made.

## Consciously excluded scope
- Out of scope per the spec: reset layout, expectedRevision and API routes, Rooms and moving widgets between rooms, undo inside the mode, multi-select, component and e2e tests, mobile layout. (evidence: [spec-doc])

## Confirmed follow-ups
Not recorded.

## Limitations and unresolved risks
- No implementation-review report, test log or manual browser check report was found for this feature. (evidence: [git-history])
- Parts of the spec are historical: the localStorage snapshot conflict check was replaced by a per-room revision through the API (commit 37af818, storage spec), 'Изменить' is enabled once the board is loaded rather than only when widgets exist, and the grid became 24 columns with per-screen rows. (evidence: [git-history], [code-vs-spec])

## Evidence register
- [spec-doc] file: docs/superpowers/specs/2026-10-05-board-edit-mode-design.md
  Approved design: an 'Изменить' header button enables an edit mode where placed widgets move and resize cell by cell (pointer and keyboard) and are deleted; changes are batched in a working copy, 'Готово' saves once and 'Отмена' discards; BoardMode view|build|edit; builder mechanics extracted into the useActiveRect composable; pure edit-session helpers; a local snapshot comparison against localStorage stands in for expectedRevision; acceptance criteria and a manual browser check list.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 194d44a0724dcb75a53bfb53313c36ce14452303a04cfeb11505d906e5f8d427
- [plan-doc] file: docs/superpowers/plans/2026-10-05-board-edit-mode.md
  Three-task TDD plan (edit-session.ts operations; use-active-rect.ts composable and builder refactor; edit mode in WidgetBoard.vue and app.vue with a twelve-item manual browser check). All checkboxes are unticked; that is not evidence of the implementation state. No new dependencies; native Pointer Events and existing GSAP motion.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: b5c567177155d569798013e12318de11c5cf9afe46e392d052543d5ca3c9c209
- [git-history] session: This session: git log for both source files, git log d9da676^..1c5a112, git diff --stat d9da676^..1c5a112, git merge-base --is-ancestor 1c5a112 main, git show 37af818 --stat for edit-session.ts
  Implementation commits d9da676 (edit session document operations), 86bbb6f (extract active rect mechanics), 1c5a112 (edit mode to move, resize and delete placed widgets), all 2026-10-05, 6 files changed (app.vue, WidgetBoard.vue, edit-session.ts, use-active-rect.ts and two test files), 1c5a112 is an ancestor of main. Commit 37af818 later changed edit-session.ts (6 insertions, 25 deletions), dropping the local conflict check when the board moved to the API.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [code-vs-spec] session: This session: greps of apps/ui/app/board/{edit-session,use-active-rect,WidgetBoard}.vue/.ts, apps/ui/app/app.vue and a listing of apps/ui/test at HEAD f4ab72c
  Present at the grep level: BoardMode = 'view' | 'build' | 'edit' exported from edit-session.ts with setPlacement, removeInstance, isSameBoard, readingOrder, focusAfterRemoval (and later withRows); useActiveRect in use-active-rect.ts; app.vue holds a mode ref and sets mode = 'edit' from 'Изменить'; WidgetBoard.vue takes a mode model, handles Delete and Backspace only from inside the board, renders role=group items with aria-labels including the delete button label 'Удалить виджет W×H'; edit-session.test.ts and use-active-rect.test.ts exist. 'Изменить' is now enabled by boardRef.loaded, not by the board having widgets. Test bodies and most code were not read.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [go4-postmerge-tests] session: This session: read of evidence entry tests-postmerge in the frozen GO-4 archive metadata (.project-history/features/2026-10-09-go-4-widget-operation-confirmation/metadata.json)
  Attested by another session: on the tree merged with main (which contained this feature) the per-package suites reported contracts 141, widget-sdk 19, api 160, ui 264 passed, 0 failed and pnpm typecheck exit 0; the test exit code was not printed. Indirect evidence about the whole tree, not a run of this feature.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
The user named the spec explicitly. The plan names it as its Spec and shares its title and scope (three tasks: edit session operations, active-rect composable with builder refactor, edit mode in the board and header). Spec history: 17fe89b, Codex-review fix ded8859; plan history: 2a5bd0f, Codex-review fix a19f4f8; neither file has uncommitted changes or a draft/obsolete/superseded marker, and both predate the implementation commits d9da676, 86bbb6f, 1c5a112 (2026-10-05, ancestors of main). The spec was read in full. The plan's goal, architecture, constraints, review focus, task headings and the end of Task 3 (root checks, manual check list) were read; the bodies of Tasks 1-3 were not read line by line. Both files were grep-scanned for secret patterns with no hits. No tracker key exists in the materials, so the ID is the spec slug. Implementation evidence: the three commits (6 files, 726 insertions) and the current code at f4ab72c read at grep level against the spec. No implementation-review report, test log or manual-check report exists for this feature, so review and verification are recorded as unverified. No completion date is recorded. Areas come from the paths changed (all under apps/ui).
Evidence: [spec-doc], [plan-doc], [git-history], [code-vs-spec].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Working tree was dirty; uncommitted changes are not attributed to this feature automatically.
- Completion date not recorded; completedAt remains null.
- Deviations from plan were not recorded; absence of deviations is not claimed.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User authorized archiving with incomplete evidence: no implementation review, test log or manual-check report exists for this feature

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
