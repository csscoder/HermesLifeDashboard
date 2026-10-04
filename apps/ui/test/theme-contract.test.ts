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
    ['a prototype property token', base.replace(/}\s*$/, '--ld-constructor: 1;\n}'), 'unknown-property', /--ld-constructor is not a contract token/],
    ['a non-token property', base.replace(/}\s*$/, 'opacity: 0;\n}'), 'unknown-property', /opacity is not a contract token/],
    ['a url()', withToken(base, 'backdrop', 'url(https://example.com/a.png)'), 'forbidden', /url\(\)/],
    ['!important', withToken(base, 'bg', 'oklch(0.16 0.005 260) !important'), 'forbidden', /!important/],
    ['!important with whitespace', withToken(base, 'bg', 'oklch(0.16 0.005 260) ! important'), 'forbidden', /!important/],
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
