import { describe, expect, it } from 'vitest'
import { isFormControlTarget } from '../app/board/keyboard'

// Vitest runs in Node, so targets are plain objects with a tagName.
const target = (tagName: string) => ({ tagName }) as unknown as EventTarget

describe('isFormControlTarget', () => {
  it.each(['SELECT', 'INPUT', 'TEXTAREA'])('is true for %s', (tag) => {
    expect(isFormControlTarget(target(tag))).toBe(true)
  })

  it.each(['BUTTON', 'DIV', 'BODY'])('is false for %s', (tag) => {
    expect(isFormControlTarget(target(tag))).toBe(false)
  })

  it('is false without a target', () => {
    expect(isFormControlTarget(null)).toBe(false)
  })
})
