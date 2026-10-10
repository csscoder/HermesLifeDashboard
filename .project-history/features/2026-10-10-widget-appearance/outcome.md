# Per-widget appearance — frozen outcome

Feature ID: widget-appearance
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-10T16:28:19Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Widget appearance contract: DropShadow, WidgetAppearance, BARE_THEME_ID, SHADOW_LIMITS, DEFAULT_SHADOW; validation and normalization in parseScreenBoard (packages/contracts, commit e00e7ad). (evidence: [ev-commits])
- Storage: nullable widgets.appearance column via migration 5; read and written in rooms.ts; boards without appearance keep their JSON (commit 73f9fd8). (evidence: [ev-commits])
- Rendering: resolveWidgetLook, shadowCss, bare skin (bare.css), .widget--foreign rule in comfort.css, per-widget look passed to WidgetFrame and WidgetHost, useWidgetContext re-reads tokens when foreign changes (commits cabe8fb, eb6d29b). (evidence: [ev-commits])
- Edit helpers: setAppearance in edit-session.ts; styleValue, withStyle, withShadow, panelPosition in widget-settings.ts (commit 31d85c2). (evidence: [ev-commits])
- Edit mode: gear button next to remove, WidgetSettings popover panel (style select, shadow toggle and controls, reset), keyboard guard while the panel is open, panel closes on board-caused changes (commits fa65a15, eed615b, 3d42cf5). (evidence: [ev-commits])

