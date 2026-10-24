# Dashboard controls

## Intent

Give the board a quiet header matching the supplied reference. Move the existing dashboard controls into a panel above a fixed settings button in the bottom-right corner. The user delegates the panel's contents to the implementer.

## Layout and behavior

- Header: a translucent title pill at the top left and the existing circular space switcher at the top right. Display the current screen number as a small subscript when the space has several screens. Preserve title truncation and inline renaming in edit mode.
- Keep the space switcher's existing fan, create, rename, icon, color, and deletion flows. Style its trigger with an accent outline, soft glow, and decorative dot, as in the reference.
- Place screen navigation at the bottom center. Preserve previous/next, direct screen selection, disabled states, and edit-mode screen creation and deletion.
- Place a settings button at the bottom right. Its panel opens upward and closes on outside click or Escape. Preserve keyboard access and return focus to the trigger when dismissed with Escape. Constrain its height and scroll its contents on short windows.
- Panel header: `LifeDashboard` and a close button.
- Panel contents: current space name and current screen position; the existing `Добавить виджет…` picker; `Изменить доску`; `Библиотека виджетов`; and three theme choices, `Стекло`, `Обсидиан`, `Бумага`, with an explicit selected state. The theme applies to the workspace, matching current behavior.
- Panel footer: the actual API status and the current grid dimensions. Do not invent an API version or imply the column count is configurable.
- Selecting a widget, entering edit mode, or opening the library closes the panel. During placement and editing, show persistent `Готово` and `Отмена` controls at the bottom center; show the existing row-count input during editing. These controls must remain accessible without reopening settings.
- Keep API failures and application notices visible outside the closed settings panel. Reposition notifications so they do not cover the settings trigger or editing controls.
- Use existing theme tokens across all three themes. Preserve reduced-motion and focus-visible behavior.

## Approach

Move existing controls and event bindings; retain the current API, board state, validation, save/cancel flows, theme persistence, and package management. Use a native automatic popover for panel dismissal and keyboard behavior, with Vue managing action-driven closing. Add no dependencies.

A separate settings page would interrupt the board workflow. A custom drawer would duplicate dismissal and focus behavior already provided by the browser. The proposed popover follows the supplied reference and keeps the change local to the UI shell.

## Scope

Expected production changes: `apps/ui/app/app.vue`, a focused settings-panel component if needed, `apps/ui/app/spaces/SpaceTitle.vue`, `apps/ui/app/spaces/ScreenDots.vue`, and trigger styling in `apps/ui/app/spaces/SpaceSwitcher.vue`.

No backend, database, widget SDK, background, or board geometry changes. Preserve the existing minimum supported window width of 1280 px. Do not modify the pre-existing change in `ClockAnalog1.vue`. Do not create branches or commits.

## Verification

Use RED → GREEN tests for new interaction behavior in the existing Vitest setup, then run the UI suite and typecheck. Verify the rendered result through Orca's embedded browser at the current desktop width and at 1280 px: settings open/close and keyboard behavior, widget placement, edit/save/cancel, screen navigation, library opening, all theme choices, long titles, short-window scrolling, and visible error notices. Review the final diff for scope.

## Status

Approved by the user in this session. Implemented and verified; see `../plans/2026-10-23-dashboard-controls.md` for results and the deferred minor styling finding.
