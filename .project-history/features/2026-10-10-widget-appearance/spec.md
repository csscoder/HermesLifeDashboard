# Per-widget appearance

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md`
- **Builds on:** `docs/superpowers/specs/2026-10-04-theme-engine-design.md` (L4 widget theme),
  `docs/superpowers/specs/2026-10-05-board-edit-mode-design.md`
- **Status:** approved design, 2026-10-09

## Goal

In edit mode the user can change how one widget looks without changing the board theme:

- pick another built-in theme for the widget, or «Без оформления» (no frame: the widget renders as
  it is, without card background, border, card shadow or padding);
- give the widget an editable drop shadow (offset, blur, colour, opacity).

Success: hovering a widget in «Изменить» shows «⚙» next to «×»; «⚙» opens a panel next to the
widget; every change shows on the board at once; «Готово» saves, «Отмена» discards. The analog
clock set to «Без оформления» with a shadow casts a round shadow that follows the dial.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Storage | `WidgetInstance.appearance`, a nullable `appearance TEXT` column on `widgets` | Planned in the theme-engine spec (`WidgetInstance.appearance.themeId`); saved atomically with the board |
| Not `config` | Appearance never lives in `config` | `config` belongs to the widget (sandbox widgets receive it, it has its own `configVersion`); appearance belongs to the host |
| «Без оформления» | Stored as `themeId: 'builtin:bare'`; not a real theme | It has no token block: tokens and colours come from the board theme, only the skin changes |
| Bare scope | Widget only; not in the header «Тема» select | A board-wide bare theme was not requested |
| Shadow on a framed widget | `box-shadow` on `.widget__wrapper`, replacing the theme's `--ld-shadow-widget` | The card is a rectangle, so it matches `drop-shadow`; `filter` next to Glass `backdrop-filter` would break the blur |
| Shadow on a bare widget | `filter: drop-shadow()` on `.widget__wrapper` | Follows the content's alpha outline (the clock dial is round) |
| No `spread`, no inset shadow | Out of scope | `drop-shadow` has no spread; one shadow model for both cases |
| Panel | Non-modal `popover="auto"` next to «⚙» | The widget stays visible while tuning; light dismiss and Esc are native |
| Panel position | Computed from the «⚙» `getBoundingClientRect()` | CSS anchor positioning is not supported in every browser |

This reverses «Per-widget overrides … dropped» from the theme-engine spec for one override: the
shadow. The user asked for it explicitly. Token overrides per widget stay out.

## Contracts

`packages/contracts/src/board.ts`:

```ts
export interface DropShadow {
  x: number       // integer px, SHADOW_LIMITS.x
  y: number       // integer px, SHADOW_LIMITS.y
  blur: number    // integer px, SHADOW_LIMITS.blur
  color: string   // '#rrggbb'
  opacity: number // 0..1
}

export interface WidgetAppearance {
  themeId: string | null    // null: inherit the board theme; BARE_THEME_ID: no frame
  shadow: DropShadow | null // null: the theme's own shadow
}

export interface WidgetInstance {
  id: string
  source: WidgetSource
  configVersion: number
  config: Record<string, unknown>
  appearance?: WidgetAppearance
}

export const BARE_THEME_ID = 'builtin:bare'
export const SHADOW_LIMITS = { x: [-32, 32], y: [-32, 32], blur: [0, 48] } as const
export const DEFAULT_SHADOW: DropShadow = { x: 0, y: 8, blur: 16, color: '#000000', opacity: 0.5 }
```

- **Normalization:** when `themeId` and `shadow` are both `null`, the `appearance` key is absent.
  The parser and the UI helper both apply this. Boards without appearance keep their exact JSON,
  so `isSameBoard` (JSON comparison) still reports «unchanged».
- **Validation** in `parseScreenBoard` (shared by API and UI):
  - `appearance` is absent, `null` or an object;
  - `themeId` is `null` or a string of the form `builtin:<name>` (`<name>` = `[a-z0-9-]+`) or
    `user:<uuid>`. A well-formed unknown id is accepted; rendering treats it as unset
    (theme-engine spec: stored references are not rewritten);
  - `shadow` is `null` or an object whose `x`, `y`, `blur` are integers inside `SHADOW_LIMITS`,
    `color` matches `/^#[0-9a-f]{6}$/i`, `opacity` is a finite number in `0..1`;
  - any violation: `fail('instances[<i>]: invalid appearance')`.

## Data

