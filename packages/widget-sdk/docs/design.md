# Design

## Grid and sizing

- The dashboard grid has 24 columns. A widget has at most 100 rows.
- Sizes in `sizing` and `context.size` are whole cells `{ w, h }`.
- `widget.json` `sizing` sets `min`, `default` and `max`. Each must fit in the grid, and `min` ≤ `default` ≤ `max`.
- `context.sizeClass` is `xs`, `s`, `m`, `l` or `xl`, from the smaller side of the size. Adapt the layout to `sizeClass` instead of checking `size` values. See [recipes.md](recipes.md).
- `html`, `body` and `#app` fill the widget rectangle, so `height: 100%` on the widget's root element is the full widget height.
- At the `default` size the essential content is visible without scrolling. Check `min` and `default` first, then `max`.
- Round or square content, such as a clock face or a gauge, sizes from the smaller side of the widget, so it fits when the widget is wider than tall or taller than wide. Give the root `container-type: size` and the content `width: min(100cqw, 100cqh); aspect-ratio: 1`. `width: 100%; height: 100%` on square content clips it in a non-square widget. See the clock in [recipes.md](recipes.md).

## rem and rootFontSize

- Use `rem` for sizes and spacing inside the widget, so the widget follows the board's font size.
- `context.rootFontSize` is the dashboard's root font size in px. Use it only when a value must be a px number, such as a canvas size.

## Theme tokens

Every colour, radius, font, spacing and motion value comes from a theme token. Use `var(--ld-…)` with the full token name. Do not write literal colours, font names or durations.

Read the current values from `context.theme.tokens`, or use the CSS variables directly. To see the widget in a theme, open the dev shell with its `theme` id ([workflow.md](workflow.md)). Tokens of the built-in themes:

- `--ld-accent`
- `--ld-accent-active`
- `--ld-accent-hover`
- `--ld-accent-subtle`
- `--ld-accent-text`
- `--ld-backdrop`
- `--ld-bg`
- `--ld-blur`
- `--ld-border-default`
- `--ld-border-strong`
- `--ld-border-subtle`
- `--ld-border-width`
- `--ld-control-height`
- `--ld-danger`
- `--ld-danger-subtle`
- `--ld-danger-text`
- `--ld-duration-base`
- `--ld-duration-fast`
- `--ld-duration-slow`
- `--ld-ease-emphasized`
- `--ld-ease-standard`
- `--ld-edge-highlight`
- `--ld-focus-ring`
- `--ld-font-display`
- `--ld-font-mono`
- `--ld-font-scale`
- `--ld-font-ui`
- `--ld-gap`
- `--ld-info`
- `--ld-info-subtle`
- `--ld-info-text`
- `--ld-leading`
- `--ld-on-accent`
- `--ld-on-danger`
- `--ld-on-info`
- `--ld-on-success`
- `--ld-on-warning`
- `--ld-radius-card`
- `--ld-radius-control`
- `--ld-radius-pill`
- `--ld-radius-widget`
- `--ld-scrim`
- `--ld-shadow-raised`
- `--ld-shadow-widget`
- `--ld-state-active`
- `--ld-state-hover`
- `--ld-state-selected`
- `--ld-success`
- `--ld-success-subtle`
- `--ld-success-text`
- `--ld-surface-1`
- `--ld-surface-1-solid`
- `--ld-surface-2`
- `--ld-surface-3`
- `--ld-text-disabled`
- `--ld-text-muted`
- `--ld-text-primary`
- `--ld-text-secondary`
- `--ld-tracking`
- `--ld-warning`
- `--ld-warning-subtle`
- `--ld-warning-text`
- `--ld-weight-medium`
- `--ld-weight-regular`
- `--ld-weight-strong`
- `--ld-widget-padding`

Token groups:

- Surfaces: `bg`, `backdrop`, `scrim`, `surface-1`, `surface-1-solid`, `surface-2`, `surface-3`. `surface-1` may be translucent.
- States: `state-hover`, `state-active`, `state-selected` are translucent overlays on a surface.
- Text: `text-primary`, `text-secondary`, `text-muted`, `text-disabled`.
- Borders: `border-subtle`, `border-default`, `border-strong`, `border-width`.
- Accent and status: `accent*`, `on-accent`, and for each status `success`, `warning`, `danger`, `info`: `<status>`, `<status>-subtle`, `<status>-text`, `on-<status>`.
- Focus: `focus-ring`.
- Shape and effects: `radius-*`, `shadow-*`, `blur`, `glow`, `edge-highlight`.
- Type: `font-ui`, `font-mono`, `font-display`, `font-scale`, `weight-*`, `leading`, `tracking`.
- Motion: `duration-*`, `ease-*`.
- Spacing: `widget-padding`, `gap`, `control-height`.

Text must keep readable contrast in every theme. Put `text-*` on `surface-*` tokens, and `on-accent` on `accent`.

## Framed and frameless

- `framed` (default): the host draws the card around the widget. The widget draws its content only.
- `frameless` (manifest `frame`, needs sdk 3): the host draws no card. The widget draws its own background, or none.
- Declare `"frame": "frameless"` for object-like widgets: clocks, gauges and stickers. Such a widget draws no card background.
- Read `context.frame` when the widget must change its styling by frame.
