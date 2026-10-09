import type { DropShadow } from '@lifedashboard/contracts/board'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Stored values reach CSS from outside the types: a non-finite number becomes 0, a malformed colour black. */
const finite = (value: number) => (Number.isFinite(Number(value)) ? Number(value) : 0)

/** One shadow for both `box-shadow` and `drop-shadow()`: `<x>px <y>px <blur>px rgb(<r> <g> <b> / <opacity>)`. */
export function shadowCss({ x, y, blur, color, opacity }: DropShadow): string {
  const hex = HEX_COLOR.test(color) ? color : '#000000'
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16)
  return `${finite(x)}px ${finite(y)}px ${finite(blur)}px rgb(${channel(1)} ${channel(3)} ${channel(5)} / ${finite(opacity)})`
}
