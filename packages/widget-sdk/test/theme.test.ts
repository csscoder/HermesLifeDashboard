import { describe, expect, it } from 'vitest'
import { applyTokens } from '../src/theme.ts'

describe('applyTokens', () => {
  it('sets custom properties and removes the ones the new theme lacks', () => {
    const props = new Map<string, string>()
    const style = {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => props.delete(name),
    }
    const applied = applyTokens(style, [], { '--ld-bg': '#000', '--ld-glow': 'red', color: 'blue' })
    expect(applied).toEqual(['--ld-bg', '--ld-glow'])
    expect([...props]).toEqual([['--ld-bg', '#000'], ['--ld-glow', 'red']])
    applyTokens(style, applied, { '--ld-bg': '#fff' })
    expect([...props]).toEqual([['--ld-bg', '#fff']])
  })
})
