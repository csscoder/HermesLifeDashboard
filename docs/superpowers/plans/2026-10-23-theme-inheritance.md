# Theme Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist three dashboard theme scopes while preserving widget overrides.
**Architecture:** Existing resolver, space PATCH and revision-checked board PUT; additive SQLite columns, no theme import system.
**Tech Stack:** TypeScript, Vue/Nuxt, Fastify/SQLite, Vitest.
**Spec:** `docs/superpowers/specs/2026-10-23-theme-inheritance-design.md`

## Global Constraints

No new dependencies, branches or commits. Preserve pre-existing edits. Browser checks use Orca. The user requested direct implementation; no further approval gates.

## Review Focus

- Migration preserves existing data and defaults to inheritance.
- Unknown theme IDs fall back, invalid/bare scope IDs are rejected.
- Ordinary board edits preserve themes; concurrent writes retain revision checks.
- Screen edit preview cancels cleanly and failed saves preserve previous state.
- Switching spaces/screens resolves the displayed board, without leaking another scope's theme.

### Task 1: Contracts and persistence

**Files:** `packages/contracts/src/{board,space}.ts`, their tests; `apps/api/src/{migrations,spaces}.ts`, API spaces/db tests.
**Interfaces:** SpaceSummary.themeId: string | null; SpacePatch.themeId?: string | null; ScreenBoard.themeId?: string | null (omit inherited IDs canonically, before instances). Export existing isThemeId from board for reuse. Screen theme saved through board PUT; space theme through PATCH. Reject builtin:bare for these scopes.
- [x] Write validation, round-trip/reset, conflict and compatibility tests; run and observe expected failures.
- [x] Add columns and contract/API support; run focused tests to green.

### Task 2: UI and theme resolution

**Files:** `SpacePicker.vue`, `SpaceSwitcher.vue`, `SettingsPanel.vue`, `app.vue`, `WidgetBoard.vue`, `edit-session.ts`, theme styles/resolve as needed, UI tests and affected fixtures.
**Interfaces:** WidgetBoard exposes screenThemeId and themeSpaceId; setScreenTheme(id: string | null) updates a draft in edit mode or saves in view mode. SettingsPanel receives dashboard themeId, screenThemeId, screenThemeDisabled and emits screenTheme.
- [x] Add meaningful failing UI and draft/preservation tests; observe RED.
- [x] Add space theme choices, screen theme control, resolved root theme, theme-aware bubbles; remove colour tint. Verify GREEN.

### Task 3: Acceptance and review

- [x] Update README/current theme documentation.
- [x] Run pnpm test, pnpm typecheck, pnpm build. Inspect scoped diff.
- [x] Use Orca for inheritance, switching, reload, edit cancellation and widget override checks.
- [x] Dispatch one independent final reviewer; fix important findings with RED/GREEN. Record outcomes and limitations here.

## Progress

Implementation started. Ruling: work in the current checkout without branch changes, per user instructions and the already modified UI. Backend/contracts and UI are delegated independently against the frozen interfaces above. No commits are authorized.

Task 1 complete: RED contracts 19 failures and API 17 failures before implementation; focused GREEN 104 contracts / 89 API tests. Full contracts 475/475, API 368/368, both package typechecks passed.
Task 2 complete: UI baseline 514/514. New UI/draft RED 4 failures; focused GREEN 48/48. Root pnpm test, pnpm typecheck and pnpm build passed before final review correction.
Final review: independent reviewer found one Important race: an old background GET could overwrite a successful theme save in memory. Regression test observed RED (loaded instead of ignored), then GREEN 67/67 after capturing the starting snapshot and dropping refreshes superseded by a newer snapshot. No other Critical/Important findings; no deferred minors.
Ruling: keep background refreshes non-blocking and reject superseded responses, instead of disabling theme selection during every refresh. Initial loading, saves, switching and build mode still block theme writes. This keeps controls responsive while preserving newer saved state; stale refresh ordering is covered by the regression test.

## Final verification

- `pnpm test`: 1879/1879 passed on full recheck (contracts 475, SDK 341, UI 519, API 368, examples/create-widget 176). The preceding run had one intermittent failure in SDK `dev-server.listen.test.ts` (`serves one Vue runtime, sandbox, API and live manifest/secrets with production media rules`: revision 2 versus expected 1); its isolated 6-test rerun and the next full suite passed. SDK code was not changed.
- `pnpm typecheck` passed. `pnpm build` passed after the refresh fix; final UI build passed after restoring the existing immediate space-edit flow. Existing upstream Nuxt unused-import warning remains.
- Orca acceptance used a separate temporary SQLite database and static build at `http://127.0.0.1:57171`, viewport 1697×944. Verified: screen selection persists across reload; dashboard changes do not replace a screen override; clearing a screen inherits space/dashboard; space theme selection applies immediately; clearing the space falls back to dashboard; another screen inherits its space; another space inherits dashboard; screen draft preview cancels; Done persists a draft theme; widget Glass override remains Glass on Paper. Checked actual root/widget classes, saved board responses and rendered screenshots. Final browser console contained no messages.
- Orca native `select` works for non-empty values. Its `click` acknowledged input without activating the pairing form, so buttons used DOM activation; empty-value select used a DOM change event because CLI rejects empty `--value`. Native pointer activation remains unverified. No external browser used. Screenshots and scratch scripts are in the temporary `ld-theme-acceptance-vkuo4vkl` directory, outside the repository.
- Documentation sync limited to README/theme contract. The theme contract's old design link now targets the archive. Documentation checker found 22 pre-existing missing references in three untouched SDK acceptance reports, no errors in touched docs. No unrelated docs repaired.
- `git diff --check` passed. Existing dashboard-controls and clock changes preserved. No branches, commits or pushes created. Theme imports deferred as requested.
