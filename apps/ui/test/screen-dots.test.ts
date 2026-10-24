import { nextTick } from 'vue'
import * as boardContracts from '@lifedashboard/contracts/board'
import * as mediaApi from '../app/background/media-api'
import { probeMedia } from '../app/background/import-media'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_THEMES } from '../app/theme/builtin'
import { compileSfc, mountComponent, unmountComponents } from './helpers/sfc-renderer'

const editor = compileSfc(new URL('../app/background/BackgroundEditor.vue', import.meta.url), {
  '@lifedashboard/contracts/board': boardContracts, './media-api': mediaApi, './import-media': { probeMedia },
})
let resized: () => void
const component = compileSfc(new URL('../app/spaces/ScreenDots.vue', import.meta.url), {
  '../theme/builtin': { BUILTIN_THEMES },
  '../background/BackgroundEditor.vue': { __esModule: true, default: editor },
})
beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} })
  vi.stubGlobal('fetch', async () => Response.json({ data: { id: 'id', name: 'Video.mp4', size: 128, mime: 'video/mp4' } }))
})
afterEach(() => { unmountComponents(); vi.unstubAllGlobals() })
function mount(overrides: Record<string, unknown> = {}) {
  return mountComponent(component, { count: 3, index: 1, editing: true, disabled: false, canAdd: true, canRemove: true, removeTitle: '', themeId: null, background: null, screenKey: 'space:screen', ...overrides }, ['go', 'add', 'remove', 'theme', 'background'])
}
function open(ui: ReturnType<typeof mount>) {
  const panel = ui.panel()
  expect(panel).toBeDefined()
  panel.open = true
  panel.rect = { left: 0, top: 0, width: 320, height: 200 }
  const active = ui.nodes().find(el => String(el.props.class).includes('dots__item--on'))!
  active.rect = { left: 400, top: 700, width: 40, height: 24 }
  panel.props.onToggle({ newState: 'open' })
  return panel
}

describe('screen settings popover', () => {
  it('offers a gear only for the active screen in edit mode', async () => {
    const ui = mount()
    expect(ui.button('Настройки экрана 2')).toBeDefined()
    expect(ui.button('Настройки экрана 1')).toBeUndefined()
    ui.props.index = 0; await nextTick()
    expect(ui.button('Настройки экрана 1')).toBeDefined()
    expect(ui.button('Настройки экрана 2')).toBeUndefined()
    ui.props.editing = false; await nextTick()
    expect(ui.button('Настройки экрана 1')).toBeUndefined()
  })

  it('anchors the panel above the active bullet and focuses its theme selector', () => {
    const ui = mount(), panel = open(ui)
    expect(panel.style.left).toBe('260px')
    expect(panel.style.top).toBe('492px')
    expect(ui.nodes().find(el => el.tag === 'select')?.focused).toBe(true)
  })

  it('selects an explicit theme or inheritance without deleting or navigating', () => {
    const ui = mount({ themeId: 'builtin:paper' })
    const picker = ui.nodes().find(el => el.props['aria-label'] === 'Тема экрана')
    expect(picker).toBeDefined()
    expect(picker!.props.value).toBe('builtin:paper')
    picker!.props.onChange({ target: { value: 'builtin:glass' } })
    picker!.props.onChange({ target: { value: '' } })
    expect(ui.events).toEqual([['theme', 'builtin:glass'], ['theme', null]])
  })

  it('closes the shared panel before requesting deletion', () => {
    const ui = mount(), panel = open(ui)
    ui.button('Удалить экран').props.onClick()
    expect(panel.open).toBe(false)
    expect(ui.events).toEqual([['remove']])
  })

  it('protects the final space and explains the disabled delete', () => {
    const ui = mount({ count: 1, index: 0, canRemove: false, removeTitle: 'Последнее пространство удалить нельзя' })
    expect(ui.button('Настройки экрана 1')).toBeDefined()
    expect(ui.button('Удалить пространство')?.props.disabled).toBe(true)
    expect(ui.button('Удалить пространство')?.props.title).toBe('Последнее пространство удалить нельзя')
  })

  it.each([{ editing: false }, { disabled: true }, { index: 2 }, { count: 4 }])('closes when its screen context changes: %o', async (change) => {
    const ui = mount(), panel = open(ui)
    Object.assign(ui.props, change); await nextTick()
    expect(panel.open).toBe(false)
  })

  it('allows the panel to scroll but closes when its anchor scrolls or the viewport resizes', () => {
    const ui = mount(), panel = open(ui)
    const calls = vi.mocked(window.addEventListener).mock.calls
    const scroll = calls.find(([name]) => name === 'scroll')![1] as (event: { target: unknown }) => void
    scroll({ target: panel })
    expect(panel.open).toBe(true)
    scroll({ target: {} })
    expect(panel.open).toBe(false)
    open(ui)
    const resize = calls.find(([name]) => name === 'resize')![1] as () => void
    resize()
    expect(panel.open).toBe(false)
  })

  it('keeps Escape on the gear from cancelling the board while its popover is open', () => {
    const ui = mount(); open(ui)
    const event = { key: 'Escape', cancelBubble: false, stopPropagation() { this.cancelBubble = true } }
    for (let target = ui.button('Настройки экрана 2'); target && !event.cancelBubble; target = target.parent!)
      target.props.onKeydown?.(event)
    expect(event.cancelBubble).toBe(true)
  })

  it('routes independent background controls through the same screen panel', () => {
    const background = boardContracts.defaultBackground('00000000-0000-4000-8000-00000000000a')
    const ui = mount({ background })
    const videoOpacity = ui.nodes().find(el => el.props['aria-label'] === 'Прозрачность видео')
    expect(videoOpacity).toBeDefined()
    videoOpacity!.props.onInput({ target: { value: '40' } })
    expect(ui.events).toEqual([['background', { ...background, opacity: 0.4 }]])
  })

  it('keeps a growing background editor above its anchor', () => {
    const ui = mount(), panel = open(ui)
    panel.rect.height = 400
    expect(resized).toBeTypeOf('function')
    resized()
    expect(panel.style.top).toBe('292px')
    expect(panel.style.left).toBe('260px')
  })

  it('keeps board shortcuts out of the popover without preventing native Escape', () => {
    const ui = mount(), panel = open(ui)
    const event = { stopPropagation: vi.fn(), preventDefault: vi.fn() }
    panel.props.onKeydown(event)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
