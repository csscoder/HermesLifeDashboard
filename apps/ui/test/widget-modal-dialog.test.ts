import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick, ref } from 'vue'
import type { ModalRecord } from '@lifedashboard/widget-sdk/host'
import { compileSfc, mountComponent } from './helpers/sfc-renderer'

const url = new URL('../app/widgets/WidgetModal.vue', import.meta.url)
const WidgetModal = compileSfc(url, {})
const record = (title?: string): ModalRecord => ({ id: 'modal-1', owner: { runtimeId: 'runtime-1', widgetId: 'widget-1', hash: 'hash', packageId: 'pkg', version: '1.0.0', title: 'Package' }, input: { view: 'details', ...(title === undefined ? {} : { title }) }, state: 'open' })
const mount = (value: ModalRecord | null = record()) => mountComponent(WidgetModal, { record: value, error: null }, ['close', 'retry'])
const dialog = (ui: ReturnType<typeof mount>) => ui.nodes().find(node => node.tag === 'dialog')!
beforeEach(() => vi.stubGlobal('document', { activeElement: null, querySelector: () => null }))
afterEach(() => vi.unstubAllGlobals())

describe('WidgetModal', () => {
  it('opens a native modal dialog for a record and closes it for null', async () => {
    const ui = mount(); await nextTick()
    expect(dialog(ui).open).toBe(true)
    ui.props.record = null; await nextTick()
    expect(dialog(ui).open).toBe(false)
    expect(ui.events).toEqual([])
  })
  it('renders the package source and title as text', async () => {
    const ui = mount(record('<b>x</b>')); await nextTick()
    expect(ui.text()).toContain('Package')
    expect(ui.nodes().find(node => node.tag === 'h2')?.text).toBe('<b>x</b>')
    expect(ui.nodes().some(node => node.tag === 'b')).toBe(false)
    expect(dialog(ui).props['aria-labelledby']).toBe(ui.nodes().find(node => node.tag === 'h2')?.props.id)
  })
  it('falls back to the package title', () => {
    expect(mount().nodes().find(node => node.tag === 'h2')?.text).toBe('Package')
  })
  it('emits close once from the close button and from Escape', async () => {
    const ui = mount(); await nextTick()
    ui.button('Закрыть').props.onClick()
    ui.button('Закрыть').props.onClick()
    expect(ui.events).toEqual([['close', 'modal-1']])
    const other = mount(); await nextTick()
    const cancel = new Event('cancel', { cancelable: true })
    dialog(other).props.onCancel(cancel)
    dialog(other).props.onCancel(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(other.events).toEqual([['close', 'modal-1']])
  })
  it('ignores backdrop clicks', async () => {
    const ui = mount(); await nextTick()
    dialog(ui).props.onClick?.({ target: dialog(ui) })
    expect(dialog(ui).open).toBe(true)
    expect(ui.events).toEqual([])
  })
  it('applies the default dimensions', () => {
    // The custom renderer has no CSS layout engine; inspect the scoped layout contract.
    const css = readFileSync(url, 'utf8').split('<style scoped>')[1]!
    expect(css).toContain('width: min(1120px, calc(100vw - 48px))')
    expect(css).toContain('height: min(780px, calc(100vh - 48px))')
    expect(css).toMatch(/\.widget-modal__header\s*\{[^}]*flex-shrink: 0/s)
    expect(css).toMatch(/\.widget-modal__body\s*\{[^}]*flex: 1[^}]*min-height: 0/s)
  })
  it('shows loading, then error with retry and close', async () => {
    const ui = mount(); await nextTick()
    expect(ui.text()).toContain('Загрузка')
    ui.props.error = 'Connection failed'; await nextTick()
    expect(ui.text()).toContain('Connection failed')
    expect(ui.text()).not.toContain('Загрузка')
    ui.button('Повторить').props.onClick()
    expect(ui.events).toEqual([['retry', 'modal-1']])
    ui.button('Закрыть').props.onClick()
    expect(ui.events).toContainEqual(['close', 'modal-1'])
  })
  it('removes loading when the slotted sandbox reports ready', async () => {
    const ui = mountComponent({ render: () => h(WidgetModal, { record: record(), error: null }, { default: ({ ready }: { ready(): void }) => h('button', { onClick: ready }, 'Ready') }) }, {}, [])
    await nextTick()
    ui.button('Ready').props.onClick(); await nextTick()
    expect(ui.text()).not.toContain('Загрузка')
  })
  it('shows loading again when retrying a previously ready sandbox', async () => {
    const failure = ref<string | null>(null)
    const current = record()
    const ui = mountComponent({ render: () => h(WidgetModal, { record: current, error: failure.value }, { default: ({ ready }: { ready(): void }) => h('button', { onClick: ready }, 'Ready') }) }, {}, [])
    await nextTick()
    ui.button('Ready').props.onClick(); await nextTick()
    failure.value = 'Failed'; await nextTick()
    ui.button('Повторить').props.onClick()
    failure.value = null; await nextTick()
    expect(ui.text()).toContain('Загрузка')
  })
  it('marks the board inert while open and restores it on close', async () => {
    // showModal is the browser inertness boundary; this host only models openness.
    const origin = { isConnected: true, focus: vi.fn() }
    vi.stubGlobal('document', { activeElement: origin, querySelector: () => null })
    const ui = mount(); await nextTick()
    expect(dialog(ui).open).toBe(true)
    ui.props.record = null; await nextTick()
    expect(dialog(ui).open).toBe(false)
    expect(origin.focus).toHaveBeenCalledOnce()
  })
  it('moves focus into the dialog on open', async () => {
    const fallback = { focus: vi.fn() }
    const doc = { activeElement: { isConnected: false }, querySelector: vi.fn(() => fallback) }
    vi.stubGlobal('document', doc)
    const ui = mount(); await nextTick()
    expect(doc.activeElement).toBe(ui.button('Закрыть'))
    ui.props.record = null; await nextTick()
    expect(doc.querySelector).toHaveBeenCalledWith('[data-board-focus]')
    expect(fallback.focus).toHaveBeenCalledOnce()
  })
})
it('disables error retry during closing and refreshing including already queued handlers', async () => {
 const ui = mount(record()); ui.props.error = 'Failed'; await nextTick()
 const retry = ui.button('Повторить')
 for (const state of ['closing', 'refreshing'] as const) {
  ui.props.record = { ...record(), state }; await nextTick()
  const buttons = ui.nodes().filter(node => node.tag === 'button' && node.text === 'Повторить')
  expect(buttons.every(button => button.props.disabled === true)).toBe(true)
  retry.props.onClick()
  expect(ui.events).toEqual([])
 }
})
