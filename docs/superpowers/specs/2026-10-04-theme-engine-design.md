# Theme engine: themes as validated CSS over a token contract

- **Base design:** `docs/base-2026-10-04-lifegamehermes-design.md` (§6.2, §7.4, §7.6, §7.7, §13.6, §14.1, §14.2, §15)
- **Builds on:** `docs/superpowers/specs/2026-10-04-widget-builder-placement-design.md` (`WidgetFrame`, board document)
- **Status:** design approved in conversation 2026-10-04; written spec awaiting review

## Goal

One design system for the whole app. `builtin`, `declarative` and Hermes-generated `component`
widgets all look like one product. A user switches the look of the whole dashboard, of one Room,
or of a single widget by choosing a theme. The layout engine stays outside the reach of any theme.

This document is the full architecture. The implementation plan covers only the MVP slice
(see [MVP](#mvp)); every later part is scheduled against the base-design stages.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| What a theme is | A record `{ id, name, mode, skin, css }`. The CSS sets values for a fixed token contract and may add visual rules under its own class | Themes are produced by AI (a separate skill) or shipped with the app; nobody hand-edits them in a UI |
| Theme editor | None. Per-widget overrides and semantic slots are dropped | No editor means nobody sets them. A widget that must look different gets a different theme |
| Built-in vs user themes | One mechanism. Built-in themes are CSS files in the repo with the same contract and validator as imported ones | One code path; built-in themes are the reference for the AI skill |
| Theme selection | `themeId: string \| null` on Workspace, Room and WidgetInstance; `null` inherits | Changing a Room theme recolours every widget that was not set explicitly; "reset to inherited" is `null` |
| Room theme scope | The whole screen while that Room is active: shell, backdrop and board | Only one design system is visible at a time (§14.1); widget themes are the only exception |
| Frame styling | BEM: `.widget > __wrapper > __box > __body`, plus a reusable **skin** class for structural effects | Effects (glass highlight, glow, gradient border) need layers and pseudo-elements, not just variable values |
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

## Architecture

```text
L0  System constants   static CSS: grid, spacing scale, z-index, container sizes. No theme sees them.
L1  Theme              ThemeRecord: token values + optional visual rules + skin
L2  Workspace          themeId                      ┐ resolved together on the root element
L3  Room               themeId | null               ┘ (the active Room themes the whole screen)
L4  Widget             themeId | null
    ComfortProfile     user preferences, last CSS layer, beats every theme
```

`resolveThemeId([widget, room, workspace], known)` returns the first id that is non-null and
known, otherwise the default built-in theme. An unknown id (deleted theme, import from another
install) is treated as `null`: inheritance continues and the UI shows a warning. Stored data is
never rewritten, so re-importing the theme restores the choice.

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
- Modifiers set by the board, never by themes: `.widget--editing`, `.widget--state-<state>`.
- `.widget__header` is an overlay (`position: absolute`), so entering edit mode does not reflow
  widget content. In edit mode the body is dimmed and ignores pointer events.

### CSS layers

```css
@layer ld.reset, ld.frame, ld.skin, ld.theme, ld.utilities, ld.comfort;
```

| Layer | Contents | Author |
| --- | --- | --- |
| `ld.reset` | Minimal reset: `box-sizing`, body margin | us, static |
| `ld.frame` | Frame mechanics: heights, `overflow`, `container-type: size` and `isolation: isolate` on `__body`, header overlay, fallbacks for optional tokens | us, static |
| `ld.skin` | `.room--skin-*`, `.widget--skin-*`: layers, pseudo-elements, blur, borders; all values from tokens | us, `theme/styles/skins/` |
| `ld.theme` | Theme token blocks and their extra visual rules (built-in files and the user-theme stylesheet) | built-in files; validated import |
| `ld.utilities` | UnoCSS output (content only) | generator |
| `ld.comfort` | `ComfortProfile` rules: solid surfaces, no blur/noise/glow, zero durations | us, static |

Unlayered CSS (Vue `<style scoped>` in widgets) beats all layers, but scoped styles reach only the
widget's own content elements. `isolation: isolate` on `__body` keeps content `z-index` below the
header overlay, and `overflow: hidden` on `__box` clips absolutely positioned content. `contain:
paint` is not used on `.widget` because it would clip shadows and glow.

Frame mechanics (`ld.frame`):

```css
.widget__wrapper { height: 100%; }
.widget__box     { position: relative; height: 100%; overflow: hidden;
                   border-radius: var(--widget-radius, var(--ld-radius-widget)); }
.widget__body    { box-sizing: border-box; height: 100%; overflow-y: auto; container-type: size;
                   isolation: isolate; padding: var(--widget-padding, var(--ld-widget-padding));
                   scrollbar-color: var(--ld-border-strong) transparent; }
.widget__header  { position: absolute; inset: 0 0 auto; }
.widget--editing .widget__body { opacity: .5; pointer-events: none; }
```

## Token contract

All tokens use the `--ld-` prefix, except the optional frame tokens `--widget-*`. The canonical
list lives in `app/theme/contract.ts`; `docs/theme-contract.md` is its human- and AI-readable
description and the source for the AI theme skill.

### Required tokens

| Group | Tokens |
| --- | --- |
| Background | `bg` (opaque colour), `backdrop` (gradient or colour for `.room__backdrop`), `scrim` |
| Surfaces | `surface-1` (widget box), `surface-2` (cards inside), `surface-3` (controls, inputs); `surface-1-solid`, `surface-2-solid`, `surface-3-solid` (opaque variants for reduced transparency) |
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
| Effects | `shadow-widget`, `shadow-raised`, `blur`, `glow`, `glass-highlight`, `noise-opacity` | `none` / `0` / `transparent` |
| Frame | `--widget-surface`, `--widget-border`, `--widget-radius`, `--widget-shadow`, `--widget-blur`, `--widget-padding` | The matching `--ld-*` token |

`font-scale` multiplies text sizes only. It does not change the root `rem`, which scales the
layout with the viewport (§7.4), so a theme cannot change the grid.

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

**Token block.** Exactly one rule whose selector list is `.room--theme-<slug>`,
`.widget--theme-<slug>` (both). It contains:

- every required token, and optional tokens only from the contract list (unknown `--*` names are
  rejected);
- `color-scheme`, which must match `mode`.

**Values:**

- Colour tokens: `oklch(L C H [/ A])` literals, `var(--ld-<colour token>)` referencing a token in
  the same block, or `transparent`.
- `bg` must be opaque, and so must every `*-solid` surface.
- `backdrop` may also be `linear-gradient()` / `radial-gradient()` built only from those colour
  forms.
- Non-colour tokens: lengths (`rem`, `em`, `px`), numbers, durations, `cubic-bezier()`, font
  stacks, `box-shadow` lists.
- Forbidden anywhere: `url(`, `image-set(`, `attr(`, `expression`, `!important`.

**Extra visual rules** (optional). The selector starts with `.room--theme-<slug>` or
`.widget--theme-<slug>`, followed by `>` or a descendant combinator and one of:

- `.room__backdrop`, `.widget__wrapper`, `.widget__box`, `.widget__body`;
- their `::before` / `::after`;
- `:hover` / `:focus-within` on the theme class itself (`.widget--theme-<slug>:hover > .widget__wrapper`).

Allowed properties:

| Applies to | Properties |
| --- | --- |
| Any allowed element | `background*`, `border-color`, `border-style`, `border-image*`, `border-radius`, `box-shadow`, `outline*`, `backdrop-filter`, `-webkit-backdrop-filter`, `filter`, `opacity`, `color`, `mix-blend-mode`, `transition*` |
| `::before` / `::after` only | `content: ""`, `position: absolute`, `inset`, `pointer-events: none` |

**Rejected:**

- `.widget__header`, `.widget__state`, `.room__header` controls, and any element not listed above;
- layout properties on any element: `position` (outside pseudo-elements), `display`, `width`,
  `height`, `margin`, `padding`, `border-width`, `grid-*`, `flex*`, `transform`;
- all at-rules except `@media (prefers-reduced-motion | prefers-color-scheme | prefers-contrast)`
  around allowed rules;
- `@import`, `@font-face`, `@keyframes`.

**Contrast** (WCAG 2, §14.2):

- Every translucent colour is composited over `bg` first.
- The validator resolves `var()` references inside the block.
- `oklch` is converted to sRGB with gamut clipping by our own `color.ts`; no colour library is
  added.

| Foreground | Background | Minimum |
| --- | --- | --- |
| `text-primary` | `surface-1` | 7:1 |
| `text-primary`, `text-secondary`, `text-muted` | `surface-1`, `surface-2`, `surface-3` | 4.5:1 |
| `accent-text`, `<s>-text` | `surface-1` | 4.5:1 |
| `on-accent` | `accent`; `on-<s>` on `<s>` | 4.5:1 |
| `focus-ring` | `surface-1` | 3:1 |

`text-disabled` is exempt. Limitation: contrast over a photo backdrop cannot be checked. Glass
themes rely on surface opacity plus the `transparency: reduced` comfort setting.

## Skins

A skin is structural CSS shared by several themes: Blue Glass and Pink Glass share the `glass`
skin and differ only in token values. Skins live in `theme/styles/skins/<id>.css`, in layer
`ld.skin`, and read only tokens. Adding a skin is a code change (trusted CSS). `SkinId` is a closed
union in `contract.ts`.

```css
@layer ld.skin {
  .widget--skin-glass > .widget__wrapper {
    backdrop-filter: blur(var(--widget-blur, var(--ld-blur, 0)));
    box-shadow: var(--widget-shadow, var(--ld-shadow-widget, none));
  }
  .widget--skin-glass .widget__box {
    background: var(--widget-surface, var(--ld-surface-1));
    border: var(--ld-border-width) solid var(--widget-border, var(--ld-border-subtle));
  }
  .widget--skin-glass .widget__box::before {                       /* top highlight */
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(oklch(1 0 0 / var(--ld-glass-highlight, 0)), transparent 40%);
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
- `<style scoped>` is allowed with `var(--ld-*)` only; colour literals are a review error.
- The vocabulary test fails on palette classes.

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
     `min-*`/`max-*`, `transform`, `opacity`, `grid-*`, `--*`.
3. **Classes.** Run `checkClasses`; errors go to the Hermes repair round.
4. **Scoped style.** `<style scoped>` goes through `compileStyle` with a postcss filter that rejects:
   - colour literals (only `var(--ld-*)`, `transparent` and `currentColor` are allowed);
   - `:global`, `:deep(.widget…)`, `html`, `body`, `.room*`, `.widget*`;
   - `@import`, `@font-face`, external `url()`, `position: fixed`.
5. **CSS artifact.** Uno CSS for the version's classes (no preflight) plus the scoped CSS is stored
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

**Effects belong to the theme.** Blur, glass highlight, noise, glow, elevation and transition
character are optional tokens plus skin rules. They travel with the theme.

**Comfort belongs to the user.** It is stored on the Workspace, never exported with a theme, and
always beats the theme (layer `ld.comfort`).

```ts
interface ComfortProfile {
  motion: 'system' | 'full' | 'reduced' | 'none'   // system follows prefers-reduced-motion
  transparency: 'full' | 'reduced'                 // reduced: *-solid surfaces, no blur
  effects: 'full' | 'lite'                         // lite: no blur, noise, glow (weak GPUs, WebKitGTK)
}
```

The profile sets `.comfort--motion-reduced`, `.comfort--motion-none`,
`.comfort--transparency-reduced` and `.comfort--effects-lite` on the root.

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
  - Served together as `GET /api/v1/themes/styles.css`, wrapped in `@layer ld.theme`, cached by
    the maximum revision.
  - Every write is validated on the server.
  - Deleting a theme in use is allowed; references resolve as `null` (see Architecture).
- **Selection:**
  - MVP: `localStorage` key `lifedashboard.appearance`, value
    `{ schemaVersion: 1, themeId: string | null, comfort?: ComfortProfile }`. The parser falls back
    to defaults on any error and never throws, like `loadBoard`.
  - Later: Workspace settings in SQLite; `Room.themeId`; `WidgetInstance.appearance.themeId`
    (board document `schemaVersion: 2` migration in `parseBoardDocument`).
- **Export:** `<name>.ldtheme.json` = `{ format: 'lifedashboard-theme', contractVersion, name,
  mode, skin, css }`.
- **Import:**
  1. Parse.
  2. Check `format` and `contractVersion`.
  3. Run `validateThemeCss`.
  4. Assign a new `user:<uuid>` id.
  5. Rewrite the slug in the selectors to the new id. This is safe because the validator has
     already restricted selectors to the old slug.

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
   - `PlaceholderWidget` content moves to Uno classes.
2. **Token contract.** `contract.ts` and `docs/theme-contract.md`.
3. **Built-in themes and skins.**
   - **Glass**: dark, `glass` skin. The default, keeping today's radial-gradient look.
   - **Obsidian**: dark, `solid` skin.
   - **Paper**: light, `paper` skin.
4. **Validator.**
   - `color.ts`: oklch → sRGB and WCAG contrast.
   - `validate-theme.ts`: postcss, token block, values, selectors, properties, contrast.
   - Tests: all built-in themes pass; fixtures for each rejection rule fail with the expected
     message.
5. **Frame and root.**
   - `WidgetFrame` becomes the BEM structure (`__wrapper`, `__box`, `__body`).
   - `ld.frame`, `ld.skin`, `ld.theme`, `ld.utilities` and `ld.comfort` layer files.
   - `app.vue` drops its hard-coded colours, and the root becomes
     `room room--theme-* room--skin-*` with `.room__backdrop`.
   - `widget-theme.css` is removed.
6. **Workspace theme selection.**
   - A native `<select>` in the header.
   - `appearance.ts` (load/save, fallback to Glass).
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
- Manual check in Orca's built-in browser: all three themes at 1280×700, with the narrow-window
  message unaffected.

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
