# Theme Engine MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard is painted by one of three validated built-in themes (Glass, Obsidian, Paper). The theme is chosen in the header and persisted. Widget frames use the BEM structure with skins, and widget content uses a semantic UnoCSS vocabulary.

**Architecture:**
- A theme is one CSS token block (`--ld-*` custom properties) for `.room--theme-<slug>, .widget--theme-<slug>`.
- A pure-TS validator (`postcss` + own oklch math) enforces the token contract, value ranges, opacity rules and the WCAG contrast matrix. It runs in Vitest on the built-in themes.
- Static CSS ships in fixed cascade layers: `ld.frame` holds the mechanics, `ld.skin` the effects, `ld.theme` the tokens and `ld.comfort` the reduced-motion rules.
- UnoCSS with emptied wind4 theme families and semantic rules styles widget content inside `.widget__body`.
- The root element carries `room room--theme-* room--skin-*`. `WidgetFrame` renders `.widget > __wrapper > __box > __body`.

**Tech Stack:** Node 24, pnpm 10.30.2, TypeScript 6.0.3, Nuxt 4.5.2 (SPA, Vite 8.3.2), Vue 3.5.43, Vitest 5.0.3. New: `unocss` 66.10.5, `@unocss/nuxt` 66.10.5, `postcss` 8.5.28 (dev).

**Spec:** `docs/superpowers/specs/2026-10-04-theme-engine-design.md`. Base design: `docs/base-2026-10-04-lifegamehermes-design.md` (§7.4, §14.1, §14.2).

## Global Constraints

- **Branch.** Work on `csscoder/theme-engine` and never commit to `main`.
- **Pre-existing change.** `pnpm-workspace.yaml` has an uncommitted change that belongs to the user. Never stage, revert or commit it, and stage only the files each task names.
- **Dependencies.** Use exact versions, no `^`/`~`. The only new dependencies are:
  - `unocss@66.10.5` and `@unocss/nuxt@66.10.5` in `dependencies` of `apps/ui`;
  - `postcss@8.5.28` in `devDependencies` of `apps/ui`.
- **TypeScript.** Strict, and the code must compile with `noUncheckedIndexedAccess`.
- **Nuxt.** It has `imports: { autoImport: false }` and `components: false`, so import every Vue API, component and module explicitly. Local imports have no extensions (`'./contract'`).
- **Language.** User-facing strings are Russian. Code, identifiers, comments, docs and commit messages are English.
- **Commits.** A short conventional subject and no attribution trailers.
- **Layer order**, verbatim and first in the app CSS: `@layer ld.reset, ld.frame, ld.skin, ld.theme, ld.utilities, ld.widget, ld.comfort;`
- **Theme CSS** is exactly one rule `.room--theme-<slug>, .widget--theme-<slug> { … }` holding `color-scheme` and contract tokens only. Colours are `oklch()` literals, `var(--ld-<colour token>)` or `transparent`.
- **Theme ids:** `builtin:<name>` maps to the class suffix `<name>`, and `user:<uuid>` maps to `u-<uuid>`. The default is `builtin:glass`.
- **Storage.** The `localStorage` key is `lifedashboard.appearance` and the value is `{ schemaVersion: 1, themeId: string | null }`. Load and save never throw.
- **No runtime CSS injection:** no `<style>` from JS and no inline `<style>` in `index.html`. Dynamic values only go through object `:style` bindings.
- **Target WebViews: Safari 18 / current Chromium.** Do not use `@scope`, `contrast-color()` or `prefers-reduced-transparency`.
- **Root scale, verbatim and unchanged:** `html { font-size: max(16px, min(1vw, calc(100dvh / 43.75))) }`. Grid: 12×8 cells, `4rem` cells, `0.75rem` gap.
- **Out of scope (do not build):**
  - theme import/export, the user-theme endpoint, SQLite;
  - Rooms, per-widget theme choice, `.widget--foreign`;
  - the `ComfortProfile` UI or classes, `.widget__header` / `.widget__state` markup, edit mode;
  - declarative primitives, the Hermes SFC pipeline, bundled or user fonts.

## Review Focus

1. **UnoCSS output loaded before `layers.css`.** Then `ld.utilities` becomes the lowest layer and content classes silently lose to frame and skin rules. Expected: the built CSS declares the layers in the constant order. Pinned by Task 5, Step 9 (build + layer-order script).
2. **Bad stored appearance.** Nothing throws in any case:
   - malformed JSON, a wrong shape or storage throwing on read → Glass applies, no notice;
   - an unknown theme id → Glass applies, the header shows «Тема не найдена, показана тема по умолчанию», and the stored value stays unchanged;
   - storage throwing on write → the selected theme stays applied for the session, and the header shows «Не удалось сохранить тему».
   Pinned by Task 3 tests and Task 6, Step 9.
6. **Keyboard focus in the header while the builder is open.** Arrow keys and Enter in the theme `<select>` must operate the select. They must not move, resize or confirm the board draft. Pinned by Task 6, Steps 1–4 and Step 8.
3. **Paper (light) theme and the shell.** Builder affordances and header controls used to be hard-coded white and would vanish on a light theme. Expected: shell and frame styles contain no colour literals. Pinned by Task 4 test `styles use theme tokens only`.
4. **Optional effect tokens leaking.** A token set by the Room theme (`blur`, `glow`, `edge-highlight`, shadows) must not leak into a widget theme that omits it. Expected: `frame.css` resets exactly `OPTIONAL_TOKENS`. Pinned by Task 4 test.
5. **Built-in theme or skin not imported.** A theme listed in `builtin.ts` whose CSS or skin is not imported by `layers.css` renders without tokens when selected. Expected: every built-in theme and skin is imported. Pinned by Task 4 test.

---

### Task 1: Colour math (`color.ts`)

**Files:**
- Create: `apps/ui/app/theme/color.ts`
- Test: `apps/ui/test/color.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`apps/ui/app/theme/color.ts`):
  - `interface Oklch { l: number; c: number; h: number; alpha: number }`. `l` is 0–1, `alpha` is 0–1.
  - `interface Rgba { r: number; g: number; b: number; alpha: number }`. Channels are gamma-encoded sRGB 0–1.
  - `parseColor(value: string): Oklch | null`. Accepts `oklch(L C H [/ A])` (L as number or %, A as number or %) and `transparent`. Returns null otherwise, including for non-finite components.
  - `toRgba(color: Oklch): Rgba`. oklch → sRGB with per-channel clipping.
  - `composite(top: Rgba, bottom: Rgba): Rgba`. Source-over in gamma-encoded sRGB, as browsers paint.
  - `contrastRatio(a: Rgba, b: Rgba): number`. WCAG 2 ratio; alpha is ignored, so callers composite first.

- [ ] **Step 1: Write the failing test**

`apps/ui/test/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { composite, contrastRatio, parseColor, toRgba, type Rgba } from '../app/theme/color'

const rgb = (r: number, g: number, b: number): Rgba => ({ r: r / 255, g: g / 255, b: b / 255, alpha: 1 })

describe('parseColor', () => {
  it.each([
    ['oklch(0.5 0.1 200)', { l: 0.5, c: 0.1, h: 200, alpha: 1 }],
    ['oklch(50% 0.1 200 / 0.5)', { l: 0.5, c: 0.1, h: 200, alpha: 0.5 }],
    ['oklch(0.5 0.1 200deg / 50%)', { l: 0.5, c: 0.1, h: 200, alpha: 0.5 }],
    ['transparent', { l: 0, c: 0, h: 0, alpha: 0 }],
  ])('parses %s', (value, expected) => {
    expect(parseColor(value)).toEqual(expected)
  })

  it.each([
    '#fff',
    'rgb(0 0 0)',
    'oklch(1.2 0 0)',
    'oklch(0.5 0.1)',
    'oklch(0.5 0.1 200 / 2)',
    'var(--x)',
    `oklch(0.5 ${'9'.repeat(400)} 200)`, // overflows to Infinity
    `oklch(0.5 0.1 ${'9'.repeat(400)})`,
  ])(
    'rejects %s',
    (value) => {
      expect(parseColor(value)).toBeNull()
    },
  )
})

describe('toRgba', () => {
  it('maps oklch white and black to sRGB white and black', () => {
    const white = toRgba(parseColor('oklch(1 0 0)')!)
    const black = toRgba(parseColor('oklch(0 0 0)')!)
    expect([white.r, white.g, white.b]).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6), expect.closeTo(1, 6)])
    expect([black.r, black.g, black.b]).toEqual([0, 0, 0])
  })

  it('maps the oklch value of sRGB red back to red', () => {
    const red = toRgba(parseColor('oklch(0.627955 0.257683 29.2339)')!)
    expect(red.r).toBeCloseTo(1, 3)
    expect(red.g).toBeCloseTo(0, 3)
    expect(red.b).toBeCloseTo(0, 3)
  })

  it('keeps channels finite for a huge finite hue', () => {
    const { r, g, b } = toRgba(parseColor(`oklch(0.5 0.1 ${'9'.repeat(308)})`)!)
    expect([r, g, b].every(Number.isFinite)).toBe(true)
  })

  it('clips out-of-gamut channels to 0–1', () => {
    const { r, g, b } = toRgba(parseColor('oklch(0.7 0.4 150)')!)
    for (const channel of [r, g, b]) expect(channel).toBeGreaterThanOrEqual(0)
    for (const channel of [r, g, b]) expect(channel).toBeLessThanOrEqual(1)
  })
})

