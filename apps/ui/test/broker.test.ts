import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIRMATION_DIALOG_MS, type GatewayOp } from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import { API_TIMEOUT_MS, type ApiResult } from '../app/api'
import { cancelConfirmations, confirmations, requestConfirmation, type ConfirmationAnswer } from '../app/confirmations'
import { createBridge, createGatewayClient, createHandshakes, type GatewayApi } from '../app/widgets/broker'

// JSON of 'x'.repeat(n) is n + 2 bytes.
const exactly64k = 'x'.repeat(65_534)
const never = () => new Promise<never>(() => {})

type Answer = (op: string, token: string, input: unknown, confirmationId?: string) => Promise<ApiResult<unknown>>
type Confirm = (op: GatewayOp, input: unknown) => Promise<ConfirmationAnswer>

function fakeApi(answer: Answer) {
  let created = 0
  return {
    createWidgetSession: vi.fn(async (_widgetId: string) => ({ ok: true as const, data: { widgetSession: `s${++created}`, grants: [] } })),
    endWidgetSession: vi.fn(async (_token: string) => ({ ok: true as const, data: null })),
    gateway: vi.fn(answer),
    declineConfirmation: vi.fn(async (_token: string, _id: string) => ({ ok: true as const, data: null })),
  } satisfies GatewayApi
}

function setup(answer: Answer, confirmAnswer: Confirm = async () => 'approved') {
  const api = fakeApi(answer)
  const onNotify = vi.fn()
  const onSessionLost = vi.fn()
  const confirm = vi.fn(confirmAnswer)
  return { api, onNotify, onSessionLost, confirm, client: createGatewayClient({ api, widgetId: 'w1', confirm, onNotify, onSessionLost }) }
}

function answers(...results: ApiResult<unknown>[]) {
  return async () => results.shift()!
}

const note = { title: 'Hi', body: '' }

function asked(confirmationId: string): ApiResult<unknown> {
  return { ok: false, kind: 'confirmation-required', confirmationId }
}

