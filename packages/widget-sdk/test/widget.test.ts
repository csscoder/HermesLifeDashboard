import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { createPortClient } from '../src/port-client.ts'
import { createWidget, provideInProcessWidget, useWidget, WidgetError, type Widget, type WidgetCall } from '../src/widget.ts'

const CONTEXT: WidgetContext = {
  size: { w: 3, h: 3 },
  sizeClass: 'm',
  theme: { id: 'builtin:glass', scheme: 'dark', tokens: { '--ld-bg': '#000' } },
  rootFontSize: 16,
  config: {},
  locale: 'ru-RU',
  visible: true,
}

interface Harness {
  widget: Widget
  calls: [string, unknown][]
  patch(patch: Partial<WidgetContext>): void
  close(): void
}

// The host's answers: state at revision 3, notifications ok, every other op unknown.
function fakeCall(calls: [string, unknown][]): WidgetCall {
  return async (op, input) => {
    calls.push([op, input])
    if (op === 'state.get') return { data: { n: 1 }, revision: 3 }
    if (op === 'state.set') {
      if ((input as { expectedRevision: number }).expectedRevision !== 3) throw new WidgetError('CONFLICT', 'stale')
      return { revision: 4 }
    }
    if (op === 'notifications.send') return { ok: true }
    throw new WidgetError('UNKNOWN_OP', `Unknown operation "${op}"`)
  }
}

// In-process: WidgetHost's setup provides, the widget's setup injects (rendered on the server, no DOM).
async function inProcess(): Promise<Harness> {
  const calls: [string, unknown][] = []
  const context = reactive(structuredClone(CONTEXT))
  let widget: Widget | undefined
  const Child = defineComponent({
    setup() {
      widget = useWidget()
      return () => null
    },
  })
  const Host = defineComponent({
    setup() {
      provideInProcessWidget({ call: fakeCall(calls), context })
      return () => h(Child)
    },
  })
  await renderToString(createSSRApp(Host))
  return { widget: widget!, calls, patch: (patch) => Object.assign(context, patch), close() {} }
}

// Sandbox: the widget talks over a MessagePort; the other end answers like the host bridge.
async function sandbox(): Promise<Harness> {
  const calls: [string, unknown][] = []
  const answer = fakeCall(calls)
  const { port1, port2 } = new MessageChannel()
  port1.onmessage = async (event: MessageEvent) => {
    const { id, op, input } = event.data as { id: number; op: string; input: unknown }
    try {
      port1.postMessage({ t: 'res', id, ok: true, value: await answer(op, input) })
    } catch (error) {
      const { code, message } = error as WidgetError
      port1.postMessage({ t: 'res', id, ok: false, error: { code, message } })
    }
  }
  const context = reactive(structuredClone(CONTEXT))
  const widget = createWidget(createPortClient(port2, (patch) => Object.assign(context, patch)), context)
  return {
    widget,
    calls,
    patch: (patch) => port1.postMessage({ t: 'context', patch }),
    close() {
      port1.close()
      port2.close()
    },
  }
}

let current: Harness | undefined

afterEach(() => {
  current?.close()
  current = undefined
  vi.restoreAllMocks()
})

// One suite, two transports: a widget must not notice which host runs it.
describe.each([
  ['in-process', inProcess],
  ['sandbox', sandbox],
] as const)('Widget contract (%s)', (_name, create) => {
  it('reads state', async () => {
    current = await create()
    expect(await current.widget.state.get()).toEqual({ data: { n: 1 }, revision: 3 })
    expect(current.calls).toEqual([['state.get', {}]])
  })

  it('writes state with the expected revision', async () => {
    current = await create()
    expect(await current.widget.state.set({ n: 2 }, 3)).toEqual({ revision: 4 })
    expect(current.calls).toEqual([['state.set', { data: { n: 2 }, expectedRevision: 3 }]])
  })

  it('rejects a stale write with a CONFLICT WidgetError', async () => {
    current = await create()
    const error = await current.widget.state.set({}, 1).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WidgetError)
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'stale' })
  })

  it('notifies with an empty body by default and resolves to undefined', async () => {
    current = await create()
    expect(await current.widget.notify({ title: 'Hi' })).toBeUndefined()
    expect(current.calls).toEqual([['notifications.send', { title: 'Hi', body: '' }]])
  })

  it('passes other operations through call', async () => {
    current = await create()
    await expect(current.widget.call('data.query', { a: 1 })).rejects.toMatchObject({ code: 'UNKNOWN_OP' })
    expect(current.calls).toEqual([['data.query', { a: 1 }]])
  })

  it('exposes a read-only context that follows the host', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    current = await create()
    current.patch({ size: { w: 4, h: 2 }, sizeClass: 's' })
    await vi.waitFor(() => expect(current!.widget.context.size).toEqual({ w: 4, h: 2 }))
    expect(current.widget.context.sizeClass).toBe('s')
    ;(current.widget.context as WidgetContext).visible = false
    expect(current.widget.context.visible).toBe(true)
  })
})

describe('useWidget', () => {
  it('throws outside a widget host', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => useWidget()).toThrow(/inside a LifeDashboard widget/)
  })
})

describe('createPortClient', () => {
  it('rejects an input the port cannot clone with INVALID_INPUT', async () => {
    const { port1, port2 } = new MessageChannel()
    try {
      const call = createPortClient(port2, () => {})
      await expect(call('state.set', { data: () => 1, expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    } finally {
      port1.close()
      port2.close()
    }
  })
})
