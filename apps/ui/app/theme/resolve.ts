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
