# Dashboard Controls Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Track steps with checkboxes.

**Goal:** Match the approved quiet header and move dashboard controls to the bottom-right settings popover.

**Architecture:** Retain app.vue as the owner of board/theme/package actions. A SettingsPanel component renders the existing catalog and emits user choices. Native popover provides light dismissal and keyboard behavior. Keep editing and screen controls outside the panel.

**Tech Stack:** Vue 3, TypeScript, native Popover API, existing Vitest custom-renderer pattern, Orca browser.

**Spec:** docs/superpowers/specs/2026-10-23-dashboard-controls-design.md

## Global Constraints

- No dependencies, backend changes, branches, or commits; preserve the existing ClockAnalog1.vue diff.
- Use existing theme tokens; minimum window width remains 1280 px.
- Preserve validation, save/cancel, screen and space management, and theme persistence.

## Review Focus

- An unavailable or unloaded board must not permit placement or editing.
- Escape/outside click must dismiss settings; Escape returns trigger focus.
- Editing/build actions must remain visible with settings closed.
- Long names and short windows must not clip controls or hide failures.
- Theme selection must persist and remain legible in all three themes.

### Task 1: Settings panel and shell layout

**Files:** Create apps/ui/app/SettingsPanel.vue and apps/ui/test/settings-panel.test.ts. Modify app.vue, SpaceTitle.vue, ScreenDots.vue, and SpaceSwitcher.vue.

**Interfaces:** SettingsPanel accepts picker entries, loaded/view state, current space/screen, rows, themeId, apiLabel, and apiDown. Emits pick(key), edit(), library(), theme(id). Existing board expose and save/cancel interfaces remain unchanged.

- [x] Write component behavior tests using the existing compiler/custom-renderer pattern: action emission and dismissal, valid selection, disabled states, selected theme, dynamic API status/grid.
- [x] Run pnpm -C apps/ui test test/settings-panel.test.ts and observe the missing-feature failure.
- [x] Implement the native popover and move existing bindings; style title/switcher and footer controls.
- [x] Run the focused test and UI typecheck, then pnpm test.
- [x] Verify in Orca: open/close/focus, library, placement/cancel, edit/save/cancel, screens, theme persistence, short viewport and long title; inspect console and screenshots.
- [x] Request an independent read-only review of the named uncommitted files, resolve significant findings, and record actual verification below.

## Execution notes

User approved the design and implementation in this session. Work stays in the current checkout without branches or commits, as the approved spec requires. Execute inline without another confirmation.


## Verification results

- Panel tests: 8 failures against the empty baseline component, then 8/8 passing. Keyboard regression: 3 additional failing cases, then 11/11 passing after the fix.
- `pnpm -C apps/ui typecheck`: passed.
- `pnpm test`: passed, 1839 tests including 513 UI tests. Full output: `/tmp/lifedashboard-controls-tests-final.log`.
- `git diff --check`: passed. Existing ClockAnalog1.vue change preserved and excluded from the implementation/review scope.
- Orca at `http://127.0.0.1:3000/`: rendered app, no framework overlay, no browser warnings/errors in the final console check. Verified 1697×944, 1280×720, and 1280×480.
- Native dismissal: outside click and Escape close the panel; Escape restores focus to the trigger. Panel scrolls inside the short viewport (380 px panel, 484 px scroll height).
- Widget selection closes the panel and starts a draft with persistent Done/Cancel; cancelling removes the draft. Library opens its existing modal with the panel closed.
- Editing: row change/cancel restored 16; save/reload on Garage screen 2 persisted 12 → 13, then restored 13 → 12 and verified another reload. No test widgets or altered row counts remain.
- Space switch and both screen buttons work; header subscript follows screen 1/2. Final space/screen restored to Garage/2; theme restored to Glass.
- Themes: Glass/Obsidian/Paper apply with explicit selection. Obsidian persisted a reload; Paper was visually inspected at 1280 px. Samples inherit each theme's own tokens.
- Long-title layout stress: 4134 px of text clipped with ellipsis inside a 1490 px text box, with the switcher outside the title pill.
- Failure visibility: simulated existing board `api`/`notice` events displayed an external status banner and a trigger error dot while settings stayed closed; reset afterwards. An actual API outage was not induced.
- Screenshots: `/tmp/lifedashboard-controls.byqKon/final-open.png` (final Glass panel), `paper-edit.png` (1280 px edit controls).

