# Theme contract (version 1)

The rules a LifeDashboard theme must satisfy. `apps/ui/app/theme/contract.ts` is the canonical
token list; `validateThemeCss()` in `apps/ui/app/theme/validate-theme.ts` enforces this document.
The AI theme skill writes themes against it. Design: `docs/superpowers/specs/2026-10-04-theme-engine-design.md`.

## Format

A theme is a record `{ id, name, mode, skin, css }`.

- `mode`: `light` or `dark`.
- `skin`: one of the built-in skins `glass`, `solid`, `paper`. Skins hold all structure and effects;
  a theme only tunes them through tokens.
- `css`: exactly **one rule** and nothing else:

```css
.room--theme-<slug>, .widget--theme-<slug> {
  color-scheme: dark;
  --ld-bg: oklch(0.2 0.02 280);
  /* … every required token, optional tokens if wanted */
}
```

The slug is `<name>` for `builtin:<name>` and `u-<uuid>` for `user:<uuid>`. No other selector,
rule or at-rule (`@import`, `@media`, `@font-face`, `@keyframes`, …) and no property other than
`color-scheme` and contract tokens. `url(`, `image-set(`, `attr(`, `expression` and `!important`
are rejected anywhere.

Reference themes: `apps/ui/app/theme/styles/themes/*.css`.

## Values

- **Colour tokens:** `oklch(L C H [/ A])`, `var(--ld-<colour token>)` from the same block, or
  `transparent`. No hex, `rgb()`, `hsl()` or named colours. Cycles are rejected.
- **Opaque (alpha 1):** `bg`, `surface-1-solid`, `surface-2`, `surface-3`, all `text-*`,
  `accent`, `accent-hover`, `accent-active`, `accent-text`, `on-accent`, `focus-ring`, and for each
  status `<s>`, `<s>-text`, `on-<s>`. Only `surface-1` may be translucent.
- `surface-1-solid` must be an `oklch()` literal (not `var()`).
- **Font stacks:** family names in double or single quotes containing only `[A-Za-z0-9 _-]+`
  (ASCII letters, digits, spaces, underscores and hyphens), and generic families (`system-ui`, `ui-monospace`,
  `ui-serif`, `ui-rounded`, `sans-serif`, `serif`, `monospace`, …) only.

## Required tokens

| Token | Type | Allowed values |
| --- | --- | --- |
| `bg` | colour | Opaque page colour |
| `backdrop` | colour or gradient | Colour, or `linear-gradient()` / `radial-gradient()` with ≥ 2 colour stops |
| `scrim` | colour | Overlay behind dialogs |
| `surface-1` | colour | Widget box; may be translucent |
| `surface-1-solid` | colour | Opaque `oklch()` replacement for `surface-1` |
| `surface-2`, `surface-3` | colour | Cards, controls; opaque |
| `state-hover`, `state-active`, `state-selected` | colour | Translucent overlays |
| `text-primary`, `text-secondary`, `text-muted`, `text-disabled` | colour | Opaque |
| `border-subtle`, `border-default`, `border-strong` | colour | |
| `border-width` | length | 0–0.125rem |
| `accent`, `accent-hover`, `accent-active` | colour | Opaque fills |
| `accent-subtle` | colour | Tinted background |
| `accent-text`, `on-accent` | colour | Opaque |
| `<s>`, `<s>-subtle`, `<s>-text`, `on-<s>` for `success`, `warning`, `danger`, `info` | colour | `<s>`, `<s>-text`, `on-<s>` opaque |
| `focus-ring` | colour | Opaque |
| `radius-widget`, `radius-card`, `radius-control` | length | 0–2rem |
| `radius-pill` | length | 0–999px |
| `font-ui`, `font-mono`, `font-display` | font stack | See Values |
| `font-scale` | number | 0.875–1.25 |
| `weight-regular`, `weight-medium`, `weight-strong` | number | 300–800, strictly ascending |
| `leading` | number | 1.2–1.8 |
| `tracking` | length | -0.02em–0.05em |
| `duration-fast`, `duration-base`, `duration-slow` | time | 0–600ms |
| `ease-standard`, `ease-emphasized` | easing | `cubic-bezier()` or `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out` |
| `widget-padding`, `gap` | length | 0.25rem–1.5rem |
| `control-height` | length | 1.75rem–2.75rem |

## Optional tokens

| Token | Type | Allowed values | When omitted |
| --- | --- | --- | --- |
| `shadow-widget`, `shadow-raised` | shadow | `none` or up to 3 outer shadows; rem lengths ≤ 3rem; one colour each; no `inset` | `none` |
| `blur` | length | 0–2rem (backdrop blur of the frame) | `0` |
| `glow` | colour | | `transparent` |
| `edge-highlight` | number | 0–0.4 (alpha of a 1px line at the top edge) | `0` |

## Contrast (WCAG 2)

The validator composites in paint order (backdrop → surface → overlay → foreground) and checks
every row in two modes:

1. **translucent:** `surface-1` over `bg` and over every `backdrop` stop, worst case;
2. **solid:** `surface-1` replaced by `surface-1-solid`.

| Foreground | Background | Minimum |
| --- | --- | --- |
| `text-primary` | `surface-1` | 7:1 |
| `text-primary`, `text-secondary`, `text-muted` | `surface-1`, `surface-2`, `surface-3` | 4.5:1 |
| `text-primary` | `state-hover`, `state-selected` over each surface | 4.5:1 |
| `accent-text` | `surface-1`; `accent-subtle` over `surface-1` | 4.5:1 |
| `<s>-text` | `surface-1`; `<s>-subtle` over `surface-1` | 4.5:1 |
| `on-accent` | `accent`, `accent-hover`, `accent-active` | 4.5:1 |
| `on-<s>` | `<s>` | 4.5:1 |
| `focus-ring` | each surface | 3:1 |

`text-disabled` is exempt. A photo backdrop cannot be checked.

## Error messages

Each error has a `rule` (`forbidden`, `syntax`, `single-block`, `selector`, `color-scheme`,
`unknown-property`, `duplicate`, `missing`, `value`, `reference`, `opaque`, `contrast`) and a
message naming the offending token and the allowed alternative, for example
`text-muted on surface-1 (translucent mode) is 3.74:1, needs 4.5:1`.

## Evolution

New tokens are added as optional with a fallback, so existing themes keep working.
`CONTRACT_VERSION` increases only for a breaking change, together with a migration.
