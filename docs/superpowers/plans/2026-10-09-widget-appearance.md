# Per-Widget Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In edit mode a «⚙» next to «×» opens a panel that sets one widget's theme (or «Без оформления») and drop shadow, shown live and saved with the board.

**Architecture:** `WidgetInstance.appearance` is validated and normalized in `packages/contracts/src/board.ts` and stored in a new nullable `widgets.appearance` column (migration 5). The UI resolves each widget's look with a pure `resolveWidgetLook` (theme id, frame skin incl. `bare`, `foreign`), `WidgetFrame` applies the skin class, `.widget--foreign` and an inline shadow, and `useWidgetContext` re-reads tokens when `foreign` flips. A single non-modal `popover="auto"` panel per board edits the working copy through `setAppearance`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vue 3.5 / Nuxt 4 (`ssr: false`), Fastify 5, `node:sqlite`, Vitest 5, PostCSS (tests only), native Popover API.

**Spec:** `docs/superpowers/specs/2026-10-09-widget-appearance-design.md`

## Global Constraints

- Branch: `csscoder/widget-edit-gear-button` (current). Never commit to `main`.
- Commits: conventional `type(scope): subject`, one or two lines, **no attribution trailers** (the user's CLAUDE.md overrides the harness reminder).
- No new dependencies (runtime or test). No `happy-dom`, no `@vue/test-utils`: Vue logic is tested in Node with `effectScope` and stubs, as `apps/ui/test/use-active-rect.test.ts` does.
- Contracts, verbatim from the spec: `BARE_THEME_ID = 'builtin:bare'`, `SHADOW_LIMITS = { x: [-32, 32], y: [-32, 32], blur: [0, 48] } as const`, `DEFAULT_SHADOW = { x: 0, y: 8, blur: 16, color: '#000000', opacity: 0.5 }`.
- `themeId` format: `null`, `builtin:<[a-z0-9-]+>` or `user:<uuid>`; well-formed unknown ids are accepted and stored unchanged.
- Shadow: `x`, `y`, `blur` integers inside `SHADOW_LIMITS`; `color` matches `/^#[0-9a-f]{6}$/i`; `opacity` finite in `0..1`. Any violation: `instances[<i>]: invalid appearance`.
- Normalization: `themeId === null && shadow === null` → the `appearance` key is absent. Appearance is always built in canonical key order `{ themeId, shadow }`, shadow `{ x, y, blur, color, opacity }`, appended **after** `config`, so `isSameBoard` (JSON comparison) stays exact.
- Appearance never goes into `config`.
- Migration 5 is additive: `ALTER TABLE widgets ADD COLUMN appearance TEXT;`. `openDatabase` already backs the file up to `<file>.bak-v4` before applying it. `PUT` body schema and board revision rules do not change.
- `SKINS` in `apps/ui/app/theme/contract.ts` does not change; `bare` is a frame skin only (`FrameSkin = SkinId | 'bare'`).
- Shadow CSS: `<x>px <y>px <blur>px rgb(<r> <g> <b> / <opacity>)`; `filter: drop-shadow(...)` on `.widget__wrapper` for `bare`, `box-shadow: ...` otherwise, as an inline style.
- Copy (Russian, verbatim): «⚙», `aria-label="Настройки виджета"`, «Стиль», «Как у доски», Стекло / Обсидиан / Бумага (from `BUILTIN_THEMES`), «Без оформления», «Тень», «X», «Y», «Размытие», «Цвет», «Непрозрачность», «Сбросить».
- Component `<style>` blocks use theme tokens only (no colour literals); `theme-contract.test.ts` enforces it.
- Browser work uses Orca's built-in browser through `orca-cli` only (project rule).
- Every task runs its own package's tests (and typecheck where listed); Task 7 runs everything.

**Refinements of the spec (same intent):**

- Focus return after a user close: the spec says focus returns to the gear. The plan returns it only when focus is on `body` or still inside the panel; when the user closed the panel by clicking another focusable element (another widget), focus stays there instead of being pulled back to the old gear, which would also re-select the old widget through `focusin`.
- Panel value transitions (`styleValue`, `withStyle`, `withShadow`) and placement (`panelPosition`) live in a pure `apps/ui/app/board/widget-settings.ts`, so they get unit tests; the SFC has no test harness.

## Review Focus

1. **The same «⚙» clicked twice.** Light dismiss closes an `auto` popover on `pointerup`, before the gear's `click`; a naive toggle then re-opens it. Expected: the second click closes the panel; a click on another widget's «⚙» switches the panel to that widget (Task 6, state captured at `pointerdown`; browser check Task 7).
2. **A shadow edit on a widget whose stored `themeId` is unknown** (`user:<deleted>`). The panel shows «Как у доски», but toggling or editing the shadow must keep the stored id (Task 5, `withShadow` test).
3. **Esc, Enter, Backspace or arrows with the panel open.** Expected: Esc closes only the panel (edit mode stays), Backspace never deletes the widget, Enter never confirms the board (Task 6, keyboard guard without `preventDefault`; browser check Task 7).
4. **Set an appearance, then «Сбросить», then «Готово».** Expected: `isSameBoard` is true and no `PUT` is sent (Task 5, `setAppearance` test asserting `isSameBoard(next, board)`).
5. **A version 4 database with widgets.** Expected: migration 5 runs, widgets read back without an `appearance` key, and the board saves unchanged (Task 2, db and rooms tests).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/contracts/src/board.ts` | `DropShadow`, `WidgetAppearance`, constants, `normalizeAppearance`, parser validation | 1 |
| `apps/api/src/migrations.ts` | Migration 5 | 2 |
| `apps/api/src/rooms.ts` | Read/write `widgets.appearance` | 2 |
| `apps/ui/app/theme/resolve.ts` | `FrameSkin`, `resolveWidgetLook` | 3 |
| `apps/ui/app/theme/shadow.ts` (new) | `shadowCss` | 3 |
| `apps/ui/app/theme/styles/skins/bare.css` (new) | Bare frame in `ld.skin` | 3 |
| `apps/ui/app/theme/styles/layers.css` | Import `bare.css` | 3 |
| `apps/ui/app/theme/styles/comfort.css` | `.widget--foreign` rule | 3 |
| `apps/ui/app/widgets/context.ts` | `foreign` source, re-read on `[themeId, foreign]` | 4 |
| `apps/ui/app/widgets/WidgetFrame.vue` | `skin`, `foreign`, `shadow` props | 4 |
| `apps/ui/app/widgets/WidgetHost.vue` | Pass look to frame and context | 4 |
| `apps/ui/app/board/WidgetBoard.vue` | Resolve looks (Task 4); gear, panel, keyboard, closes (Task 6) | 4, 6 |
| `apps/ui/app/board/edit-session.ts` | `setAppearance` | 5 |
| `apps/ui/app/board/widget-settings.ts` (new) | `styleValue`, `withStyle`, `withShadow`, `panelPosition` | 5 |
| `apps/ui/app/board/WidgetSettings.vue` (new) | The popover panel | 6 |

---

### Task 1: Appearance contract and validation

**Files:**
- Modify: `packages/contracts/src/board.ts`
- Test: `packages/contracts/test/board.test.ts`

**Interfaces:**
- Consumes: `fail`, `isRecord` from `./parse.ts`; `isUuid` (same file).
- Produces (all exported from `@lifedashboard/contracts/board`):
  - `interface DropShadow { x: number; y: number; blur: number; color: string; opacity: number }`
  - `interface WidgetAppearance { themeId: string | null; shadow: DropShadow | null }`
  - `WidgetInstance.appearance?: WidgetAppearance`
  - `const BARE_THEME_ID = 'builtin:bare'`
  - `const SHADOW_LIMITS = { x: [-32, 32], y: [-32, 32], blur: [0, 48] } as const`
  - `const DEFAULT_SHADOW: DropShadow`
  - `function normalizeAppearance(appearance: WidgetAppearance | null | undefined): WidgetAppearance | undefined`
  - `parseScreenBoard` keeps a valid appearance, last in each instance, normalized.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/test/board.test.ts`, change the import to:

```ts
import {
  DEFAULT_SHADOW,
  isUuid,
  normalizeAppearance,
  parseScreenBoard,
  type ScreenBoard,
} from '../src/board.ts'
```

Append at the end of the file:

```ts
describe('widget appearance', () => {
  const look = { themeId: 'builtin:paper', shadow: { x: 0, y: 8, blur: 16, color: '#1a2B3c', opacity: 0.5 } }
  const withLook = (appearance: unknown) => mutated((d) => { d.instances[0].appearance = appearance })
  const first = (raw: unknown) => {
    const result = parseScreenBoard(raw)
    if (!result.ok) throw new Error(result.error)
    return result.value.instances[0]!
  }

  it('keeps a valid appearance last, in canonical key order, without unknown fields', () => {
    const scrambled = { extra: 1, shadow: { opacity: 0.5, color: '#1a2B3c', extra: 1, blur: 16, y: 8, x: 0 }, themeId: 'builtin:paper' }
    expect(JSON.stringify(first(withLook(scrambled)))).toBe(JSON.stringify({ ...valid.instances[0], appearance: look }))
  })

  it('reads a board without appearance back with the exact same JSON', () => {
    const result = parseScreenBoard(structuredClone(valid))
    expect(result.ok && JSON.stringify(result.value)).toBe(JSON.stringify(valid))
  })

  it.each([
    ['null', null],
    ['both fields null', { themeId: null, shadow: null }],
  ])('omits the appearance key for %s', (_name, appearance) => {
    expect(first(withLook(appearance))).not.toHaveProperty('appearance')
  })

  it.each([
    ['the bare id', 'builtin:bare'],
    ['an unknown built-in id', 'builtin:deleted-1'],
    ['a user theme id', `user:${A}`],
    ['null with a shadow', null],
  ])('accepts %s as themeId', (_name, themeId) => {
    expect(first(withLook({ themeId, shadow: DEFAULT_SHADOW })).appearance).toStrictEqual({ themeId, shadow: DEFAULT_SHADOW })
  })

  it('accepts the shadow bounds', () => {
    for (const shadow of [
      { x: -32, y: -32, blur: 0, color: '#000000', opacity: 0 },
      { x: 32, y: 32, blur: 48, color: '#FFFFFF', opacity: 1 },
    ]) {
      expect(first(withLook({ themeId: null, shadow })).appearance).toStrictEqual({ themeId: null, shadow })
    }
  })

  const shadowWith = (change: Record<string, unknown>) => ({ themeId: null, shadow: { ...DEFAULT_SHADOW, ...change } })

  it.each([
    ['a string', 'paper'],
    ['an array', []],
    ['a missing themeId', { shadow: null }],
    ['a missing shadow', { themeId: 'builtin:paper' }],
    ['a bare theme name', { themeId: 'glass', shadow: null }],
    ['an upper-case built-in id', { themeId: 'builtin:Glass', shadow: null }],
    ['an empty built-in name', { themeId: 'builtin:', shadow: null }],
    ['a user id that is not a UUID', { themeId: 'user:x', shadow: null }],
    ['a numeric themeId', { themeId: 7, shadow: null }],
    ['a non-object shadow', { themeId: null, shadow: 'soft' }],
    ['x above 32', shadowWith({ x: 33 })],
    ['y below -32', shadowWith({ y: -33 })],
    ['a fractional x', shadowWith({ x: 1.5 })],
    ['a string y', shadowWith({ y: '8' })],
    ['a negative blur', shadowWith({ blur: -1 })],
    ['blur above 48', shadowWith({ blur: 49 })],
    ['a 3-digit colour', shadowWith({ color: '#fff' })],
    ['a named colour', shadowWith({ color: 'red' })],
    ['a non-hex colour', shadowWith({ color: '#12345g' })],
    ['opacity above 1', shadowWith({ opacity: 1.01 })],
    ['negative opacity', shadowWith({ opacity: -0.1 })],
    ['NaN opacity', shadowWith({ opacity: Number.NaN })],
    ['string opacity', shadowWith({ opacity: '0.5' })],
    ['a missing colour', { themeId: null, shadow: { x: 0, y: 8, blur: 16, opacity: 0.5 } }],
  ])('rejects %s', (_name, appearance) => {
    const result = parseScreenBoard(withLook(appearance))
    expect(result).toEqual({ ok: false, error: 'instances[0]: invalid appearance' })
  })
})

describe('normalizeAppearance', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['both fields null', { themeId: null, shadow: null }],
  ])('returns undefined for %s', (_name, appearance) => {
    expect(normalizeAppearance(appearance)).toBeUndefined()
  })

  it('rebuilds the canonical key order', () => {
    const scrambled = { shadow: { opacity: 0.5, color: '#000000', blur: 16, y: 8, x: 0 }, themeId: null }
    expect(JSON.stringify(normalizeAppearance(scrambled))).toBe(JSON.stringify({ themeId: null, shadow: DEFAULT_SHADOW }))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C packages/contracts test`
Expected: FAIL — `DEFAULT_SHADOW` / `normalizeAppearance` are not exported (`undefined`), and the parser drops `appearance`.

- [ ] **Step 3: Implement**

In `packages/contracts/src/board.ts`, replace the `WidgetInstance` interface with:

```ts
export interface DropShadow {
  x: number // integer px, SHADOW_LIMITS.x
  y: number // integer px, SHADOW_LIMITS.y
  blur: number // integer px, SHADOW_LIMITS.blur
  color: string // '#rrggbb'
  opacity: number // 0..1
}

// Host-owned look of one widget; never part of `config` (spec 2026-10-09-widget-appearance).
export interface WidgetAppearance {
  themeId: string | null // null: inherit the board theme; BARE_THEME_ID: no frame
  shadow: DropShadow | null // null: the theme's own shadow
}

export interface WidgetInstance {
  id: string
  source: WidgetSource
  // Schema version of `config` (base design §12.2); every widget type starts at 1.
  configVersion: number
  config: Record<string, unknown>
  // Absent when nothing is set (normalizeAppearance).
  appearance?: WidgetAppearance
}

export const BARE_THEME_ID = 'builtin:bare'
export const SHADOW_LIMITS = { x: [-32, 32], y: [-32, 32], blur: [0, 48] } as const
export const DEFAULT_SHADOW: DropShadow = { x: 0, y: 8, blur: 16, color: '#000000', opacity: 0.5 }
```

After `isUuid`, add:

```ts
/**
 * Canonical appearance: absent when nothing is set, keys in a fixed order. The parser and the UI
 * both build it here, so boards compare equal as JSON (isSameBoard).
 */
export function normalizeAppearance(appearance: WidgetAppearance | null | undefined): WidgetAppearance | undefined {
  if (!appearance || (appearance.themeId === null && appearance.shadow === null)) return undefined
  const { shadow } = appearance
  return {
    themeId: appearance.themeId,
    shadow: shadow && { x: shadow.x, y: shadow.y, blur: shadow.blur, color: shadow.color, opacity: shadow.opacity },
  }
}
```

In `parseScreenBoard`, replace

```ts
    if (!isRecord(item.config)) return fail(`instances[${index}]: config must be an object`)
    ids.add(item.id)
    instances.push({ id: item.id, source, configVersion: version, config: item.config })
```

with

```ts
    if (!isRecord(item.config)) return fail(`instances[${index}]: config must be an object`)
    const appearance = parseAppearance(item.appearance)
    if (appearance === null) return fail(`instances[${index}]: invalid appearance`)
    ids.add(item.id)
    // appearance goes last, as rooms.ts reads it back: isSameBoard compares JSON.
    instances.push({ id: item.id, source, configVersion: version, config: item.config, ...(appearance && { appearance }) })
```

After `parseSource`, add:

```ts
const BUILTIN_THEME = /^builtin:[a-z0-9-]+$/
const HEX_COLOR = /^#[0-9a-f]{6}$/i

// undefined: nothing set (absent, null or both fields null); null: invalid.
function parseAppearance(raw: unknown): WidgetAppearance | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) return null
  const { themeId, shadow } = raw
  if (themeId !== null && !isThemeId(themeId)) return null
  if (shadow !== null && !isDropShadow(shadow)) return null
  return normalizeAppearance({ themeId, shadow })
}

// A well-formed unknown id is valid: rendering treats it as unset, the stored reference stays.
function isThemeId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return BUILTIN_THEME.test(value) || (value.startsWith('user:') && isUuid(value.slice('user:'.length)))
}

function isDropShadow(value: unknown): value is DropShadow {
  if (!isRecord(value)) return false
  const within = (n: unknown, [min, max]: readonly [number, number]) =>
    typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  const { opacity, color } = value
  return (
    within(value.x, SHADOW_LIMITS.x) &&
    within(value.y, SHADOW_LIMITS.y) &&
    within(value.blur, SHADOW_LIMITS.blur) &&
    typeof color === 'string' &&
    HEX_COLOR.test(color) &&
    typeof opacity === 'number' &&
    Number.isFinite(opacity) &&
    opacity >= 0 &&
    opacity <= 1
  )
}
```

(The negated type-guard narrowing of `themeId` / `shadow` and the `...(appearance && { appearance })` spread were checked with this TypeScript configuration.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C packages/contracts test && pnpm -C packages/contracts typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/board.ts packages/contracts/test/board.test.ts
git commit -m "feat(contracts): validate and normalize widget appearance"
```

---

### Task 2: Store appearance in SQLite

**Files:**
- Modify: `apps/api/src/migrations.ts` (append migration 5)
- Modify: `apps/api/src/rooms.ts:13-25` (`WidgetRow`), `:91-96` (read), `:130-151` (insert)
- Test: `apps/api/test/db.test.ts`, `apps/api/test/rooms.test.ts`

**Interfaces:**
- Consumes: `WidgetAppearance` and the parser behaviour from Task 1.
- Produces: `GET /api/v1/rooms/:roomId/board` returns `appearance` after `config` when stored; omits the key otherwise. `MIGRATIONS.length === 5`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/db.test.ts`, the test `gives grants of a version 3 database the mode allow` opens with all migrations and asserts version 4; pin it to 4 migrations. Replace

```ts
    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(4)
```

with

```ts
    const db = await openDatabase(file, MIGRATIONS.slice(0, 4))
    expect(userVersion(db)).toBe(4)
```

Add after that test:

```ts
  it('adds a nullable appearance column to widgets of a version 4 database', async () => {
    const v4 = await openDatabase(file, MIGRATIONS.slice(0, 4))
    v4.exec(`
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('w1', '${SEED_SCREEN_ID}', 'builtin', 'placeholder', '{}', 1, 0, 0, 2, 2);
    `)
    v4.close()

    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(5)
    expect(db.prepare('SELECT id, appearance FROM widgets').all()).toEqual([{ id: 'w1', appearance: null }])
    db.close()
    expect(existsSync(`${file}.bak-v4`)).toBe(true)
  })
```

In `apps/api/test/rooms.test.ts`, append:

```ts
describe('widget appearance', () => {
  const look = { themeId: 'builtin:bare', shadow: { x: 2, y: 4, blur: 12, color: '#102030', opacity: 0.25 } }
  const styled = (appearance: unknown) => ({
    ...screen,
    instances: [{ ...screen.instances[0]!, appearance }, screen.instances[1]!],
  })

  it('round-trips appearance after config and leaves the key out for widgets without one', async () => {
    const response = await put({ expectedRevision: 1, screens: [styled(look)] })
    expect(response.statusCode).toBe(200)
    const board = await getBoard()
    expect(JSON.stringify(board.screens[0])).toBe(JSON.stringify(styled(look)))
    expect(board.screens[0]!.instances[1]).not.toHaveProperty('appearance')
  })

  it('stores NULL for an empty appearance and reads the old board JSON back', async () => {
    const response = await put({ expectedRevision: 1, screens: [styled({ themeId: null, shadow: null })] })
    expect(response.statusCode).toBe(200)
    expect(t.db.prepare('SELECT appearance FROM widgets ORDER BY rowid').all()).toEqual([{ appearance: null }, { appearance: null }])
    expect(JSON.stringify((await getBoard()).screens[0])).toBe(JSON.stringify(screen))
  })

  it('answers 400 for an invalid appearance and changes nothing', async () => {
    const response = await put({ expectedRevision: 1, screens: [styled({ themeId: null, shadow: { ...look.shadow, blur: 49 } })] })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(await getBoard()).toEqual({ roomId: SEED_ROOM_ID, revision: 1, screens: [EMPTY_SCREEN] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/api test -- db rooms`
Expected: FAIL — `userVersion` is 4 not 5 and no `.bak-v4`; the round-trip loses `appearance`; the `SELECT appearance` query throws `no such column: appearance`.

- [ ] **Step 3: Implement**

In `apps/api/src/migrations.ts`, append to `MIGRATIONS` (after the grants migration):

```ts
  `
-- Spec 2026-10-09-widget-appearance: per-widget theme and shadow as JSON; NULL means none.
ALTER TABLE widgets ADD COLUMN appearance TEXT;
`,
```

In `apps/api/src/rooms.ts`:

1. Import the type: add `type WidgetAppearance,` to the `@lifedashboard/contracts/board` import list.
2. Add to `WidgetRow` after `config_version: number`:

```ts
  appearance: string | null
```

3. In `readBoard`, replace the instance mapping with:

```ts
        instances: placed.map((row) => ({
          id: row.id,
          source: sourceOf(row),
          configVersion: row.config_version,
          config: JSON.parse(row.config) as Record<string, unknown>,
          // Last, as parseScreenBoard builds it: the UI compares boards as JSON.
          ...(row.appearance !== null && { appearance: JSON.parse(row.appearance) as WidgetAppearance }),
        })),
```

4. In `saveBoard`, replace the insert statement and its `run` call with:

```ts
    const insert = db.prepare(
      'INSERT INTO widgets (id, screen_id, source_kind, source_type, source_version, config, config_version, appearance, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
```

```ts
          insert.run(
            instance.id,
            screen.id,
            source.kind,
            source.kind === 'package' ? source.packageId : source.type,
            source.kind === 'package' ? source.version : null,
            JSON.stringify(instance.config),
            instance.configVersion,
            // parseScreenBoard already dropped an empty appearance.
            instance.appearance ? JSON.stringify(instance.appearance) : null,
            place.x,
            place.y,
            place.w,
            place.h,
          )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/api test && pnpm -C apps/api typecheck`
Expected: PASS (whole API suite: old boards still round-trip without the key).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migrations.ts apps/api/src/rooms.ts apps/api/test/db.test.ts apps/api/test/rooms.test.ts
git commit -m "feat(api): store widget appearance in migration 5"
```

---

### Task 3: Widget look, shadow CSS, bare skin and foreign rule

**Files:**
- Modify: `apps/ui/app/theme/resolve.ts`
- Create: `apps/ui/app/theme/shadow.ts`
- Create: `apps/ui/app/theme/styles/skins/bare.css`
- Modify: `apps/ui/app/theme/styles/layers.css:10` (import after `paper.css`)
- Modify: `apps/ui/app/theme/styles/comfort.css`
- Test: `apps/ui/test/theme-resolve.test.ts`, `apps/ui/test/shadow.test.ts` (new), `apps/ui/test/theme-contract.test.ts`

**Interfaces:**
- Consumes: `BARE_THEME_ID`, `DEFAULT_SHADOW`, `DropShadow`, `WidgetAppearance` (Task 1); `BUILTIN_THEME_IDS`, `themeMeta` (`theme/builtin.ts`); `SkinId` (`theme/contract.ts`).
- Produces:
  - `type FrameSkin = SkinId | 'bare'` (from `theme/resolve.ts`)
  - `resolveWidgetLook(appearance: WidgetAppearance | undefined, boardThemeId: string): { themeId: string; skin: FrameSkin; foreign: boolean }`
  - `shadowCss(shadow: DropShadow): string` (from `theme/shadow.ts`)
  - CSS classes `.widget--skin-bare`, `.widget--foreign`.

- [ ] **Step 1: Write the failing tests**

In `apps/ui/test/theme-resolve.test.ts`, change the imports:

```ts
import { BARE_THEME_ID, DEFAULT_SHADOW } from '@lifedashboard/contracts/board'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_STORAGE_KEY, loadAppearance, saveAppearance } from '../app/theme/appearance'
import { BUILTIN_THEME_IDS, BUILTIN_THEMES, DEFAULT_THEME_ID, themeMeta } from '../app/theme/builtin'
import { resolveThemeId, resolveWidgetLook, themeClass } from '../app/theme/resolve'
```

Add after the `resolveThemeId` describe:

```ts
describe('resolveWidgetLook', () => {
  const paper = { themeId: 'builtin:paper', skin: 'paper', foreign: false }

  it.each([
    ['absent', undefined, 'builtin:paper', paper],
    ['inherited with a shadow', { themeId: null, shadow: DEFAULT_SHADOW }, 'builtin:paper', paper],
    ['the board theme chosen', { themeId: 'builtin:paper', shadow: null }, 'builtin:paper', paper],
    ['Glass chosen on Paper', { themeId: 'builtin:glass', shadow: null }, 'builtin:paper', { themeId: 'builtin:glass', skin: 'glass', foreign: true }],
    ['Obsidian chosen on Glass', { themeId: 'builtin:obsidian', shadow: null }, 'builtin:glass', { themeId: 'builtin:obsidian', skin: 'solid', foreign: true }],
    ['bare', { themeId: BARE_THEME_ID, shadow: null }, 'builtin:obsidian', { themeId: 'builtin:obsidian', skin: 'bare', foreign: false }],
    ['an unknown user id', { themeId: 'user:00000000-0000-4000-8000-00000000000a', shadow: null }, 'builtin:paper', paper],
    ['an unknown built-in id', { themeId: 'builtin:deleted', shadow: null }, 'builtin:paper', paper],
  ] as const)('%s', (_name, appearance, board, expected) => {
    expect(resolveWidgetLook(appearance, board)).toEqual(expected)
  })
})
```

Create `apps/ui/test/shadow.test.ts`:

```ts
import { DEFAULT_SHADOW } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { shadowCss } from '../app/theme/shadow'

describe('shadowCss', () => {
  it('formats the default shadow', () => {
    expect(shadowCss(DEFAULT_SHADOW)).toBe('0px 8px 16px rgb(0 0 0 / 0.5)')
  })

  it('converts any-case hex to rgb channels and keeps negative offsets', () => {
    expect(shadowCss({ x: -4, y: 2, blur: 0, color: '#FF8000', opacity: 1 })).toBe('-4px 2px 0px rgb(255 128 0 / 1)')
    expect(shadowCss({ x: 0, y: 0, blur: 48, color: '#0a1b2c', opacity: 0 })).toBe('0px 0px 48px rgb(10 27 44 / 0)')
  })
})
```

In `apps/ui/test/theme-contract.test.ts`, add inside `describe('stylesheets', …)`:

```ts
  it('layers.css imports the bare skin, which themes cannot pick', () => {
    expect(styleFile('layers.css')).toContain(`@import './skins/bare.css';`)
    expect(SKINS).not.toContain('bare')
  })

  it('bare.css removes the card in ld.skin', () => {
    const decls: Record<string, Record<string, string>> = {}
    postcss.parse(styleFile('skins/bare.css')).walkRules((rule) => {
      if ((rule.parent as AtRule | undefined)?.params !== 'ld.skin') return
      rule.walkDecls((decl) => {
        ;(decls[rule.selector] ??= {})[decl.prop] = decl.value
      })
    })
    expect(decls).toEqual({
      '.widget--skin-bare > .widget__wrapper > .widget__box': {
        border: '0',
        'border-radius': '0',
        background: 'none',
        overflow: 'visible',
      },
      '.widget--skin-bare > .widget__wrapper > .widget__box > .widget__body': { padding: '0' },
    })
  })

  it('comfort.css makes a foreign widget opaque and unblurred in ld.comfort', () => {
    const decls: Record<string, string> = {}
    postcss.parse(styleFile('comfort.css')).walkRules('.widget--foreign', (rule) => {
      if ((rule.parent as AtRule | undefined)?.params !== 'ld.comfort') return
      rule.walkDecls((decl) => {
        decls[decl.prop] = decl.value
      })
    })
    expect(decls).toEqual({ '--ld-surface-1': 'var(--ld-surface-1-solid)', '--ld-blur': '0' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/ui test -- theme-resolve shadow theme-contract`
Expected: FAIL — `resolveWidgetLook` is not a function, `../app/theme/shadow` does not exist, `skins/bare.css` is missing (ENOENT), the `.widget--foreign` decls are `{}`.

- [ ] **Step 3: Implement**

Replace `apps/ui/app/theme/resolve.ts` with:

```ts
import { BARE_THEME_ID, type WidgetAppearance } from '@lifedashboard/contracts/board'
import { BUILTIN_THEME_IDS, DEFAULT_THEME_ID, themeMeta } from './builtin'
import type { SkinId } from './contract'

/** A frame skin: a theme's skin, or «Без оформления», which only a widget appearance picks. */
export type FrameSkin = SkinId | 'bare'

/**
 * The theme of a scope: the first id in the chain (widget, room, workspace) that is set and known.
 * An unknown id (deleted theme) counts as unset; the stored reference is not rewritten.
 */
export function resolveThemeId(chain: readonly (string | null)[], known: ReadonlySet<string>): string {
  return chain.find((id): id is string => id !== null && known.has(id)) ?? DEFAULT_THEME_ID
}

/**
 * How one widget is drawn on a board with the resolved `boardThemeId`. Bare keeps the board's tokens and
 * only drops the frame; a widget on another theme than the board's is `foreign` (opaque surface-1).
 */
export function resolveWidgetLook(
  appearance: WidgetAppearance | undefined,
  boardThemeId: string,
): { themeId: string; skin: FrameSkin; foreign: boolean } {
  if (appearance?.themeId === BARE_THEME_ID) return { themeId: boardThemeId, skin: 'bare', foreign: false }
  const themeId = resolveThemeId([appearance?.themeId ?? null, boardThemeId], BUILTIN_THEME_IDS)
  return { themeId, skin: themeMeta(themeId).skin, foreign: themeId !== boardThemeId }
}

/** CSS class suffix: builtin:<name> → <name>, user:<uuid> → u-<uuid>. */
export function themeClass(id: string): string {
  if (id.startsWith('builtin:')) return id.slice('builtin:'.length)
  if (id.startsWith('user:')) return `u-${id.slice('user:'.length)}`
  throw new Error(`Unknown theme id format: ${id}`)
}
```

Create `apps/ui/app/theme/shadow.ts`:

```ts
import type { DropShadow } from '@lifedashboard/contracts/board'

/** One shadow for both `box-shadow` and `drop-shadow()`: `<x>px <y>px <blur>px rgb(<r> <g> <b> / <opacity>)`. */
export function shadowCss({ x, y, blur, color, opacity }: DropShadow): string {
  const channel = (at: number) => Number.parseInt(color.slice(at, at + 2), 16)
  return `${x}px ${y}px ${blur}px rgb(${channel(1)} ${channel(3)} ${channel(5)} / ${opacity})`
}
```

Create `apps/ui/app/theme/styles/skins/bare.css`:

```css
/* «Без оформления»: no card. Tokens and colours stay the board theme's; only the frame goes.
   Not in SKINS: themes cannot pick it, only a widget appearance does. overflow: visible keeps
   the widget's drop-shadow unclipped. */
@layer ld.skin {
  .widget--skin-bare > .widget__wrapper > .widget__box {
    border: 0;
    border-radius: 0;
    background: none;
    overflow: visible;
  }

  .widget--skin-bare > .widget__wrapper > .widget__box > .widget__body {
    padding: 0;
  }
}
```

In `apps/ui/app/theme/styles/layers.css`, add after `@import './skins/paper.css';`:

```css
@import './skins/bare.css';
```

In `apps/ui/app/theme/styles/comfort.css`, replace the header comment and add the rule inside `@layer ld.comfort`, before the `@media` block:

```css
/* User comfort beats every theme and all widget CSS (spec: Effects and comfort).
   MVP: prefers-reduced-motion and foreign widgets; ComfortProfile classes arrive with its UI. */
@layer ld.comfort {
  /* A widget on another theme than the board's: its contrast was checked against its own bg, not
     this backdrop, so it paints opaque. `transparency: reduced` joins this rule with the ComfortProfile UI. */
  .widget--foreign {
    --ld-surface-1: var(--ld-surface-1-solid);
    --ld-blur: 0;
  }

  @media (prefers-reduced-motion: reduce) {
```

(the rest of the file stays as it is).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/ui test`
Expected: PASS (whole UI suite, including the existing «imports every skin» and reduced-motion tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/theme/resolve.ts apps/ui/app/theme/shadow.ts apps/ui/app/theme/styles/skins/bare.css apps/ui/app/theme/styles/layers.css apps/ui/app/theme/styles/comfort.css apps/ui/test/theme-resolve.test.ts apps/ui/test/shadow.test.ts apps/ui/test/theme-contract.test.ts
git commit -m "feat(ui): resolve widget look, bare skin and foreign surface rule"
```

---

### Task 4: Render each widget with its own look

**Files:**
- Modify: `apps/ui/app/widgets/context.ts:25-30` (source type), `:67` (watch)
- Modify: `apps/ui/app/widgets/WidgetFrame.vue` (whole file)
- Modify: `apps/ui/app/widgets/WidgetHost.vue:18-35`, `:59`
- Modify: `apps/ui/app/board/WidgetBoard.vue:54-59` (`placed`), `:307`, `:327-334`
- Test: `apps/ui/test/widget-context.test.ts` (new)

**Interfaces:**
- Consumes: `resolveWidgetLook`, `FrameSkin`, `shadowCss` (Task 3); `DropShadow` (Task 1).
- Produces:
  - `useWidgetContext(source: { size; themeId; foreign: () => boolean; config; frame })` — `foreign` is required.
  - `WidgetFrame` props: `themeId: string; skin?: FrameSkin; foreign?: boolean; shadow?: DropShadow | null`.
  - `WidgetHost` props: adds `skin?: FrameSkin; foreign?: boolean; shadow?: DropShadow | null`.
  - `placed` items in `WidgetBoard.vue`: `{ instance, placement, look }`.

- [ ] **Step 1: Write the failing test**

Create `apps/ui/test/widget-context.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useWidgetContext } from '../app/widgets/context'

// Vitest runs in Node: the frame's computed style is a stub whose surface-1 follows `surface`.
// onMounted is a no-op outside a component, so only the watch path runs here.
let surface = 'translucent'
const scopes: ReturnType<typeof effectScope>[] = []

beforeEach(() => {
  surface = 'translucent'
  vi.stubGlobal('document', { visibilityState: 'visible', documentElement: {}, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('getComputedStyle', () => ({
    fontSize: '16px',
    getPropertyValue: (name: string) => (name === '--ld-surface-1' ? surface : ''),
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup(foreign: boolean) {
  const flag = ref(foreign)
  const scope = effectScope()
  scopes.push(scope)
  const context = scope.run(() =>
    useWidgetContext({
      size: () => ({ w: 2, h: 2 }),
      themeId: () => 'builtin:glass',
      foreign: () => flag.value,
      config: () => ({}),
      frame: () => ({}) as Element,
    }),
  )!
  return { flag, context }
}

describe('useWidgetContext', () => {
  it('re-reads tokens when foreign flips while the theme id stays, in both directions', async () => {
    const { flag, context } = setup(false)

    surface = 'solid'
    flag.value = true
    await vi.waitFor(() => expect(context.theme.tokens['--ld-surface-1']).toBe('solid'))

    surface = 'translucent'
    flag.value = false
    await vi.waitFor(() => expect(context.theme.tokens['--ld-surface-1']).toBe('translucent'))
    expect(context.theme.id).toBe('builtin:glass')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/ui test -- widget-context`
Expected: FAIL — `vi.waitFor` times out: tokens stay `{}` because only `themeId` is watched.

- [ ] **Step 3: Implement**

`apps/ui/app/widgets/context.ts` — the source type becomes:

```ts
export function useWidgetContext(source: {
  size: () => Size
  themeId: () => string
  // True when the widget's theme differs from the board's: comfort.css swaps surface-1 and blur.
  foreign: () => boolean
  config: () => Record<string, unknown>
  frame: () => Element | null
}): WidgetContext {
```

and replace `watch(source.themeId, readTheme)` with:

```ts
  // `foreign` changes the computed tokens without changing the id (a widget fixed to Glass while the
  // board switches Glass → Paper), so the pair is watched.
  watch(() => [source.themeId(), source.foreign()] as const, readTheme)
```

Replace `apps/ui/app/widgets/WidgetFrame.vue` with:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { DropShadow } from '@lifedashboard/contracts/board'
import { themeMeta } from '../theme/builtin'
import { themeClass, type FrameSkin } from '../theme/resolve'
import { shadowCss } from '../theme/shadow'

// A resolved theme id: the widget's own choice or the one it inherits. `skin` and `foreign` come from
// resolveWidgetLook; without them the frame draws the theme's own skin (the build draft).
const props = defineProps<{ themeId: string; skin?: FrameSkin; foreign?: boolean; shadow?: DropShadow | null }>()

const skin = computed(() => props.skin ?? themeMeta(props.themeId).skin)
const classes = computed(() => [
  'widget',
  `widget--theme-${themeClass(props.themeId)}`,
  `widget--skin-${skin.value}`,
  { 'widget--foreign': props.foreign },
])
// Inline style beats the skin's layered box-shadow. A bare widget gets drop-shadow, which follows its
// content's alpha outline (the round clock dial); a card is a rectangle, and filter would break Glass blur.
const wrapperStyle = computed(() => {
  if (!props.shadow) return undefined
  const css = shadowCss(props.shadow)
  return skin.value === 'bare' ? { filter: `drop-shadow(${css})` } : { boxShadow: css }
})
</script>

<template>
  <div :class="classes">
    <div class="widget__wrapper" :style="wrapperStyle">
      <div class="widget__box">
        <div class="widget__body">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
```

`apps/ui/app/widgets/WidgetHost.vue`:

1. Imports: change the contracts import to `import type { DropShadow, WidgetSource } from '@lifedashboard/contracts/board'` and add `import type { FrameSkin } from '../theme/resolve'`.
2. Props become:

```ts
const props = defineProps<{
  source: WidgetSource
  size: Size
  // Resolved by resolveWidgetLook on the board; the build draft passes only themeId.
  themeId: string
  skin?: FrameSkin
  foreign?: boolean
  shadow?: DropShadow | null
  widgetId?: string
  config?: Record<string, unknown>
}>()
```

3. Context:

```ts
const context = useWidgetContext({
  size: () => props.size,
  themeId: () => props.themeId,
  foreign: () => props.foreign,
  config: () => props.config ?? {},
  frame: () => frame.value?.$el ?? null,
})
```

(Vue casts an absent boolean prop to `false`.)

4. Template frame line:

```vue
  <WidgetFrame ref="frameBox" :theme-id="themeId" :skin="skin" :foreign="foreign" :shadow="shadow">
```

`apps/ui/app/board/WidgetBoard.vue`:

1. Add the import: `import { resolveWidgetLook } from '../theme/resolve'`.
2. Replace `placed` with:

```ts
const placed = computed(() =>
  shown.value.layout.flatMap((placement) => {
    const instance = shown.value.instances.find((item) => item.id === placement.instanceId)
    return instance ? [{ instance, placement, look: resolveWidgetLook(instance.appearance, props.themeId) }] : []
  }),
)
```

3. Template: `v-for="{ instance, placement } in placed"` → `v-for="{ instance, placement, look } in placed"`, and the placed `WidgetHost` becomes:

```vue
          <WidgetHost
            class="board__content"
            :source="instance.source"
            :size="placement"
            :theme-id="look.themeId"
            :skin="look.skin"
            :foreign="look.foreign"
            :shadow="instance.appearance?.shadow"
            :widget-id="instance.id"
            :config="instance.config"
          />
```

The build draft `WidgetHost` (`:theme-id="themeId"` only) stays unchanged.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm -C apps/ui test && pnpm -r typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/widgets/context.ts apps/ui/app/widgets/WidgetFrame.vue apps/ui/app/widgets/WidgetHost.vue apps/ui/app/board/WidgetBoard.vue apps/ui/test/widget-context.test.ts
git commit -m "feat(ui): render widgets with their own theme, skin and shadow"
```

---

### Task 5: Appearance edits as pure helpers

**Files:**
- Modify: `apps/ui/app/board/edit-session.ts`
- Create: `apps/ui/app/board/widget-settings.ts`
- Test: `apps/ui/test/edit-session.test.ts`, `apps/ui/test/widget-settings.test.ts` (new)

**Interfaces:**
- Consumes: `normalizeAppearance`, `BARE_THEME_ID`, `DropShadow`, `WidgetAppearance` (Task 1); `BUILTIN_THEME_IDS`.
- Produces:
  - `setAppearance(doc: ScreenBoard, id: string, next: WidgetAppearance | null | undefined): ScreenBoard` (`board/edit-session.ts`)
  - From `board/widget-settings.ts`:
    - `styleValue(appearance: WidgetAppearance | undefined): string` — `''` means «Как у доски»
    - `withStyle(appearance: WidgetAppearance | undefined, value: string): WidgetAppearance`
    - `withShadow(appearance: WidgetAppearance | undefined, shadow: DropShadow | null): WidgetAppearance`
    - `panelPosition(anchor: { left: number; top: number; right: number }, size: { width: number; height: number }, viewport: { width: number; height: number }, margin?: number): { left: number; top: number }`

- [ ] **Step 1: Write the failing tests**

In `apps/ui/test/edit-session.test.ts`, change the first and third imports:

```ts
import { DEFAULT_SHADOW, parseScreenBoard, type ScreenBoard, type WidgetAppearance } from '@lifedashboard/contracts/board'
```

```ts
import { focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setAppearance, setPlacement, withRows } from '../app/board/edit-session'
```

Append:

```ts
describe('setAppearance', () => {
  const look: WidgetAppearance = { themeId: 'builtin:paper', shadow: null }

  it('sets the appearance last on the target only and does not mutate its input', () => {
    const before = structuredClone(board)
    const next = setAppearance(board, A, look)
    expect(next.instances[0]).toStrictEqual({ ...board.instances[0], appearance: look })
    expect(Object.keys(next.instances[0]!).at(-1)).toBe('appearance')
    expect(next.instances[1]).toBe(board.instances[1])
    expect(next.layout).toBe(board.layout)
    expect(board).toEqual(before)
  })

  it('replaces an appearance and stores it in canonical key order', () => {
    const scrambled = { shadow: { opacity: 0.5, color: '#000000', blur: 16, y: 8, x: 0 }, themeId: null } as WidgetAppearance
    const next = setAppearance(setAppearance(board, A, look), A, scrambled)
    expect(JSON.stringify(next.instances[0]!.appearance)).toBe(JSON.stringify({ themeId: null, shadow: DEFAULT_SHADOW }))
  })

  it.each([
    ['null («Сбросить»)', null],
    ['undefined', undefined],
    ['both fields null', { themeId: null, shadow: null }],
  ])('removes the key for %s, so the board is unchanged again', (_name, value) => {
    const next = setAppearance(setAppearance(board, A, look), A, value)
    expect(next.instances[0]).not.toHaveProperty('appearance')
    expect(isSameBoard(next, board)).toBe(true)
  })

  it('matches what the parser reads back', () => {
    const next = setAppearance(board, A, { themeId: null, shadow: DEFAULT_SHADOW })
    const parsed = parseScreenBoard(JSON.parse(JSON.stringify(next)))
    expect(parsed.ok && isSameBoard(parsed.value, next)).toBe(true)
  })
})
```

Create `apps/ui/test/widget-settings.test.ts`:

```ts
import { BARE_THEME_ID, DEFAULT_SHADOW } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { panelPosition, styleValue, withShadow, withStyle } from '../app/board/widget-settings'

const UNKNOWN = 'user:00000000-0000-4000-8000-00000000000a'

describe('styleValue', () => {
  it.each([
    ['no appearance', undefined, ''],
    ['an inherited theme', { themeId: null, shadow: DEFAULT_SHADOW }, ''],
    ['a built-in theme', { themeId: 'builtin:paper', shadow: null }, 'builtin:paper'],
    ['bare', { themeId: BARE_THEME_ID, shadow: null }, BARE_THEME_ID],
    ['an unknown user theme', { themeId: UNKNOWN, shadow: null }, ''],
    ['an unknown built-in theme', { themeId: 'builtin:deleted', shadow: null }, ''],
  ] as const)('%s → %j', (_name, appearance, expected) => {
    expect(styleValue(appearance)).toBe(expected)
  })
})

describe('withStyle', () => {
  it('sets the theme and keeps the shadow', () => {
    expect(withStyle({ themeId: null, shadow: DEFAULT_SHADOW }, BARE_THEME_ID)).toEqual({ themeId: BARE_THEME_ID, shadow: DEFAULT_SHADOW })
  })

  it('maps «Как у доски» to null', () => {
    expect(withStyle({ themeId: 'builtin:paper', shadow: null }, '')).toEqual({ themeId: null, shadow: null })
    expect(withStyle(undefined, '')).toEqual({ themeId: null, shadow: null })
  })
})

describe('withShadow', () => {
  it('keeps a stored unknown theme id while the shadow changes', () => {
    const on = withShadow({ themeId: UNKNOWN, shadow: null }, DEFAULT_SHADOW)
    expect(on).toEqual({ themeId: UNKNOWN, shadow: DEFAULT_SHADOW })
    expect(withShadow(on, null)).toEqual({ themeId: UNKNOWN, shadow: null })
  })

  it('starts from an inherited theme without an appearance', () => {
    expect(withShadow(undefined, DEFAULT_SHADOW)).toEqual({ themeId: null, shadow: DEFAULT_SHADOW })
  })
})

describe('panelPosition', () => {
  const size = { width: 240, height: 300 }
  const viewport = { width: 1280, height: 800 }

  it('places the panel right of the gear, top-aligned', () => {
    expect(panelPosition({ left: 100, top: 50, right: 124 }, size, viewport)).toEqual({ left: 132, top: 50 })
  })

  it('flips left of the gear near the right edge', () => {
    expect(panelPosition({ left: 1200, top: 50, right: 1224 }, size, viewport)).toEqual({ left: 952, top: 50 })
  })

  it('keeps the panel inside the bottom edge', () => {
    expect(panelPosition({ left: 100, top: 700, right: 124 }, size, viewport)).toEqual({ left: 132, top: 492 })
  })

  it('pins a panel larger than the viewport to the margin', () => {
    expect(panelPosition({ left: 100, top: 50, right: 124 }, size, { width: 200, height: 200 })).toEqual({ left: 8, top: 8 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/ui test -- edit-session widget-settings`
Expected: FAIL — `setAppearance` is not a function; `../app/board/widget-settings` does not exist.

- [ ] **Step 3: Implement**

In `apps/ui/app/board/edit-session.ts`, change the first import to:

```ts
import { normalizeAppearance, type ScreenBoard, type WidgetAppearance, type WidgetPlacement } from '@lifedashboard/contracts/board'
```

and add after `removeInstance`:

```ts
/** The board with `id`'s appearance replaced; an empty one removes the key (normalizeAppearance). */
export function setAppearance(doc: ScreenBoard, id: string, next: WidgetAppearance | null | undefined): ScreenBoard {
  const appearance = normalizeAppearance(next)
  return {
    ...doc,
    instances: doc.instances.map((item) => {
      if (item.id !== id) return item
      // Rebuilt without the old key, so a new appearance goes last, as the API returns it.
      const { appearance: _old, ...rest } = item
      return appearance ? { ...rest, appearance } : rest
    }),
  }
}
```

Create `apps/ui/app/board/widget-settings.ts`:

```ts
import { BARE_THEME_ID, type DropShadow, type WidgetAppearance } from '@lifedashboard/contracts/board'
import { BUILTIN_THEME_IDS } from '../theme/builtin'

/** The «Стиль» value: '' is «Как у доски», which a stored unknown id also shows. */
export function styleValue(appearance: WidgetAppearance | undefined): string {
  const id = appearance?.themeId ?? null
  return id !== null && (id === BARE_THEME_ID || BUILTIN_THEME_IDS.has(id)) ? id : ''
}

/** A new «Стиль»; the shadow stays. */
export function withStyle(appearance: WidgetAppearance | undefined, value: string): WidgetAppearance {
  return { themeId: value === '' ? null : value, shadow: appearance?.shadow ?? null }
}

/** A new shadow (null: the theme's own); the stored theme id stays, an unknown one too. */
export function withShadow(appearance: WidgetAppearance | undefined, shadow: DropShadow | null): WidgetAppearance {
  return { themeId: appearance?.themeId ?? null, shadow }
}

/**
 * Top-left of a fixed panel beside the gear: to its right, else to its left, `margin` inside the viewport.
 * CSS anchor positioning is not in every browser (spec «Decisions»).
 */
export function panelPosition(
  anchor: { left: number; top: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  const right = anchor.right + margin
  const left = right + size.width + margin <= viewport.width ? right : anchor.left - margin - size.width
  const clamp = (value: number, length: number, room: number) => Math.max(margin, Math.min(value, room - length - margin))
  return { left: clamp(left, size.width, viewport.width), top: clamp(anchor.top, size.height, viewport.height) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/ui test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/app/board/edit-session.ts apps/ui/app/board/widget-settings.ts apps/ui/test/edit-session.test.ts apps/ui/test/widget-settings.test.ts
git commit -m "feat(ui): appearance edit helpers for the widget settings panel"
```

---

### Task 6: Settings panel and «⚙» in edit mode

**Files:**
- Create: `apps/ui/app/board/WidgetSettings.vue`
- Modify: `apps/ui/app/board/WidgetBoard.vue` (script, template, styles)
- Test: `apps/ui/test/theme-contract.test.ts` (tokens-only list)

**Interfaces:**
- Consumes: `setAppearance` (Task 5); `styleValue`, `withStyle`, `withShadow`, `panelPosition` (Task 5); `BUILTIN_THEMES`; `BARE_THEME_ID`, `DEFAULT_SHADOW`, `SHADOW_LIMITS`, `DropShadow`, `WidgetAppearance` (Task 1).
- Produces:
  - `WidgetSettings.vue`: props `{ appearance: WidgetAppearance | undefined }`; emits `change: [next: WidgetAppearance | null]`, `toggle: [open: boolean]`; exposes `open(anchor: Element): void`, `close(): void`, `isOpen(): boolean`.
  - In `WidgetBoard.vue`: `.board__settings` buttons with `data-settings="<instance id>"`.

The SFC has no unit-test harness (no new test dependencies); its logic lives in the Task 5 helpers, and its behaviour is checked in the browser in Task 7. The RED step here is the style contract test.

- [ ] **Step 1: Write the failing test**

In `apps/ui/test/theme-contract.test.ts`, extend the tokens-only list:

```ts
  it.each(['app.vue', 'board/WidgetBoard.vue', 'board/WidgetSettings.vue', 'widgets/WidgetFrame.vue', 'widgets/WidgetHost.vue'])(
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/ui test -- theme-contract`
Expected: FAIL — `ENOENT … board/WidgetSettings.vue`.

- [ ] **Step 3: Create the panel**

Create `apps/ui/app/board/WidgetSettings.vue`:

```vue
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import {
  BARE_THEME_ID,
  DEFAULT_SHADOW,
  SHADOW_LIMITS,
  type DropShadow,
  type WidgetAppearance,
} from '@lifedashboard/contracts/board'
import { BUILTIN_THEMES } from '../theme/builtin'
import { panelPosition, styleValue, withShadow, withStyle } from './widget-settings'

// One per board: a non-modal popover beside the «⚙» of the widget being tuned. It sits in the top
// layer, so the board never clips it; light dismiss and Esc are native (spec «Host UI»).
const props = defineProps<{ appearance: WidgetAppearance | undefined }>()
const emit = defineEmits<{
  change: [next: WidgetAppearance | null]
  toggle: [open: boolean]
}>()

const panel = useTemplateRef<HTMLElement>('panelBox')
const shadow = computed(() => props.appearance?.shadow ?? null)
// While the shadow is off the controls show DEFAULT_SHADOW, disabled; nothing is written.
const shown = computed(() => shadow.value ?? DEFAULT_SHADOW)
const percent = computed(() => Math.round(shown.value.opacity * 100))
const offsets = [
  { key: 'x', label: 'X', limits: SHADOW_LIMITS.x },
  { key: 'y', label: 'Y', limits: SHADOW_LIMITS.y },
  { key: 'blur', label: 'Размытие', limits: SHADOW_LIMITS.blur },
] as const

function isOpen(): boolean {
  return panel.value?.matches(':popover-open') ?? false
}

// Measured after showPopover(): a hidden popover has no size.
function open(anchor: Element) {
  const el = panel.value
  if (!el) return
  if (!isOpen()) el.showPopover()
  const { left, top } = panelPosition(anchor.getBoundingClientRect(), el.getBoundingClientRect(), {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

function close() {
  if (isOpen()) panel.value?.hidePopover()
}

function onToggle(event: ToggleEvent) {
  const opened = event.newState === 'open'
  if (opened) panel.value?.querySelector<HTMLElement>('select')?.focus()
  emit('toggle', opened)
}

const valueOf = (event: Event) => (event.target as HTMLInputElement | HTMLSelectElement).value

function setStyle(event: Event) {
  emit('change', withStyle(props.appearance, valueOf(event)))
}

function setShadowOn(event: Event) {
  emit('change', withShadow(props.appearance, (event.target as HTMLInputElement).checked ? DEFAULT_SHADOW : null))
}

function setShadow<K extends keyof DropShadow>(key: K, value: DropShadow[K]) {
  if (shadow.value) emit('change', withShadow(props.appearance, { ...shadow.value, [key]: value }))
}

defineExpose({ open, close, isOpen })
</script>

<template>
  <div ref="panelBox" popover="auto" role="dialog" aria-label="Настройки виджета" class="settings" @toggle="onToggle">
    <label class="settings__row">
      <span class="settings__label">Стиль</span>
      <select class="settings__control" :value="styleValue(appearance)" @change="setStyle">
        <option value="">Как у доски</option>
        <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
        <option :value="BARE_THEME_ID">Без оформления</option>
      </select>
    </label>
    <label class="settings__row">
      <span class="settings__label">Тень</span>
      <input type="checkbox" :checked="shadow !== null" @change="setShadowOn" />
    </label>
    <label v-for="item in offsets" :key="item.key" class="settings__row">
      <span class="settings__label">{{ item.label }}</span>
      <input
        type="range"
        class="settings__control"
        :min="item.limits[0]"
        :max="item.limits[1]"
        step="1"
        :value="shown[item.key]"
        :disabled="!shadow"
        @input="setShadow(item.key, Number(valueOf($event)))"
      />
      <output class="settings__value">{{ shown[item.key] }} px</output>
    </label>
    <label class="settings__row">
      <span class="settings__label">Цвет</span>
      <input type="color" :value="shown.color" :disabled="!shadow" @input="setShadow('color', valueOf($event))" />
    </label>
    <label class="settings__row">
      <span class="settings__label">Непрозрачность</span>
      <input
        type="range"
        class="settings__control"
        min="0"
        max="100"
        step="1"
        :value="percent"
        :disabled="!shadow"
        @input="setShadow('opacity', Number(valueOf($event)) / 100)"
      />
      <output class="settings__value">{{ percent }} %</output>
    </label>
    <button type="button" class="settings__reset" @click="emit('change', null)">Сбросить</button>
  </div>
</template>

<style scoped>
/* The UA centres a popover (inset: 0; margin: auto); open() sets left and top. A hidden popover keeps
   the UA display: none, so display is set only while open. */
.settings {
  position: fixed;
  inset: auto;
  margin: 0;
  width: 18rem;
  padding: 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-2);
  color: var(--ld-text-primary);
  box-shadow: var(--ld-shadow-raised, none);
  font: inherit;
}

.settings:popover-open {
  display: grid;
  gap: 0.5rem;
}

.settings__row {
  display: grid;
  grid-template-columns: 7rem 1fr 3rem;
  align-items: center;
  gap: 0.5rem;
}

.settings__label {
  color: var(--ld-text-secondary);
}

.settings__control {
  min-width: 0;
}

.settings__value {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.settings__reset {
  justify-self: start;
  padding: 0.25rem 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.settings select:focus-visible,
.settings input:focus-visible,
.settings__reset:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
```

- [ ] **Step 4: Wire the gear and the panel into `WidgetBoard.vue`**

Script changes:

1. Imports:

```ts
import type { ScreenBoard, WidgetAppearance, WidgetInstance, WidgetSource } from '@lifedashboard/contracts/board'
```

```ts
import { focusAfterRemoval, isSameBoard, readingOrder, removeInstance, setAppearance, setPlacement, withRows, type BoardMode } from './edit-session'
```

```ts
import WidgetSettings from './WidgetSettings.vue'
```

2. After the `draftEl` template ref, add:

```ts
const settings = useTemplateRef<InstanceType<typeof WidgetSettings>>('settingsPanel')
// The widget the settings panel edits; kept after the panel closes, so its gear can take focus back.
const settingsId = ref<string | null>(null)
// Mirrors the popover for aria-expanded; logic asks settings.value.isOpen(), which is synchronous.
const settingsOpen = ref(false)
// Board-caused closes (widget removed, mode left, save started) keep the board's own focus rules.
let boardClosing = false
// Light dismiss closes the panel on pointerup, before the gear's click; this is its state at pointerdown.
let openAtPress: boolean | null = null
```

3. After `removeWidget`, add:

```ts
function gearOf(id: string) {
  return gridEl.value?.querySelector<HTMLElement>(`[data-settings="${CSS.escape(id)}"]`) ?? null
}

function isSettingsOpenFor(id: string) {
  return settings.value?.isOpen() === true && settingsId.value === id
}

function pressGear(id: string) {
  openAtPress = isSettingsOpenFor(id)
}

// The same gear closes its panel; another gear moves the panel to its widget.
function toggleSettings(event: MouseEvent, id: string) {
  // detail 0: a keyboard click, no pointerdown before it.
  const wasOpen = event.detail > 0 && openAtPress !== null ? openAtPress : isSettingsOpenFor(id)
  openAtPress = null
  select(id)
  if (wasOpen) {
    settings.value?.close()
    return
  }
  settingsId.value = id
  const gear = gearOf(id)
  if (gear) settings.value?.open(gear)
}

function onSettingsToggle(open: boolean) {
  settingsOpen.value = open
  const byBoard = boardClosing
  boardClosing = false
  if (open || byBoard || !settingsId.value) return
  // Esc, light dismiss or the gear: focus goes back to the gear, unless the user already moved it
  // to another element (clicking another widget focuses that widget).
  const focus = document.activeElement
  if (!focus || focus === document.body || settings.value?.$el.contains(focus)) gearOf(settingsId.value)?.focus()
}

function changeAppearance(next: WidgetAppearance | null) {
  if (editing.value && !saving.value && settingsId.value) working.value = setAppearance(working.value, settingsId.value, next)
}

const settingsInstance = computed(() => working.value.instances.find((item) => item.id === settingsId.value))

// The panel closes with its widget, when the mode leaves edit and when a save starts.
watch(
  () => editing.value && !saving.value && settingsInstance.value !== undefined,
  (keep) => {
    if (keep || !settings.value?.isOpen()) return
    boardClosing = true
    settings.value.close()
  },
)
```

4. `onKeydown`: make the panel guard the first statement, without `preventDefault` (a cancelled Escape keydown would stop the native popover close):

```ts
function onKeydown(event: KeyboardEvent) {
  // The open panel owns the keyboard: Esc closes only it (native), Backspace never deletes, Enter never confirms.
  if (settings.value?.isOpen()) return
  if (saving.value || mode.value === 'view' || isFormControlTarget(event.target)) return
```

(the rest of the function stays as it is).

Template changes:

5. After the `board__remove` button inside `.board__item`, add:

```vue
        <button
          v-if="editing"
          type="button"
          class="board__settings"
          :data-settings="instance.id"
          aria-label="Настройки виджета"
          :aria-expanded="settingsOpen && settingsId === instance.id"
          @pointerdown.stop="pressGear(instance.id)"
          @click="toggleSettings($event, instance.id)"
        >
          ⚙
        </button>
```

6. After the closing `</div>` of `.board__grid` (a sibling of the grid, so `inert` while saving never applies to it and the grid's pointer handlers never see it), before `<p class="board__live" …>`:

```vue
    <WidgetSettings
      ref="settingsPanel"
      :appearance="settingsInstance?.appearance"
      @change="changeAppearance"
      @toggle="onSettingsToggle"
    />
```

Style changes (`<style scoped>`):

7. Focus ring: change the selector list

```css
.board__draft:focus-visible,
.board__item--editable:focus-visible,
.board__remove:focus-visible {
```

to

```css
.board__draft:focus-visible,
.board__item--editable:focus-visible,
.board__remove:focus-visible,
.board__settings:focus-visible {
```

and `.board__remove:focus-visible { outline-offset: 0.125rem; }` to

```css
.board__remove:focus-visible,
.board__settings:focus-visible {
  outline-offset: 0.125rem;
}
```

8. Share the button look: change `.board__remove {` to

```css
.board__remove,
.board__settings {
```

and add right after that block:

```css
.board__settings {
  right: 2rem;
}
```

9. Replace the visibility rule with:

```css
.board__item:hover .board__remove,
.board__item:focus-within .board__remove,
.board__item:hover .board__settings,
.board__item:focus-within .board__settings,
.board__settings[aria-expanded='true'] {
  opacity: 1;
}
```

(focus moves into the panel, so the item loses `:focus-within`; the gear of the open panel stays visible).

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm -C apps/ui test && pnpm -r typecheck`
Expected: PASS, no type errors. If `vue-tsc` rejects the `popover` attribute or `@toggle="onToggle"`, fix the typing (e.g. `(event: Event) => … (event as ToggleEvent)`), not by disabling checks.

- [ ] **Step 6: Commit**

```bash
git add apps/ui/app/board/WidgetSettings.vue apps/ui/app/board/WidgetBoard.vue apps/ui/test/theme-contract.test.ts
git commit -m "feat(ui): widget settings panel behind a gear in edit mode"
```

---

### Task 7: Full verification and browser acceptance

**Files:** none changed unless a check fails (then fix in the owning task's files, with a failing test first where the logic is unit-testable).

- [ ] **Step 1: Run the whole suite and typecheck**

Run: `pnpm -r typecheck && pnpm test`
Expected: every package PASS.

- [ ] **Step 2: Build the sandbox example and start the app on an empty data directory**

```bash
pnpm -C examples/widgets/hello build
export LIFEDASHBOARD_DATA_DIR="$(mktemp -d)"
pnpm dev
```

Expected: `examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0.ldwidget.json` exists (`dist/` is git-ignored). Run `pnpm dev` in a background terminal; note the pairing code and `LIFEDASHBOARD_DATA_DIR`.

- [ ] **Step 3: Browser acceptance in Orca's built-in browser**

Load the `orca-cli` skill and control Orca's built-in browser through `orca` (project rule: no external browser). Open `http://127.0.0.1:3000`, pair, set the header «Тема» to Стекло. «Виджеты» → «Установить из файла» → `dev.lifedashboard.hello-1.0.0.ldwidget.json` → «Установить». Place the analog clock, a placeholder widget and «Привет», then check in order. Take a screenshot for checks 3–6.

Sandbox tokens: `SandboxWidget.vue` posts `context.theme.tokens` into the iframe, where `packages/widget-sdk/src/sandbox.ts` sets them on the frame's `documentElement.style`. The iframe is sandboxed (opaque origin), so read the host side instead: load the `vue-runtime-inspect` skill and read the `SandboxWidget` instance's `context.theme.tokens['--ld-surface-1']` prop for «Привет». Glass values: `surface-1` `oklch(1 0 0 / 0.08)`, `surface-1-solid` `oklch(0.27 0.03 280)`.

1. **Gear** — «Изменить»; hover the clock: «⚙» shows left of «×». Tab to a widget: both show on focus. Drag starting on «⚙» does not move the widget (acceptance 1).
2. **Open / close / switch** — click «⚙»: the panel opens beside the widget, inside the viewport, focus on «Стиль». Click the same «⚙» again: the panel closes and focus is on the gear (Review Focus 1). Open it, then click the other widget's «⚙»: the panel now edits that widget.
3. **Bare clock with a shadow** — clock: «Стиль» «Без оформления», «Тень» on, «Размытие» 24, «Y» 12: no card background, border or padding; the shadow is round and follows the dial (acceptance 3, 4). Change «Цвет» and «Непрозрачность»: the board updates on every change.
4. **Bare sandbox widget with a shadow** — «Привет»: «Без оформления», «Тень» on: the shadow follows its content (text and button), with no rectangular shadow from the iframe box. This settles the spec's «Unverified (inferred)» note; if the shadow is rectangular, report it as a finding instead of patching around it.
5. **Foreign widget** — placeholder: «Стиль» Бумага on the Glass board: it paints Paper's opaque sheet with readable text. Set the placeholder and «Привет» to Стекло and switch the header «Тема» to Бумага: both keep Glass and have `widget--foreign`; `getComputedStyle(<their .widget>).getPropertyValue('--ld-surface-1')` resolves to the opaque `surface-1-solid`, not the translucent white; «Привет»'s `context.theme.tokens['--ld-surface-1']` (see above) is `oklch(0.27 0.03 280)`. Switch the header back to Стекло: `widget--foreign` is gone and the token is `oklch(1 0 0 / 0.08)` again (acceptance 2; the end-to-end check of the Task 4 re-read).
6. **Keyboard with the panel open** — focus «Сбросить» or a slider, press Backspace: the widget stays. Press Enter on a slider: the board is not saved. Press Esc: only the panel closes, edit mode stays, focus is on the gear (acceptance 7, Review Focus 3).
7. **Cancel** — «Отмена» (or Esc with no panel open): the board returns to the saved look.
8. **Reset is a no-op** — «Изменить», on an unstyled widget set «Стиль» Бумага, then «Сбросить», then «Готово»: no `PUT /api/v1/rooms/…/board` in `orca` network output (Review Focus 4).
9. **Persist** — style the clock again (bare + shadow) and the placeholder (Бумага), «Готово», reload: both looks remain (acceptance 5). While saving, the panel is closed.
10. **Removal closes the panel** — «Изменить», open the panel of a widget, click its «×»: the panel closes and focus moves to the next widget (`focusAfterRemoval`); «Отмена».
11. **Old boards** (acceptance 6) — covered by the Task 2 tests (version 4 database, round-trip without the key); additionally confirm an untouched widget's `GET` JSON has no `appearance` key.

Expected: every check passes. Report each check with its result in the final report; mark anything not run as `unverified`.

- [ ] **Step 4: Commit fixes, if any**

Only if Step 3 required a fix:

```bash
git add <fixed files>
git commit -m "fix(ui): <what the browser check found>"
```
