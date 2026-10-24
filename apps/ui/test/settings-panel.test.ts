import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '../app/theme/builtin'
import { GRID_COLS } from '@lifedashboard/contracts/grid'
import { compileSfc, mountComponent, type HostNode } from './helpers/sfc-renderer'

const component = compileSfc(new URL('../app/SettingsPanel.vue', import.meta.url), {
  './theme/builtin': { BUILTIN_THEMES }, '@lifedashboard/contracts/grid': { GRID_COLS },
})
function mount(overrides: Record<string, unknown> = {}) {
  return mountComponent(component, {
    entries: [{ key: 'builtin:placeholder', title: 'Заглушка', source: { kind: 'builtin', type: 'placeholder' } }],
    loaded: true, viewing: true, spaceTitle: 'Гараж', spaceIcon: '🧘', screenIndex: 1, screenCount: 3,
    rows: 12, themeId: 'builtin:glass', apiLabel: 'API: работает', apiDown: false, ...overrides,
  }, ['pick', 'edit', 'library', 'theme'])
}

describe('settings panel', () => {
  it('hands a selected widget to the board, resets the picker, and closes the panel', () => {
    const ui = mount()
    const picker = ui.nodes().find((el) => el.tag === 'select')
    expect(picker).toBeDefined()
    const panel = ui.panel(); panel.open = true
    const target = { value: 'builtin:placeholder' }
    picker!.props.onChange({ target })
    expect(ui.events).toEqual([['pick', 'builtin:placeholder']])
    expect(target.value).toBe('')
    expect(panel.open).toBe(false)
  })

  it('ignores empty or unknown picker values', () => {
    const ui = mount()
    const picker = ui.nodes().find((el) => el.tag === 'select')
    expect(picker).toBeDefined()
    for (const value of ['', 'missing']) picker!.props.onChange({ target: { value } })
    expect(ui.events).toEqual([])
  })

  it.each([['Изменить доску', 'edit'], ['Библиотека виджетов', 'library']])('closes before handing off %s', (label, event) => {
    const ui = mount()
    expect(ui.button(label)).toBeDefined()
    const panel = ui.panel(); panel.open = true
    ui.button(label).props.onClick()
    expect(ui.events).toEqual([[event]])
    expect(panel.open).toBe(false)
  })

  it.each([{ loaded: false }, { viewing: false }])('disables board actions when unavailable: %o', (props) => {
    const ui = mount(props)
    expect(ui.nodes().find((el) => el.tag === 'select')?.props.disabled).toBe(true)
    expect(ui.button('Изменить доску')?.props.disabled).toBe(true)
  })

  it('shows the selected theme and emits a theme choice without closing settings', () => {
    const ui = mount()
    expect(ui.button('Стекло')?.props['aria-pressed']).toBe(true)
    expect(ui.button('Бумага')?.props['aria-pressed']).toBe(false)
    const panel = ui.panel(); panel.open = true
    ui.button('Бумага').props.onClick()
    expect(ui.events).toEqual([['theme', 'builtin:paper']])
    expect(panel.open).toBe(true)
  })

  it.each(['Escape', 'ArrowRight', 'Enter'])('keeps %s inside open settings without preventing native keyboard behavior', async (key) => {
    const ui = mount({ viewing: false })
    ui.panel().props.onToggle({ newState: 'open' })
    await Vue.nextTick()
    const event = { key, cancelBubble: false, defaultPrevented: false,
      stopPropagation() { this.cancelBubble = true }, preventDefault() { this.defaultPrevented = true } }
    // Follow the rendered host ancestry as a keyboard event bubbles from a theme button.
    for (let target: HostNode | null = ui.button('Стекло'); target && !event.cancelBubble; target = target.parent)
      target.props.onKeydown?.(event)
    expect(event.cancelBubble).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })

  it('renders actual space, screen, grid and changing API status', async () => {
    const ui = mount()
    expect(ui.text()).toContain('Гараж')
    expect(ui.text()).toContain('Экран 2 из 3')
    expect(ui.text()).toContain('24 × 12')
    expect(ui.text()).toContain('API: работает')
    ui.props.apiLabel = 'API: недоступен'; ui.props.apiDown = true
    await Vue.nextTick()
    expect(ui.text()).toContain('API: недоступен')
    expect(ui.text()).not.toContain('API: работает')
  })
})


it('keeps screen-specific controls out of dashboard settings', () => {
  const ui = mount()
  expect(ui.nodes().some(el => el.props['aria-label'] === 'Тема экрана')).toBe(false)
})
