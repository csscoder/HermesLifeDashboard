import { h, nextTick, ref } from 'vue'
import type { ModalRecord } from '@lifedashboard/widget-sdk/host'
import * as confirmationModule from '../app/confirmations'
import { compileSfc, mountComponent } from './helpers/sfc-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIRMATION_DIALOG_MS } from '@lifedashboard/contracts/widget-gateway'
import { cancelConfirmations, cancelSurfaceConfirmations, confirmations, requestConfirmation } from '../app/confirmations'

const note = { title: 'Hi', body: '' }

function ask(widgetId: string) {
  return requestConfirmation({ widgetId, title: 'Привет', op: 'notifications.send', input: note })
}

function queued(): string[] {
  return confirmations.value.map((item) => item.widgetId)
}

afterEach(() => {
  cancelConfirmations('a')
  cancelConfirmations('b')
  cancelConfirmations('w1')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('confirmations', () => {
  it('cancels only one surface', async () => {
    const card = requestConfirmation({ widgetId: 'w1', ownerId: 'c1', title: 'Card', op: 'notifications.send', input: note })
    const modal = requestConfirmation({ widgetId: 'w1', ownerId: 'm1', title: 'Modal', op: 'notifications.send', input: note })
    cancelSurfaceConfirmations('m1')
    expect(await modal).toBe('declined')
    expect(confirmations.value.map(item => item.ownerId)).toEqual(['c1'])
    confirmations.value[0]!.answer('approved')
    expect(await card).toBe('approved')
  })

  it('cancels every surface on widget removal', async () => {
    const card = requestConfirmation({ widgetId: 'w1', ownerId: 'c1', title: 'Card', op: 'notifications.send', input: note })
    const modal = requestConfirmation({ widgetId: 'w1', ownerId: 'm1', title: 'Modal', op: 'notifications.send', input: note })
    cancelConfirmations('w1')
    expect(await Promise.all([card, modal])).toEqual(['declined', 'declined'])
    expect(confirmations.value).toEqual([])
  })

  it('queues requests first in, first out', async () => {
    const first = ask('a')
    const second = ask('b')
    expect(queued()).toEqual(['a', 'b'])
    expect(confirmations.value[0]).toMatchObject({ widgetId: 'a', title: 'Привет', op: 'notifications.send', input: note })
    confirmations.value[0]!.answer('approved')
    expect(await first).toBe('approved')
    expect(queued()).toEqual(['b'])
    confirmations.value[0]!.answer('declined')
    expect(await second).toBe('declined')
    expect(confirmations.value).toEqual([])
  })

  it('lets the first answer win', async () => {
    const first = ask('a')
    ask('b')
    const head = confirmations.value[0]!
    head.answer('approved')
    head.answer('declined')
    expect(await first).toBe('approved')
    // A second answer to a settled entry never touches the next one.
    expect(queued()).toEqual(['b'])
  })

  it('cancels by widgetId and keeps another widget with the same title', async () => {
    const a = ask('a')
    ask('b')
    cancelConfirmations('a')
    expect(await a).toBe('declined')
    expect(queued()).toEqual(['b'])
  })

  it('expires each entry CONFIRMATION_DIALOG_MS after its request, shown or still queued', async () => {
    vi.useFakeTimers()
    const shown = ask('a')
    vi.advanceTimersByTime(1_000)
    const waiting = ask('b')
    vi.advanceTimersByTime(CONFIRMATION_DIALOG_MS - 1_001)
    expect(queued()).toEqual(['a', 'b'])
    const head = confirmations.value[0]!
    vi.advanceTimersByTime(1)
    expect(await shown).toBe('expired')
    // An answer after the deadline does nothing.
    head.answer('approved')
    expect(queued()).toEqual(['b'])
    vi.advanceTimersByTime(1_000)
    expect(await waiting).toBe('expired')
    expect(confirmations.value).toEqual([])
  })
})

const ConfirmDialog = compileSfc(new URL('../app/ConfirmDialog.vue', import.meta.url), { './confirmations': confirmationModule })

describe('ConfirmDialog', () => {
  it('stays above an open application dialog and handles Escape first', async () => {
    const underlyingCancel = vi.fn()
    const app = mountComponent({ render: () => h('dialog', { onCancel: underlyingCancel }, [h('button', 'Origin')]) }, {}, [])
    const application = app.nodes().find(node => node.tag === 'dialog')!
    const origin = app.button('Origin')
    application.showModal()
    const board = { isConnected: true, focus: vi.fn() }
    const doc = { activeElement: origin, querySelector: vi.fn(() => board) }
    vi.stubGlobal('document', doc)
    const ui = mountComponent(ConfirmDialog, {}, [])
    const preferred = { isConnected: true, focus: vi.fn() }
    const answer = requestConfirmation({ widgetId: 'a', title: 'App', op: 'notifications.send', input: note, returnFocus: () => preferred as unknown as HTMLElement })
    await nextTick()
    const dialog = ui.nodes().find(node => node.tag === 'dialog')!
    expect(dialog.open).toBe(true)
    expect(doc.activeElement).toBe(ui.button('Отклонить'))
    const cancel = new Event('cancel', { cancelable: true, bubbles: true })
    dialog.props.onCancel?.(cancel)
    if (!cancel.cancelBubble) application.props.onCancel(cancel)
    expect(underlyingCancel).not.toHaveBeenCalled()
    expect(cancel.defaultPrevented).toBe(true)
    expect(await answer).toBe('declined')
    await nextTick()
    expect(application.open).toBe(true)
    expect(preferred.focus).toHaveBeenCalledOnce()

    doc.activeElement = origin
    const detached = { isConnected: false, focus: vi.fn() }
    const second = requestConfirmation({ widgetId: 'a', title: 'App', op: 'notifications.send', input: note, returnFocus: () => detached as unknown as HTMLElement })
    await nextTick()
    ui.button('Отклонить').props.onClick()
    await second
    await nextTick()
    expect(doc.activeElement).toBe(origin)
    expect(detached.focus).not.toHaveBeenCalled()

    doc.activeElement = detached as any
    const third = requestConfirmation({ widgetId: 'a', title: 'App', op: 'notifications.send', input: note })
    await nextTick()
    ui.button('Отклонить').props.onClick()
    await third
    await nextTick()
    expect(doc.querySelector).toHaveBeenCalledWith('[data-board-focus]')
    expect(board.focus).toHaveBeenCalledOnce()
  })

  it('keeps the next queued confirmation focused after an answer', async () => {
    const preferred = { isConnected: true, focus: vi.fn() }
    vi.stubGlobal('document', { activeElement: preferred, querySelector: () => null })
    const ui = mountComponent(ConfirmDialog, {}, [])
    const first = requestConfirmation({ widgetId: 'a', title: 'First', op: 'notifications.send', input: note, returnFocus: () => preferred as unknown as HTMLElement })
    const second = requestConfirmation({ widgetId: 'b', title: 'Second', op: 'notifications.send', input: note })
    await nextTick()
    const escape = new Event('keydown', { cancelable: true, bubbles: true })
    Object.defineProperty(escape, 'key', { value: 'Escape' })
    ui.nodes().find(node => node.tag === 'dialog')!.props.onKeydown(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(escape.cancelBubble).toBe(true)
    expect(await first).toBe('declined')
    await nextTick()
    expect(preferred.focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(ui.button('Отклонить'))
    ui.button('Отклонить').props.onClick()
    expect(await second).toBe('declined')
  })
})

const WidgetModal = compileSfc(new URL('../app/widgets/WidgetModal.vue', import.meta.url), {})
it.each(['application-first', 'confirmation-first', 'same-tick-confirmation-first', 'same-tick-application-first'])('keeps real permission confirmation above an application modal: %s', async (order) => {
  vi.useFakeTimers()
  const origin = { isConnected: true, focus: vi.fn() }
  vi.stubGlobal('document', { activeElement: origin, querySelector: () => null })
  const active = ref<ModalRecord | null>(null)
  const close = vi.fn()
  const ui = mountComponent({ render: () => [
    h(WidgetModal, { record: active.value, error: null, onClose: close }),
    h(ConfirmDialog, { applicationModalId: active.value?.id }),
  ] }, {}, [])
  await nextTick()
  const dialogs = ui.nodes().filter(node => node.tag === 'dialog')
  const stack: typeof dialogs = []
  for (const box of dialogs) {
    const show = box.showModal.bind(box), hide = box.close.bind(box)
    box.showModal = () => { stack.push(box); show() }
    box.close = () => { const index = stack.indexOf(box); if (index >= 0) stack.splice(index, 1); hide() }
  }
  const application = dialogs[0]!, confirmation = dialogs[1]!
  const open = () => { active.value = { id: 'modal-1', owner: { runtimeId: 'compact', widgetId: 'w1', hash: 'hash', packageId: 'pkg', version: '1', title: 'Package' }, input: { view: 'editor' }, state: 'open' } }
  let first!: Promise<confirmationModule.ConfirmationAnswer>
  const askFirst = () => { first = requestConfirmation({ widgetId: 'a', title: 'First', op: 'notifications.send', input: note, returnFocus: () => origin as unknown as HTMLElement }) }
  if (order.includes('application-first')) { open(); if (!order.startsWith('same-tick')) await nextTick(); askFirst() }
  else { askFirst(); if (!order.startsWith('same-tick')) { await nextTick(); await vi.advanceTimersByTimeAsync(500) }; open() }
  const second = requestConfirmation({ widgetId: 'b', title: 'Second', op: 'notifications.send', input: note, returnFocus: () => origin as unknown as HTMLElement })
  await nextTick(); await nextTick()
  expect(stack.at(-1) === confirmation).toBe(true)
  expect(document.activeElement).toBe(ui.button('Отклонить'))
  expect(confirmations.value.map(entry => entry.title)).toEqual(['First', 'Second'])
  // Restacking an already armed head must not restart its approval delay.
  expect(ui.button('Разрешить один раз').props.disabled).toBe(order === 'confirmation-first' ? false : true)
  const cancel = new Event('cancel', { cancelable: true, bubbles: true })
  stack.at(-1)!.props.onCancel(cancel)
  expect(await first).toBe('declined'); expect(close).not.toHaveBeenCalled()
  await nextTick()
  expect(application.open).toBe(true)
  expect(document.activeElement).toBe(ui.button('Отклонить'))
  expect(ui.button('Разрешить один раз').props.disabled).toBe(true)
  expect(origin.focus).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(500)
  ui.button('Разрешить один раз').props.onClick()
  expect(await second).toBe('approved'); await nextTick()
  expect(origin.focus).toHaveBeenCalledOnce()
})
