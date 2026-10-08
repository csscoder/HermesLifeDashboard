import { afterEach, describe, expect, it, vi } from 'vitest'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import type { ApiResult } from '../app/api'
import { createBridge, createGatewayClient, createHandshakes, type GatewayApi } from '../app/widgets/broker'

// JSON of 'x'.repeat(n) is n + 2 bytes.
const exactly64k = 'x'.repeat(65_534)
const never = () => new Promise<never>(() => {})

function fakeApi(answer: (op: string, token: string, input: unknown) => Promise<ApiResult<unknown>>) {
  let created = 0
  return {
    createWidgetSession: vi.fn(async (_widgetId: string) => ({ ok: true as const, data: { widgetSession: `s${++created}`, grants: [] } })),
    endWidgetSession: vi.fn(async (_token: string) => ({ ok: true as const, data: null })),
    gateway: vi.fn(answer),
  } satisfies GatewayApi
}

function setup(answer: (op: string, token: string, input: unknown) => Promise<ApiResult<unknown>>) {
  const api = fakeApi(answer)
  const onNotify = vi.fn()
  const onSessionLost = vi.fn()
  return { api, onNotify, onSessionLost, client: createGatewayClient({ api, widgetId: 'w1', onNotify, onSessionLost }) }
}

function answers(...results: ApiResult<unknown>[]) {
  return async () => results.shift()!
}

