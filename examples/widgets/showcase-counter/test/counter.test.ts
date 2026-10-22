import { describe, expect, it } from 'vitest'
import { WidgetError, type Widget } from '@lifedashboard/widget-sdk'
import { createCounter } from '../src/counter.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function storage(data: unknown = null) {
  const saved = {
    data,
    revision: 0,
    reads: 0,
    writes: 0,
    readError: false,
    writeError: false,
    hold: null as Promise<void> | null,
    beforeWrite: null as (() => void) | null,
  }
  const api: Widget['state'] = {
    async get<T>() {
      saved.reads++
      if (saved.readError) throw new WidgetError('UNAVAILABLE')
      return { data: structuredClone(saved.data) as T | null, revision: saved.revision }
    },
    async set(next, expectedRevision) {
      saved.writes++
      await saved.hold
      saved.beforeWrite?.()
      if (expectedRevision !== saved.revision) throw new WidgetError('CONFLICT')
      saved.data = structuredClone(next)
      saved.revision++
      if (saved.writeError) throw new WidgetError('TIMEOUT')
      return { revision: saved.revision }
    },
  }
  return { saved, api }
}

describe('persisted counter', () => {
  it('starts empty, saves an increment, and restores it in a fresh instance', async () => {
    const { saved, api } = storage()
    const counter = createCounter(api)
    await counter.load()
    expect(counter.state.ready).toBe(true)
    expect(counter.state.count).toBe(0)
    await counter.change(1)
    expect(saved.data).toEqual({ count: 1 })
    const reopened = createCounter(api)
    await reopened.load()
    expect(reopened.state.count).toBe(1)
  })

  it('keeps the confirmed value until a write completes and ignores another click while busy', async () => {
    const { saved, api } = storage({ count: 2 })
    const counter = createCounter(api)
    await counter.load()
    const pending = deferred()
    saved.hold = pending.promise
    const change = counter.change(1)
    await counter.change(1)
    expect([counter.state.count, counter.state.busy, saved.writes]).toEqual([2, true, 1])
    pending.resolve()
    await change
    expect([counter.state.count, counter.state.busy, saved.data]).toEqual([3, false, { count: 3 }])
  })

  it('never decrements below zero or writes an unchanged count', async () => {
    const { saved, api } = storage()
    const counter = createCounter(api)
    await counter.load()
    await counter.change(-1)
    expect([counter.state.count, saved.writes]).toEqual([0, 0])
    await counter.change(1)
    await counter.change(-1)
    expect(saved.data).toEqual({ count: 0 })
  })

  it('reapplies an increment to the latest count after a revision conflict', async () => {
    const { saved, api } = storage({ count: 2 })
    const counter = createCounter(api)
    await counter.load()
    saved.data = { count: 5 }
    saved.revision = 1
    await counter.change(1)
    expect([counter.state.count, saved.data, saved.revision]).toEqual([6, { count: 6 }, 2])
    expect(counter.state.error).toBe('')
  })

  it('stops retrying repeated conflicts and shows the latest saved value', async () => {
    const { saved, api } = storage({ count: 2 })
    const counter = createCounter(api)
    await counter.load()
    saved.beforeWrite = () => {
      saved.data = { count: 5 + saved.writes }
      saved.revision++
    }
    await counter.change(1)
    expect(saved.writes).toBe(2)
    expect([counter.state.count, saved.data]).toEqual([7, { count: 7 }])
    expect(counter.state.error).not.toBe('')
    expect(counter.state.busy).toBe(false)
  })

  it.each([{ count: -1 }, { count: 1.5 }, { count: '3' }, { count: Infinity }, { count: Number.MAX_SAFE_INTEGER + 1 }, {}])(
    'blocks invalid saved progress without overwriting it: %j', async (data) => {
      const { saved, api } = storage(data)
      const counter = createCounter(api)
      await counter.load()
      await counter.change(1)
      expect(counter.state.ready).toBe(false)
      expect(counter.state.error).not.toBe('')
      expect([saved.writes, saved.data]).toEqual([0, data])
    },
  )

  it('lets a failed initial read recover without writing progress', async () => {
    const { saved, api } = storage({ count: 4 })
    const counter = createCounter(api)
    saved.readError = true
    await counter.load()
    expect([counter.state.ready, counter.state.busy]).toEqual([false, false])
    expect(counter.state.error).not.toBe('')
    saved.readError = false
    await counter.load()
    expect([counter.state.ready, counter.state.count, saved.writes]).toEqual([true, 4, 0])
    expect(counter.state.error).toBe('')
  })

  it('reloads after an uncertain save without replaying an already persisted increment', async () => {
    const { saved, api } = storage({ count: 2 })
    const counter = createCounter(api)
    await counter.load()
    saved.writeError = true
    await counter.change(1)
    expect([counter.state.count, counter.state.ready, counter.state.busy]).toEqual([2, false, false])
    expect(counter.state.error).not.toBe('')
    await counter.change(1)
    expect(saved.writes).toBe(1)
    saved.writeError = false
    await counter.load()
    expect([counter.state.count, saved.data, saved.writes]).toEqual([3, { count: 3 }, 1])
    await counter.change(1)
    expect(saved.data).toEqual({ count: 4 })
  })

  it('does not overflow the largest safe persisted count', async () => {
    const { saved, api } = storage({ count: Number.MAX_SAFE_INTEGER })
    const counter = createCounter(api)
    await counter.load()
    await counter.change(1)
    expect([counter.state.count, saved.writes]).toEqual([Number.MAX_SAFE_INTEGER, 0])
  })
})
