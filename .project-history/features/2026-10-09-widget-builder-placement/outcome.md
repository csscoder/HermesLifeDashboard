# Widget builder v1: placement at real size — frozen outcome

Feature ID: widget-builder-placement
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-09T10:12:18Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Pure grid placement logic with Vitest introduced in apps/ui (later moved to packages/contracts), a widget catalog with the placeholder manifest, and a versioned board document with parser and storage (later removed when storage moved to the API). (evidence: [git-history], [code-vs-spec])
- UI: WidgetFrame and WidgetHost with the unknown-widget fallback, an explicit renderer registry, the placeholder widget, a builder mode in WidgetBoard.vue with a '+' header button, draft move and resize by pointer and keyboard, jelly draft motion (draft-motion.ts), and the narrow-window message. (evidence: [git-history], [code-vs-spec])

## Accepted decisions
- Drag and resize use native Pointer Events and CSS Grid with no library, because libraries tend to push neighbours, contradicting the base design's 'block, don't shift'; snapping, bounds and collisions are a pure Vue-free TypeScript module that can be unit-tested and reused for later move/resize. (evidence: [spec-doc])
- The board is a portable versioned document with separate instances and layout arrays (mirroring WidgetInstance and RoomLayout), validated by one parser for every external input; an unknown widget type is accepted and rendered as 'Неизвестный виджет' so a newer document never breaks the board. (evidence: [spec-doc])
- Every widget, including the draft, renders through WidgetHost and WidgetFrame so the draft looks exactly like the final widget; a widget manifest holds default, min and max sizing and an explicit renderer registry replaces import.meta.glob (autoImport and components stay disabled). (evidence: [spec-doc], [code-vs-spec])
- One rem-based scale: every size is a rem token and only the root font size follows the viewport; below 1280 px width the app shows 'Окно слишком узкое' (base design section 7.4). (evidence: [spec-doc], [code-vs-spec])
- Builder mode starts from findFreeRect with the default size and falls back to the minimum size; with neither free it shows 'Нет свободного места'. The draft is committed only on 'Готово' (or Enter); the card floats freely under the pointer and only the snapped landing slot is validated. vitest 5.0.3 was added as the only new dependency of apps/ui. (evidence: [spec-doc], [plan-doc])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-04-widget-builder-placement-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-04-widget-builder-placement.md` → [plan](plan.md)

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
- Command/check: pnpm typecheck and pnpm test (plan Task 4), as covered by the GO-4 post-merge run
  Result: unverified; exit code: not recorded; evidence: [go4-postmerge-tests].
- Command/check: Manual browser check from the spec's Testing section (dot grid and draft, snapping, resize limits, keyboard, persistence across reload, delete, full board, corrupted storage, no scroll at 1280x700 and 1920x1080, narrow window message)
  Result: not-run; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: unverified; evidence: not recorded.

## Deviations from plan
- Change: While building, the header replaces '+' with 'Готово' and 'Отмена', exposed by WidgetBoard as confirm() and cancel() (the spec only disables '+').
  Reason: Declared in the plan as a deliberate deviation from the spec.
  Effect: not recorded
  Evidence: [plan-doc].
- Change: Below 1280 px the whole UI (header and board) is replaced by 'Окно слишком узкое'.
  Reason: Follows base design section 7.4 so a usable '+' never sits next to a hidden board.
  Effect: not recorded
  Evidence: [plan-doc], [code-vs-spec].
- Change: Two tabs: WidgetBoard reloads the document on the storage event; 'Готово' and the delete button re-read storage first and a taken place shows 'Место занято, переместите виджет'.
  Reason: Declared in the plan; it synchronises sequential changes only, writes by two tabs at the same moment are not atomic and a tab whose save failed can overwrite other tabs later (accepted for placeholders).
  Effect: not recorded
  Evidence: [plan-doc].
- Change: widget-theme.css is registered through css in nuxt.config.ts; WidgetFrame hardcodes data-widget-theme="default"; WidgetBoard emits a notice string rendered in an always-present role=status header element.
  Reason: Declared in the plan as small structural choices (theme selection and messages were not specified in detail).
  Effect: not recorded
  Evidence: [plan-doc].

## Consciously excluded scope
- Out of scope per the spec: export/import buttons, theme selection and additional themes, moving/resizing placed widgets, rectangle selection, widget gallery, prompt step, Hermes generation, declarative and component widgets, useWidgetRuntime and data sources, API routes and SQLite, Rooms, packages/contracts, component and e2e tests, mobile layout. (evidence: [spec-doc])

## Confirmed follow-ups
- The spec lists proposals for the base design that it does not decide: choose declarative variants by min size, route widget data through a shared widget runtime, and replace separate widget install and layout routes with one atomic install use case. (evidence: [spec-doc])

## Limitations and unresolved risks
- No implementation-review report, test log or manual browser check report was found for this feature. The plan's deviations list records what was intended, not a comparison with the final code. (evidence: [git-history])
- Much of the spec is historical: the localStorage board document and parseBoardDocument were replaced by SQLite behind the API (37af818), the 12x8 grid by 24 columns with per-screen rows, the single default theme by a theme engine, and the scale formula by 100vw / 80. (evidence: [git-history], [code-vs-spec])

## Evidence register
- [spec-doc] file: docs/superpowers/specs/2026-10-04-widget-builder-placement-design.md
  Approved design: a '+' header button opens a builder mode over a 12x8 dot grid with a draft widget moved and resized cell by cell at real size with native Pointer Events and GSAP motion; 'Готово' leaves a placeholder persisted in localStorage as a versioned board document validated by parseBoardDocument; widget manifest and catalog, explicit renderer registry, shared WidgetFrame with theme tokens, rem-based scale with a 1280 px minimum width, acceptance criteria and a manual browser check list.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 618079fc80f96deb467f6c9263e5731b72d43458d98f4b69eb1e11f39edc3716
- [plan-doc] file: docs/superpowers/plans/2026-10-04-widget-builder-placement.md
  Four-task TDD plan (Vitest in apps/ui and grid logic; catalog and board document; widget frame, host, board and header; repository-wide verification and report). All checkboxes are unticked; that is not evidence of the implementation state. It lists six deliberate deviations from the spec (header buttons while building, whole UI replaced when narrow, two-tab storage sync, theme CSS registration, hardcoded theme attribute, notice messages).
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 9551de0fc508fd6331dd3808133f487a4eb05cc0645573134645be680863aab2
- [git-history] session: This session: git log for both source files, git log de0b6c1^..9eebc53, git diff --stat de0b6c1^..9eebc53, git merge-base --is-ancestor 9eebc53 main, git log for board-document.ts
  Implementation commits de0b6c1 (grid logic with vitest), 312122c (catalog and versioned board document), a31a2d9 (widget builder with real-size placement board), 30cf8bf (retain persistence warnings), 9eebc53 (jelly motion for the draft drag), all 2026-10-04, 18 files changed; 9eebc53 is an ancestor of main. board-document.ts was removed later by 37af818 when the board moved to the API, and fd1b6ec moved grid logic into packages/contracts.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [code-vs-spec] session: This session: greps and listings of apps/ui/app/widgets, apps/ui/app/board, apps/ui/test, apps/ui/app/app.vue, WidgetBoard.vue, WidgetHost.vue and apps/ui/package.json at HEAD f4ab72c
  Present at the grep level: catalog.ts re-exporting built-in manifests, registry.ts, WidgetFrame.vue, WidgetHost.vue with the 'Неизвестный виджет' fallback, builtin/PlaceholderWidget.vue, board/draft-motion.ts with draft-motion.test.ts, 'Окно слишком узкое' in app.vue, 'Нет свободного места' in WidgetBoard.vue, vitest 5.0.3 and a test script in apps/ui/package.json. Absent because later work replaced them: apps/ui/app/widgets/grid.ts, board-document.ts and widget-theme.css (grid moved to packages/contracts, storage moved to the API, themes became a token contract). Test bodies and most code were not read.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [go4-postmerge-tests] session: This session: read of evidence entry tests-postmerge in the frozen GO-4 archive metadata (.project-history/features/2026-10-09-go-4-widget-operation-confirmation/metadata.json)
  Attested by another session: on the tree merged with main (which contained this feature) the per-package suites reported contracts 141, widget-sdk 19, api 160, ui 264 passed, 0 failed and pnpm typecheck exit 0; the test exit code was not printed. Indirect evidence about the whole tree, not a run of this feature.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
The user named the spec explicitly. The plan names it as its Spec and shares its title and scope (four tasks: Vitest and grid logic, catalog and board document, frame/host/board/header, repository-wide verification). Spec history: 9c5615e, Codex-review fix 720c55c, scale and storage fix 6e301e3; plan history: be64f3a, Codex-review fix ea05338, follow-ups c5dbd65 and f5f130a; neither file has uncommitted changes or a draft/obsolete/superseded marker, and both predate or accompany the implementation commits de0b6c1, 312122c, a31a2d9, 30cf8bf, 9eebc53 (2026-10-04, ancestors of main). One implementation commit (9eebc53) also edited the spec by 16 lines; the working-tree spec is the final version. The spec was read in full. The plan's goal, architecture, global constraints, deviations from the spec, review focus and task headings were read; the bodies of Tasks 1-4 were not read line by line. Both files were grep-scanned for secret patterns with no hits. No tracker key exists in the materials, so the ID is the spec slug. Implementation evidence: the five commits (18 files, 1323 insertions) and the current code at f4ab72c read at grep level. No implementation-review report, test log or manual-check report exists for this feature, so review and verification are recorded as unverified. No completion date is recorded. Areas come from the paths changed (all under apps/ui).
Evidence: [spec-doc], [plan-doc], [git-history], [code-vs-spec].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Working tree was dirty; uncommitted changes are not attributed to this feature automatically.
- Completion date not recorded; completedAt remains null.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User authorized archiving with incomplete evidence: no implementation review, test log or manual-check report exists for this feature

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
