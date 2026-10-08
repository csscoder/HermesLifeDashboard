import { describe, expect, it } from 'vitest'
import { findBuiltinWidget } from '../app/widgets/catalog'

describe('catalog', () => {
  it('re-exports the built-in manifests from contracts', () => {
    expect(findBuiltinWidget('placeholder')?.sizing).toEqual({
      default: { w: 4, h: 4 },
      min: { w: 1, h: 1 },
      max: { w: 12, h: 8 },
    })
    expect(findBuiltinWidget('toString')).toBeUndefined()
  })
})
