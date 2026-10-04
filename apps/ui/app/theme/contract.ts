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