## Independent review and decisions

- Independent read-only review by `review_dashboard_controls`; no Critical findings.
- Important finding fixed: editor shortcuts were receiving keyboard events from dashboard settings. Live RED confirmed Escape cancelled editing. Settings now stop bubbling while open without preventing native defaults. Regression cases for Escape/ArrowRight/Enter pass. Live GREEN: Escape closed only the panel, editing stayed active with unsaved rows=17 and focus returned to the settings trigger; ArrowRight on a theme button left the active widget rectangle unchanged.
- Deferred minor: the Done button's primary color rule precedes the base rule with equal specificity, so it uses the ordinary button styling. Functionality and contrast remain the same as the other existing controls.
- Ruling: retain the current checkout without creating branches or commits, following the approved spec and repository instructions. Changes remain uncommitted for user review.
- Ruling: run the UI preview with `CHOKIDAR_USEPOLLING=true` in a visible Orca terminal because filesystem watch notifications were delayed. This changes only that process environment; no repository configuration was changed.
- Not checked: packaged Tauri/macOS build, actual upstream outage, destructive deletion of existing spaces/screens/widgets. Existing data and package contents were preserved.


## Follow-up: quiet dashboard controls

User requested the same hover behavior for screen navigation and settings, with opacity 25% until hovered directly. The space trigger, screen navigation, and settings trigger now use shared shell rules: 0 outside the dashboard, 0.25 inside, 1 on direct hover, keyboard focus, or an open menu. Existing open panels and edit/save controls retain full readability. Fine-pointer hover devices use the effect; touch devices retain visible controls. Opacity transitions use 1.5 × the theme slow duration (480 ms normally), and existing reduced-motion behavior remains in effect.

Verified in Orca: all three idle opacities 0.25; individual nav/settings/space hover opacity 1 with other controls at 0.25; all three outside opacities 0; native space fan opening/closing; settings popover and trigger at opacity 1 while open; focused screen button keeps navigation at opacity 1 outside the dashboard. A running nav fade was observed at opacity 0.930842, currentTime ~266 ms, duration 480 ms, then reached 1. The shell itself remains at opacity 1. Browser warnings/errors: none. All four changed Vue style blocks compile, git diff --check passes, and pnpm test passes all 1839 tests.


## Follow-up: compact space switcher

Removed the corner trigger's coloured outline, outer accent ring and open-state enlargement; preserved keyboard focus indication and the selected border in the dropdown. Shifted the switcher origin, radial scrim and picker by 10 px left/down. The corner trigger and maximum hovered bubble share a 2.8 rem diameter. Idle dropdown bubbles render at scale 0.8; hover and keyboard focus use scale 1. The fan uses radius 4.75 rem, ring step 3.75 rem and gap 0.75 rem; closed items still collapse to the trigger's actual centre.

Verification: a new production-geometry regression test first failed with the old large fan, then passed. All 21 slots fit within a 20 rem corner region at minimum viewport scale, and their full hovered footprints do not overlap. All 1840 repository tests and UI typecheck pass; git diff --check passes. Orca confirmed a borderless 59.39 px trigger, 10 px root insets and idle bubbles of 47.51 px. The shared 2.8 rem hover footprint is covered by the geometry test and CSS inspection; final live hover-width measurement was not completed because the dashboard had an open edit draft and further GUI actions were stopped to preserve it. ClockAnalog1.vue was not modified by this task. No branches, commits or dependencies were added.


## Follow-up: smaller settings panel

Scaled the settings panel uniformly to 70% around its bottom-right anchor and moved its bottom anchor to preserve the gap above the smaller trigger. The gear trigger now measures 2.8 rem, matching the space trigger; reduced padding keeps the SVG icon at its previous size.

Orca layout verification used an invisible, inert clone of the actual panel to preserve the open board draft: painted width 445.46 → 311.82 px, width and height ratios both 0.7. Actual gear and space trigger widths both measure 59.39 px. The SVG icon changed only by rounding (31.945 → 31.938 px). All 1840 tests and git diff --check pass. No browser reload or UI state changes were used for this follow-up verification.
