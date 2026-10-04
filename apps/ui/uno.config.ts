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
