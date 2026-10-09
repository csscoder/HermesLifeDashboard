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
