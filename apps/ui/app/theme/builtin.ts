import type { ThemeMeta } from './contract'

export const DEFAULT_THEME_ID = 'builtin:glass'

// The CSS of each theme is styles/themes/<name>.css; styles/layers.css imports it into ld.theme.
export const BUILTIN_THEMES: readonly ThemeMeta[] = [
  { id: 'builtin:glass', name: 'Стекло', mode: 'dark', skin: 'glass' },
  { id: 'builtin:obsidian', name: 'Обсидиан', mode: 'dark', skin: 'solid' },
  { id: 'builtin:paper', name: 'Бумага', mode: 'light', skin: 'paper' },
]

const byId = new Map(BUILTIN_THEMES.map((theme) => [theme.id, theme]))

export const BUILTIN_THEME_IDS: ReadonlySet<string> = new Set(byId.keys())

/** Metadata for an id from resolveThemeId; any other id gets the default theme. */
export function themeMeta(id: string): ThemeMeta {
  return byId.get(id) ?? byId.get(DEFAULT_THEME_ID)!
}
