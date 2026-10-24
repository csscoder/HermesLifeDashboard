import { describe, expect, it } from 'vitest'
import { afterDelete, headerTitle } from '../app/spaces/nav'

describe('headerTitle', () => {
  it('omits the index for a single screen', () => {
    expect(headerTitle('Дом', 0, 1)).toBe('Дом')
  })

  it('adds the 1-based index when there are several screens', () => {
    expect(headerTitle('Дом', 1, 3)).toBe('Дом (2)')
    expect(headerTitle('Дом', 0, 2)).toBe('Дом (1)')
  })
})

describe('afterDelete', () => {
  it('returns the previous id for a middle or last delete', () => {
    expect(afterDelete(['a', 'b', 'c'], 'b')).toBe('a')
    expect(afterDelete(['a', 'b', 'c'], 'c')).toBe('b')
  })

  it('returns the next id when the first is deleted', () => {
    expect(afterDelete(['a', 'b', 'c'], 'a')).toBe('b')
  })

  it('returns null when the only id is deleted', () => {
    expect(afterDelete(['a'], 'a')).toBeNull()
  })
})
