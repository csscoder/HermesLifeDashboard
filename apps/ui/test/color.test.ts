import { describe, expect, it } from 'vitest'
import { composite, contrastRatio, parseColor, toRgba, type Rgba } from '../app/theme/color'

const rgb = (r: number, g: number, b: number): Rgba => ({ r: r / 255, g: g / 255, b: b / 255, alpha: 1 })

describe('parseColor', () => {
  it.each([
    ['oklch(0.5 0.1 200)', { l: 0.5, c: 0.1, h: 200, alpha: 1 }],
    ['oklch(50% 0.1 200 / 0.5)', { l: 0.5, c: 0.1, h: 200, alpha: 0.5 }],
    ['oklch(0.5 0.1 200deg / 50%)', { l: 0.5, c: 0.1, h: 200, alpha: 0.5 }],
    ['transparent', { l: 0, c: 0, h: 0, alpha: 0 }],
  ])('parses %s', (value, expected) => {
    expect(parseColor(value)).toEqual(expected)
  })

  it.each([
    '#fff',
    'rgb(0 0 0)',
    'oklch(1.2 0 0)',
    'oklch(0.5 0.1)',
    'oklch(0.5 0.1 200 / 2)',
    'var(--x)',
    `oklch(0.5 ${'9'.repeat(400)} 200)`, // overflows to Infinity
    `oklch(0.5 0.1 ${'9'.repeat(400)})`,
  ])(
    'rejects %s',
    (value) => {
      expect(parseColor(value)).toBeNull()
    },
  )
})

describe('toRgba', () => {
  it('maps oklch white and black to sRGB white and black', () => {
    const white = toRgba(parseColor('oklch(1 0 0)')!)
    const black = toRgba(parseColor('oklch(0 0 0)')!)
    expect([white.r, white.g, white.b]).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6), expect.closeTo(1, 6)])
    expect([black.r, black.g, black.b]).toEqual([0, 0, 0])
  })

  it('maps the oklch value of sRGB red back to red', () => {
    const red = toRgba(parseColor('oklch(0.627955 0.257683 29.2339)')!)
    expect(red.r).toBeCloseTo(1, 3)
    expect(red.g).toBeCloseTo(0, 3)
    expect(red.b).toBeCloseTo(0, 3)
  })

  it('keeps channels finite for a huge finite hue', () => {
    const { r, g, b } = toRgba(parseColor(`oklch(0.5 0.1 ${'9'.repeat(308)})`)!)
    expect([r, g, b].every(Number.isFinite)).toBe(true)
  })

  it('clips out-of-gamut channels to 0–1', () => {
    const { r, g, b } = toRgba(parseColor('oklch(0.7 0.4 150)')!)
    for (const channel of [r, g, b]) expect(channel).toBeGreaterThanOrEqual(0)
    for (const channel of [r, g, b]) expect(channel).toBeLessThanOrEqual(1)
  })
})

describe('composite', () => {
  it('blends half-transparent white over black to mid grey', () => {
    const result = composite({ r: 1, g: 1, b: 1, alpha: 0.5 }, rgb(0, 0, 0))
    expect(result).toEqual({ r: 0.5, g: 0.5, b: 0.5, alpha: 1 })
  })

  it('keeps an opaque top colour', () => {
    expect(composite(rgb(10, 20, 30), rgb(200, 200, 200))).toEqual(rgb(10, 20, 30))
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for equal colours', () => {
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21, 5)
    expect(contrastRatio(rgb(118, 118, 118), rgb(118, 118, 118))).toBe(1)
  })

  it('matches the WCAG value for #767676 on white', () => {
    expect(contrastRatio(rgb(118, 118, 118), rgb(255, 255, 255))).toBeCloseTo(4.54, 2)
  })

  it('is symmetric', () => {
    expect(contrastRatio(rgb(255, 255, 255), rgb(118, 118, 118))).toBe(contrastRatio(rgb(118, 118, 118), rgb(255, 255, 255)))
  })
})