## Accepted decisions
- Appearance is stored in widgets.appearance, not in config: config belongs to the widget (sandbox widgets receive it, own configVersion); appearance belongs to the host. (evidence: [ev-spec])
- Bare («Без оформления») is stored as builtin:bare, applies to one widget only and is not a theme: it has no token block, so tokens and colours come from the board theme. (evidence: [ev-spec])
- Shadow on a framed widget is box-shadow on .widget__wrapper, replacing the theme's shadow; on a bare widget it is filter: drop-shadow(). A card is a rectangle, so box-shadow matches it, and filter would break Glass backdrop-filter; drop-shadow follows the round clock dial. (evidence: [ev-spec])
- This reverses the theme-engine spec's rule that per-widget overrides are dropped, for the shadow only, because the user asked for it. Token overrides stay out. (evidence: [ev-spec])
- The panel is a non-modal popover="auto" positioned from the gear's getBoundingClientRect(), because CSS anchor positioning is not supported in every browser. (evidence: [ev-spec])
- A widget whose theme differs from the board's paints the opaque surface-1-solid with zero blur (the foreign rule from the theme-engine spec, implemented here). (evidence: [ev-spec])
- A stored unknown themeId is kept and rendered with the board theme; the panel shows «Как у доски» until the user chooses otherwise. (evidence: [ev-spec])
- Focus returns to the gear after a user close only when focus is on body or inside the panel. This refines the spec so that a click on another widget keeps focus there. (evidence: [ev-plan])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-09-widget-appearance-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-09-widget-appearance.md` → [plan](plan.md)

## Areas and modules
Not recorded.

## Git state
Repository root: .
Branch: csscoder/widget-edit-gear-button
HEAD commit: 5e2988394600f9826cf5648baef2784bd80afecc
Describe: 5e29883
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [ev-commits].

## Verification
Reported status: unverified.
- Command/check: pnpm -r typecheck && pnpm test (plan Task 7, Step 1); not run for this archive, no recorded result
  Result: unverified; exit code: not recorded; evidence: not recorded.
- Command/check: Orca built-in browser acceptance (plan Task 7, Step 3, checks 1-11: gear, panel open/close/switch, bare clock shadow, bare sandbox shadow, foreign widget, keyboard, cancel, reset no-op, persist, removal closes panel, old boards); no recorded result
  Result: unverified; exit code: not recorded; evidence: not recorded.
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
Deviations: not recorded / unverified. No absence claim is made.

## Consciously excluded scope
- User themes, a board-wide bare theme, shadow spread, inset shadows and per-widget token overrides (spec Out of scope). (evidence: [ev-spec])
- The transparency: reduced half of the foreign-widget rule; it waits for the ComfortProfile UI (spec, Rendering). (evidence: [ev-spec])

## Confirmed follow-ups
- Run the full typecheck and test suite and the Orca browser acceptance (plan Task 7), then record the results. No result is recorded in this archive. (evidence: [ev-plan])
- Check that drop-shadow on a bare sandbox widget follows its content outline, not the iframe box (spec, Unverified (inferred)). (evidence: [ev-spec])

## Limitations and unresolved risks
- Panel behaviour (gear toggle, focus return, keyboard guard) has no automated test; the plan covers it only with the Task 7 browser checks, which are unrecorded. (evidence: [ev-plan])
- Foreign-widget opacity and the bare sandbox shadow are unverified in a browser. (evidence: [ev-spec], [ev-plan])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-09-widget-appearance-design.md
  Approved design. Decisions: appearance stored in widgets.appearance, not config; bare theme as builtin:bare, widget scope only; shadow as box-shadow on framed widgets and drop-shadow on bare ones; non-modal popover panel positioned from the gear rect; foreign widgets paint opaque surface-1-solid. Out of scope: user themes, board-wide bare theme, shadow spread, inset shadows, per-widget token overrides. Acceptance criteria 1-7.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 6ccf3c2672942fb475943d69d6a0a1e045a2f8262a70a3318bba4b21ccffbfa1
- [ev-plan] file: docs/superpowers/plans/2026-10-09-widget-appearance.md
  Seven tasks: contract and validation; SQLite migration 5; widget look, shadow CSS, bare skin and foreign rule; per-widget rendering; edit helpers; settings panel and gear; full verification and browser acceptance (Task 7: full typecheck and test run, 11 browser checks in Orca's built-in browser). All 36 plan checkboxes are unchecked, which records nothing either way. The plan refines the spec: focus returns to the gear after a user close only when focus is on body or inside the panel. The SFC panel has no unit-test harness; its behaviour is covered by the Task 7 browser checks only.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: f303bf030434c00ecbd345b8512612a7354b3486f325fb38965ee39f26f11c05
- [ev-commits] session: This archive session, Bash: git log --oneline -15 and git status --short on branch csscoder/widget-edit-gear-button (HEAD 5e29883); file existence checks by grep and ls in apps/ and packages/
  Commits for the feature: e00e7ad (contracts validation and normalization, Task 1); 73f9fd8 (migration 5, Task 2); cabe8fb (resolveWidgetLook, bare skin, foreign rule, Task 3); eb6d29b (per-widget rendering, Task 4); 31d85c2 (setAppearance and panel helpers, Task 5); fa65a15 (gear and settings panel, Task 6); eed615b and 3d42cf5 (fixes to the panel, keyboard, focus and shadow CSS, after Task 6). Symbols and files named in the plan exist in the working tree. Working tree was clean at the start of the session. No commit or file records Task 7 results.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
Read the full spec (status: approved, 2026-10-09) and the full plan (Tasks 1-7). The plan's header links the spec by path; both use the 2026-10-09-widget-appearance slug. Neither has a draft, obsolete or superseded marker; HEAD (5e29883) is the final version (the last spec and plan commits are 2cfcc22 and fcf927d). Implementation: commits e00e7ad through 3d42cf5 map to plan Tasks 1-6; the symbols and files named in the plan (normalizeAppearance, migration 5, resolveWidgetLook, shadowCss, bare.css, widget--foreign, setAppearance, panelPosition, WidgetSettings.vue, data-settings) exist in the working tree. No review artifact and no recorded result for Task 7 (full test run and Orca browser acceptance) exist in the repository or this session, so review and verification are not recorded. Tests were not run for this archive. Archive mode is incomplete-evidence by explicit user choice.
Evidence: [ev-spec], [ev-plan], [ev-commits].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- Deviations from plan were not recorded; absence of deviations is not claimed.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User explicitly chose incomplete-evidence archiving: no review record and no recorded result for plan Task 7 (test run and browser acceptance).

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
