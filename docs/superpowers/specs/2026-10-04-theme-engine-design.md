# Theme engine: themes as validated CSS over a token contract

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§6.2, §7.4, §7.6, §7.7, §13.6, §14.1, §14.2, §15)
- **Builds on:** `docs/superpowers/specs/2026-10-04-widget-builder-placement-design.md` (`WidgetFrame`, board document)
- **Status:** design approved in conversation 2026-10-04; revised through 5 Codex review rounds (26 findings, all accepted).
  The round-5 correction (only `surface-1` may be translucent) is unverified by Codex, accepted by the owner (USER_OVERRIDE).
  Awaiting owner review of the written spec.

## Goal

One design system for the whole app. `builtin`, `declarative` and Hermes-generated `component`
widgets all look like one product. A user switches the look of the whole dashboard, of one Room,
or of a single widget by choosing a theme. The layout engine stays outside the reach of any theme.

This document is the full architecture. The implementation plan covers only the MVP slice
(see [MVP](#mvp)); every later part is scheduled against the base-design stages.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| What a theme is | A record `{ id, name, mode, skin, css }`. The CSS is one token block: values for a fixed token contract, nothing else | Themes are produced by AI (a separate skill) or shipped with the app; nobody hand-edits them in a UI. Token-only CSS cannot hide controls, bypass contrast or reach another theme's widgets |
| Visual effects | Built-in skins (trusted code) implement all structure and effects; themes tune them through effect tokens. A new effect is a new skin, added through the normal development process | Arbitrary theme rules (`opacity: 0` on the box, `color: transparent`, room rules hitting widgets with their own theme) cannot be validated safely |
| Theme editor | None. Per-widget overrides and semantic slots are dropped | No editor means nobody sets them. A widget that must look different gets a different theme |
| Built-in vs user themes | One mechanism. Built-in themes are CSS files in the repo with the same contract and validator as imported ones | One code path; built-in themes are the reference for the AI skill |
| Theme selection | `themeId: string \| null` on Workspace, Room and WidgetInstance; `null` inherits | Changing a Room theme recolours every widget that was not set explicitly; "reset to inherited" is `null` |
| Room theme scope | The whole screen while that Room is active: shell, backdrop and board | Only one design system is visible at a time (§14.1); widget themes are the only exception |
| Frame styling | BEM: `.widget > __wrapper > __box > __body`, plus a reusable **skin** class for structural effects | Effects (glass blur, edge highlight, glow, gradient border) need structure and layers, not just variable values |
| Content styling | UnoCSS with a semantic colour vocabulary inside `.widget__body` | No per-widget CSS files; Hermes writes content with the same vocabulary |
| Values | CSS custom properties `--ld-*`, colours in `oklch()` | The token contract is independent of Uno; Uno only reads the variables |
| Runtime CSS delivery | Stylesheets via `<link>` (build output, `/api/v1/themes/styles.css`, widget CSS artifacts). Never runtime `<style>` injection | Tauri adds a nonce to `style-src`, which silently disables `'unsafe-inline'`; `<style>` inserted by JS then breaks |
| Accessibility preferences | `ComfortProfile` on the Workspace, outside themes, applied in the last CSS layer | A theme author must not be able to force motion or transparency on the user |
| Fonts | A font registry separate from themes; system stacks in MVP; no Google Fonts at runtime | Privacy (IP leak) and offline operation |

### Rejected alternatives

- **Recipe + compiler** (a theme stores ~20 seed parameters; TS derives ~70 tokens with contrast
  correction). Approved first, then dropped: without an editor the derivation has no consumer, and
  the AI skill can produce final values while the validator enforces contrast.
- **One BEM class per theme with no variables.** Custom themes would need hand-written CSS for
  every widget primitive, and Hermes widgets could not follow a theme that did not exist when they
  were generated.
- **Copying the Room theme into every widget record.** Changing the Room theme would require
  rewriting all widgets, and "inherited" could no longer be told apart from "chosen".
- **UnoCSS browser runtime for Hermes widgets.** It injects `<style>` elements (blocked under the
  Tauri CSP). Base design §7.7 already compiles SFCs on the server, so CSS is generated there too.
- **Tailwind CSS v4.** Its `compile()` works in Node, but arbitrary values (`text-[#f00]`,
  `bg-(--x)`) bypass a restricted palette, and detecting unknown classes needs an `__unstable__`
  API. **Panda, StyleX, vanilla-extract:** none can generate CSS for code that appears after the
  build; StyleX has no working Vue SFC integration (facebook/stylex#1562).
- **Extra visual rules in theme CSS** (pseudo-elements, backdrop rules under the theme class).
  Dropped after review: `opacity`/`filter` on the box hide system controls, `color` bypasses the
  contrast check, and `.room--theme-x .widget__box` restyles widgets that chose another theme.
  Narrowing them to decorative pseudo-elements still leaves contrast only approximately bounded.

## Architecture

```text
L0  System constants   static CSS: grid, spacing scale, z-index, container sizes. No theme sees them.
L1  Theme              ThemeRecord: token values + skin
L2  Workspace          themeId                      ┐ resolved together on the root element
L3  Room               themeId | null               ┘ (the active Room themes the whole screen)
L4  Widget             themeId | null
    ComfortProfile     user preferences, last CSS layer, beats every theme
```

`resolveThemeId([widget, room, workspace], known)` returns the first id that is non-null and
known, otherwise the default built-in theme. An unknown id (deleted theme, import from another
install) is treated as `null`: inheritance continues and the UI shows a warning. Stored references
are not rewritten. A re-imported theme gets a new id, so the user selects it again.

Every widget element always carries the classes of its resolved theme, whether chosen or
inherited. The theme's token block therefore applies on the widget element itself, and `var()`
aliases inside a theme block are evaluated per widget. This avoids the classic trap where an alias
declared on `:root` keeps its root value even though a nested scope overrides the variable it
references.

### Markup

```html
<div class="room room--theme-glass room--skin-glass">          ← root; Workspace ⊕ Room theme
  <div class="room__backdrop"></div>
  <header class="room__header">…</header>
  <main class="room__board">
    <div class="widget widget--theme-paper widget--skin-paper">  ← grid placement: layout engine only
      <div class="widget__wrapper">                                ← effects: shadow, glow, blur, gradient border
        <div class="widget__box">                                  ← surface, radius, overflow: hidden
          <div class="widget__header">…</div>                      ← edit-mode controls (later)
          <div class="widget__body">…</div>                        ← widget content (UnoCSS)
          <div class="widget__state">…</div>                       ← loading/error/unavailable (later)
```

- `themeClass(id)`: `builtin:<name>` → `<name>`; `user:<uuid>` → `u-<uuid>`. Built-in names never
  start with `u-`, so the two namespaces cannot collide.
- Modifiers set by the board, never by themes: `.widget--editing`, `.widget--state-<state>`, and
  `.widget--foreign` when the widget's resolved theme differs from the root's. A foreign widget
  paints its opaque `surface-1-solid` (see Effects and comfort): its contrast was checked against
  its own `bg`, not against the Room's backdrop under it.
- `.widget__header` is an overlay (`position: absolute`), so entering edit mode does not reflow
  widget content. In edit mode the body is dimmed and ignores pointer events.

### CSS layers

```css
@layer ld.reset, ld.frame, ld.skin, ld.theme, ld.utilities, ld.widget, ld.comfort;
```

| Layer | Contents | Author |
| --- | --- | --- |
| `ld.reset` | Minimal reset: `box-sizing`, body margin | us, static |
| `ld.frame` | Frame mechanics: heights, `overflow`, `container-type: size`, stacking levels, header overlay; reset of optional tokens on every theme scope | us, static |
| `ld.skin` | `.room--skin-*`, `.widget--skin-*`: layers, pseudo-elements, blur, borders; all values from tokens | us, `theme/styles/skins/` |
| `ld.theme` | Theme token blocks (built-in files and the user-theme stylesheet) | built-in files; validated import |
| `ld.utilities` | UnoCSS output (content only) | generator |
| `ld.widget` | Widget-authored CSS: builtin `<style scoped>` content and Hermes widget CSS artifacts | widget authors; server wraps Hermes CSS |
| `ld.comfort` | `ComfortProfile` rules: solid surfaces, no blur/glow, zero durations, also inside widget content | us, static |

**All widget CSS lives in `ld.widget`**, so `ld.comfort` beats it:

- Builtin widgets wrap their `<style scoped>` content in `@layer ld.widget { … }`. Vue's scoped
  transform rewrites selectors inside at-rules. The vocabulary test (see Content styling) fails on
  an unwrapped rule.
- The server wraps Hermes widget CSS when it builds the artifact.
- `!important` is rejected in both. An important declaration in an earlier layer would beat
  `ld.comfort`.
- Programmatic animations (gsap, Web Animations) must respect the effective motion level. In the
  MVP that is `prefers-reduced-motion`, which `draft-motion.ts` already checks. When the
  `ComfortProfile` UI ships, that check moves to a shared `useComfort()`.

**Stacking levels (L0):**

| z-index | Elements |
| --- | --- |
| 0 | Skin decoration (`::before` / `::after` of `__wrapper` / `__box`) |
| 1 | `__body`, positioned. It creates a stacking context, so a large `z-index` in content stays inside it |
| 2 | `__header`, `__state` |

`overflow: hidden` on `__box` clips absolutely positioned content. `contain: paint` is not used on
`.widget` because it would clip shadows and glow.

Frame mechanics (`ld.frame`):

```css
.widget__wrapper { height: 100%; }
.widget__box     { position: relative; height: 100%; overflow: hidden;
                   border-radius: var(--ld-radius-widget); }
.widget__body    { position: relative; z-index: 1; box-sizing: border-box; height: 100%;
                   overflow-y: auto; container-type: size;
                   padding: var(--ld-widget-padding);
                   scrollbar-color: var(--ld-border-strong) transparent; }
.widget__header,
.widget__state   { position: absolute; z-index: 2; }
.widget__header  { inset: 0 0 auto; }
.widget--editing .widget__body { opacity: .5; pointer-events: none; }

/* Optional tokens do not leak from the Room theme into a widget theme that omits them.
   The list is generated from contract.ts; the theme block in ld.theme wins when it sets a value. */
.room, .widget { --ld-shadow-widget: initial; --ld-glow: initial; /* … every optional token */ }
```

## Token contract

All tokens use the `--ld-` prefix. The canonical
list lives in `app/theme/contract.ts`; `docs/theme-contract.md` is its human- and AI-readable
description and the source for the AI theme skill.

### Required tokens

| Group | Tokens |
| --- | --- |
| Background | `bg` (opaque colour), `backdrop` (gradient or colour for `.room__backdrop`), `scrim` |
| Surfaces | `surface-1` (widget box, the only surface that may be translucent), `surface-2` (cards inside, opaque), `surface-3` (controls, inputs, opaque); `surface-1-solid` (opaque variant of `surface-1`) |
| State layers | `state-hover`, `state-active`, `state-selected` (translucent overlays usable on any surface) |
| Text | `text-primary`, `text-secondary`, `text-muted`, `text-disabled` |
| Borders | `border-subtle`, `border-default`, `border-strong`, `border-width` |
| Accent | `accent`, `accent-hover`, `accent-active`, `accent-subtle`, `accent-text`, `on-accent` |
| Status (×4: `success`, `warning`, `danger`, `info`) | `<s>`, `<s>-subtle`, `<s>-text`, `on-<s>` |
| Focus | `focus-ring` |
| Shape | `radius-widget`, `radius-card`, `radius-control`, `radius-pill` |
| Typography | `font-ui`, `font-mono`, `font-display`, `font-scale`, `weight-regular`, `weight-medium`, `weight-strong`, `leading`, `tracking` |
| Motion | `duration-fast`, `duration-base`, `duration-slow`, `ease-standard`, `ease-emphasized` |
| Density | `widget-padding`, `control-height`, `gap` |

### Optional tokens (fallback in `ld.frame` or the skin)

| Group | Tokens | Fallback |
| --- | --- | --- |
| Effects | `shadow-widget`, `shadow-raised`, `blur`, `glow`, `edge-highlight` | `none` / `0` / `transparent` |

There are no separate frame colour tokens: the frame paints `surface-1` and `border-subtle`, the
same values the contrast matrix checks. Effects never paint under widget content: shadow and glow
are outside the box, blur only blurs the backdrop, and the edge highlight is a 1px inset line at the
top edge, inside the box padding (`widget-padding` ≥ 0.25rem), so it never sits behind text.

`font-scale` multiplies text sizes only. It does not change the root `rem`, which scales the
layout with the viewport (§7.4), so a theme cannot change the grid.

### Token types and ranges

Every token has one type and, where it affects readability or frame geometry, a range.
`contract.ts` holds this table; the validator enforces it.

| Tokens | Type | Allowed values |
| --- | --- | --- |
| Colour tokens (backgrounds, surfaces, state layers, text, borders, accent, status, focus, `glow`) | colour | See Values below |
| `backdrop` | colour or gradient | Colour, or `linear-gradient()` / `radial-gradient()` of colour stops |
| `border-width` | length | 0–0.125rem |
| `radius-widget`, `radius-card`, `radius-control` | length | 0–2rem |
| `radius-pill` | length | 0–999px |
| `font-ui`, `font-mono`, `font-display` | font stack | Quoted family names and generic families only |
| `font-scale` | number | 0.875–1.25 |
| `weight-regular`, `weight-medium`, `weight-strong` | number | 300–800, in ascending order |
| `leading` | number | 1.2–1.8 |
| `tracking` | length (em) | -0.02em–0.05em |
| `duration-fast`, `duration-base`, `duration-slow` | time | 0–600ms |
| `ease-standard`, `ease-emphasized` | easing | `cubic-bezier()` or keyword |
| `widget-padding`, `gap` | length | 0.25rem–1.5rem |
| `control-height` | length | 1.75rem–2.75rem |
| `shadow-widget`, `shadow-raised` | shadow | `none` or up to 3 outer shadows (`inset` rejected); offsets, blur and spread ≤ 3rem, colours per Values. An outer shadow never paints inside the border box |
| `blur` | length | 0–2rem |
| `edge-highlight` | number (alpha of the edge line) | 0–0.4 |

Outside the contract (L0, static CSS, rejected if a theme sets them): spacing scale, z-index, grid
tokens, container query sizes, icon sizes.

### Contract evolution

A new token is always added as optional with a fallback, so existing themes keep working.
`contractVersion` increases only for a breaking change and comes with a migration. Each theme
record stores the `contractVersion` it was validated against.

## Theme CSS rules (validator)

`validateThemeCss(css, { slug, mode }) → { ok: true } | { ok: false; errors: ThemeError[] }` is a
pure TS function over `postcss`. It runs in vitest for built-in themes now and on import later.
Error messages are written for an AI repair loop: each names the rule, the offending selector or
property, and the allowed alternative.

**The whole stylesheet is one token block.** Exactly one rule, with the selector list
`.room--theme-<slug>, .widget--theme-<slug>`. Any other rule, selector or at-rule is rejected,
including `@import`, `@font-face`, `@keyframes` and `@media`. The block contains:

- every required token, and optional tokens only from the contract list (unknown `--*` names are
  rejected);
- `color-scheme`, which must match `mode`;
- no other property.

Because the block only sets custom properties on the theme scope, a theme cannot hide controls,
change layout, or reach elements of a widget with another theme.

**Values:**

- Colour tokens: `oklch(L C H [/ A])` literals, `var(--ld-<colour token>)` referencing a token in
  the same block, or `transparent`. Cyclic or unresolved references are rejected.
- `surface-1-solid` must be an `oklch()` literal, not `var()`: the solid-mode rule below
  substitutes it for `surface-1`, and a reference back to a surface would create a cycle.
- Opaque (alpha 1) colours are required for:
  - `bg`, `surface-1-solid`, `surface-2` and `surface-3`. Only `surface-1` may be translucent,
    so nested surfaces never stack translucency;
  - all foreground tokens: `text-*`, `accent-text`, `<s>-text`, `on-accent`, `on-<s>`,
    `focus-ring`;
  - the fills `accent`, `accent-hover`, `accent-active` and `<s>`.
- Non-colour tokens follow the type and range table above.
- Forbidden anywhere: `url(`, `image-set(`, `attr(`, `expression`, `!important`.

**Contrast** (WCAG 2, §14.2). The validator:

- resolves `var()` references inside the block;
- converts `oklch` to sRGB with gamut clipping in our own `color.ts` (no colour library);
- composites in the order the UI paints: backdrop → surface → overlay (`state-*`, `*-subtle`) →
  foreground.

The matrix is evaluated in **two modes**, and every row must pass in both:

1. **Translucent mode.** `surface-1` as declared, composited over `bg` and over every colour
   stop of `backdrop`; the worst case counts. `surface-2` and `surface-3` are opaque, so they need
   no compositing.
2. **Solid mode.** `surface-1` replaced by `surface-1-solid`, exactly as the `ld.comfort`
   substitution does at runtime (`.widget--foreign`, `transparency: reduced`). Overlays
   (`state-*`, `*-subtle`) are composited over the solid surfaces.

In the table, `surface-n` means the surface of the current mode. Checking stops approximates a
gradient: oklch interpolation keeps lightness between the two stops, while luminance may drift
slightly with hue and chroma.

| Foreground | Background (composited) | Minimum |
| --- | --- | --- |
| `text-primary` | `surface-1` | 7:1 |
| `text-primary`, `text-secondary`, `text-muted` | `surface-1..3` | 4.5:1 |
| `text-primary` | `state-hover`, `state-selected` over `surface-1..3` | 4.5:1 |
| `accent-text` | `surface-1`; `accent-subtle` over `surface-1` | 4.5:1 |
| `<s>-text` | `surface-1`; `<s>-subtle` over `surface-1` | 4.5:1 |
| `on-accent` | `accent`, `accent-hover`, `accent-active` | 4.5:1 |
| `on-<s>` | `<s>` | 4.5:1 |
| `focus-ring` | `surface-1..3` | 3:1 |

- `text-disabled` is exempt.
- Primitive renderer tables use only the pairs in this table. The vocabulary description for
  Hermes lists the same pairs as the allowed text/background combinations; other combinations of
  semantic classes are not contrast-checked.
- The translucent-surface check is valid only over the theme's own `bg` and `backdrop`. Wherever
  that is not the case, the opaque `surface-1-solid` is used: a widget theme inside a Room with
  another theme (`.widget--foreign`) and `transparency: reduced`.
- **Limitation:** a photo backdrop (a later Room feature) cannot be checked. Glass themes then rely
  on the `transparency: reduced` comfort setting.

## Skins

A skin is structural CSS shared by several themes: Blue Glass and Pink Glass share the `glass`
skin and differ only in token values. Skins live in `theme/styles/skins/<id>.css`, in layer
`ld.skin`, and read only tokens. Skins are the only place for structure and effects: themes tune
them through the effect tokens (`blur`, `glow`, `edge-highlight`, shadows) and
cannot add rules. Adding a skin is a code change (trusted CSS). `SkinId` is a closed union in
`contract.ts`. Skin decoration stays at stacking level 0, under `__body`.

```css
@layer ld.skin {
  .widget--skin-glass > .widget__wrapper {
    backdrop-filter: blur(var(--ld-blur, 0));
    box-shadow: var(--ld-shadow-widget, none);
  }
  .widget--skin-glass .widget__box {
    background: var(--ld-surface-1);
    border: var(--ld-border-width) solid var(--ld-border-subtle);
    /* edge highlight: a line on the top edge, never a fill under content */
    box-shadow: inset 0 1px 0 oklch(1 0 0 / var(--ld-edge-highlight, 0));
  }
}
```

## Content styling: UnoCSS vocabulary

One `uno.config.ts` serves the Nuxt build now and the Fastify pipeline later (moved to
`packages/theme` then).

- Base: `presetWind4` with preflight off (we ship our own reset).
- `theme.colors` is **replaced** by semantic names that point at `var(--ld-*)`, so palette classes
  such as `text-slate-200` do not exist.
- Text sizes `text-xs`…`text-3xl` are `calc(var(--ld-font-scale) * <rem>)`.
- Output goes to `@layer ld.utilities`.
- How Uno replaces (not deep-merges) a preset theme, and how it emits CSS layers, is
  **unverified**. The plan starts with a spike that checks the generated CSS.

| Allowed | Examples |
| --- | --- |
| Semantic colours | `text-primary/secondary/muted/disabled/accent/on-accent`, `text-success/warning/danger/info`, `bg-surface-1..3`, `bg-accent`, `bg-accent-subtle`, `bg-<s>-subtle`, `hover:bg-state-hover`, `border-subtle/default/strong`, `ring-focus`, `fill-*` / `stroke-*` with the same names |
| Shape and type | `rounded-control/card/pill/none`, `font-ui/mono/display`, `font-regular/medium/strong`, `shadow-raised` |
| Layout | wind4 layout and spacing: `flex`, `grid`, `gap-*`, `p-*`, `m-*`, `w-*`, `h-*`, `truncate`, `line-clamp-*`, `tabular-nums`, … |
| Variants | `hover:`, `focus-visible:`, `disabled:`, `aria-*:`, container sizes (`@sm:`, `@md:`), `motion-safe:`, `motion-reduce:` |

Blocklist, each entry with a message that names the semantic alternative:

| Blocked | Why |
| --- | --- |
| Arbitrary values and variables: `[...]`, `(--x)` | Bypass the vocabulary |
| `dark:` | Mode belongs to the theme scope, not a media query; a light widget in a dark room would break |
| `rounded-sm…3xl`, numeric `font-<n>`, `shadow-sm…2xl` | Shape and weight belong to the theme |
| `fixed`, `z-<n>` above 10, `!` important | Escape the frame or cover the header |

`checkClasses(classes) → { unknown: string[]; blocked: { cls; message }[] }` is built on the
generator: unknown = extracted minus `matched`. Consumers:

- vitest, over the template ASTs of all builtin SFCs (now);
- the Hermes SFC pipeline (E6).

The vocabulary description in Hermes prompts is generated from the same config, so documentation
cannot drift from the code.

## Integration by widget kind

**WidgetFrame.** `WidgetFrame.vue` renders the BEM structure and the theme and skin classes from a
resolved `themeId`; its default slot fills `.widget__body`. Props: `themeId: string`, later
`editing` and `state`. Content never receives or changes frame styling.

**Builtin widgets.**
- Content uses Uno classes from the vocabulary.
- `<style scoped>` is allowed with `var(--ld-*)` only, wrapped in `@layer ld.widget`, without
  `!important`; colour literals are a review error.
- The vocabulary test fails on palette classes, on an unwrapped scoped rule and on `!important`.

**Declarative widgets (E3b).** Hermes sees no classes. Primitives take semantic enums only; the
definition schema has `additionalProperties: false`, so `class` and `style` are rejected.

```ts
interface PrimitiveAppearance {
  tone?: 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
  variant?: 'plain' | 'subtle' | 'solid' | 'outline'   // badge, button, stat, progress
  size?: 'sm' | 'md' | 'lg'
  align?: 'start' | 'center' | 'end'
}
```

Each primitive renderer maps `(tone, variant, size)` to vocabulary classes through one fixed table,
so the look of all declarative widgets changes in one place.

**Component widgets from Hermes (E6).** These checks are added to the save-time validation of
base design §7.5 step 4 and §7.7:

1. **SFC blocks.** Only `<template>`, `<script setup>` and `<style scoped>`.
2. **Template AST.**
   - Collect static `class` values and literals in `:class` (objects, arrays, ternaries of
     literals).
   - Reject class strings built dynamically (concatenation, template literals, variables).
   - Reject static `style` attributes. Vue stringifies large static subtrees into `innerHTML`, and
     CSP then blocks the inline style.
   - Reject string `:style`. Object `:style` is allowed only with keys `width`, `height`,
     `min-*`/`max-*`, `transform`, `opacity`, `grid-*` and custom properties outside the reserved
     prefix `--ld-*`. A reserved key is rejected, so content cannot redefine theme tokens.
3. **Classes.** Run `checkClasses`; errors go to the Hermes repair round.
4. **Scoped style.** `<style scoped>` goes through `compileStyle` with a postcss filter that rejects:
   - a colour literal in **any** declaration value, shorthands included (`border`, `outline`,
     `background`, `-webkit-text-fill-color`, …): hex, colour functions (`rgb()`, `hsl()`,
     `oklch()`, `color-mix()`, …) and CSS named colours. Colours come only from `var(--ld-*)`,
     `transparent` and `currentColor`;
   - a custom property in a colour position other than `var(--ld-*)`, so a widget's own variable
     cannot carry a colour;
   - declaring any `--ld-*` custom property, so scoped CSS cannot redefine theme tokens;
   - `font-family` other than `var(--ld-font-*)`, and the `font` shorthand (longhands such as
     `font-size` and `font-weight` stay allowed);
   - `:global`, `:deep(.widget…)`, `html`, `body`, `.room*`, `.widget*`;
   - `@import`, `@font-face`, external `url()`, `position: fixed`, `!important`.
5. **CSS artifact.** Uno CSS for the version's classes (no preflight) plus the scoped CSS, wrapped
   in `@layer ld.widget`, is stored
   with the version and attached via `<link>`. `adoptedStyleSheets` is an alternative only after a
   WKWebView CSP probe.
6. **Widget SDK theme API.** `useWidget().theme` exposes:
   - `mode`;
   - `token(name)`, which reads the computed value on the widget element (for canvas, pixi.js and
     charts);
   - `onChange(cb)`.

## Typography and fonts

Typography is part of the token contract: `font-ui`, `font-mono`, `font-display`, `font-scale`,
weights, `leading`, `tracking`. A theme names fonts by family stack. Fonts themselves come from a
registry outside themes:

```ts
interface FontDefinition {
  id: string
  family: string
  source: 'system' | 'bundled' | 'user'
  category: 'sans' | 'serif' | 'mono' | 'display'   // selects the fallback stack
  weightRange?: [number, number]
  assetId?: string                                  // source 'user' only
}
```

| Source | Mechanism | When |
| --- | --- | --- |
| system | `system-ui`, `ui-monospace`, `ui-rounded` stacks; a typed family name checked with `document.fonts.check()` (`queryLocalFonts` does not exist in WKWebView) | MVP: stacks only |
| bundled | A small curated set via `@fontsource-variable` (each font is a new dependency, approved separately) | after MVP |
| user | Uploaded `.woff2`/`.ttf` in asset storage, loaded with `new FontFace(family, arrayBuffer)`; CSP stays `font-src 'self'` | E6 |
| Google Fonts | Never at runtime: it leaks the user's IP (LG München I, 3 O 17493/20) and breaks offline use. Download and upload the file instead | — |

A theme that references a missing font falls back to the category stack; the theme list shows a
warning. Fonts load lazily, only when a used theme references them.

## Effects and comfort

**Effects belong to the theme.** Blur, edge highlight, glow, elevation and transition
character are optional tokens plus skin rules. They travel with the theme.

**Comfort belongs to the user.** It is stored on the Workspace, never exported with a theme, and
always beats the theme (layer `ld.comfort`).

```ts
interface ComfortProfile {
  motion: 'system' | 'full' | 'reduced' | 'none'   // system follows prefers-reduced-motion
  transparency: 'full' | 'reduced'                 // reduced: surface-1-solid, no blur
  effects: 'full' | 'lite'                         // lite: no blur, glow (weak GPUs, WebKitGTK)
}
```

The profile sets `.comfort--motion-reduced`, `.comfort--motion-none`,
`.comfort--transparency-reduced` and `.comfort--effects-lite` on `<html>`, above the `.room` root,
so descendant selectors reach both the root and the widgets.

Transparency reduction and foreign widgets share one rule in `ld.comfort`, which beats the theme
block in `ld.theme`. The `var()` substitution happens on the same element as the theme block, so
it picks up that element's own solid values:

```css
.comfort--transparency-reduced .room, .comfort--transparency-reduced .widget, .widget--foreign {
  --ld-surface-1: var(--ld-surface-1-solid);
  --ld-blur: 0;
}
```

- `reduced` keeps fades of 150 ms or less and removes movement and scaling.
- `none` removes all animation, including the Room-switch crossfade.
- Safari has no `prefers-reduced-transparency`, so transparency is a manual setting.

A `contrast: high` preference is deferred: without a compiler it requires every theme to ship a
high-contrast block.

## Storage, versioning, import/export

- **Built-in themes:** `app/theme/builtin.ts` lists `{ id, name, mode, skin }`. The CSS is
  `theme/styles/themes/<name>.css`, imported at build time.
- **User themes (E1):**
  - Stored in table `themes(id, name, mode, skin, css, contract_version, revision, created_at,
    updated_at)`.
  - Served together as `GET /api/v1/themes/styles.css`, wrapped in `@layer ld.theme`, with
    `Cache-Control: no-cache` and an `ETag` equal to the hash of the whole response body. Any
    create, update or delete changes the body and therefore the ETag.
  - Every write is validated on the server.
  - Deleting a theme in use is allowed; references resolve as `null` (see Architecture).
- **Selection:**
  - MVP: `localStorage` key `lifedashboard.appearance`, value
    `{ schemaVersion: 1, themeId: string | null, comfort?: ComfortProfile }`.
    - `loadAppearance()` never throws. Missing, malformed or unreadable data yields defaults.
    - `saveAppearance()` never throws and returns `boolean`. On `false` the selected theme stays
      applied in memory, and the header shows the same storage notice as the board.
    - Tests cover reload, malformed JSON, and `getItem` / `setItem` exceptions.
  - Later: Workspace settings in SQLite; `Room.themeId`; `WidgetInstance.appearance.themeId`
    (board document `schemaVersion: 2` migration in `parseBoardDocument`).
- **Export:** `<name>.ldtheme.json` = `{ format: 'lifedashboard-theme', contractVersion, slug,
  name, mode, skin, css }`. `slug` is the theme's `themeClass(id)` in the exporting install.
- **Import:**
  1. Parse.
  2. Check `format` and `contractVersion`.
  3. Run `validateThemeCss(css, { slug: envelope.slug, mode })`.
  4. Assign a new `user:<uuid>` id.
  5. Rewrite the two selectors of the token block from the envelope slug to
     `themeClass(newId)` (`u-<uuid>`). This is safe because the validator has already proved that
     the stylesheet is exactly that one rule.

  An import never activates the theme automatically.

## Performance

- Theme switch = class change on the root and on widgets. No CSS is generated or injected at
  runtime.
- Each widget re-applies its theme's token block (about 90 declarations) through one class rule.
  Elements with equal classes share style computation.
- `backdrop-filter` on many widgets is the main GPU cost. `effects: lite` removes it, and skins
  apply blur on `__wrapper` only.
- UnoCSS is build-time for builtin widgets; Hermes widget CSS is produced once per saved version.
- No polling, no MutationObserver.

## CSP and Tauri

- `style-src` stays without `'unsafe-inline'`. All CSS arrives as files: the build, the
  user-theme endpoint and widget artifacts.
- Variables and dynamic sizes are set through object `:style` bindings, which Vue applies with
  `setProperty` (CSSOM). CSP does not block this.
- `index.html` must have no inline `<style>`. Otherwise Tauri injects nonces and hashes, which
  disable `'unsafe-inline'` for the whole directive.
- **Unverified, test in packaged WKWebView before freezing the CSP (E7):**
  - whether WebKit applies `style-src` to constructable stylesheets;
  - whether `style.cssText` assignment is blocked.

## Accessibility

- Contrast is enforced by the validator (WCAG 2 table above).
- Colour is never the only status signal: primitives carry an icon or text (§14.2).
- `focus-ring` is a required token. Focus is shown with `:focus-visible` in frame, skin and
  primitives.
- Motion and transparency are controlled by `ComfortProfile`. `prefers-reduced-motion` is
  respected by default.
- Per-scope `color-scheme` keeps scrollbars and native controls correct in mixed light and dark
  layouts.

## MVP

The implementation plan covers exactly this:

1. **UnoCSS** (`unocss`, `@unocss/nuxt`, exact version pinned at install).
   - Semantic vocabulary and blocklist.
   - `checkClasses`, with a vitest test over all builtin SFCs.
   - `PlaceholderWidget` content moves to Uno classes; any remaining scoped CSS is wrapped in
     `@layer ld.widget`.
2. **Token contract.** `contract.ts` and `docs/theme-contract.md`.
3. **Built-in themes and skins.**
   - **Glass**: dark, `glass` skin. The default, keeping today's radial-gradient look.
   - **Obsidian**: dark, `solid` skin.
   - **Paper**: light, `paper` skin.
4. **Validator.**
   - `color.ts`: oklch → sRGB and WCAG contrast.
   - `validate-theme.ts`: postcss; the single token block, token names, types and ranges,
     opacity rules, contrast matrix.
   - Tests: all built-in themes pass; fixtures for each rejection rule fail with the expected
     message, including a theme that passes translucent mode but fails solid mode, a `var()` in
     `surface-1-solid`, and a translucent `surface-2`.
5. **Frame and root.**
   - `WidgetFrame` becomes the BEM structure (`__wrapper`, `__box`, `__body`).
   - Layer order with `ld.widget`; `ld.frame` with stacking levels and the optional-token reset;
     `ld.skin`, `ld.theme`, `ld.comfort` files.
   - `WidgetBoard.vue` builder affordances (grid dots, landing outline, resize handle, size
     label; today hard-coded at lines 338–410) move to tokens.
   - `app.vue` drops its hard-coded colours, and the root becomes
     `room room--theme-* room--skin-*` with `.room__backdrop`.
   - `widget-theme.css` is removed.
6. **Workspace theme selection.**
   - A native `<select>` in the header.
   - `appearance.ts`: never-throw load/save, fallback to Glass, storage notice on a failed save
     (see Storage).
   - `resolve.ts` with `resolveThemeId` and `themeClass`, plus tests.
7. **Comfort and fonts.** `prefers-reduced-motion` handling in `ld.comfort` (no UI). System font
   stacks only.

**New dependencies, approved with this spec:**
- `unocss` and `@unocss/nuxt`: runtime build tooling for `apps/ui`.
- `postcss`: devDependency of `apps/ui` for the validator tests. It moves to the server package
  with import.

**Verification:**
- `pnpm --filter @lifedashboard/ui test` and `typecheck`.
- `nuxt generate` succeeds.
- Manual check in Orca's built-in browser, all three themes at 1280×700: board, builder mode
  (draft drag and resize, landing outline, grid dots), focus indicators, theme switch, and the
  narrow-window message unaffected.

## Later, by stage

| Stage | Scope |
| --- | --- |
| E1 (SQLite, API) | `themes` table, import with server validation, `styles.css` endpoint, theme list (rename, delete, export), Workspace appearance in SQLite |
| E2 (Rooms) | `Room.themeId`, whole-screen Room theme, View Transition crossfade on Room switch |
| Edit-mode header | `.widget__header` controls; per-widget theme choice (`WidgetInstance.appearance.themeId`) |
| E3b | Declarative primitives with `PrimitiveAppearance` |
| E6 | Hermes SFC pipeline (class check, scoped-style filter, CSS artifact), `useWidget().theme`, user fonts |
| After MVP | `ComfortProfile` UI, bundled fonts, a Workspace option to follow the system light/dark preference with a theme pair |
| Possibly later | Per-widget overrides, semantic slots, high-contrast preference |

## File structure (MVP)

```text
apps/ui/
  uno.config.ts
  app/theme/
    contract.ts          token lists (required/optional), SkinId, ThemeRecord, contract version
    builtin.ts           built-in theme metadata
    resolve.ts           resolveThemeId(), themeClass()
    appearance.ts        load/save Workspace appearance (localStorage)
    color.ts             oklch parsing, oklch → sRGB, WCAG contrast
    validate-theme.ts    validateThemeCss()
    vocabulary.ts        checkClasses()
    styles/
      layers.css         @layer order
      frame.css          ld.frame
      comfort.css        ld.comfort
      skins/glass.css  skins/solid.css  skins/paper.css
      themes/glass.css themes/obsidian.css themes/paper.css
  app/widgets/WidgetFrame.vue
  test/color.test.ts  test/theme-contract.test.ts  test/theme-resolve.test.ts  test/vocabulary.test.ts
docs/theme-contract.md
```

`app/theme/*.ts` files have no Vue or DOM dependency (except `appearance.ts`, which uses
`localStorage`), so they move to `packages/theme` when the server needs them.

## Deviations from the base design

| Base design | This spec | Why |
| --- | --- | --- |
| §6.2: a Room has a selectable theme | Room theme deferred to E2 | Rooms do not exist yet; the root already carries the `room` classes |
| §2.3: settings in SQLite | Workspace appearance in `localStorage` | No storage layer yet; same parser-with-fallback pattern as the board document |
| §7.7: component SFC may use `<style scoped>` freely | Scoped styles restricted (no colour literals, no frame selectors) | Keeps Hermes widgets inside the design system |

## Mistakes this design avoids

1. Declaring `var()` aliases on `:root` and overriding the referenced variable on a nested scope:
   the alias keeps the root value.
2. Palette classes or `dark:` in widget content: the widget stops following its scope theme.
3. Runtime `<style>` injection: breaks under the Tauri CSP.
4. Copying the Room theme into each widget: loses "inherited".
5. Letting a theme touch layout: blocked by the validator and by `ld.frame`.
6. External `url()` in themes: privacy leak and offline breakage.
7. Coupling themes to UnoCSS: themes are CSS variables, Uno only reads them.
8. Letting theme CSS contain rules: it can hide controls and bypass contrast; themes are tokens,
   structure is skins.
9. Leaving widget CSS unlayered: it beats `ld.comfort`, so the user's motion and effects choices
   stop working inside widgets.