// The real queue and its deadline, as SandboxWidget wires it.
const askUser: Confirm = (op, input) => requestConfirmation({ widgetId: 'w1', title: 'Привет', op, input })

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
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: { n: 1 }, expectedRevision: 0 }, undefined)
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

  it('asks with the parsed input and repeats the call once with the id after an approval', async () => {
    const { api, client, confirm, onNotify } = setup(answers(asked('c1'), { ok: true, data: { ok: true } }))
    expect(await client.call('notifications.send', note)).toEqual({ ok: true })
    expect(api.gateway.mock.calls).toEqual([
      ['notifications.send', 's1', note, undefined],
      ['notifications.send', 's1', note, 'c1'],
    ])
    // The dialog previews exactly the value the API bound the id to.
    expect(confirm).toHaveBeenCalledWith('notifications.send', note)
    expect(confirm.mock.calls[0]![1]).toBe(api.gateway.mock.calls[0]![2])
    expect(onNotify).toHaveBeenCalledTimes(1)
    expect(api.declineConfirmation).not.toHaveBeenCalled()
  })

  it.each([
    ['declined', 'The user declined the call'],
    ['expired', 'The confirmation expired'],
  ] as const)('declines the id and throws DECLINED when the answer is %s', async (answer, message) => {
    const { api, client, onNotify } = setup(answers(asked('c1')), async () => answer)
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'DECLINED', message })
    expect(api.declineConfirmation).toHaveBeenCalledWith('s1', 'c1')
    expect(api.gateway).toHaveBeenCalledTimes(1)
    expect(onNotify).not.toHaveBeenCalled()
  })

  it('maps CONFIRMATION_INVALID on the repeat to DECLINED without declining', async () => {
    const { api, client } = setup(answers(asked('c1'), { ok: false, kind: 'invalid', code: 'CONFIRMATION_INVALID', message: 'm' }))
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'DECLINED', message: 'The confirmation expired' })
    expect(api.declineConfirmation).not.toHaveBeenCalled()
  })

  it('never asks twice for one call on one session: a 428 on the repeat ends it', async () => {
    const { client, confirm } = setup(answers(asked('c1'), asked('c2')))
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'DECLINED' })
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('never asks for a 428 without an id', async () => {
    const { client, confirm } = setup(answers({ ok: false, kind: 'invalid', code: 'CONFIRMATION_REQUIRED', message: 'm' }))
    await expect(client.call('notifications.send', note)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('resends without the id after a session renewal and asks again', async () => {
    const { api, client, confirm } = setup(
      answers(asked('c1'), { ok: false, kind: 'session-expired' }, asked('c2'), { ok: true, data: { ok: true } }),
    )
    expect(await client.call('notifications.send', note)).toEqual({ ok: true })
    expect(api.gateway.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ['s1', undefined],
      ['s1', 'c1'],
      ['s2', undefined],
      ['s2', 'c2'],
    ])
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('declines nothing when the widget closes while the user is asked', async () => {
    let answer: ((result: ConfirmationAnswer) => void) | undefined
    const { api, client, confirm } = setup(answers(asked('c1')), () => new Promise((resolve) => { answer = resolve }))
    const pending = client.call('notifications.send', note)
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    await client.close()
    answer!('declined')
    await expect(pending).rejects.toMatchObject({ code: 'DECLINED' })
    expect(api.declineConfirmation).not.toHaveBeenCalled()
  })

  it('opens no dialog when the widget closes while the first call is in flight', async () => {
    let release: (() => void) | undefined
    const { api, client, confirm } = setup(() => new Promise((resolve) => { release = () => resolve(asked('c1')) }))
    const pending = client.call('notifications.send', note)
    await vi.waitFor(() => expect(api.gateway).toHaveBeenCalled())
    await client.close()
    release!()
    await expect(pending).rejects.toMatchObject({ code: 'DECLINED', message: 'The widget was closed' })
    expect(confirm).not.toHaveBeenCalled()
    expect(api.createWidgetSession).toHaveBeenCalledTimes(1)
  })

  it('creates no new session when the widget closes before a renewal', async () => {
    let release: (() => void) | undefined
    const { api, client, confirm } = setup(() => new Promise((resolve) => { release = () => resolve({ ok: false, kind: 'session-expired' }) }))
    const pending = client.call('notifications.send', note)
    await vi.waitFor(() => expect(api.gateway).toHaveBeenCalled())
    await client.close()
    release!()
    await expect(pending).rejects.toMatchObject({ code: 'DECLINED', message: 'The widget was closed' })
    expect(api.createWidgetSession).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('ends a session whose creation finished after the widget closed', async () => {
    const { api, client } = setup(answers())
    let created: (() => void) | undefined
    api.createWidgetSession.mockImplementationOnce(() => new Promise((resolve) => { created = () => resolve({ ok: true as const, data: { widgetSession: 'late', grants: [] } }) }))
    const pending = client.call('state.get', {})
    await vi.waitFor(() => expect(api.createWidgetSession).toHaveBeenCalled())
    await client.close()
    created!()
    await expect(pending).rejects.toMatchObject({ code: 'DECLINED' })
    expect(api.gateway).not.toHaveBeenCalled()
    expect(api.endWidgetSession).toHaveBeenCalledWith('late')
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
    cancelConfirmations('w1')
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
    expect(api.gateway).toHaveBeenCalledWith('state.set', 's1', { data: exactly64k, expectedRevision: 0 }, undefined)
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

  it('ends an unanswered confirmation DECLINED before the bridge timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { api, client } = setup(answers(asked('c1')), askUser)
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 1, op: 'notifications.send', input: note })
    await vi.waitFor(() => expect(confirmations.value).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(CONFIRMATION_DIALOG_MS)
    // With the 10 s request timeout the first answer would be TIMEOUT.
    expect(await frame.next()).toMatchObject({ t: 'res', id: 1, ok: false, error: { code: 'DECLINED', message: 'The confirmation expired' } })
    expect(api.declineConfirmation).toHaveBeenCalledWith('s1', 'c1')
  })

  it('ends DECLINED before the bridge timeout after a late approval, a session renewal and an unanswered second dialog', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Every API call takes the whole API_TIMEOUT_MS: the worst case of spec «Contracts».
    const slow = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), API_TIMEOUT_MS))
    const results: ApiResult<unknown>[] = [asked('c1'), { ok: false, kind: 'session-expired' }, asked('c2')]
    const { api, client } = setup(() => slow(results.shift()!), askUser)
    let sessions = 0
    api.createWidgetSession.mockImplementation(() => slow({ ok: true as const, data: { widgetSession: `s${++sessions}`, grants: [] } }))
    const frame = connect(client.call)
    frame.send({ t: 'req', id: 1, op: 'notifications.send', input: note })
    await vi.waitFor(() => expect(api.createWidgetSession).toHaveBeenCalled())
    // vi.waitFor advances fake time by its interval on each check, so the steps below keep a 1 s margin.
    await vi.advanceTimersByTimeAsync(2 * API_TIMEOUT_MS)
    await vi.waitFor(() => expect(confirmations.value).toHaveLength(1))
    // A late approval, 1 s before the dialog deadline.
    await vi.advanceTimersByTimeAsync(CONFIRMATION_DIALOG_MS - 1_000)
    confirmations.value[0]!.answer('approved')
    // Repeat (session expired), new session, call (asked again).
    await vi.advanceTimersByTimeAsync(3 * API_TIMEOUT_MS)
    await vi.waitFor(() => expect(confirmations.value).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(CONFIRMATION_DIALOG_MS)
    expect(await frame.next()).toMatchObject({ t: 'res', id: 1, ok: false, error: { code: 'DECLINED' } })
    expect(api.declineConfirmation).toHaveBeenCalledWith('s2', 'c2')
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
