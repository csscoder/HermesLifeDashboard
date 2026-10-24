import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileSfc, mountComponent, unmountComponents } from './helpers/sfc-renderer'

const background = { kind: 'video', mediaId: '00000000-0000-4000-8000-000000000001', opacity: 1, dim: .35, pattern: { shape: 'none', color: '#000000', opacity: .25, scale: 1 } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await nextTick() }
function setup() {
  const renderer = { setBackground: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() }
  const create = vi.fn().mockResolvedValue(renderer)
  const component = compileSfc(new URL('../app/background/PixiBackground.vue', import.meta.url), {
    './renderer': { createBackgroundRenderer: create },
  })
  return { renderer, create, component }
}
afterEach(unmountComponents)

describe('Pixi background host', () => {
  it('does not allocate Pixi for theme-only screens and forwards the latest background after initialization', async () => {
    const { component, create, renderer } = setup()
    let finish!: (value: typeof renderer) => void
    create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const ui = mountComponent(component, { background: null }, ['error'])
    await flush(); expect(create).not.toHaveBeenCalled()
    ui.props.background = background; await flush()
    expect(create).toHaveBeenCalledTimes(1)
    ui.props.background = { ...background, kind: 'image', opacity: .2 }; await flush()
    finish(renderer); await flush()
    expect(renderer.setBackground).toHaveBeenCalledWith({ ...background, kind: 'image', opacity: .2 })
    expect(ui.nodes().find(node => node.props['aria-hidden'] === 'true')).toBeDefined()
    ui.props.background = null; await flush()
    expect(renderer.setBackground).toHaveBeenLastCalledWith(null)
  })

  it('switches screens immediately while the preceding video is still loading', async () => {
    const { component, renderer } = setup()
    let finish!: () => void
    renderer.setBackground.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const ui = mountComponent(component, { background }, ['error'])
    await flush()
    ui.props.background = { ...background, mediaId: '00000000-0000-4000-8000-000000000002' }
    await flush()
    expect(renderer.setBackground).toHaveBeenLastCalledWith(ui.props.background)
    finish(); await flush()
  })

  it('destroys an asynchronously initialized renderer when its component already unmounted', async () => {
    const { component, create, renderer } = setup()
    let finish!: (value: typeof renderer) => void
    create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const ui = mountComponent(component, { background }, ['error'])
    await flush(); unmountComponents()
    finish(renderer); await flush()
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
    expect(renderer.setBackground).not.toHaveBeenCalled()
    expect(ui.events).toEqual([])
  })

  it('emits a visible failure for rejected initialization, then retries on a later background', async () => {
    const { component, create, renderer } = setup()
    create.mockRejectedValueOnce(new Error('WebGL unavailable'))
    const ui = mountComponent(component, { background }, ['error'])
    await flush()
    expect(ui.events).toEqual([['error', expect.any(String)]])
    ui.props.background = { ...background, mediaId: '00000000-0000-4000-8000-000000000002' }
    await flush()
    expect(renderer.setBackground).toHaveBeenCalledWith(ui.props.background)
  })

  it('forwards runtime errors and releases the single renderer on unmount', async () => {
    const { component, create, renderer } = setup()
    const ui = mountComponent(component, { background }, ['error'])
    await flush()
    const report = create.mock.calls[0]![1] as (message: string | null) => void
    report('decode failed'); report(null)
    expect(ui.events).toEqual([['error', 'decode failed'], ['error', null]])
    unmountComponents(); report('late failure')
    expect(ui.events).toHaveLength(2)
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
  })
})