- Migration (next `user_version`): `ALTER TABLE widgets ADD COLUMN appearance TEXT;`.
- `rooms.ts` writes `JSON.stringify(instance.appearance)` or `NULL`, and reads the column back
  into `appearance` (omitted when `NULL`). Board revision and the `PUT` contract do not change.
- Stored data is trusted only after `parseScreenBoard`, as today.

## Rendering

- `theme/resolve.ts` gains a pure function:

  ```ts
  export type FrameSkin = SkinId | 'bare'
  export function resolveWidgetLook(
    appearance: WidgetAppearance | undefined,
    boardThemeId: string,
  ): { themeId: string; skin: FrameSkin; foreign: boolean }
  ```

  - `themeId === BARE_THEME_ID` → `{ themeId: boardThemeId, skin: 'bare', foreign: false }`;
  - otherwise `themeId = resolveThemeId([appearance?.themeId ?? null, boardThemeId], BUILTIN_THEME_IDS)`,
    `skin = themeMeta(themeId).skin` and `foreign = themeId !== boardThemeId`.
- **Foreign widgets.** The theme-engine spec requires a widget whose theme differs from the
  board's to paint its opaque `surface-1-solid` (contrast was checked against its own `bg`, not
  the board backdrop). That rule is not implemented yet; this change adds it.
  `WidgetFrame` sets `.widget--foreign` when `foreign` is true, and `comfort.css` gets the
  foreign half of the spec's shared rule in `ld.comfort`:

  ```css
  .widget--foreign {
    --ld-surface-1: var(--ld-surface-1-solid);
    --ld-blur: 0;
  }
  ```

  The `transparency: reduced` half arrives with the `ComfortProfile` UI. `useWidgetContext`
  reads tokens from the computed style of the frame element, so the substituted `surface-1` and
  `blur` reach sandbox widgets. `foreign` can change while the widget's `themeId` stays the same
  (a widget fixed to Glass while the board switches Glass → Paper), so `useWidgetContext` gets a
  `foreign: () => boolean` source and re-reads tokens (after `nextTick`, as today) when the pair
  `[themeId, foreign]` changes, not only `themeId`. Example: a Glass widget on a Paper board shows the
  opaque `oklch(0.27 0.03 280)` surface, not the translucent white one over the light backdrop.
- `SKINS` in `contract.ts` does not change: themes cannot pick `bare`.
- `WidgetBoard.vue` passes the resolved `themeId`, `skin`, `foreign` and `appearance?.shadow` to `WidgetHost`;
  the host passes them to `WidgetFrame` and the resolved `themeId` to `useWidgetContext`, so
  sandbox widgets get the theme and colour scheme they are drawn with. The build draft passes no
  appearance and renders as today.
- `WidgetFrame.vue` gets optional props `skin` (default `themeMeta(themeId).skin`), `foreign`
  (default `false`) and `shadow`. It sets `widget--skin-<skin>`, `widget--foreign` when `foreign`,
  and, when `shadow` is set, an inline style on `.widget__wrapper`:
  `filter: drop-shadow(<css>)` for `bare`, `box-shadow: <css>` otherwise. Inline style beats the
  skin's layered `box-shadow` without `!important`.
- Pure helper `shadowCss(shadow: DropShadow): string` (in `theme/`) returns
  `<x>px <y>px <blur>px rgb(<r> <g> <b> / <opacity>)`.
- New `theme/styles/skins/bare.css` in layer `ld.skin`, imported from `layers.css`:
  `.widget__box` has no background, border or radius and `overflow: visible` (the shadow is not
  clipped); `.widget__body` has `padding: 0`.

## Host UI

- **Gear button.** `WidgetBoard.vue` renders `board__settings` («⚙») next to `board__remove` in
  edit mode, with the same visibility (`:hover` / `:focus-within`), `type="button"`,
  `aria-label="Настройки виджета"`, `aria-expanded`, and `@pointerdown.stop` so it never starts a
  drag. Click selects the widget (`select(id)`) and toggles the panel.
- **Panel.** New `apps/ui/app/board/WidgetSettings.vue`, one per board, `popover="auto"` (top
  layer: never clipped by the board). Props: the widget's `appearance`; emits the next
  appearance. Positioned from the gear's `getBoundingClientRect()`, kept inside the viewport.
  On open, focus moves to the first control. When the user closes the panel (Esc, light dismiss,
  the gear again), focus returns to the gear. Closes caused by the board keep its existing focus
  rules: removal focuses `focusAfterRemoval`, leaving the mode or saving keeps focus where the
  header button put it.
