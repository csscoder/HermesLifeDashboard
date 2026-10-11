export type Layout = 'rail' | 'stacked'

export const RAIL_MIN_WIDTH = 7

/** Spec «Layout»: the rail needs room for two columns; narrower widgets stack. */
export function layoutFor(size: { w: number }): Layout {
  return size.w >= RAIL_MIN_WIDTH ? 'rail' : 'stacked'
}
