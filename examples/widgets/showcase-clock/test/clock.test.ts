import { describe, expect, it } from 'vitest'
import { handAngles } from '../src/clock.ts'

describe('handAngles', () => {
  it('carries seconds into the minute and hour hands', () => {
    const angles = handAngles(new Date(2026, 9, 22, 6, 15, 30))
    expect(angles).toEqual({ hour: 187.75, minute: 93, second: 180 })
  })

  it('normalizes afternoon hours to a twelve-hour dial', () => {
    expect(handAngles(new Date(2026, 9, 22, 15, 0, 0))).toEqual({ hour: 90, minute: 0, second: 0 })
    expect(handAngles(new Date(2026, 9, 23, 0, 0, 0))).toEqual({ hour: 0, minute: 0, second: 0 })
  })

  it('uses milliseconds for a smooth sweep', () => {
    const angles = handAngles(new Date(2026, 9, 22, 12, 0, 0, 500))
    expect(angles.hour).toBeCloseTo(0.0041666667, 8)
    expect(angles.minute).toBeCloseTo(0.05, 8)
    expect(angles.second).toBe(3)
  })

  it('uses whole-second ticks for reduced motion', () => {
    expect(handAngles(new Date(2026, 9, 22, 6, 15, 30, 900), false)).toEqual({ hour: 187.75, minute: 93, second: 180 })
  })
})
