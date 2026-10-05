import { describe, expect, it } from 'vitest'
import { findManifest } from '../app/widgets/catalog'

describe('catalog', () => {
  it('describes the placeholder and nothing else', () => {
    expect(findManifest('placeholder')?.sizing).toEqual({
      default: { w: 4, h: 4 },
      min: { w: 1, h: 1 },
      max: { w: 12, h: 8 },
    })
    expect(findManifest('toString')).toBeUndefined()
  })
})
