# Screen Settings Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Put theme and confirmed deletion together above the active screen bullet in board edit mode.
**Architecture:** Extend ScreenDots with a native auto-popover positioned from the active item, reuse board draft theme API and existing confirmation dialog. Remove duplicate screen controls from SettingsPanel.
**Tech Stack:** Vue 3, TypeScript, Vitest, native Popover API.
**Spec:** `docs/superpowers/specs/2026-10-23-theme-inheritance-design.md` (Screen settings placement update).

## Global Constraints

Preserve prior work. No dependencies, branches, commits or persistence changes. Use Orca browser and isolated acceptance data. Continue direct implementation as authorized.

## Review Focus

- Theme remains a draft; Cancel restores and Done persists.
- Empty screen deletion still asks; declining never deletes or saves.
- Single-screen deletion confirms the space and protects the final space.
- Panel stays above the active bullet, clears the scroll container and fits viewport.
- Keyboard dismissal, disabled/switching states, changed screen identity and focus restoration do not reach board shortcuts.

### Task 1: Always confirm screen deletion

**Files:** `board/switch-flow.ts`, `spaces/nav.ts`, their UI tests; caller in `WidgetBoard.vue`.
**Interfaces:** runDeleteScreen({ask, remove}) no longer takes needsConfirm. Remove unused needsDeleteConfirm.
- [x] RED/GREEN for decline, pending answer, accepted delete and failure reactions. Keep no-pre-save behavior.

### Task 2: Anchored screen controls

**Files:** `spaces/ScreenDots.vue`, `SettingsPanel.vue`, `app.vue`, UI tests and reusable test renderer if needed.
**Interfaces:** ScreenDots gains themeId:string|null, emits theme(id:string|null); app routes it to board.setScreenTheme. Existing remove event continues through confirmation.
- [x] Add failing rendered-component tests for active-only gear, draft theme event/inheritance, shared delete control, placement, closing, disabled and keyboard behavior.
- [x] Replace active-screen X with gear and add native popover; remove duplicate screen selector from dashboard settings. Run focused tests GREEN.

### Task 3: Verification and docs

- [x] Update current README/theme docs for new control location.
- [x] Run full tests, typecheck, build and git diff --check; independent review.
- [x] Orca acceptance: popup placement, screen themes, Done/Cancel, empty/populated deletion confirmation and cancel, single-screen and final-space safety, dismissal and console.

## Progress

Started. Work in current checkout per existing authorization. Deletion flow and UI use disjoint ownership; no Git operations authorized.

Task 1 complete: 6 expected RED failures with the old confirmation bypass; 20 focused tests GREEN after always asking and removing the obsolete helper. WidgetBoard caller updated.
Task 2 complete: UI component RED 11 failures; focused GREEN 44/44 after integration. Shared renderer extracted from existing settings-panel tests without a new dependency. Native template ref keys differ from setup bindings so the compiled ref cannot overwrite its binding.
Independent review found an Important Escape path after Shift+Tab back to the gear: panel-local keyboard handling did not protect the board. Added a failing gear-bubbling regression, then stopped propagation on the navigation while the panel is open; default browser dismissal remains enabled. A second RED/GREEN test keeps internal panel scrolling usable while outside scroll/resize close it. No deferred minors.

Browser acceptance found the existing shell inactivity CSS made an open screen panel invisible and non-interactive when the page lost hover/focus (native `:popover-open` remained true, navigation opacity 0, inherited pointer-events none). The rendering assertion failed before the fix. Keep navigation visible whenever it contains an open popover, using the shell's existing visibility selector. This preserves the panel independently of native focus reporting in Orca.

## Final results

- Full `pnpm test`: 1890/1890 passed (UI 530), including a second full run after the shell visibility fix. Focused feature tests: 44/44. `pnpm typecheck`, root `pnpm build`, and final UI build passed. `git diff --check` passed.
- Orca test UI/API used temporary data at `http://127.0.0.1:62343`, viewport 1697×944. Verified live: gear only in edit mode; popover positioned 8 px above the active bullet, horizontally centered within 0.004 px; explicit theme and inheritance preview without server writes; Cancel restores; Done/reload persists. Empty and populated screen deletions both ask, cancel keeps screens/widgets, accept deletes; only-screen deletion confirms its space; final space remains protected. Console contained no messages.
- Open-panel shell rendering regression GREEN after disabling the navigation opacity transition while its native popover is open: navigation opacity 1, inherited pointer-events auto, popover open, bottom 882.969 px versus anchor top 890.969 px.
- Orca native Shift+Tab/Escape acknowledged input without the expected focus/dismissal changes. DOM focus + keyboard bubbling verified that Escape on the gear preserves the board draft. Native keyboard behavior remains unverified in this host.
- Orca screenshot has a reproduced side effect: before screenshot, edit mode and `:popover-open` are true and the accessibility snapshot contains the dialog; immediately after screenshot edit mode is still true but the popover is closed. Therefore screenshot pixels do not establish the panel's visual appearance. Geometry, styles, interaction state and snapshot were verified separately; no external browser fallback used. Scratch scripts/data are outside the repository in `ld-screen-popover-dfz38tgp`.
- Documentation check: 22 pre-existing missing references in three untouched SDK acceptance reports; no touched-document errors. README and theme contract now point to the active-screen gear as the screen-theme entry point.
- No dependencies, branches, commits, pushes or persistence changes. Existing unrelated work preserved. Independent review had one Important keyboard finding, fixed by RED/GREEN; no deferred minors. Temporary acceptance browser tab/server are closed after verification.