describe('composite', () => {
  it('blends half-transparent white over black to mid grey', () => {
    const result = composite({ r: 1, g: 1, b: 1, alpha: 0.5 }, rgb(0, 0, 0))
    expect(result).toEqual({ r: 0.5, g: 0.5, b: 0.5, alpha: 1 })
  })

  it('keeps an opaque top colour', () => {
    expect(composite(rgb(10, 20, 30), rgb(200, 200, 200))).toEqual(rgb(10, 20, 30))
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for equal colours', () => {
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21, 5)
    expect(contrastRatio(rgb(118, 118, 118), rgb(118, 118, 118))).toBe(1)
  })

  it('matches the WCAG value for #767676 on white', () => {
    expect(contrastRatio(rgb(118, 118, 118), rgb(255, 255, 255))).toBeCloseTo(4.54, 2)
  })

  it('is symmetric', () => {
    expect(contrastRatio(rgb(255, 255, 255), rgb(118, 118, 118))).toBe(contrastRatio(rgb(118, 118, 118), rgb(255, 255, 255)))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/color.test.ts`
Expected: FAIL — `Failed to resolve import "../app/theme/color"`.

- [ ] **Step 3: Implement `color.ts`**

`apps/ui/app/theme/color.ts`:

```ts
export interface Oklch {
  l: number
  c: number
  h: number
  alpha: number
}
/** Gamma-encoded sRGB channels 0–1 plus alpha. */
export interface Rgba {
  r: number
  g: number
  b: number
  alpha: number
}

const NUMBER = String.raw`(-?\d*\.?\d+)(%?)`
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*${NUMBER}\s+${NUMBER}\s+${NUMBER}(?:deg)?\s*(?:\/\s*${NUMBER}\s*)?\)$`,
  'i',
)

/** Parses an `oklch(L C H [/ A])` literal or `transparent`; anything else is null. */
export function parseColor(value: string): Oklch | null {
  const text = value.trim()
  if (text === 'transparent') return { l: 0, c: 0, h: 0, alpha: 0 }
  const m = OKLCH.exec(text)
  if (!m) return null
  const part = (index: number, percentOf: number) => {
    const n = Number(m[index])
    return m[index + 1] === '%' ? (n / 100) * percentOf : n
  }
  const l = part(1, 1)
  const c = part(3, 0.4)
  const alpha = m[7] === undefined ? 1 : part(7, 1)
  const h = Number(m[5])
  if (![l, c, h, alpha].every(Number.isFinite)) return null
  if (m[6] === '%' || l < 0 || l > 1 || c < 0 || alpha < 0 || alpha > 1) return null
  return { l, c, h, alpha }
}

function encode(x: number): number {
  // ponytail: per-channel clipping, not CSS Color 4 chroma-reduction gamut mapping; built-in themes stay near sRGB.
  const v = Math.min(1, Math.max(0, x))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

/** oklch → gamma-encoded sRGB (Björn Ottosson's OKLab matrices). */
export function toRgba({ l, c, h, alpha }: Oklch): Rgba {
  const rad = ((h % 360) * Math.PI) / 180 // the modulo keeps a huge finite hue from overflowing to NaN
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: encode(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: encode(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: encode(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
    alpha,
  }
}

/** Paints `top` over `bottom` the way browsers do: source-over in gamma-encoded sRGB. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha)
  if (alpha === 0) return { r: 0, g: 0, b: 0, alpha: 0 }
  const mix = (t: number, b: number) => (t * top.alpha + b * bottom.alpha * (1 - top.alpha)) / alpha
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), alpha }
}

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = ({ r, g, b }: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

/** WCAG 2 contrast ratio. Alpha is ignored: composite translucent colours first. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/color.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/theme/color.ts apps/ui/test/color.test.ts
git commit -m "feat(theme): add oklch to sRGB conversion and WCAG contrast"
```

---

### Task 2: Token contract, validator and built-in themes

**Files:**
- Modify: `apps/ui/package.json`, `pnpm-lock.yaml` (devDependency `postcss@8.5.28`)
- Create: `apps/ui/app/theme/contract.ts`, `apps/ui/app/theme/validate-theme.ts`, `apps/ui/app/theme/builtin.ts`
- Create: `apps/ui/app/theme/styles/themes/glass.css`, `obsidian.css`, `paper.css`
- Create: `docs/theme-contract.md`
- Test: `apps/ui/test/theme-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseColor`, `toRgba`, `composite`, `contrastRatio`, `Rgba`.
- Produces:
  - `apps/ui/app/theme/contract.ts`:
    - `CONTRACT_VERSION = 1`;
    - `SKINS = ['glass', 'solid', 'paper'] as const`, `type SkinId`;
    - `type ThemeMode = 'light' | 'dark'`;
    - `interface ThemeMeta { id: string; name: string; mode: ThemeMode; skin: SkinId }`;
    - `STATUSES = ['success', 'warning', 'danger', 'info'] as const`;
    - `type TokenSpec`;
    - `REQUIRED_TOKENS`, `OPTIONAL_TOKENS` (`Readonly<Record<string, TokenSpec>>`, keys without the `--ld-` prefix);
    - `OPAQUE_TOKENS: readonly string[]`.
  - `apps/ui/app/theme/validate-theme.ts`:
    - `interface ThemeError { rule: string; message: string }`;
    - `type ThemeValidation = { ok: true } | { ok: false; errors: ThemeError[] }`;
    - `validateThemeCss(css: string, options: { slug: string; mode: ThemeMode }): ThemeValidation`.
    - Rule ids: `forbidden`, `syntax`, `single-block`, `selector`, `color-scheme`, `unknown-property`, `duplicate`, `missing`, `value`, `reference`, `opaque`, `contrast`.
  - `apps/ui/app/theme/builtin.ts`: `DEFAULT_THEME_ID = 'builtin:glass'`, `BUILTIN_THEMES: readonly ThemeMeta[]`.
  - Theme files `apps/ui/app/theme/styles/themes/<name>.css`, where `<name>` is the id without `builtin:`.

- [ ] **Step 1: Add the devDependency**

Run: `pnpm --filter @lifedashboard/ui add -D postcss@8.5.28`
Expected: `apps/ui/package.json` devDependencies contain `"postcss": "8.5.28"` (exact). `git status` shows `pnpm-workspace.yaml` still modified and unstaged; leave it.

- [ ] **Step 2: Write the built-in theme files**

These values were checked against the contrast matrix while writing this plan (worst case over every backdrop stop, in translucent and solid mode).

`apps/ui/app/theme/styles/themes/glass.css`:

```css
/* Glass: dark, translucent widget surfaces over a violet radial backdrop. Skin: glass. */
.room--theme-glass, .widget--theme-glass {
  color-scheme: dark;
  --ld-bg: oklch(0.2 0.02 280);
  --ld-backdrop: radial-gradient(circle at 20% 10%, oklch(0.38 0.07 280), oklch(0.2 0.02 280) 60%);
  --ld-scrim: oklch(0 0 0 / 0.5);
  --ld-surface-1: oklch(1 0 0 / 0.08);
  --ld-surface-1-solid: oklch(0.27 0.03 280);
  --ld-surface-2: oklch(0.31 0.03 280);
  --ld-surface-3: oklch(0.35 0.03 280);
  --ld-state-hover: oklch(1 0 0 / 0.06);
  --ld-state-active: oklch(1 0 0 / 0.1);
  --ld-state-selected: oklch(1 0 0 / 0.14);
  --ld-text-primary: oklch(0.97 0.005 280);
  --ld-text-secondary: oklch(0.89 0.01 280);
  --ld-text-muted: oklch(0.82 0.015 280);
  --ld-text-disabled: oklch(0.55 0.015 280);
  --ld-border-subtle: oklch(1 0 0 / 0.18);
  --ld-border-default: oklch(1 0 0 / 0.25);
  --ld-border-strong: oklch(1 0 0 / 0.45);
  --ld-border-width: 0.0625rem;
  --ld-accent: oklch(0.72 0.14 285);
  --ld-accent-hover: oklch(0.77 0.13 285);
  --ld-accent-active: oklch(0.67 0.15 285);
  --ld-accent-subtle: oklch(0.72 0.14 285 / 0.12);
  --ld-accent-text: oklch(0.88 0.08 285);
  --ld-on-accent: oklch(0.18 0.03 285);
  --ld-success: oklch(0.75 0.15 150);
  --ld-success-subtle: oklch(0.75 0.15 150 / 0.12);
  --ld-success-text: oklch(0.9 0.1 150);
  --ld-on-success: oklch(0.2 0.04 150);
  --ld-warning: oklch(0.82 0.14 80);
  --ld-warning-subtle: oklch(0.82 0.14 80 / 0.12);
  --ld-warning-text: oklch(0.88 0.12 85);
  --ld-on-warning: oklch(0.22 0.04 80);
  --ld-danger: oklch(0.7 0.17 25);
  --ld-danger-subtle: oklch(0.7 0.17 25 / 0.12);
  --ld-danger-text: oklch(0.88 0.08 20);
  --ld-on-danger: oklch(0.18 0.04 25);
  --ld-info: oklch(0.74 0.12 240);
  --ld-info-subtle: oklch(0.74 0.12 240 / 0.12);
  --ld-info-text: oklch(0.89 0.07 240);
  --ld-on-info: oklch(0.2 0.04 240);
  --ld-focus-ring: oklch(0.84 0.1 285);
  --ld-radius-widget: 1rem;
  --ld-radius-card: 0.75rem;
  --ld-radius-control: 0.5rem;
  --ld-radius-pill: 999px;
  --ld-font-ui: system-ui, sans-serif;
  --ld-font-mono: ui-monospace, monospace;
  --ld-font-display: system-ui, sans-serif;
  --ld-font-scale: 1;
  --ld-weight-regular: 400;
  --ld-weight-medium: 500;
  --ld-weight-strong: 600;
  --ld-leading: 1.5;
  --ld-tracking: 0em;
  --ld-duration-fast: 120ms;
  --ld-duration-base: 200ms;
  --ld-duration-slow: 320ms;
  --ld-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ld-ease-emphasized: cubic-bezier(0.3, 0, 0, 1.2);
  --ld-widget-padding: 0.75rem;
  --ld-gap: 0.75rem;
  --ld-control-height: 2.25rem;
  --ld-shadow-widget: 0 0.5rem 2rem oklch(0 0 0 / 0.3);
  --ld-shadow-raised: 0 0.25rem 0.75rem oklch(0 0 0 / 0.3);
  --ld-blur: 1rem;
  --ld-edge-highlight: 0.18;
}
```

`apps/ui/app/theme/styles/themes/obsidian.css`:

```css
/* Obsidian: dark, opaque neutral surfaces with a cool accent. Skin: solid. */
.room--theme-obsidian, .widget--theme-obsidian {
  color-scheme: dark;
  --ld-bg: oklch(0.16 0.005 260);
  --ld-backdrop: oklch(0.16 0.005 260);
  --ld-scrim: oklch(0 0 0 / 0.6);
  --ld-surface-1: oklch(0.21 0.006 260);
  --ld-surface-1-solid: oklch(0.21 0.006 260);
  --ld-surface-2: oklch(0.25 0.007 260);
  --ld-surface-3: oklch(0.29 0.008 260);
  --ld-state-hover: oklch(1 0 0 / 0.05);
  --ld-state-active: oklch(1 0 0 / 0.09);
  --ld-state-selected: oklch(1 0 0 / 0.12);
  --ld-text-primary: oklch(0.95 0.003 260);
  --ld-text-secondary: oklch(0.84 0.006 260);
  --ld-text-muted: oklch(0.74 0.008 260);
  --ld-text-disabled: oklch(0.5 0.008 260);
  --ld-border-subtle: oklch(0.3 0.008 260);
  --ld-border-default: oklch(0.37 0.01 260);
  --ld-border-strong: oklch(0.5 0.012 260);
  --ld-border-width: 0.0625rem;
  --ld-accent: oklch(0.72 0.13 230);
  --ld-accent-hover: oklch(0.77 0.12 230);
  --ld-accent-active: oklch(0.67 0.14 230);
  --ld-accent-subtle: oklch(0.72 0.13 230 / 0.14);
  --ld-accent-text: oklch(0.8 0.11 230);
  --ld-on-accent: oklch(0.17 0.03 230);
  --ld-success: oklch(0.74 0.15 150);
  --ld-success-subtle: oklch(0.74 0.15 150 / 0.14);
  --ld-success-text: oklch(0.82 0.13 150);
  --ld-on-success: oklch(0.18 0.04 150);
  --ld-warning: oklch(0.82 0.14 80);
  --ld-warning-subtle: oklch(0.82 0.14 80 / 0.14);
  --ld-warning-text: oklch(0.86 0.12 85);
  --ld-on-warning: oklch(0.2 0.04 80);
  --ld-danger: oklch(0.7 0.17 25);
  --ld-danger-subtle: oklch(0.7 0.17 25 / 0.14);
  --ld-danger-text: oklch(0.8 0.12 22);
  --ld-on-danger: oklch(0.16 0.04 25);
  --ld-info: oklch(0.74 0.12 240);
  --ld-info-subtle: oklch(0.74 0.12 240 / 0.14);
  --ld-info-text: oklch(0.82 0.09 240);
  --ld-on-info: oklch(0.18 0.04 240);
  --ld-focus-ring: oklch(0.8 0.11 230);
  --ld-radius-widget: 0.75rem;
  --ld-radius-card: 0.5rem;
  --ld-radius-control: 0.375rem;
  --ld-radius-pill: 999px;
  --ld-font-ui: system-ui, sans-serif;
  --ld-font-mono: ui-monospace, monospace;
  --ld-font-display: system-ui, sans-serif;
  --ld-font-scale: 1;
  --ld-weight-regular: 400;
  --ld-weight-medium: 500;
  --ld-weight-strong: 650;
  --ld-leading: 1.5;
  --ld-tracking: 0em;
  --ld-duration-fast: 100ms;
  --ld-duration-base: 160ms;
  --ld-duration-slow: 260ms;
  --ld-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ld-ease-emphasized: cubic-bezier(0.3, 0, 0, 1);
  --ld-widget-padding: 0.75rem;
  --ld-gap: 0.75rem;
  --ld-control-height: 2.25rem;
  --ld-shadow-widget: 0 0.0625rem 0.125rem oklch(0 0 0 / 0.4);
  --ld-shadow-raised: 0 0.25rem 0.75rem oklch(0 0 0 / 0.35);
}
```

`apps/ui/app/theme/styles/themes/paper.css`:

```css
/* Paper: light, warm opaque surfaces with ink-like text. Skin: paper. */
.room--theme-paper, .widget--theme-paper {
  color-scheme: light;
  --ld-bg: oklch(0.95 0.01 85);
  --ld-backdrop: oklch(0.95 0.01 85);
  --ld-scrim: oklch(0.2 0.01 85 / 0.4);
  --ld-surface-1: oklch(0.99 0.004 85);
  --ld-surface-1-solid: oklch(0.99 0.004 85);
  --ld-surface-2: oklch(0.965 0.008 85);
  --ld-surface-3: oklch(0.93 0.01 85);
  --ld-state-hover: oklch(0 0 0 / 0.04);
  --ld-state-active: oklch(0 0 0 / 0.08);
  --ld-state-selected: oklch(0 0 0 / 0.1);
  --ld-text-primary: oklch(0.22 0.01 85);
  --ld-text-secondary: oklch(0.36 0.01 85);
  --ld-text-muted: oklch(0.47 0.012 85);
  --ld-text-disabled: oklch(0.65 0.01 85);
  --ld-border-subtle: oklch(0.88 0.012 85);
  --ld-border-default: oklch(0.8 0.015 85);
  --ld-border-strong: oklch(0.62 0.015 85);
  --ld-border-width: 0.0625rem;
  --ld-accent: oklch(0.5 0.13 255);
  --ld-accent-hover: oklch(0.45 0.13 255);
  --ld-accent-active: oklch(0.4 0.12 255);
  --ld-accent-subtle: oklch(0.5 0.13 255 / 0.1);
  --ld-accent-text: oklch(0.45 0.13 255);
  --ld-on-accent: oklch(0.99 0.004 85);
  --ld-success: oklch(0.48 0.12 150);
  --ld-success-subtle: oklch(0.48 0.12 150 / 0.1);
  --ld-success-text: oklch(0.42 0.11 150);
  --ld-on-success: oklch(0.99 0.004 85);
  --ld-warning: oklch(0.52 0.12 65);
  --ld-warning-subtle: oklch(0.75 0.15 75 / 0.16);
  --ld-warning-text: oklch(0.45 0.1 60);
  --ld-on-warning: oklch(0.99 0.004 85);
  --ld-danger: oklch(0.5 0.17 27);
  --ld-danger-subtle: oklch(0.5 0.17 27 / 0.1);
  --ld-danger-text: oklch(0.45 0.16 27);
  --ld-on-danger: oklch(0.99 0.004 85);
  --ld-info: oklch(0.5 0.11 240);
  --ld-info-subtle: oklch(0.5 0.11 240 / 0.1);
  --ld-info-text: oklch(0.44 0.1 240);
  --ld-on-info: oklch(0.99 0.004 85);
  --ld-focus-ring: oklch(0.5 0.13 255);
  --ld-radius-widget: 0.5rem;
  --ld-radius-card: 0.375rem;
  --ld-radius-control: 0.25rem;
  --ld-radius-pill: 999px;
  --ld-font-ui: system-ui, sans-serif;
  --ld-font-mono: ui-monospace, monospace;
  --ld-font-display: ui-serif, serif;
  --ld-font-scale: 1;
  --ld-weight-regular: 400;
  --ld-weight-medium: 500;
  --ld-weight-strong: 650;
  --ld-leading: 1.55;
  --ld-tracking: 0em;
  --ld-duration-fast: 100ms;
  --ld-duration-base: 160ms;
  --ld-duration-slow: 260ms;
  --ld-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ld-ease-emphasized: cubic-bezier(0.3, 0, 0, 1);
  --ld-widget-padding: 0.75rem;
  --ld-gap: 0.75rem;
  --ld-control-height: 2.25rem;
  --ld-shadow-widget: 0 0.0625rem 0.1875rem oklch(0.3 0.02 85 / 0.12);
  --ld-shadow-raised: 0 0.25rem 0.75rem oklch(0.3 0.02 85 / 0.14);
}
```

- [ ] **Step 3: Write `builtin.ts`**

`apps/ui/app/theme/builtin.ts`:

```ts
import type { ThemeMeta } from './contract'

export const DEFAULT_THEME_ID = 'builtin:glass'

// The CSS of each theme is styles/themes/<name>.css; styles/layers.css imports it into ld.theme.
export const BUILTIN_THEMES: readonly ThemeMeta[] = [
  { id: 'builtin:glass', name: 'Стекло', mode: 'dark', skin: 'glass' },
  { id: 'builtin:obsidian', name: 'Обсидиан', mode: 'dark', skin: 'solid' },
  { id: 'builtin:paper', name: 'Бумага', mode: 'light', skin: 'paper' },
]
```

- [ ] **Step 4: Write the failing test**

`apps/ui/test/theme-contract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '../app/theme/builtin'
import { validateThemeCss } from '../app/theme/validate-theme'

const themeCss = (name: string) => readFileSync(new URL(`../app/theme/styles/themes/${name}.css`, import.meta.url), 'utf8')
const nameOf = (id: string) => id.slice('builtin:'.length)
// Replaces the value of one token in a theme stylesheet.
const withToken = (css: string, token: string, value: string) =>
  css.replace(new RegExp(`(--ld-${token}:)[^;]*;`), `$1 ${value};`)

describe('built-in themes', () => {
  it.each(BUILTIN_THEMES.map((theme) => [theme.id, theme] as const))('%s passes the contract', (_, theme) => {
    expect(validateThemeCss(themeCss(nameOf(theme.id)), { slug: nameOf(theme.id), mode: theme.mode })).toEqual({ ok: true })
  })
})

describe('validateThemeCss', () => {
  const base = themeCss('obsidian')
  const glass = themeCss('glass')

  it.each([
    ['an extra rule', `${base}\n.widget__box { opacity: 0 }`, 'single-block', /exactly one rule/],
    ['an @import', `@import "other.css";\n${base}`, 'single-block', /exactly one rule/],
    ['a @media wrapper', `@media (min-width: 1px) { ${base} }`, 'single-block', /exactly one rule/],
    ['another selector', base.replace('.widget--theme-obsidian', '.widget'), 'selector', /must be "\.room--theme-obsidian, \.widget--theme-obsidian"/],
    ['an unknown token', base.replace(/}\s*$/, '--ld-foo: 1;\n}'), 'unknown-property', /--ld-foo is not a contract token/],
    ['a non-token property', base.replace(/}\s*$/, 'opacity: 0;\n}'), 'unknown-property', /opacity is not a contract token/],
    ['a url()', withToken(base, 'backdrop', 'url(https://example.com/a.png)'), 'forbidden', /url\(\)/],
    ['!important', withToken(base, 'bg', 'oklch(0.16 0.005 260) !important'), 'forbidden', /!important/],
    ['a missing token', base.replace(/--ld-focus-ring:[^;]*;/, ''), 'missing', /--ld-focus-ring is required/],
    ['a wrong color-scheme', base.replace('color-scheme: dark', 'color-scheme: light'), 'color-scheme', /must be "dark"/],
    ['a font scale out of range', withToken(base, 'font-scale', '0'), 'value', /--ld-font-scale: "0" must be a number 0\.875–1\.25/],
    ['a radius out of range', withToken(base, 'radius-widget', '5rem'), 'value', /--ld-radius-widget: "5rem" must be a length 0rem–2rem/],
    ['an inset shadow', withToken(base, 'shadow-widget', 'inset 0 0 1rem oklch(0 0 0 / 0.5)'), 'value', /no inset/],
    ['a hex colour', withToken(base, 'text-primary', '#fff'), 'value', /--ld-text-primary: "#fff" must be an oklch\(\) literal/],
    ['an unquoted font family', withToken(base, 'font-ui', 'Inter, sans-serif'), 'value', /--ld-font-ui: .* quoted family names/],
    ['weights out of order', withToken(base, 'weight-medium', '300'), 'value', /weight-regular < weight-medium < weight-strong/],
    ['a var() in surface-1-solid', withToken(base, 'surface-1-solid', 'var(--ld-surface-2)'), 'value', /surface-1-solid must be an oklch\(\) literal, not var\(\)/],
    [
      'a reference cycle',
      withToken(withToken(base, 'accent', 'var(--ld-accent-hover)'), 'accent-hover', 'var(--ld-accent)'),
      'reference',
      /--ld-accent has a cyclic or unresolved var\(\) reference/,
    ],
    ['a translucent surface-2', withToken(base, 'surface-2', 'oklch(0.25 0.007 260 / 0.5)'), 'opaque', /--ld-surface-2 must be fully opaque/],
    ['a translucent text colour', withToken(base, 'text-muted', 'oklch(0.74 0.008 260 / 0.6)'), 'opaque', /--ld-text-muted must be fully opaque/],
    ['malformed CSS', `${base}\n.x {`, 'syntax', /CSS does not parse/],
    ['a duplicate token', base.replace(/}\s*$/, '--ld-bg: oklch(0.2 0 0);\n}'), 'duplicate', /--ld-bg is declared twice/],
    ['a cubic-bezier x outside 0–1', withToken(base, 'ease-standard', 'cubic-bezier(2, 0, 0, 1)'), 'value', /--ld-ease-standard: .* x1 and x2 in 0–1/],
    ['a negative shadow blur', withToken(base, 'shadow-raised', '0 0.25rem -0.75rem oklch(0 0 0 / 0.3)'), 'value', /--ld-shadow-raised: .* blur ≥ 0/],
    [
      'an unknown gradient direction',
      withToken(base, 'backdrop', 'linear-gradient(sideways, oklch(0.2 0 0), oklch(0.3 0 0))'),
      'value',
      /--ld-backdrop: .*radial-gradient\(\) of oklch/,
    ],
    [
      'two horizontal gradient sides',
      withToken(base, 'backdrop', 'linear-gradient(to left right, oklch(0.2 0 0), oklch(0.3 0 0))'),
      'value',
      /--ld-backdrop: .*radial-gradient\(\) of oklch/,
    ],
    ['low text contrast', withToken(base, 'text-muted', 'oklch(0.5 0.008 260)'), 'contrast', /text-muted on surface-1 \(translucent mode\) is [\d.]+:1, needs 4\.5:1/],
  ])('rejects %s', (_, css, rule, message) => {
    const result = validateThemeCss(css, { slug: 'obsidian', mode: 'dark' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.find((error) => error.rule === rule)?.message).toMatch(message)
  })

  it('rejects a theme that passes translucent mode but fails solid mode', () => {
    const result = validateThemeCss(withToken(glass, 'surface-1-solid', 'oklch(0.6 0.03 280)'), { slug: 'glass', mode: 'dark' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThan(0)
    for (const error of result.errors) expect(error.message).toMatch(/\(solid mode\)/)
  })

  it('accepts a theme without optional tokens', () => {
    const css = base.replace(/\s*--ld-shadow-(widget|raised):[^;]*;/g, '')
    expect(validateThemeCss(css, { slug: 'obsidian', mode: 'dark' })).toEqual({ ok: true })
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/theme-contract.test.ts`
Expected: FAIL — `Failed to resolve import "../app/theme/validate-theme"`.

- [ ] **Step 6: Implement `contract.ts`**

`apps/ui/app/theme/contract.ts`:

```ts
export const CONTRACT_VERSION = 1

export const SKINS = ['glass', 'solid', 'paper'] as const
export type SkinId = (typeof SKINS)[number]
export type ThemeMode = 'light' | 'dark'

export interface ThemeMeta {
  id: string
  name: string
  mode: ThemeMode
  skin: SkinId
}

export const STATUSES = ['success', 'warning', 'danger', 'info'] as const

export type TokenSpec =
  | { type: 'color' | 'backdrop' | 'font' | 'easing' | 'shadow' }
  | { type: 'length'; unit: 'rem' | 'px' | 'em'; min: number; max: number }
  | { type: 'number' | 'time'; min: number; max: number }

const color = { type: 'color' } as const
const rem = (min: number, max: number) => ({ type: 'length', unit: 'rem', min, max }) as const
const num = (min: number, max: number) => ({ type: 'number', min, max }) as const
const time = { type: 'time', min: 0, max: 600 } as const
const colors = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, color]))

// Canonical token list (names without the --ld- prefix). docs/theme-contract.md describes it.
export const REQUIRED_TOKENS: Readonly<Record<string, TokenSpec>> = {
  ...colors(['bg', 'scrim']),
  backdrop: { type: 'backdrop' },
  ...colors(['surface-1', 'surface-2', 'surface-3', 'surface-1-solid']),
  ...colors(['state-hover', 'state-active', 'state-selected']),
  ...colors(['text-primary', 'text-secondary', 'text-muted', 'text-disabled']),
  ...colors(['border-subtle', 'border-default', 'border-strong']),
  'border-width': rem(0, 0.125),
  ...colors(['accent', 'accent-hover', 'accent-active', 'accent-subtle', 'accent-text', 'on-accent']),
  ...colors(STATUSES.flatMap((s) => [s, `${s}-subtle`, `${s}-text`, `on-${s}`])),
  'focus-ring': color,
  'radius-widget': rem(0, 2),
  'radius-card': rem(0, 2),
  'radius-control': rem(0, 2),
  'radius-pill': { type: 'length', unit: 'px', min: 0, max: 999 },
  'font-ui': { type: 'font' },
  'font-mono': { type: 'font' },
  'font-display': { type: 'font' },
  'font-scale': num(0.875, 1.25),
  'weight-regular': num(300, 800),
  'weight-medium': num(300, 800),
  'weight-strong': num(300, 800),
  leading: num(1.2, 1.8),
  tracking: { type: 'length', unit: 'em', min: -0.02, max: 0.05 },
  'duration-fast': time,
  'duration-base': time,
  'duration-slow': time,
  'ease-standard': { type: 'easing' },
  'ease-emphasized': { type: 'easing' },
  'widget-padding': rem(0.25, 1.5),
  gap: rem(0.25, 1.5),
  'control-height': rem(1.75, 2.75),
}

// Reset to `initial` on every theme scope in styles/frame.css, so they never leak from the Room
// theme into a widget theme; skins read them with a fallback.
export const OPTIONAL_TOKENS: Readonly<Record<string, TokenSpec>> = {
  'shadow-widget': { type: 'shadow' },
  'shadow-raised': { type: 'shadow' },
  blur: rem(0, 2),
  glow: color,
  'edge-highlight': num(0, 0.4),
}

// Colour tokens that must resolve to alpha 1. Only surface-1 may be translucent.
export const OPAQUE_TOKENS: readonly string[] = [
  'bg',
  'surface-1-solid',
  'surface-2',
  'surface-3',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-disabled',
  'accent',
  'accent-hover',
  'accent-active',
  'accent-text',
  'on-accent',
  'focus-ring',
  ...STATUSES.flatMap((s) => [s, `${s}-text`, `on-${s}`]),
]
```

- [ ] **Step 7: Implement `validate-theme.ts`**

`apps/ui/app/theme/validate-theme.ts`:

```ts
import postcss, { type Declaration, type Root } from 'postcss'
import { composite, contrastRatio, parseColor, toRgba, type Rgba } from './color'
import { OPAQUE_TOKENS, OPTIONAL_TOKENS, REQUIRED_TOKENS, STATUSES, type ThemeMode, type TokenSpec } from './contract'

export interface ThemeError {
  rule: string
  message: string
}
export type ThemeValidation = { ok: true } | { ok: false; errors: ThemeError[] }

const TOKENS: Readonly<Record<string, TokenSpec>> = { ...REQUIRED_TOKENS, ...OPTIONAL_TOKENS }
const FORBIDDEN = /url\(|image-set\(|attr\(|expression|!important/i
const VAR = /^var\(--ld-([a-z0-9-]+)\)$/
const COLOR_ITEM = /oklch\([^)]*\)|var\([^)]*\)|transparent/g
const GENERIC_FONTS = new Set([
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'math', 'emoji',
])
const EASINGS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'])
const NUM = String.raw`-?\d*\.?\d+`
const SIDE = '(?:left|right|top|bottom)'
const POSITION = String.raw`(?:${SIDE}|center|\d*\.?\d+%)`
const GRADIENT_HEAD = {
  linear: new RegExp(String.raw`^(?:to (?:(?:left|right)(?: (?:top|bottom))?|(?:top|bottom)(?: (?:left|right))?)|${NUM}deg)$`),
  radial: new RegExp(String.raw`^(?:(?:circle|ellipse)(?: at ${POSITION}(?: ${POSITION})?)?|at ${POSITION}(?: ${POSITION})?)$`),
}
const GRADIENT_STOP = /^(oklch\([^)]*\)|var\([^)]*\)|transparent)(?:\s+\d*\.?\d+%){0,2}$/

/** Splits at commas outside parentheses. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

const inRange = (n: number, spec: { min: number; max: number }) => Number.isFinite(n) && n >= spec.min && n <= spec.max

function isColorValue(value: string, values: Map<string, string>): boolean {
  if (parseColor(value)) return true
  const ref = VAR.exec(value)?.[1]
  return ref !== undefined && TOKENS[ref]?.type === 'color' && values.has(ref)
}

/** The colour stops of a backdrop: the value itself, or the colour items of a gradient. */
function backdropStops(value: string): string[] | null {
  const m = /^(linear|radial)-gradient\((.*)\)$/s.exec(value)
  if (!m) return [value]
  const items = splitTopLevel(m[2]!)
  if (GRADIENT_HEAD[m[1] as 'linear' | 'radial'].test(items[0]!)) items.shift()
  const stops = items.map((item) => GRADIENT_STOP.exec(item)?.[1])
  return stops.length >= 2 && stops.every((stop) => stop !== undefined) ? (stops as string[]) : null
}

/** Returns what the value must be, or null when it is valid. */
function checkType(value: string, spec: TokenSpec, values: Map<string, string>): string | null {
  switch (spec.type) {
    case 'color':
      return isColorValue(value, values) ? null : 'an oklch() literal, var(--ld-<colour token>) or transparent'
    case 'backdrop': {
      const stops = backdropStops(value)
      return stops?.every((stop) => isColorValue(stop, values))
        ? null
        : 'a colour or a linear-/radial-gradient() of oklch()/var() stops'
    }
    case 'font':
      return splitTopLevel(value).every((item) => /^"[^"\\]+"$|^'[^'\\]+'$/.test(item) || GENERIC_FONTS.has(item))
        ? null
        : 'quoted family names and generic families only'
    case 'easing': {
      if (EASINGS.has(value)) return null
      const args = /^cubic-bezier\(([^)]*)\)$/.exec(value)?.[1]?.split(',').map((arg) => arg.trim())
      const [x1, , x2] = (args ?? []).map(Number)
      const ok =
        args?.length === 4 &&
        args.every((arg) => new RegExp(`^${NUM}$`).test(arg)) &&
        [x1, x2].every((x) => x !== undefined && x >= 0 && x <= 1)
      return ok ? null : 'an easing keyword or cubic-bezier(x1, y1, x2, y2) with x1 and x2 in 0–1'
    }
    case 'shadow': {
      if (value === 'none') return null
      const shadows = splitTopLevel(value)
      const ok =
        shadows.length <= 3 &&
        shadows.every((shadow) => {
          const colorPart = shadow.match(COLOR_ITEM)?.[0]
          const lengths = shadow.replace(colorPart ?? '', '').trim().split(/\s+/)
          return (
            colorPart !== undefined &&
            isColorValue(colorPart, values) &&
            lengths.length >= 2 &&
            lengths.length <= 4 &&
            lengths.every((length) => length === '0' || (/^-?\d*\.?\d+rem$/.test(length) && Math.abs(parseFloat(length)) <= 3)) &&
            !lengths[2]?.startsWith('-') // blur radius
          )
        })
      return ok ? null : 'none or up to 3 outer shadows: rem lengths ≤ 3rem, blur ≥ 0 and one colour each (no inset)'
    }
    case 'length': {
      if (value === '0' && spec.min <= 0) return null
      const m = new RegExp(String.raw`^(-?\d*\.?\d+)${spec.unit}$`).exec(value)
      return m && inRange(Number(m[1]), spec) ? null : `a length ${spec.min}${spec.unit}–${spec.max}${spec.unit}`
    }
    case 'time': {
      const m = /^(\d*\.?\d+)ms$/.exec(value)
      return m && inRange(Number(m[1]), spec) ? null : `a time ${spec.min}ms–${spec.max}ms`
    }
    case 'number':
      return /^-?\d*\.?\d+$/.test(value) && inRange(Number(value), spec) ? null : `a number ${spec.min}–${spec.max}`
  }
}

/** Follows var() references to an oklch literal; null for a cycle or a non-colour. */
function resolveColor(name: string, values: Map<string, string>, seen = new Set<string>()): Rgba | null {
  if (seen.has(name)) return null
  seen.add(name)
  const value = values.get(name)
  if (value === undefined) return null
  const parsed = parseColor(value)
  if (parsed) return toRgba(parsed)
  const ref = VAR.exec(value)?.[1]
  return ref === undefined ? null : resolveColor(ref, values, seen)
}

/** The WCAG matrix of the spec, in translucent and solid mode. Values are already type-checked. */
function contrastErrors(values: Map<string, string>): ThemeError[] {
  const errors: ThemeError[] = []
  const color = (name: string) => resolveColor(name, values)!
  const stopColor = (stop: string) => {
    const parsed = parseColor(stop)
    return parsed ? toRgba(parsed) : color(VAR.exec(stop)![1]!)
  }
  const bg = color('bg')
  const backdrop = (backdropStops(values.get('backdrop')!) ?? []).map((stop) => composite(stopColor(stop), bg))
  const modes = [
    // surface-1 over bg and over every backdrop stop; the worst case counts.
    { mode: 'translucent', surface1: [bg, ...backdrop].map((base) => composite(color('surface-1'), base)) },
    // surface-1 replaced by surface-1-solid, as the ld.comfort substitution does at runtime.
    { mode: 'solid', surface1: [color('surface-1-solid')] },
  ]
  for (const { mode, surface1 } of modes) {
    const check = (fg: string, on: string, bases: Rgba[], min: number) => {
      const ratio = Math.min(...bases.map((base) => contrastRatio(color(fg), base)))
      if (!Number.isFinite(ratio) || ratio < min)
        errors.push({ rule: 'contrast', message: `${fg} on ${on} (${mode} mode) is ${ratio.toFixed(2)}:1, needs ${min}:1` })
    }
    const over = (overlay: string, bases: Rgba[]) => bases.map((base) => composite(color(overlay), base))
    const surfaces: [string, Rgba[]][] = [
      ['surface-1', surface1],
      ['surface-2', [color('surface-2')]],
      ['surface-3', [color('surface-3')]],
    ]
    check('text-primary', 'surface-1', surface1, 7)
    for (const [surface, bases] of surfaces) {
      for (const fg of ['text-primary', 'text-secondary', 'text-muted']) check(fg, surface, bases, 4.5)
      for (const state of ['state-hover', 'state-selected'])
        check('text-primary', `${state} over ${surface}`, over(state, bases), 4.5)
      check('focus-ring', surface, bases, 3)
    }
    check('accent-text', 'surface-1', surface1, 4.5)
    check('accent-text', 'accent-subtle over surface-1', over('accent-subtle', surface1), 4.5)
    for (const s of STATUSES) {
      check(`${s}-text`, 'surface-1', surface1, 4.5)
      check(`${s}-text`, `${s}-subtle over surface-1`, over(`${s}-subtle`, surface1), 4.5)
    }
    if (mode === 'solid') {
      // Fills are opaque, so these pairs are the same in both modes; check them once.
      for (const fill of ['accent', 'accent-hover', 'accent-active']) check('on-accent', fill, [color(fill)], 4.5)
      for (const s of STATUSES) check(`on-${s}`, s, [color(s)], 4.5)
    }
  }
  return errors
}

/**
 * Checks a theme stylesheet against the token contract: one token block for the theme's own
 * classes, known tokens with valid values, the opacity rules and the WCAG contrast matrix.
 * Messages name the rule and the allowed alternative, for an AI repair loop.
 */
export function validateThemeCss(css: string, { slug, mode }: { slug: string; mode: ThemeMode }): ThemeValidation {
  const errors: ThemeError[] = []
  const fail = (rule: string, message: string): ThemeValidation => {
    errors.push({ rule, message })
    return { ok: false, errors }
  }
  if (FORBIDDEN.test(css)) return fail('forbidden', 'url(), image-set(), attr(), expression and !important are not allowed')
  let root: Root
  try {
    root = postcss.parse(css)
  } catch (error) {
    return fail('syntax', `CSS does not parse: ${(error as Error).message}`)
  }
  const expected = [`.room--theme-${slug}`, `.widget--theme-${slug}`]
  const nodes = root.nodes.filter((node) => node.type !== 'comment')
  const rule = nodes[0]
  if (nodes.length !== 1 || rule?.type !== 'rule')
    return fail('single-block', `The stylesheet must be exactly one rule: ${expected.join(', ')} { … }`)
  if (rule.selectors.join(',') !== expected.join(','))
    return fail('selector', `The selector must be "${expected.join(', ')}", got "${rule.selector}"`)

  const decls: Declaration[] = []
  for (const node of rule.nodes) {
    if (node.type === 'comment') continue
    if (node.type !== 'decl') return fail('single-block', 'The token block may contain declarations only')
    decls.push(node)
  }
  const values = new Map<string, string>()
  for (const decl of decls) {
    if (decl.prop === 'color-scheme') {
      if (decl.value !== mode) errors.push({ rule: 'color-scheme', message: `color-scheme must be "${mode}"` })
      continue
    }
    const name = decl.prop.startsWith('--ld-') ? decl.prop.slice('--ld-'.length) : null
    if (name === null || !(name in TOKENS)) {
      errors.push({ rule: 'unknown-property', message: `${decl.prop} is not a contract token; see docs/theme-contract.md` })
      continue
    }
    if (values.has(name)) errors.push({ rule: 'duplicate', message: `--ld-${name} is declared twice` })
    values.set(name, decl.value.trim())
  }
  if (!decls.some((decl) => decl.prop === 'color-scheme'))
    errors.push({ rule: 'color-scheme', message: `color-scheme: ${mode} is required` })
  for (const name of Object.keys(REQUIRED_TOKENS))
    if (!values.has(name)) errors.push({ rule: 'missing', message: `--ld-${name} is required` })
  for (const [name, value] of values) {
    const problem = checkType(value, TOKENS[name]!, values)
    if (problem) errors.push({ rule: 'value', message: `--ld-${name}: "${value}" must be ${problem}` })
  }
  if (errors.length) return { ok: false, errors }

  for (const name of values.keys())
    if (TOKENS[name]!.type === 'color' && !resolveColor(name, values))
      errors.push({ rule: 'reference', message: `--ld-${name} has a cyclic or unresolved var() reference` })
  if (!parseColor(values.get('surface-1-solid')!))
    errors.push({ rule: 'value', message: '--ld-surface-1-solid must be an oklch() literal, not var()' })
  const [regular, medium, strong] = ['weight-regular', 'weight-medium', 'weight-strong'].map((name) => Number(values.get(name)))
  if (!(regular! < medium! && medium! < strong!))
    errors.push({ rule: 'value', message: 'weight-regular < weight-medium < weight-strong is required' })
  if (errors.length) return { ok: false, errors }

  for (const name of OPAQUE_TOKENS)
    if (resolveColor(name, values)!.alpha !== 1)
      errors.push({ rule: 'opaque', message: `--ld-${name} must be fully opaque (alpha 1)` })
  if (errors.length) return { ok: false, errors }

  errors.push(...contrastErrors(values))
  return errors.length ? { ok: false, errors } : { ok: true }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/theme-contract.test.ts`
Expected: PASS. Three built-in themes, 27 rejection fixtures, the solid-mode case, and the case without optional tokens.

If a built-in theme fails a contrast row, change only the named foreground's lightness (L) in that theme file until it passes. Never relax a threshold.

- [ ] **Step 9: Write `docs/theme-contract.md`**

~~~markdown
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
- **Font stacks:** quoted family names and generic families (`system-ui`, `ui-monospace`,
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
~~~

- [ ] **Step 10: Run all tests and the typecheck**

Run: `pnpm --filter @lifedashboard/ui test && pnpm --filter @lifedashboard/ui typecheck`
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 11: Commit**

```bash
git add apps/ui/package.json pnpm-lock.yaml apps/ui/app/theme/contract.ts apps/ui/app/theme/validate-theme.ts \
  apps/ui/app/theme/builtin.ts apps/ui/app/theme/styles/themes apps/ui/test/theme-contract.test.ts docs/theme-contract.md
git commit -m "feat(theme): add token contract, validator and built-in themes"
```

---

### Task 3: Theme resolution and stored appearance

**Files:**
- Modify: `apps/ui/app/theme/builtin.ts`
- Create: `apps/ui/app/theme/resolve.ts`, `apps/ui/app/theme/appearance.ts`
- Test: `apps/ui/test/theme-resolve.test.ts`

**Interfaces:**
- Consumes:
  - Task 2 `DEFAULT_THEME_ID`, `BUILTIN_THEMES` and `ThemeMeta`.
- Produces:
  - `apps/ui/app/theme/builtin.ts` gains:
    - `BUILTIN_THEME_IDS: ReadonlySet<string>`;
    - `themeMeta(id: string): ThemeMeta`, which returns the default theme for an unknown id.
  - `apps/ui/app/theme/resolve.ts`:
    - `resolveThemeId(chain: readonly (string | null)[], known: ReadonlySet<string>): string`;
    - `themeClass(id: string): string`, which throws for an id that is neither `builtin:` nor `user:`.
  - `apps/ui/app/theme/appearance.ts`:
    - `APPEARANCE_STORAGE_KEY = 'lifedashboard.appearance'`;
    - `interface Appearance { schemaVersion: 1; themeId: string | null }`;
    - `loadAppearance(): Appearance`, which never throws;
    - `saveAppearance(appearance: Appearance): boolean`, which never throws.

- [ ] **Step 1: Write the failing test**

`apps/ui/test/theme-resolve.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_STORAGE_KEY, loadAppearance, saveAppearance } from '../app/theme/appearance'
import { BUILTIN_THEME_IDS, BUILTIN_THEMES, DEFAULT_THEME_ID, themeMeta } from '../app/theme/builtin'
import { resolveThemeId, themeClass } from '../app/theme/resolve'

describe('resolveThemeId', () => {
  const known = new Set(['builtin:glass', 'builtin:paper', 'builtin:obsidian'])

  it('returns the first set and known id (widget, room, workspace)', () => {
    expect(resolveThemeId(['builtin:obsidian', 'builtin:paper'], known)).toBe('builtin:obsidian')
    expect(resolveThemeId([null, 'builtin:paper'], known)).toBe('builtin:paper')
  })

  it('treats an unknown id as unset', () => {
    expect(resolveThemeId(['user:deleted', null, 'builtin:paper'], known)).toBe('builtin:paper')
  })

  it('falls back to the default theme', () => {
    expect(resolveThemeId([null, null], known)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemeId([], known)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemeId(['user:deleted'], known)).toBe(DEFAULT_THEME_ID)
  })
})

describe('themeClass', () => {
  it('maps builtin and user ids to class suffixes', () => {
    expect(themeClass('builtin:glass')).toBe('glass')
    expect(themeClass('user:3f2a-11')).toBe('u-3f2a-11')
  })

  it('throws for any other id', () => {
    expect(() => themeClass('glass')).toThrow(/Unknown theme id/)
  })

  it('never gives a built-in theme a user-namespace class', () => {
    for (const theme of BUILTIN_THEMES) expect(themeClass(theme.id).startsWith('u-')).toBe(false)
  })
})

describe('built-in theme metadata', () => {
  it('knows the default theme', () => {
    expect(BUILTIN_THEME_IDS.has(DEFAULT_THEME_ID)).toBe(true)
  })

  it('returns metadata by id and the default theme for an unknown id', () => {
    expect(themeMeta('builtin:paper')).toMatchObject({ mode: 'light', skin: 'paper' })
    expect(themeMeta('user:deleted').id).toBe(DEFAULT_THEME_ID)
  })
})

function memoryStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(APPEARANCE_STORAGE_KEY, initial)
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

describe('appearance storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns defaults when nothing is stored', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('round-trips a saved appearance', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(saveAppearance({ schemaVersion: 1, themeId: 'builtin:paper' })).toBe(true)
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: 'builtin:paper' })
  })

  it.each([
    ['malformed JSON', '{'],
    ['a wrong schemaVersion', '{"schemaVersion":2,"themeId":"builtin:paper"}'],
    ['a non-string themeId', '{"schemaVersion":1,"themeId":7}'],
    ['a missing themeId', '{"schemaVersion":1}'],
    ['an array', '[]'],
  ])('returns defaults for %s', (_, stored) => {
    vi.stubGlobal('localStorage', memoryStorage(stored))
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('drops unknown fields', () => {
    vi.stubGlobal('localStorage', memoryStorage('{"schemaVersion":1,"themeId":null,"extra":1}'))
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('returns defaults when getItem throws or storage is missing', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
    vi.stubGlobal('localStorage', undefined)
    expect(loadAppearance()).toEqual({ schemaVersion: 1, themeId: null })
  })

  it('returns false when setItem throws', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(saveAppearance({ schemaVersion: 1, themeId: 'builtin:paper' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/theme-resolve.test.ts`
Expected: FAIL — `Failed to resolve import "../app/theme/appearance"`.

- [ ] **Step 3: Extend `builtin.ts`**

Append to `apps/ui/app/theme/builtin.ts`:

```ts
const byId = new Map(BUILTIN_THEMES.map((theme) => [theme.id, theme]))

export const BUILTIN_THEME_IDS: ReadonlySet<string> = new Set(byId.keys())

/** Metadata for an id from resolveThemeId; any other id gets the default theme. */
export function themeMeta(id: string): ThemeMeta {
  return byId.get(id) ?? byId.get(DEFAULT_THEME_ID)!
}
```

- [ ] **Step 4: Implement `resolve.ts`**

`apps/ui/app/theme/resolve.ts`:

```ts
import { DEFAULT_THEME_ID } from './builtin'

/**
 * The theme of a scope: the first id in the chain (widget, room, workspace) that is set and known.
 * An unknown id (deleted theme) counts as unset; the stored reference is not rewritten.
 */
export function resolveThemeId(chain: readonly (string | null)[], known: ReadonlySet<string>): string {
  return chain.find((id): id is string => id !== null && known.has(id)) ?? DEFAULT_THEME_ID
}

/** CSS class suffix: builtin:<name> → <name>, user:<uuid> → u-<uuid>. */
export function themeClass(id: string): string {
  if (id.startsWith('builtin:')) return id.slice('builtin:'.length)
  if (id.startsWith('user:')) return `u-${id.slice('user:'.length)}`
  throw new Error(`Unknown theme id format: ${id}`)
}
```

- [ ] **Step 5: Implement `appearance.ts`**

`apps/ui/app/theme/appearance.ts`:

```ts
export const APPEARANCE_STORAGE_KEY = 'lifedashboard.appearance'

// Workspace appearance until settings move to SQLite (E1).
export interface Appearance {
  schemaVersion: 1
  themeId: string | null
}

/** Never throws: missing, malformed or unreadable data yields the defaults. */
export function loadAppearance(): Appearance {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'schemaVersion' in raw &&
      raw.schemaVersion === 1 &&
      'themeId' in raw &&
      (raw.themeId === null || typeof raw.themeId === 'string')
    )
      return { schemaVersion: 1, themeId: raw.themeId }
  } catch {
    // Unreadable storage or malformed JSON: fall through to the defaults.
  }
  return { schemaVersion: 1, themeId: null }
}

/** Never throws; false means the choice stays applied in memory only. */
export function saveAppearance(appearance: Appearance): boolean {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance))
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/theme-resolve.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/ui/app/theme/builtin.ts apps/ui/app/theme/resolve.ts apps/ui/app/theme/appearance.ts apps/ui/test/theme-resolve.test.ts
git commit -m "feat(theme): resolve theme ids and persist workspace appearance"
```

---

### Task 4: Cascade layers, frame, skins and themed root

The app is painted by the stored or default theme (Glass). There is no selector yet. `WidgetFrame` becomes the BEM structure, and shell colours become tokens.

**Files:**
- Create: `apps/ui/app/theme/styles/layers.css`, `frame.css`, `comfort.css`
- Create: `apps/ui/app/theme/styles/skins/glass.css`, `solid.css`, `paper.css`
- Modify: `apps/ui/nuxt.config.ts` (`css`)
- Modify: `apps/ui/app/app.vue`, `apps/ui/app/board/WidgetBoard.vue`
- Modify: `apps/ui/app/widgets/WidgetFrame.vue`, `apps/ui/app/widgets/WidgetHost.vue`
- Delete: `apps/ui/app/widgets/widget-theme.css`
- Test: `apps/ui/test/theme-contract.test.ts` (append)

**Interfaces:**
- Consumes:
  - Task 2: `OPTIONAL_TOKENS`, `SKINS`, `BUILTIN_THEMES`.
  - Task 3: `resolveThemeId`, `themeClass`, `BUILTIN_THEME_IDS`, `themeMeta`, `loadAppearance`.
- Produces:
  - `WidgetFrame` props `{ themeId: string }` (a resolved id). Default slot → `.widget__body`.
  - `WidgetHost` props `{ source: WidgetSource; size: Size; themeId: string }`.
  - `WidgetBoard` props `{ themeId: string }` (plus the existing `v-model:building`, `notice` event and exposed `confirm`/`cancel`).
  - In `app.vue`: `themeId: Ref<string>` (resolved) and `rootClass: ComputedRef<string[]>`. Task 6 extends them.

- [ ] **Step 1: Write the failing tests**

Append to `apps/ui/test/theme-contract.test.ts`. Merge the imports into the existing import block at the top of the file.

```ts
import postcss, { type AtRule } from 'postcss'
import { parse } from 'vue/compiler-sfc'
import { OPTIONAL_TOKENS, SKINS } from '../app/theme/contract'

const styleFile = (path: string) => readFileSync(new URL(`../app/theme/styles/${path}`, import.meta.url), 'utf8')

describe('stylesheets', () => {
  it('layers.css declares the layer order first', () => {
    const first = postcss.parse(styleFile('layers.css')).nodes.find((node) => node.type !== 'comment')
    expect(first?.type === 'atrule' && first.name === 'layer' && first.params).toBe(
      'ld.reset, ld.frame, ld.skin, ld.theme, ld.utilities, ld.widget, ld.comfort',
    )
  })

  it('layers.css imports every built-in theme into ld.theme and every skin', () => {
    const css = styleFile('layers.css')
    for (const theme of BUILTIN_THEMES) expect(css).toContain(`@import './themes/${nameOf(theme.id)}.css' layer(ld.theme);`)
    for (const skin of SKINS) expect(css).toContain(`@import './skins/${skin}.css';`)
  })

  it('comfort.css zeroes motion under prefers-reduced-motion in ld.comfort, and layers.css imports it', () => {
    expect(styleFile('layers.css')).toContain(`@import './comfort.css';`)
    const zeroed: string[] = []
    postcss.parse(styleFile('comfort.css')).walkAtRules('media', (media) => {
      const parent = media.parent
      if (media.params !== '(prefers-reduced-motion: reduce)') return
      if (parent?.type !== 'atrule' || (parent as AtRule).params !== 'ld.comfort') return
      media.walkDecls((decl) => {
        if (/^0m?s$/.test(decl.value)) zeroed.push(decl.prop)
      })
    })
    expect([...new Set(zeroed)].sort()).toEqual([
      '--ld-duration-base',
      '--ld-duration-fast',
      '--ld-duration-slow',
      'animation-duration',
      'transition-duration',
    ])
  })

  it('frame.css resets exactly the optional tokens on every theme scope', () => {
    const reset: string[] = []
    postcss.parse(styleFile('frame.css')).walkRules((rule) => {
      if (rule.selectors.join(',') !== '.room,.widget') return
      rule.walkDecls((decl) => {
        if (decl.value === 'initial') reset.push(decl.prop)
      })
    })
    expect(reset.sort()).toEqual(Object.keys(OPTIONAL_TOKENS).map((name) => `--ld-${name}`).sort())
  })

  it.each(['app.vue', 'board/WidgetBoard.vue', 'widgets/WidgetFrame.vue', 'widgets/WidgetHost.vue'])(
    '%s styles use theme tokens only',
    (file) => {
      const { descriptor } = parse(readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8'))
      const colourLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(|(?<![\w-])(?:white|black)(?![\w-])/i
      for (const style of descriptor.styles) expect(style.content).not.toMatch(colourLiteral)
    },
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/theme-contract.test.ts`
Expected: FAIL. `layers.css` and `frame.css` are not found (ENOENT), and `app.vue` / `WidgetBoard.vue` match the colour-literal pattern (`#12131c`, `rgb(`).

- [ ] **Step 3: Write the stylesheets**

`apps/ui/app/theme/styles/layers.css`:

```css
/* Cascade order of the whole app (spec: CSS layers). This file must be the first CSS loaded. */
@layer ld.reset, ld.frame, ld.skin, ld.theme, ld.utilities, ld.widget, ld.comfort;

@import './frame.css';
@import './skins/glass.css';
@import './skins/solid.css';
@import './skins/paper.css';
@import './themes/glass.css' layer(ld.theme);
@import './themes/obsidian.css' layer(ld.theme);
@import './themes/paper.css' layer(ld.theme);
@import './comfort.css';

@layer ld.reset {
  *,
  ::before,
  ::after {
    box-sizing: border-box;
    border: 0 solid;
  }

  body {
    margin: 0;
  }
}
```

`apps/ui/app/theme/styles/frame.css`:

```css
/* Frame mechanics (spec: CSS layers, stacking levels). Themes only provide token values. */
@layer ld.frame {
  /* Typography and colour are declared on every theme scope, not only inherited from the root,
     so a widget with its own theme uses its own token values. */
  .room,
  .widget {
    color: var(--ld-text-primary);
    font-family: var(--ld-font-ui);
    line-height: var(--ld-leading);
    letter-spacing: var(--ld-tracking);
    /* Optional tokens must not leak from the Room theme into a widget theme that omits them.
       Keep equal to OPTIONAL_TOKENS in contract.ts (theme-contract.test.ts checks it). */
    --ld-shadow-widget: initial;
    --ld-shadow-raised: initial;
    --ld-blur: initial;
    --ld-glow: initial;
    --ld-edge-highlight: initial;
  }

  .room {
    position: relative;
    isolation: isolate;
    min-height: 100dvh;
    background: var(--ld-bg);
  }

  .room__backdrop {
    position: fixed;
    inset: 0;
    z-index: -1;
    background: var(--ld-backdrop);
    pointer-events: none;
  }

  .widget,
  .widget__wrapper {
    height: 100%;
  }

  .widget__box {
    position: relative;
    height: 100%;
    overflow: hidden;
    border-radius: var(--ld-radius-widget);
  }

  /* Level 1: a stacking context, so z-index inside content never covers header or state. */
  .widget__body {
    position: relative;
    z-index: 1;
    height: 100%;
    overflow-y: auto;
    container-type: size;
    padding: var(--ld-widget-padding);
    font-size: calc(var(--ld-font-scale) * 1rem);
    scrollbar-color: var(--ld-border-strong) transparent;
  }

  /* Level 2. Markup arrives with edit mode and widget states. */
  .widget__header,
  .widget__state {
    position: absolute;
    z-index: 2;
  }

  .widget__header {
    inset: 0 0 auto;
  }

  .widget--editing .widget__body {
    opacity: 0.5;
    pointer-events: none;
  }
}
```

`apps/ui/app/theme/styles/comfort.css`:

```css
/* User comfort beats every theme and all widget CSS (spec: Effects and comfort).
   MVP: prefers-reduced-motion only; ComfortProfile classes arrive with its UI. */
@layer ld.comfort {
  @media (prefers-reduced-motion: reduce) {
    .room,
    .widget {
      --ld-duration-fast: 0ms;
      --ld-duration-base: 0ms;
      --ld-duration-slow: 0ms;
    }

    .widget__body *,
    .widget__body *::before,
    .widget__body *::after {
      animation-duration: 0s;
      transition-duration: 0s;
    }
  }
}
```

`apps/ui/app/theme/styles/skins/glass.css`:

```css
/* Glass: translucent box, backdrop blur, outer shadow and a 1px top edge highlight.
   Decoration stays at stacking level 0, under .widget__body. */
@layer ld.skin {
  .widget--skin-glass > .widget__wrapper {
    border-radius: var(--ld-radius-widget);
    box-shadow: var(--ld-shadow-widget, none);
    -webkit-backdrop-filter: blur(var(--ld-blur, 0));
    backdrop-filter: blur(var(--ld-blur, 0));
  }

  .widget--skin-glass > .widget__wrapper > .widget__box {
    border: var(--ld-border-width) solid var(--ld-border-subtle);
    background: var(--ld-surface-1);
    box-shadow: inset 0 1px 0 oklch(1 0 0 / var(--ld-edge-highlight, 0));
  }
}
```

`apps/ui/app/theme/styles/skins/solid.css`:

```css
/* Solid: opaque box with a hairline border and an outer shadow. */
@layer ld.skin {
  .widget--skin-solid > .widget__wrapper {
    border-radius: var(--ld-radius-widget);
    box-shadow: var(--ld-shadow-widget, none);
  }

  .widget--skin-solid > .widget__wrapper > .widget__box {
    border: var(--ld-border-width) solid var(--ld-border-subtle);
    background: var(--ld-surface-1);
  }
}
```

`apps/ui/app/theme/styles/skins/paper.css`:

```css
/* Paper: opaque sheet with a visible default border and a soft lift. */
@layer ld.skin {
  .widget--skin-paper > .widget__wrapper {
    border-radius: var(--ld-radius-widget);
    box-shadow: var(--ld-shadow-widget, none);
  }

  .widget--skin-paper > .widget__wrapper > .widget__box {
    border: var(--ld-border-width) solid var(--ld-border-default);
    background: var(--ld-surface-1);
  }
}
```

- [ ] **Step 4: Register the stylesheet and remove the old theme file**

In `apps/ui/nuxt.config.ts`, replace

```ts
  css: ['~/widgets/widget-theme.css'],
```

with

```ts
  css: ['~/theme/styles/layers.css'],
```

Run: `git rm apps/ui/app/widgets/widget-theme.css`

- [ ] **Step 5: Rewrite `WidgetFrame.vue`**

`apps/ui/app/widgets/WidgetFrame.vue` (whole file):

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { themeMeta } from '../theme/builtin'
import { themeClass } from '../theme/resolve'

// A resolved theme id: the widget's own choice or the one it inherits.
const props = defineProps<{ themeId: string }>()

const classes = computed(() => [
  'widget',
  `widget--theme-${themeClass(props.themeId)}`,
  `widget--skin-${themeMeta(props.themeId).skin}`,
])
</script>

<template>
  <div :class="classes">
    <div class="widget__wrapper">
      <div class="widget__box">
        <div class="widget__body">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Pass the theme through `WidgetHost.vue`**

In `apps/ui/app/widgets/WidgetHost.vue`, replace

```ts
const props = defineProps<{ source: WidgetSource; size: Size }>()
```

with

```ts
const props = defineProps<{ source: WidgetSource; size: Size; themeId: string }>()
```

and replace

```vue
  <WidgetFrame>
```

with

```vue
  <WidgetFrame :theme-id="themeId">
```

Leave the `.widget-host__unknown` rule as it is: it has no colours, and Task 5 replaces it.

- [ ] **Step 7: Theme the board**

In `apps/ui/app/board/WidgetBoard.vue`:

1. After `const emit = defineEmits<{ notice: [message: string | null] }>()`, add:

```ts
defineProps<{ themeId: string }>()
```

2. Replace `<WidgetHost :source="instance.source" :size="placement" />` with
   `<WidgetHost :source="instance.source" :size="placement" :theme-id="themeId" />`.
3. Replace `<WidgetHost :source="draftSource" :size="draft" />` with
   `<WidgetHost :source="draftSource" :size="draft" :theme-id="themeId" />`.
4. Make these style changes:

| Selector | Old declaration(s) | New declaration(s) |
| --- | --- | --- |
| `.board__dot` | `background: rgb(255 255 255 / 0.35);` | `background: var(--ld-border-strong);` |
| `.board__draft--moving::before` | `border: 0.125rem dashed rgb(255 255 255 / 0.45);` / `border-radius: 1rem;` | `border: 0.125rem dashed var(--ld-border-strong);` / `border-radius: var(--ld-radius-widget);` |
| `.board__resize` | `border-right: 0.1875rem solid #fff;` / `border-bottom: 0.1875rem solid #fff;` / `border-bottom-right-radius: 1rem;` | `border-right: 0.1875rem solid var(--ld-text-primary);` / `border-bottom: 0.1875rem solid var(--ld-text-primary);` / `border-bottom-right-radius: var(--ld-radius-widget);` |
| `.board__remove` | `border: none;` / `background: rgb(0 0 0 / 0.45);` / `color: #fff;` | `border: var(--ld-border-width) solid var(--ld-border-default);` / `background: var(--ld-surface-3);` / `color: var(--ld-text-primary);` |

5. Add these rules after the `.board__draft:active` rule:

```css
.board__draft:focus-visible,
.board__remove:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
}

.board__remove:focus-visible {
  outline-offset: 0.125rem;
}
```

- [ ] **Step 8: Theme the root in `app.vue`**

In `apps/ui/app/app.vue`, the script becomes:

```ts
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import WidgetBoard from './board/WidgetBoard.vue'
import { loadAppearance } from './theme/appearance'
import { BUILTIN_THEME_IDS, themeMeta } from './theme/builtin'
import { resolveThemeId, themeClass } from './theme/resolve'
```

Keep the existing `ApiState`, `labels`, `apiState`, `building`, `notice`, `boardRef`, `HEALTH_TIMEOUT_MS`, `isApiHealthy` and `onMounted` code unchanged. Add after `boardRef`:

```ts
// Workspace theme; Rooms (E2) will put their own id in front of it in the chain.
const themeId = ref(resolveThemeId([loadAppearance().themeId], BUILTIN_THEME_IDS))
const rootClass = computed(() => [
  'room',
  `room--theme-${themeClass(themeId.value)}`,
  `room--skin-${themeMeta(themeId.value).skin}`,
])
```

The template becomes:

```vue
<template>
  <div :class="rootClass">
    <div class="room__backdrop" />
    <div class="app">
      <header class="app__header">
        <h1 class="app__title">LifeDashboard</h1>
        <template v-if="building">
          <button type="button" class="app__button" @click="boardRef?.confirm()">Готово</button>
          <button type="button" class="app__button" @click="boardRef?.cancel()">Отмена</button>
        </template>
        <button v-else type="button" class="app__button" aria-label="Добавить виджет" @click="building = true">+</button>
        <p class="app__notice" role="status">{{ notice }}</p>
        <p class="app__api">{{ labels[apiState] }}</p>
      </header>
      <main class="app__main">
        <WidgetBoard ref="board" v-model:building="building" :theme-id="themeId" @notice="notice = $event" />
      </main>
    </div>
    <p class="app__narrow">Окно слишком узкое</p>
  </div>
</template>
```

In the `<style>` block:
- Delete the whole `body { … }` rule. `ld.reset` sets the margin, and `.room` / `.room__backdrop` paint the background and text.
- Keep the `html { font-size … }` rule verbatim.
- Replace `.app__button`, `.app__notice` and `.app__api` with:

```css
.app__button {
  height: var(--ld-control-height);
  min-width: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.app__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.app__notice {
  margin: 0;
  color: var(--ld-danger-text);
  font-size: 0.875rem;
}

.app__api {
  margin: 0 0 0 auto;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}
```

Leave `.app`, `.app__header`, `.app__title`, `.app__main`, `.app__narrow` and the `@media (max-width: 1279.98px)` block unchanged.

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm --filter @lifedashboard/ui test && pnpm --filter @lifedashboard/ui typecheck`
Expected: all tests PASS (including the five new `stylesheets` tests); typecheck exits 0.

- [ ] **Step 10: Build and check the layer order**

Run:

```bash
pnpm --filter @lifedashboard/ui build && node -e '
const fs = require("node:fs"); const dir = "apps/ui/.output/public/_nuxt/";
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".css"))) {
  const order = [];
  for (const m of fs.readFileSync(dir + file, "utf8").matchAll(/@layer\s+([^{;]+)/g))
    for (const name of m[1].split(",").map((s) => s.trim())) if (!order.includes(name)) order.push(name);
  if (order.length) console.log(file, order.join(" > "));
}'
```

Expected: the build succeeds and one CSS file prints `ld.reset > ld.frame > ld.skin > ld.theme > ld.utilities > ld.widget > ld.comfort`. Any other order means `layers.css` is not the first CSS loaded: stop and report.

- [ ] **Step 11: Check in the browser**

Start the dev server with `pnpm --filter @lifedashboard/ui dev`. Open `http://127.0.0.1:3000` in Orca's built-in browser (use the `orca-cli` skill) at 1280×700. Expect:

- the violet radial Glass backdrop and translucent widget frames;
- light text and visible header buttons;
- a 4×4 placeholder that can still be added, moved and resized, with visible grid dots, a dashed landing outline while dragging, and a white resize handle;
- a focus ring on the draft after Tab;
- the «×» button visible on hover.

Inspect a placed widget: it is `.widget.widget--theme-glass.widget--skin-glass > .widget__wrapper > .widget__box > .widget__body`.

- [ ] **Step 12: Commit**

```bash
git add apps/ui/app/theme/styles apps/ui/nuxt.config.ts apps/ui/app/app.vue apps/ui/app/board/WidgetBoard.vue \
  apps/ui/app/widgets/WidgetFrame.vue apps/ui/app/widgets/WidgetHost.vue apps/ui/test/theme-contract.test.ts
git commit -m "feat(theme): cascade layers, BEM widget frame and themed root"
```

(The `git rm` from Step 4 is already staged.)

---

### Task 5: UnoCSS semantic vocabulary for widget content

**Files:**
- Modify: `apps/ui/package.json`, `pnpm-lock.yaml` (`unocss@66.10.5`, `@unocss/nuxt@66.10.5`)
- Create: `apps/ui/uno.config.ts`, `apps/ui/app/theme/vocabulary.ts`
- Modify: `apps/ui/nuxt.config.ts` (module + options)
- Modify: `apps/ui/app/widgets/builtin/PlaceholderWidget.vue`, `apps/ui/app/widgets/WidgetHost.vue`
- Test: `apps/ui/test/vocabulary.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `STATUSES`.
- Produces:
  - `apps/ui/uno.config.ts` (default export, the shared vocabulary config);
  - `apps/ui/app/theme/vocabulary.ts`: `checkClasses(classes: readonly string[]): Promise<{ unknown: string[]; blocked: { cls: string; message: string }[] }>`. It is async because the UnoCSS generator is async; unknown classes keep their input order.

- [ ] **Step 1: Add the dependencies**

Run: `pnpm --filter @lifedashboard/ui add unocss@66.10.5 @unocss/nuxt@66.10.5`
Expected: `dependencies` contains both, with exact versions. Leave `pnpm-workspace.yaml` unstaged.

- [ ] **Step 2: Write the failing test**

`apps/ui/test/vocabulary.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import postcss from 'postcss'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import { checkClasses } from '../app/theme/vocabulary'

describe('checkClasses', () => {
  it('accepts semantic and layout classes', async () => {
    const classes = [
      'text-primary', 'text-accent', 'text-on-accent', 'text-danger', 'bg-surface-2', 'bg-accent-subtle',
      'bg-success-subtle', 'hover:bg-state-hover', 'border-default', 'focus-visible:ring-focus', 'fill-accent',
      'rounded-card', 'rounded-none', 'font-ui', 'font-mono', 'font-strong', 'shadow-raised', 'text-sm', 'text-3xl',
      'flex', 'grid', 'gap-3', 'p-2', 'w-1/2', 'h-full', 'truncate', 'line-clamp-2', 'tabular-nums', 'z-10',
      '@sm:flex', 'motion-safe:transition', 'aria-selected:bg-state-selected', 'disabled:text-disabled', 'border',
    ]
    expect(await checkClasses(classes)).toEqual({ unknown: [], blocked: [] })
  })

  it('reports palette, opacity-modified and theme-owned classes as unknown', async () => {
    const result = await checkClasses(['text-slate-200', 'bg-zinc-950', 'text-primary/50', 'leading-tight', 'font-sans', 'text-4xl'])
    expect(result).toEqual({
      unknown: ['text-slate-200', 'bg-zinc-950', 'text-primary/50', 'leading-tight', 'font-sans', 'text-4xl'],
      blocked: [],
    })
  })

  it.each([
    ['text-[#f00]', /Arbitrary values/],
    ['bg-(--x)', /Arbitrary values/],
    ['dark:text-primary', /dark: is not allowed/],
    ['!p-2', /Important/],
    ['p-2!', /Important/],
    ['fixed', /fixed is not allowed/],
    ['z-50', /z-index above 10/],
    ['font-600', /font-regular, font-medium or font-strong/],
    ['rounded', /rounded-control/],
    ['rounded-lg', /rounded-control/],
    ['shadow-xl', /shadow-raised/],
  ])('blocks %s with a message', async (cls, message) => {
    const { blocked } = await checkClasses([cls])
    expect(blocked).toHaveLength(1)
    expect(blocked[0]!.message).toMatch(message)
  })
})

type AstNode = {
  props?: { type: number; name: string; value?: { content: string }; arg?: { content?: string }; exp?: { content?: string } }[]
  children?: AstNode[]
}

// Static class values and string literals inside :class (objects, arrays, ternaries).
function collectClasses(node: AstNode, out: string[]) {
  for (const prop of node.props ?? []) {
    if (prop.type === 6 && prop.name === 'class' && prop.value) out.push(...prop.value.content.split(/\s+/).filter(Boolean))
    if (prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'class' && prop.exp?.content)
      for (const m of prop.exp.content.matchAll(/'([^']*)'|"([^"]*)"/g)) out.push(...(m[1] ?? m[2]!).split(/\s+/).filter(Boolean))
  }
  for (const child of node.children ?? []) collectClasses(child, out)
}

const widgetsDir = new URL('../app/widgets/', import.meta.url)
const widgetFiles = [
  ...readdirSync(new URL('builtin/', widgetsDir))
    .filter((file) => file.endsWith('.vue'))
    .map((file) => `builtin/${file}`),
  'WidgetHost.vue',
]

describe.each(widgetFiles)('%s', (file) => {
  const { descriptor } = parse(readFileSync(new URL(file, widgetsDir), 'utf8'))

  it('uses vocabulary classes only', async () => {
    const classes: string[] = []
    collectClasses(descriptor.template!.ast as unknown as AstNode, classes)
    expect(await checkClasses(classes)).toEqual({ unknown: [], blocked: [] })
  })

  it('keeps scoped styles in @layer ld.widget without !important', () => {
    for (const style of descriptor.styles) {
      expect(style.scoped).toBe(true)
      const root = postcss.parse(style.content)
      for (const node of root.nodes)
        if (node.type !== 'comment') expect(node.type === 'atrule' && node.name === 'layer' && node.params).toBe('ld.widget')
      root.walkDecls((decl) => expect(decl.important).toBe(false))
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/vocabulary.test.ts`
Expected: FAIL — `Failed to resolve import "../app/theme/vocabulary"`.

- [ ] **Step 4: Write `uno.config.ts`**

`apps/ui/uno.config.ts`:

```ts
import { defineConfig, presetWind4, type Rule } from 'unocss'
import { STATUSES } from './app/theme/contract'

// Class suffix → token. Text and background map separately, so `text-accent` reads the
// contrast-checked `accent-text` while `bg-accent` reads the `accent` fill.
const TEXT: Record<string, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  muted: 'text-muted',
  disabled: 'text-disabled',
  accent: 'accent-text',
  'on-accent': 'on-accent',
  ...Object.fromEntries(STATUSES.flatMap((s) => [[s, `${s}-text`], [`on-${s}`, `on-${s}`]])),
}
const BG: Record<string, string> = Object.fromEntries(
  [
    'surface-1', 'surface-2', 'surface-3', 'accent', 'accent-subtle', 'state-hover', 'state-active', 'state-selected',
    ...STATUSES.flatMap((s) => [s, `${s}-subtle`]),
  ].map((token) => [token, token]),
)
const BORDER: Record<string, string> = { subtle: 'border-subtle', default: 'border-default', strong: 'border-strong' }
// [font-size, line-height] in rem, multiplied by the theme's font scale.
const SIZES: Record<string, [number, number]> = {
  xs: [0.75, 1],
  sm: [0.875, 1.25],
  base: [1, 1.5],
  lg: [1.125, 1.75],
  xl: [1.25, 1.75],
  '2xl': [1.5, 2],
  '3xl': [1.875, 2.25],
}

function semantic(prefix: string, property: string, tokens: Record<string, string>): Rule {
  return [
    new RegExp(`^${prefix}-(${Object.keys(tokens).join('|')})$`),
    ([, key]) => ({ [property]: `var(--ld-${tokens[key!]})` }),
  ]
}

// One vocabulary for builtin widgets (build time) and, from E6, Hermes widgets (server side).
export default defineConfig({
  presets: [presetWind4({ preflights: { reset: false } })],
  // Colours, shape, shadows and type belong to the theme. The wind4 theme families are emptied, so
  // palette classes (text-slate-200) generate nothing and no theme value is aliased on :root, where
  // a nested theme scope could not override it.
  extendTheme: (theme) => ({
    ...theme,
    colors: {},
    radius: {},
    shadow: {},
    insetShadow: {},
    dropShadow: {},
    textShadow: {},
    font: {},
    fontWeight: {},
    text: {},
    leading: {},
    tracking: {},
  }),
  rules: [
    semantic('text', 'color', TEXT),
    semantic('fill', 'fill', TEXT),
    semantic('stroke', 'stroke', TEXT),
    semantic('bg', 'background-color', BG),
    semantic('border', 'border-color', BORDER),
    ['ring-focus', { outline: '0.125rem solid var(--ld-focus-ring)', 'outline-offset': '0.125rem' }],
    [/^rounded-(control|card|pill)$/, ([, key]) => ({ 'border-radius': `var(--ld-radius-${key})` })],
    ['rounded-none', { 'border-radius': '0' }],
    [/^font-(ui|mono|display)$/, ([, key]) => ({ 'font-family': `var(--ld-font-${key})` })],
    [/^font-(regular|medium|strong)$/, ([, key]) => ({ 'font-weight': `var(--ld-weight-${key})` })],
    ['shadow-raised', { 'box-shadow': 'var(--ld-shadow-raised, none)' }],
    [
      /^text-(xs|sm|base|lg|xl|2xl|3xl)$/,
      ([, key]) => {
        const [size, leading] = SIZES[key!]!
        return {
          'font-size': `calc(var(--ld-font-scale) * ${size}rem)`,
          'line-height': `calc(var(--ld-font-scale) * ${leading}rem)`,
        }
      },
    ],
  ],
  // Each message names the allowed alternative; Hermes sees it in the repair round (E6).
  blocklist: [
    [/[[\]()]/, { message: 'Arbitrary values are not allowed; use a semantic class such as text-primary, bg-surface-1 or rounded-card' }],
    [/(^|:)dark:/, { message: 'dark: is not allowed; the theme of the scope sets light or dark' }],
    [/(^|:)!|!$/, { message: 'Important (!) is not allowed' }],
    [/(^|:)fixed$/, { message: 'fixed is not allowed; widget content stays inside its frame' }],
    [/(^|:)-?z-(1[1-9]|[2-9]\d|\d{3,})$/, { message: 'z-index above 10 is not allowed' }],
    [/(^|:)font-\d+$/, { message: 'Numeric font weights are not allowed; use font-regular, font-medium or font-strong' }],
    [/(^|:)rounded(-(xs|sm|md|lg|\d?xl))?$/, { message: 'Use rounded-control, rounded-card, rounded-pill or rounded-none' }],
    [/(^|:)shadow(-(xs|sm|md|lg|\d?xl))?$/, { message: 'Use shadow-raised; other shadows belong to the theme' }],
  ],
  outputToCssLayers: { cssLayerName: () => 'ld.utilities' },
})
```

- [ ] **Step 5: Write `vocabulary.ts`**

`apps/ui/app/theme/vocabulary.ts`:

```ts
import { createGenerator } from 'unocss'
import config from '../../uno.config'

let generator: ReturnType<typeof createGenerator> | undefined

/**
 * Checks class names against the semantic vocabulary: blocked classes carry the blocklist message,
 * unknown classes generate no CSS. Used by tests now and by the Hermes SFC pipeline later (E6).
 */
export async function checkClasses(
  classes: readonly string[],
): Promise<{ unknown: string[]; blocked: { cls: string; message: string }[] }> {
  generator ??= createGenerator(config)
  const gen = await generator
  const { matched } = await gen.generate(classes.join(' '), { preflights: false })
  const unknown: string[] = []
  const blocked: { cls: string; message: string }[] = []
  for (const cls of new Set(classes)) {
    const hit = gen.getBlocked(cls)
    if (hit) {
      const message = hit[1]?.message
      blocked.push({ cls, message: typeof message === 'function' ? message(cls) : (message ?? 'Not allowed') })
    } else if (!matched.has(cls)) unknown.push(cls)
  }
  return { unknown, blocked }
}
```

- [ ] **Step 6: Run the test to see the remaining failures**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/vocabulary.test.ts`
Expected: the `checkClasses` tests PASS. The SFC tests FAIL for:
- `builtin/PlaceholderWidget.vue`: unknown `placeholder`, and its scoped style is not in `@layer ld.widget`;
- `WidgetHost.vue`: unknown `widget-host__unknown`, and the scoped style is not layered.

- [ ] **Step 7: Move content to vocabulary classes and wire UnoCSS into Nuxt**

`apps/ui/app/widgets/builtin/PlaceholderWidget.vue` (whole file):

```vue
<script setup lang="ts">
import type { Size } from '../grid'

defineProps<{ size: Size }>()
</script>

<template>
  <div class="grid place-items-center h-full text-2xl font-strong text-secondary">{{ size.w }}×{{ size.h }}</div>
</template>
```

In `apps/ui/app/widgets/WidgetHost.vue`:
- replace `<div v-else class="widget-host__unknown">Неизвестный виджет</div>` with `<div v-else class="grid place-items-center h-full text-center text-sm text-muted">Неизвестный виджет</div>`;
- delete the whole `<style scoped>` block.

In `apps/ui/nuxt.config.ts`, add these entries right after `compatibilityDate: '2026-10-04',`:

```ts
  modules: ['@unocss/nuxt'],
  // wind3 is the module default and would bring the palette back; uno.config.ts defines the presets.
  unocss: { wind3: false, components: false, configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)) },
```

(`fileURLToPath` is already imported in this file.)

- [ ] **Step 8: Run all tests and the typecheck**

Run: `pnpm --filter @lifedashboard/ui test && pnpm --filter @lifedashboard/ui typecheck`
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 9: Build and check the layer order**

Run the build-and-layer-order command from Task 4, Step 10.
Expected: the build succeeds. The CSS file holding `ld.reset` still prints `ld.reset > ld.frame > ld.skin > ld.theme > ld.utilities > ld.widget > ld.comfort`.

Also run: `grep -l '\.text-secondary{color:var(--ld-text-secondary)' apps/ui/.output/public/_nuxt/*.css`
Expected: at least one file. The pattern is the generated class rule, not the theme token, so a match proves UnoCSS generated the vocabulary class.

If a second file prints a list that starts with `ld.utilities`, check `apps/ui/.output/public/index.html`. The file holding `ld.reset` must be linked before it. If it is not, stop and report: the layer order is broken.

- [ ] **Step 10: Check in the browser**

Restart the dev server and open the app in Orca's built-in browser at 1280×700. Expect:
- the placeholder shows `4×4` large, semi-bold and slightly dimmer than the header title, the same as before this task;
- `getComputedStyle` of the placeholder text gives `font-size` = 1.5 × the root font size.

- [ ] **Step 11: Commit**

```bash
git add apps/ui/package.json pnpm-lock.yaml apps/ui/uno.config.ts apps/ui/app/theme/vocabulary.ts apps/ui/nuxt.config.ts \
  apps/ui/app/widgets/builtin/PlaceholderWidget.vue apps/ui/app/widgets/WidgetHost.vue apps/ui/test/vocabulary.test.ts
git commit -m "feat(theme): semantic UnoCSS vocabulary for widget content"
```

---

### Task 6: Theme selector in the header

**Files:**
- Create: `apps/ui/app/board/keyboard.ts`
- Test: `apps/ui/test/board-keyboard.test.ts`
- Modify: `apps/ui/app/board/WidgetBoard.vue`, `apps/ui/app/app.vue`

**Interfaces:**
- Consumes:
  - Task 2: `BUILTIN_THEMES`.
  - Task 3: `saveAppearance`, `loadAppearance`, `resolveThemeId`, `BUILTIN_THEME_IDS`.
  - Task 4: `themeId`, `rootClass` in `app.vue`.
- Produces: `isFormControlTarget(target: EventTarget | null): boolean` in `apps/ui/app/board/keyboard.ts`.

`WidgetBoard.vue` listens to `keydown` on `window` while the builder is open (`onKeydown`, around lines 230–263). The new header `<select>` would hand its arrow keys and Enter to the draft. Steps 1–4 fix that first.

- [ ] **Step 1: Write the failing test**

`apps/ui/test/board-keyboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isFormControlTarget } from '../app/board/keyboard'

// Vitest runs in Node, so targets are plain objects with a tagName.
const target = (tagName: string) => ({ tagName }) as unknown as EventTarget

describe('isFormControlTarget', () => {
  it.each(['SELECT', 'INPUT', 'TEXTAREA'])('is true for %s', (tag) => {
    expect(isFormControlTarget(target(tag))).toBe(true)
  })

  it.each(['BUTTON', 'DIV', 'BODY'])('is false for %s', (tag) => {
    expect(isFormControlTarget(target(tag))).toBe(false)
  })

  it('is false without a target', () => {
    expect(isFormControlTarget(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/board-keyboard.test.ts`
Expected: FAIL — `Failed to resolve import "../app/board/keyboard"`.

- [ ] **Step 3: Implement the guard and use it in the board**

`apps/ui/app/board/keyboard.ts`:

```ts
const FORM_CONTROLS = new Set(['SELECT', 'INPUT', 'TEXTAREA'])

/** True when a key event belongs to a form control (the header theme select), not to the board draft. */
export function isFormControlTarget(target: EventTarget | null): boolean {
  const tagName = (target as { tagName?: unknown } | null)?.tagName
  return typeof tagName === 'string' && FORM_CONTROLS.has(tagName)
}
```

In `apps/ui/app/board/WidgetBoard.vue`:
1. Add `import { isFormControlTarget } from './keyboard'` to the imports.
2. In `onKeydown`, replace `if (!rect) return` with `if (!rect || isFormControlTarget(event.target)) return`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lifedashboard/ui exec vitest run test/board-keyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the selector logic**

In `apps/ui/app/app.vue`:

1. Change the appearance import to `import { loadAppearance, saveAppearance } from './theme/appearance'`.
2. Change the builtin import to `import { BUILTIN_THEMES, BUILTIN_THEME_IDS, themeMeta } from './theme/builtin'`.
3. Replace the Task 4 `themeId` declaration with:

```ts
// Workspace theme; Rooms (E2) will put their own id in front of it in the chain.
const storedThemeId = loadAppearance().themeId
const themeId = ref(resolveThemeId([storedThemeId], BUILTIN_THEME_IDS))
// An unknown stored id (deleted theme) is kept as it is; the default theme is shown meanwhile.
const themeNotice = ref<string | null>(
  storedThemeId !== null && !BUILTIN_THEME_IDS.has(storedThemeId) ? 'Тема не найдена, показана тема по умолчанию' : null,
)
const headerNotice = computed(() => [notice.value, themeNotice.value].filter(Boolean).join(' · ') || null)

function selectTheme(event: Event) {
  themeId.value = resolveThemeId([(event.target as HTMLSelectElement).value], BUILTIN_THEME_IDS)
  // A failed save keeps the theme applied for this session.
  themeNotice.value = saveAppearance({ schemaVersion: 1, themeId: themeId.value }) ? null : 'Не удалось сохранить тему'
}
```

- [ ] **Step 6: Add the control to the header**

In the template:
- Replace `<p class="app__notice" role="status">{{ notice }}</p>` with `<p class="app__notice" role="status">{{ headerNotice }}</p>`.
- Insert before that line:

```vue
        <label class="app__theme">
          Тема
          <select class="app__select" :value="themeId" @change="selectTheme">
            <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
          </select>
        </label>
```

Add to the `<style>` block after `.app__button:focus-visible`:

```css
.app__theme {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}

.app__select {
  height: var(--ld-control-height);
  padding: 0 0.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
}

.app__select:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @lifedashboard/ui test && pnpm --filter @lifedashboard/ui typecheck`
Expected: all tests PASS (`app.vue styles use theme tokens only` included); typecheck exits 0.

- [ ] **Step 8: Check every theme in the browser**

Start the dev server and open the app in Orca's built-in browser at 1280×700. For each of «Стекло», «Обсидиан» and «Бумага»:

1. Select the theme. The root class changes to `room--theme-<name> room--skin-<skin>`, and backdrop, header, buttons, select and widget frames change at once with no layout shift.
2. Add a widget («+»). Grid dots, the dashed landing outline while dragging, the resize handle and the draft's focus ring (Tab) are clearly visible. «Готово» places the widget.
3. Hover a placed widget. The «×» button is visible and gets a focus ring on Tab.
4. Reload the page. The selected theme is still applied.
5. With the builder open, switch the theme. The draft and grid recolour, and the draft keeps its position.
6. With the builder open, focus the theme select with Tab and press ↓, ↑, Enter and Escape. The select handles all four keys: it changes the theme, and the draft does not move, resize, get placed or get cancelled. Then Tab back to the draft and press Escape: the builder closes.

Then narrow the window below 1280px. «Окно слишком узкое» is readable on the theme background.

- [ ] **Step 9: Check bad stored values**

In the browser console run `localStorage.setItem('lifedashboard.appearance', '{')` and reload.
Expected: Glass applies, there is no notice and no error.

Run `localStorage.setItem('lifedashboard.appearance', '{"schemaVersion":1,"themeId":"user:deleted"}')` and reload.
Expected: Glass applies, the header shows «Тема не найдена, показана тема по умолчанию», and the stored value is unchanged (`localStorage.getItem('lifedashboard.appearance')`). Selecting a theme clears the notice.

Run `Storage.prototype.setItem = () => { throw new Error('quota') }`, then select «Бумага».
Expected: Paper applies, the header shows «Не удалось сохранить тему», and there is no error. Reload the page to restore `setItem`.

- [ ] **Step 10: Final verification**

Run: `pnpm --filter @lifedashboard/ui test && pnpm --filter @lifedashboard/ui typecheck && pnpm --filter @lifedashboard/ui build`
Expected: all three succeed. Then run the layer-order command from Task 4, Step 10 once more; the expected output is unchanged.

Then check that the generated HTML has no inline styles:

```bash
grep -c '<style' apps/ui/.output/public/index.html
```

Expected: `0` (grep exits 1). Any other count breaks the CSP rule in Global Constraints: stop and report.

- [ ] **Step 11: Commit**

```bash
git add apps/ui/app/board/keyboard.ts apps/ui/test/board-keyboard.test.ts apps/ui/app/board/WidgetBoard.vue apps/ui/app/app.vue
git commit -m "feat(theme): theme selector in the header"
```
