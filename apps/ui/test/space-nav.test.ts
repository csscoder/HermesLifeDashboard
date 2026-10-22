import type { ScreenBoard, WidgetInstance } from '@lifedashboard/contracts/board'
import { describe, expect, it } from 'vitest'
import { afterDelete, headerTitle, needsDeleteConfirm } from '../app/spaces/nav'

const instance = { id: 'w1' } as WidgetInstance

function screen(instances: WidgetInstance[]): ScreenBoard {
  return { id: 's1', rows: 12, instances, layout: [] }
}

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

describe('needsDeleteConfirm', () => {
  it('asks when the saved screen still has widgets', () => {
    expect(needsDeleteConfirm(screen([instance]), screen([]))).toBe(true)
  })

  it('asks when the working copy has widgets', () => {
    expect(needsDeleteConfirm(screen([]), screen([instance]))).toBe(true)
  })

  it('does not ask for an empty screen with no working copy', () => {
    expect(needsDeleteConfirm(screen([]), null)).toBe(false)
  })
})
