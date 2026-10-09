import type { DropShadow } from '@lifedashboard/contracts/board'

/** One shadow for both `box-shadow` and `drop-shadow()`: `<x>px <y>px <blur>px rgb(<r> <g> <b> / <opacity>)`. */
export function shadowCss({ x, y, blur, color, opacity }: DropShadow): string {
  const channel = (at: number) => Number.parseInt(color.slice(at, at + 2), 16)
  return `${x}px ${y}px ${blur}px rgb(${channel(1)} ${channel(3)} ${channel(5)} / ${opacity})`
}
