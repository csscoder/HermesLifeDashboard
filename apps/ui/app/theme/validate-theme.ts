import postcss, { type Declaration, type Root } from 'postcss'
import { composite, contrastRatio, parseColor, toRgba, type Rgba } from './color'
import { OPAQUE_TOKENS, OPTIONAL_TOKENS, REQUIRED_TOKENS, STATUSES, type ThemeMode, type TokenSpec } from './contract'

export interface ThemeError {
  rule: string
  message: string
}
export type ThemeValidation = { ok: true } | { ok: false; errors: ThemeError[] }

const TOKENS: Readonly<Record<string, TokenSpec>> = { ...REQUIRED_TOKENS, ...OPTIONAL_TOKENS }
const FORBIDDEN = /url\(|image-set\(|attr\(|expression|!\s*important/i
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
    if (node.important) return fail('forbidden', '!important is not allowed')
    decls.push(node)
  }
  const values = new Map<string, string>()
  for (const decl of decls) {
    if (decl.prop === 'color-scheme') {
      if (decl.value !== mode) errors.push({ rule: 'color-scheme', message: `color-scheme must be "${mode}"` })
      continue
    }
    const name = decl.prop.startsWith('--ld-') ? decl.prop.slice('--ld-'.length) : null
    if (name === null || !Object.hasOwn(TOKENS, name)) {
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
