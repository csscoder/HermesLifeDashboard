export interface HandAngles {
  hour: number
  minute: number
  second: number
}

/** `shortest` follows clock changes both ways; `forward` catches up after a hidden tab. */
export type Turn = 'shortest' | 'forward'

// Signed turn from a to b: in (-180, 180] when shortest, in [0, 360) when forward.
const turn = (from: number, to: number, way: Turn) => {
  const delta = (((to - from) % 360) + 360) % 360
  return way === 'shortest' && delta > 180 ? delta - 360 : delta
}

/**
 * Hand rotations in degrees clockwise from 12. The minute hand moves once a minute, the hour hand
 * every second. With `prev` the angles keep accumulating, so 59 → 0 tweens forward, not 354° back.
 */
export function handAngles(date: Date, prev?: HandAngles, way: Turn = 'shortest'): HandAngles {
  const s = date.getSeconds()
  const m = date.getMinutes()
  const raw = { hour: (date.getHours() % 12) * 30 + m / 2 + s / 120, minute: m * 6, second: s * 6 }
  if (!prev) return raw
  return {
    hour: prev.hour + turn(prev.hour, raw.hour, way),
    minute: prev.minute + turn(prev.minute, raw.minute, way),
    second: prev.second + turn(prev.second, raw.second, way),
  }
}
