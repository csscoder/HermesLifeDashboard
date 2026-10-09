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
 * Top-left of a fixed panel beside the widget: to its right, else to its left, `margin` inside the viewport.
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
