import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIRMATION_DIALOG_MS } from '@lifedashboard/contracts/widget-gateway'
import { cancelConfirmations, confirmations, requestConfirmation } from '../app/confirmations'

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
  vi.useRealTimers()
})

describe('confirmations', () => {
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
