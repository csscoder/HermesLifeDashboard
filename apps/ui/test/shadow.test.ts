import { DEFAULT_SHADOW, type DropShadow } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { shadowCss } from '../app/theme/shadow'

describe('shadowCss', () => {
  it('formats the default shadow', () => {
    expect(shadowCss(DEFAULT_SHADOW)).toBe('0px 8px 16px rgb(0 0 0 / 0.5)')
  })

  it('converts any-case hex to rgb channels and keeps negative offsets', () => {
    expect(shadowCss({ x: -4, y: 2, blur: 0, color: '#FF8000', opacity: 1 })).toBe('-4px 2px 0px rgb(255 128 0 / 1)')
    expect(shadowCss({ x: 0, y: 0, blur: 48, color: '#0a1b2c', opacity: 0 })).toBe('0px 0px 48px rgb(10 27 44 / 0)')
  })

  it('turns a tampered string or non-finite number into 0, never into CSS', () => {
    const tampered = { x: '1px) url(x', y: Number.NaN, blur: Number.POSITIVE_INFINITY, color: '#000000', opacity: 'a;b' } as unknown as DropShadow
    expect(shadowCss(tampered)).toBe('0px 0px 0px rgb(0 0 0 / 0)')
  })

  it('turns a malformed colour into black channels', () => {
    expect(shadowCss({ x: 0, y: 0, blur: 0, color: 'red', opacity: 1 })).toBe('0px 0px 0px rgb(0 0 0 / 1)')
  })
})