describe('createGatewayClient', () => {
  it('rejects an unknown op and invalid input before any API call', async () => {
    const { api, client } = setup(answers())
    await expect(client.call('http.get', {})).rejects.toMatchObject({ code: 'UNKNOWN_OP' })
    await expect(client.call('state.set', { data: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(api.createWidgetSession).not.toHaveBeenCalled()
    expect(api.gateway).not.toHaveBeenCalled()
  })

  it('creates a session on the first call and sends its token with the parsed input', async () => {
    const { api, client } = setup(answers({ ok: true, data: { revision: 1 } }))
    expect(await client.call('state.set', { data: { n: 1 }, expectedRevision: 0 })).toEqual({ revision: 1 })
    expect(api.createWidgetSession).toHaveBeenCalledWith('w1')
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: { n: 1 }, expectedRevision: 0 })
  })

  it('renews an expired session once and repeats the call', async () => {
    const { api, client, onSessionLost } = setup(
      answers({ ok: false, kind: 'session-expired' }, { ok: true, data: { data: null, revision: 0 } }),
    )
    expect(await client.call('state.get', {})).toEqual({ data: null, revision: 0 })
    expect(api.gateway.mock.calls.map((call) => call[1])).toEqual(['s1', 's2'])
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('reports a second SESSION_EXPIRED as a lost session, not as pairing', async () => {
    const { api, client, onSessionLost } = setup(
      answers({ ok: false, kind: 'session-expired' }, { ok: false, kind: 'session-expired' }),
    )
    await expect(client.call('state.get', {})).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(api.createWidgetSession).toHaveBeenCalledTimes(2)
    expect(onSessionLost).toHaveBeenCalledTimes(1)
  })

  it('reports a session that cannot be created as lost', async () => {
    const { api, client, onSessionLost } = setup(answers())
    api.createWidgetSession.mockResolvedValueOnce({ ok: false, kind: 'unavailable' } as never)
    expect(await client.start()).toBe(false)
    api.createWidgetSession.mockResolvedValueOnce({ ok: false, kind: 'unavailable' } as never)
    await expect(client.call('state.get', {})).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(api.gateway).not.toHaveBeenCalled()
    expect(onSessionLost).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ ok: false, kind: 'invalid', code: 'PERMISSION_DENIED', message: 'm' }, 'PERMISSION_DENIED'],
    [{ ok: false, kind: 'invalid', code: 'UNKNOWN_OP', message: 'm' }, 'UNKNOWN_OP'],
    [{ ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'm' }, 'INVALID_INPUT'],
    [{ ok: false, kind: 'conflict' }, 'CONFLICT'],
    [{ ok: false, kind: 'rate-limited' }, 'RATE_LIMITED'],
    [{ ok: false, kind: 'unavailable' }, 'UNAVAILABLE'],
    [{ ok: false, kind: 'unauthorized' }, 'UNAVAILABLE'],
  ] as const)('maps %j to %s', async (failure, code) => {
    const { client } = setup(answers(failure as ApiResult<unknown>))
    const error = await client.call('state.get', {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WidgetError)
    expect(error).toMatchObject({ code })
  })

  it('shows a notification only after the gateway accepted it', async () => {
    const { client, onNotify } = setup(answers({ ok: false, kind: 'rate-limited' }, { ok: true, data: { ok: true } }))
    await expect(client.call('notifications.send', { title: 'Hi', body: '' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(onNotify).not.toHaveBeenCalled()
    await client.call('notifications.send', { title: 'Hi', body: '' })
    expect(onNotify).toHaveBeenCalledWith({ title: 'Hi', body: '' })
  })

  it('ends its session on close', async () => {
    const { api, client } = setup(answers({ ok: true, data: { data: null, revision: 0 } }))
    await client.call('state.get', {})
    await client.close()
    await client.close()
    expect(api.endWidgetSession.mock.calls).toEqual([['s1']])
  })
})

describe('createHandshakes', () => {
  const hello = { t: 'ld:hello', sdk: 1 }

  it('accepts a hello only from a registered frame, once', () => {
    const handshakes = createHandshakes()
    const frame = {}
    const onHello = vi.fn()
    handshakes.register(frame, onHello)
    expect(handshakes.handle({ data: hello, source: {} })).toBe(false)
    expect(handshakes.handle({ data: hello, source: null })).toBe(false)
    expect(handshakes.handle({ data: hello, source: frame })).toBe(true)
    expect(handshakes.handle({ data: hello, source: frame })).toBe(false)
    expect(onHello).toHaveBeenCalledTimes(1)
  })

  it('ignores other messages and another SDK version', () => {
    const handshakes = createHandshakes()
    const frame = {}
    const onHello = vi.fn()
    handshakes.register(frame, onHello)
    expect(handshakes.handle({ data: { t: 'ld:hello', sdk: 2 }, source: frame })).toBe(false)
    expect(handshakes.handle({ data: 'ld:hello', source: frame })).toBe(false)
    expect(onHello).not.toHaveBeenCalled()
  })

  it('ignores a hello after the registration was cancelled (timeout or unmount)', () => {
    const handshakes = createHandshakes()
    const frame = {}
    const onHello = vi.fn()
    const cancel = handshakes.register(frame, onHello)
    cancel()
    expect(handshakes.handle({ data: hello, source: frame })).toBe(false)
    expect(onHello).not.toHaveBeenCalled()
  })
})

describe('createBridge', () => {
  let ports: MessagePort[] = []
  let bridges: { close(): void }[] = []

  // Closing the bridges clears their request timers; closing the ports lets the test process exit.
  afterEach(() => {
    for (const bridge of bridges) bridge.close()
    for (const port of ports) port.close()
    ports = []
    bridges = []
    vi.useRealTimers()
  })

  // The frame's end of the channel: sends raw messages, reads answers in order.
  function connect(call: WidgetCall) {
    const { port1, port2 } = new MessageChannel()
    ports.push(port1, port2)
    const inbox: unknown[] = []
    const waiting: ((message: unknown) => void)[] = []
    port2.onmessage = (event: MessageEvent) => {
      const next = waiting.shift()
      if (next) next(event.data)
      else inbox.push(event.data)
    }
    const onError = vi.fn()
    const onClose = vi.fn()
    const bridge = createBridge(port1, { call, onError, onClose })
    bridges.push(bridge)
    return {
      bridge,
      onError,
      onClose,
      send: (message: unknown) => port2.postMessage(message),
      next: () => (inbox.length > 0 ? Promise.resolve(inbox.shift()) : new Promise<unknown>((resolve) => waiting.push(resolve))),
    }
  }

  it('answers a request with the call result', async () => {
    const call = vi.fn(async () => ({ revision: 1 }))
    const frame = connect(call)
    frame.send({ t: 'req', id: 1, op: 'state.set', input: { data: 1, expectedRevision: 0 } })
    expect(await frame.next()).toEqual({ t: 'res', id: 1, ok: true, value: { revision: 1 } })
    expect(call).toHaveBeenCalledWith('state.set', { data: 1, expectedRevision: 0 })
  })

  it('passes a 64 KB state.set through the bridge and the gateway client', async () => {
    const { api, client } = setup(answers({ ok: true, data: { revision: 1 } }))
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 1, op: 'state.set', input: { data: exactly64k, expectedRevision: 0 } })
    expect(await frame.next()).toEqual({ t: 'res', id: 1, ok: true, value: { revision: 1 } })
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: exactly64k, expectedRevision: 0 })
  })

  it('answers UNKNOWN_OP from the gateway client without an API call', async () => {
    const { api, client } = setup(answers())
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 4, op: 'http.get', input: {} })
    expect(await frame.next()).toMatchObject({ t: 'res', id: 4, ok: false, error: { code: 'UNKNOWN_OP' } })
    expect(api.gateway).not.toHaveBeenCalled()
  })

  it('answers a message over 128 KB with INVALID_INPUT and does not call', async () => {
    const call = vi.fn(async () => null)
    const frame = connect(call)
    frame.send({ t: 'req', id: 2, op: 'state.set', input: { data: 'x'.repeat(131_072), expectedRevision: 0 } })
    expect(await frame.next()).toMatchObject({ t: 'res', id: 2, ok: false, error: { code: 'INVALID_INPUT' } })
    expect(call).not.toHaveBeenCalled()
  })

  it('caps requests in flight at 16', async () => {
    const call = vi.fn(never)
    const frame = connect(call)
    for (let id = 0; id <= 16; id++) frame.send({ t: 'req', id, op: 'state.get', input: {} })
    expect(await frame.next()).toMatchObject({ t: 'res', id: 16, ok: false, error: { code: 'RATE_LIMITED' } })
    expect(call).toHaveBeenCalledTimes(16)
  })

  it('times out a request after 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const call = vi.fn(never)
    const frame = connect(call)
    frame.send({ t: 'req', id: 3, op: 'state.get', input: {} })
    await vi.waitFor(() => expect(call).toHaveBeenCalled())
    vi.advanceTimersByTime(10_000)
    expect(await frame.next()).toMatchObject({ t: 'res', id: 3, ok: false, error: { code: 'TIMEOUT' } })
  })

  it('forwards an error report from the frame', async () => {
    const frame = connect(vi.fn(never))
    frame.send({ t: 'error', message: 'Error: boom' })
    await vi.waitFor(() => expect(frame.onError).toHaveBeenCalledWith('Error: boom'))
  })

  it('closes after 20 malformed messages', async () => {
    const call = vi.fn(async () => null)
    const frame = connect(call)
    for (let index = 0; index < 19; index++) frame.send({ t: 'junk' })
    frame.send({ t: 'req', id: 1, op: 'state.get', input: {} })
    expect(await frame.next()).toMatchObject({ id: 1, ok: true })
    expect(frame.onClose).not.toHaveBeenCalled()
    frame.send('junk')
    await vi.waitFor(() => expect(frame.onClose).toHaveBeenCalledTimes(1))
    frame.send({ t: 'req', id: 2, op: 'state.get', input: {} })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('pushes context patches to the frame', async () => {
    const frame = connect(vi.fn(never))
    frame.bridge.push({ visible: false })
    expect(await frame.next()).toEqual({ t: 'context', patch: { visible: false } })
  })
})
