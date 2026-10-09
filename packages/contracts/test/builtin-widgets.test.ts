import { describe, expect, it } from 'vitest'
import { BUILTIN_WIDGETS, findBuiltinWidget } from '../src/builtin-widgets.ts'

describe('builtin widgets', () => {
  it('describes the placeholder without permissions', () => {
    expect(BUILTIN_WIDGETS.map((manifest) => manifest.type)).toEqual(['placeholder', 'clock-analog-1'])
    expect(findBuiltinWidget('placeholder')).toEqual({
      type: 'placeholder',
      title: 'Заглушка',
      sizing: { default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 24, h: 100 } },
      permissions: [],
    })
  })

  it('describes the analog clock as a square widget without permissions', () => {
    expect(findBuiltinWidget('clock-analog-1')).toEqual({
      type: 'clock-analog-1',
      title: 'Часы: лес',
      sizing: { default: { w: 6, h: 6 }, min: { w: 4, h: 4 }, max: { w: 16, h: 16 } },
      permissions: [],
    })
  })

  it('never resolves prototype members', () => {
    expect(findBuiltinWidget('toString')).toBeUndefined()
    expect(findBuiltinWidget('constructor')).toBeUndefined()
  })
})
