# Theme inheritance

Approved direction: widget > screen > space > dashboard. The user explicitly requested immediate implementation without further design approval.

## Behavior

- Replace the space colour picker with the existing dashboard themes and an inherit-dashboard option. Remove the colour overlay; keep legacy colour data for compatibility.
- Store space themeId (nullable) in SQLite. Store optional screen themeId with its board; absent/null means inherit. Existing spaces/screens inherit. Use syntactically valid builtin/user theme IDs; bare belongs only to widgets. Unknown theme references fall through without being rewritten.
- Keep dashboard appearance in its current browser setting. Resolve the active screen, space and dashboard through the existing resolver. Preserve widget overrides and frameless behavior.
- Add current-screen theme selection to SettingsPanel, alongside the explicitly labelled dashboard default. In view mode save immediately through the revision-checked board API. In edit mode preview through the working copy; Done persists and Cancel restores. Block theme writes while loading, building, saving or switching.
- Use the same available theme list for each scope. Space switcher bubbles use the assigned/resolved theme rather than the old colour palette. Space selection saves immediately, matching existing icon editing.
- No theme import implementation, dependencies, branches or commits. Preserve all pre-existing changes.

## Approach

Extend current theme IDs and resolveThemeId; add nullable SQLite columns with an additive migration. Reuse board PUT for screen themes and existing space PATCH for space themes. Local-only assignments would lose the persistence guarantees of spaces; a separate theme package system is deferred as requested.

## Verification

RED/GREEN contract and API tests for validation, persistence, reset, revision conflicts, migration compatibility and preservation through unrelated board edits. UI interaction tests for scope selection and inheritance; Orca browser checks for three levels, widget overrides, cancel, switching and reload. Run repository tests, typecheck and build; independent final review.

## Screen settings placement update

The user requested immediate implementation in the preceding turn and now specifies the placement: in board edit mode, show a gear beside the active screen bullet. It opens a single interactive popover above that bullet containing screen-theme selection and deletion. Remove the screen selector from the dashboard settings panel; keep only the dashboard default there. Theme changes remain in the board draft and follow Done/Cancel.

Reuse the existing native auto-popover pattern, fixed positioning measured from the active bullet (outside the scrolling dot list), and existing deletion confirmation dialog. Every screen deletion now requires confirmation, including empty screens. Preserve the existing only-screen behavior: deleting it deletes its space after the space confirmation; the final space remains protected. Escape/outside click dismiss the popover; switching screens/spaces, leaving edit mode, saving, resizing or scrolling close it. Keyboard interaction in the popover must not trigger board shortcuts. No dependency or persistence changes.
