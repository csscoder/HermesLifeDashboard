import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { HttpOutput, HttpSendInput, StateGetOutput, WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { createBridge } from '../src/host.ts'
import { createPortClient } from '../src/port-client.ts'
import { createWidget, provideInProcessWidget, useWidget, WidgetError, type Widget, type WidgetCall } from '../src/widget.ts'

const CONTEXT: WidgetContext = {
  size: { w: 3, h: 3 },
  sizeClass: 'm',
  frame: 'framed',
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

const HTTP_OUTPUT: HttpOutput = { status: 200, contentType: 'application/json', body: '{"ok":true}' }

// The host's answers: state at revision 3, notifications ok, HTTP response, every other op unknown.
function fakeCall(calls: [string, unknown][]): WidgetCall {
  return async (op, input) => {
    calls.push([op, input])
    if (op === 'state.get') return { data: { n: 1 }, revision: 3 }
    if (op === 'state.set') {
      if ((input as { expectedRevision: number }).expectedRevision !== 3) throw new WidgetError('CONFLICT', 'stale')
      return { revision: 4 }
    }
    if (op === 'notifications.send') return { ok: true }
    if (op === 'http.get' || op === 'http.send') return HTTP_OUTPUT
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
  vi.useRealTimers()
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

  it('gets HTTP with an accept header', async () => {
    current = await create()
    const output = await current.widget.http.get('https://a.example/x', { accept: 'application/json' })
    expectTypeOf(output).toEqualTypeOf<HttpOutput>()
    expect(output).toEqual(HTTP_OUTPUT)
    expect(current.calls).toEqual([['http.get', { url: 'https://a.example/x', headers: { accept: 'application/json' } }]])
  })

  it.each([undefined, {}, { accept: undefined }])('gets HTTP without a headers key for options %j', async (options) => {
    current = await create()
    expect(await current.widget.http.get('https://a.example/x', options)).toEqual(HTTP_OUTPUT)
    expect(current.calls).toEqual([['http.get', { url: 'https://a.example/x' }]])
  })

  it('preserves an explicitly empty accept header', async () => {
    current = await create()
    await current.widget.http.get('https://a.example/x', { accept: '' })
    expect(current.calls).toEqual([['http.get', { url: 'https://a.example/x', headers: { accept: '' } }]])
  })

  it('passes HTTP sends through unchanged', async () => {
    current = await create()
    const request: HttpSendInput = {
      url: 'https://a.example/x',
      method: 'PATCH',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"n":2}',
    }
    const output = await current.widget.http.send(request)
    expectTypeOf(output).toEqualTypeOf<HttpOutput>()
    expect(output).toEqual(HTTP_OUTPUT)
    expect(current.calls).toEqual([['http.send', request]])
  })

  it('keeps state.get available through typed call', async () => {
    current = await create()
    const output = await current.widget.call('state.get', {})
    expectTypeOf(output).toEqualTypeOf<StateGetOutput>()
    expect(output).toEqual({ data: { n: 1 }, revision: 3 })
    expect(current.calls).toEqual([['state.get', {}]])
  })

  it('keeps runtime unknown-operation errors for JavaScript widgets', async () => {
    current = await create()
    // @ts-expect-error Unknown operations are rejected by the public TypeScript API.
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
    ;(current.widget.context as WidgetContext).size.w = 99
    ;(current.widget.context as WidgetContext).theme.tokens['--ld-bg'] = 'red'
    expect(current.widget.context.visible).toBe(true)
    expect(current.widget.context.size).toEqual({ w: 4, h: 2 })
    expect(current.widget.context.theme.tokens['--ld-bg']).toBe('#000')
  })

  it('types nested context fields as read-only', () => {
    const mutate = (widget: Widget) => {
      // @ts-expect-error The host owns nested size fields.
      widget.context.size.w = 10
      // @ts-expect-error The host owns theme tokens.
      widget.context.theme.tokens['--ld-bg'] = 'red'
    }
    void mutate
  })
})

describe('useWidget', () => {
  it('throws outside a widget host', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => useWidget()).toThrow(/inside a LifeDashboard widget/)
  })
})

describe('createPortClient', () => {
  it('rejects pending and future calls when the host explicitly closes the bridge', async () => {
    const { port1, port2 } = new MessageChannel()
    let started = 0
    const bridge = createBridge(port1, {
      call: async () => { started += 1; return new Promise(() => {}) },
      onError() {}, onClose() {},
    })
    try {
      const call = createPortClient(port2, () => {})
      const reads = [call('state.get', {}), call('notifications.send', { title: 'Hi', body: '' })]
      let outcomes: unknown[] | undefined
      void Promise.all(reads.map((read) => read.catch((error: unknown) => error))).then((errors) => { outcomes = errors })
      await vi.waitFor(() => expect(started).toBe(2))
      bridge.close()
      await vi.waitFor(() => expect(outcomes).toEqual([
        expect.objectContaining({ code: 'BRIDGE_CLOSED' }), expect.objectContaining({ code: 'BRIDGE_CLOSED' }),
      ]))
      await expect(call('state.get', {})).rejects.toMatchObject({ code: 'BRIDGE_CLOSED' })
    } finally {
      bridge.close()
      port1.close()
      port2.close()
    }
  })

  it.each([
    ['state.get', {}, 10_000],
    ['http.send', { url: 'https://a.example/', method: 'POST' }, 250_000],
  ] as const)('times out %s when its port stops answering', async (op, input, deadline) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { port1, port2 } = new MessageChannel()
    try {
      const call = createPortClient(port2, () => {})
      let error: unknown
      const pending = call(op, input).catch((caught: unknown) => { error = caught })
      port1.close()
      await vi.advanceTimersByTimeAsync(deadline - 1)
      expect(error).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(error).toMatchObject({ code: 'TIMEOUT' })
      await pending
    } finally {
      port1.close()
      port2.close()
    }
  })

  it('ignores malformed close controls and still accepts the response', async () => {
    const { port1, port2 } = new MessageChannel()
    try {
      port1.onmessage = (event: MessageEvent) => {
        for (const message of [{ t: 'close', extra: true }, { t: ['close'] }, null]) port1.postMessage(message)
        port1.postMessage({ t: 'res', id: (event.data as { id: number }).id, ok: true, value: { revision: 1 } })
      }
      const call = createPortClient(port2, () => {})
      expect(await call('state.set', { data: {}, expectedRevision: 0 })).toEqual({ revision: 1 })
    } finally {
      port1.close()
      port2.close()
    }
  })

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