- **Controls** (labels in Russian):
  - «Стиль» `<select>`: «Как у доски» (`null`), Стекло, Обсидиан, Бумага (from `BUILTIN_THEMES`),
    «Без оформления» (`BARE_THEME_ID`). A stored unknown id shows as «Как у доски»;
  - «Тень» checkbox: on → `DEFAULT_SHADOW`, off → `null`;
  - «X», «Y», «Размытие»: `<input type="range">` with `SHADOW_LIMITS`, step 1, value shown in px;
  - «Цвет»: `<input type="color">`;
  - «Непрозрачность»: range `0..100` %, stored as `0..1`;
  - while the shadow is off, all five shadow controls are disabled and show `DEFAULT_SHADOW`
    values; nothing is written until the checkbox turns the shadow on;
  - «Сбросить»: removes `appearance` entirely.
- **Data flow.** Every change runs `working = setAppearance(working, id, next)`, a new helper in
  `board/edit-session.ts` that applies the normalization. The board re-renders live. «Готово»
  saves through the existing path; «Отмена» and Esc outside the panel discard.
- **Keyboard.** While the panel is open, the board's `onKeydown` ignores Escape, Enter,
  Delete/Backspace and arrows: Esc closes only the panel (native popover), Backspace never
  deletes the widget. Sliders are already ignored through `isFormControlTarget`.
- **Closing.** The panel closes when its widget is removed, the mode leaves `edit`, or a save
  starts (`saving`).

## Error handling

- Invalid `appearance` in a `PUT` → the existing `400` from `parseScreenBoard`; the UI can only
  produce valid values (controls are bounded), so this means a bug or a foreign client.
- Unknown `themeId` → rendered with the board theme; the panel shows «Как у доски» until the user
  picks something else (the stored id is kept until then).
- Save failures follow the existing edit-mode reactions (`room-sync`).

## Testing

TDD with the existing frameworks; each behaviour gets a failing test first.

- `packages/contracts/test/board.test.ts`: valid appearance; normalization (`null`/`null` → key
  absent; `appearance: null` → absent); shadow bounds, non-integer offsets, bad colour, opacity
  outside `0..1`; malformed `themeId`; well-formed unknown `themeId` accepted.
- `apps/api/test/rooms.test.ts`: appearance survives `PUT` → `GET`; widgets without appearance
  read back without the key. `apps/api/test/db.test.ts`: migration on an existing database.
- `apps/ui/test/edit-session.test.ts`: `setAppearance` sets, replaces and normalizes.
- `apps/ui/test/theme-resolve.test.ts`: `resolveWidgetLook` for absent, inherited, chosen, bare
  and unknown theme ids, including `foreign` (true only for a chosen theme that differs from the
  board's).
- `useWidgetContext` re-reads tokens when `foreign` flips with an unchanged `themeId`, in both
  directions (a component test with a stub frame, or a browser check if no Vue test harness
  exists in `apps/ui/test`).
- `apps/ui/test/theme-contract.test.ts` (or the nearest CSS test): `comfort.css` contains the
  `.widget--foreign` rule substituting `surface-1-solid` and zero blur.
- `apps/ui/test/shadow.test.ts`: `shadowCss` output, colour conversion, opacity.
- Browser check in Orca's built-in browser (`orca-cli`): «⚙» on hover; panel opens next to the
  widget; the clock in «Без оформления» with a shadow casts a round shadow; a Glass widget on a
  Paper board paints an opaque surface with readable text, and switching the board Glass ↔ Paper
  with that widget fixed to Glass updates its frame and sandbox tokens; Esc closes only the panel; «Отмена» discards; «Готово» + reload keeps the result.

**Unverified (inferred):** `drop-shadow` on a bare sandbox widget follows its content outline,
because the iframe and its root are already transparent. Checked in the browser step.

## Out of scope

User themes, a board-wide bare theme, shadow `spread`, inset shadows, per-widget token overrides.

## Acceptance criteria

1. In edit mode, hovering or focusing a widget shows «⚙» next to «×»; «⚙» opens the settings
   panel for that widget and never starts a drag.
2. Choosing a theme recolours only that widget; «Как у доски» returns it to the board theme. A
   widget whose theme differs from the board's paints its opaque `surface-1-solid`.
3. «Без оформления» shows the widget without card background, border, card shadow and padding,
   using the board theme's colours.
4. The shadow is editable (X, Y, blur, colour, opacity) and shows live; a bare clock casts a
   shadow that follows the round dial.
5. «Готово» persists appearance through the API; «Отмена» discards it; a reload shows the saved
   result.
6. Boards saved before this change load and save unchanged.
7. Esc with the panel open closes only the panel.
