import { describe, expect, it } from 'vitest'
import { handAngles } from '../app/widgets/builtin/clocks/analog_1/clock-angles'

const at = (h: number, m: number, s: number) => new Date(2026, 9, 9, h, m, s)

describe('handAngles', () => {
  it('points the hands from 12 o’clock, clockwise in degrees', () => {
    expect(handAngles(at(3, 0, 0))).toEqual({ hour: 90, minute: 0, second: 0 })
    expect(handAngles(at(12, 30, 15))).toEqual({ hour: 15 + 15 / 120, minute: 180, second: 90 })
  })

  it('moves the minute hand once a minute and the hour hand every second', () => {
    expect(handAngles(at(9, 59, 59))).toEqual({ hour: 270 + 29.5 + 59 / 120, minute: 354, second: 354 })
  })

  it('goes forward across 59 → 0 instead of spinning back', () => {
    const before = handAngles(at(9, 59, 59))
    expect(handAngles(at(10, 0, 0), before)).toEqual({ hour: 300, minute: 360, second: 360 })
  })

  it('keeps turning forward past midnight', () => {
    const before = handAngles(at(23, 59, 59))
    const after = handAngles(at(0, 0, 0), before)
    expect(after.hour).toBe(360)
    expect(after.second).toBe(360)
  })

  it('takes the shortest way when the time jumps back', () => {
    const before = handAngles(at(10, 0, 30))
    expect(handAngles(at(10, 0, 20), before).second).toBe(120)
  })

  it('only turns forward when catching up after a hidden tab', () => {
    const before = handAngles(at(10, 0, 0))
    const after = handAngles(at(10, 40, 0), before, 'forward')
    expect(after.minute).toBe(240)
    expect(after.hour).toBe(320)
  })
})
