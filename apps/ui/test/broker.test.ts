import { describe, expect, it, vi } from 'vitest'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { CONFIRMATION_DIALOG_MS, type GatewayOp, type WidgetSessionResponse } from '@lifedashboard/contracts/widget-gateway'
import { WidgetError, type WidgetCall } from '@lifedashboard/widget-sdk'
import { API_TIMEOUT_MS, type ApiResult } from '../app/api'
import { cancelConfirmations, confirmations, requestConfirmation, type ConfirmationAnswer } from '../app/confirmations'
import { createGatewayClient, type GatewayApi } from '../app/widgets/broker'

// JSON of 'x'.repeat(n) is n + 2 bytes.
const exactly64k = 'x'.repeat(65_534)
const never = () => new Promise<never>(() => {})

type Answer = (op: string, token: string, input: unknown, confirmationId?: string) => Promise<ApiResult<unknown>>
type Confirm = (op: GatewayOp, input: unknown) => Promise<ConfirmationAnswer>

function fakeApi(answer: Answer) {
  let created = 0
  return {
    createWidgetSession: vi.fn(async (_widgetId: string, _source?: WidgetSource): Promise<ApiResult<WidgetSessionResponse>> => ({ ok: true, data: { widgetSession: `s${++created}`, grants: [] } })),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

// The real queue and its deadline, as SandboxWidget wires it.
const askUser: Confirm = (op, input) => requestConfirmation({ widgetId: 'w1', title: 'Привет', op, input })

describe('createGatewayClient', () => {
  it('rejects an unknown op and invalid input before any API call', async () => {
    const { api, client } = setup(answers())
    await expect(client.call('http.post', {})).rejects.toMatchObject({ code: 'UNKNOWN_OP' })
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

  it('renews only the original rendered source and stops when another tab changed it', async () => {
    const source: WidgetSource = { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }
    const api = fakeApi(async () => ({ ok: false, kind: 'session-expired' }))
    let starts = 0
    api.createWidgetSession.mockImplementation(async (_widgetId, expectedSource) => {
      if (++starts === 1) return { ok: true, data: { widgetSession: 'old', grants: [] } }
      return expectedSource?.kind === 'package' && expectedSource.version === '1.0.0'
        ? { ok: false, kind: 'session-expired' }
        : { ok: true, data: { widgetSession: 'new-version', grants: [] } }
    })
    const onSessionLost = vi.fn()
    const client = createGatewayClient({ api, widgetId: 'w1', source, confirm: async () => 'approved', onNotify() {}, onSessionLost })
    await client.start()
    source.version = '2.0.0'
    await expect(client.call('state.get', {})).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(api.gateway.mock.calls.map((call) => call[1])).toEqual(['old'])
    expect(onSessionLost).toHaveBeenCalledOnce()
    await client.close()
  })

  it('shares one session when calls start concurrently', async () => {
    const session = deferred<ApiResult<{ widgetSession: string; grants: [] }>>()
    const { api, client } = setup(async () => ({ ok: true, data: { data: null, revision: 0 } }))
    api.createWidgetSession.mockImplementation(() => session.promise)
    const reads = [client.call('state.get', {}), client.call('state.get', {})]
    session.resolve({ ok: true, data: { widgetSession: 'shared', grants: [] } })
    expect(await Promise.all(reads)).toEqual([{ data: null, revision: 0 }, { data: null, revision: 0 }])
    await client.close()
    expect(api.createWidgetSession).toHaveBeenCalledTimes(1)
    expect(api.endWidgetSession.mock.calls).toEqual([['shared']])
  })

  it('keeps a renewed session when an older call reports expiry during confirmation', async () => {
    const expired = deferred<ApiResult<unknown>>()
    const approval = deferred<ConfirmationAnswer>()
    const dialog = deferred<void>()
    const { api, client, onSessionLost } = setup(async (op, token, _input, confirmationId) => {
      if (token === 's1') return op === 'state.get' ? expired.promise : { ok: false, kind: 'session-expired' }
      if (op === 'state.get') return { ok: true, data: { data: null, revision: 0 } }
      if (confirmationId === undefined) return asked(`c-${token}`)
      return confirmationId === `c-${token}`
        ? { ok: true, data: { ok: true } }
        : { ok: false, kind: 'invalid', code: 'CONFIRMATION_INVALID', message: 'Wrong session' }
    }, () => { dialog.resolve(); return approval.promise })
    await client.start()
    const read = client.call('state.get', {})
    const notification = client.call('notifications.send', note)
    await dialog.promise
    expired.resolve({ ok: false, kind: 'session-expired' })
    expect(await read).toEqual({ data: null, revision: 0 })
    approval.resolve('approved')
    expect(await notification).toEqual({ ok: true })
    expect(api.createWidgetSession).toHaveBeenCalledTimes(2)
    expect(onSessionLost).not.toHaveBeenCalled()
    await client.close()
    expect(api.endWidgetSession.mock.calls).toEqual([['s2']])
  })

  it('repeats an approval on its owning session before asking again on the renewed session', async () => {
    const firstApproval = deferred<ConfirmationAnswer>()
    const firstDialog = deferred<void>()
    let dialogs = 0
    let restarted = false
    const { api, client } = setup(async (op, token, _input, confirmationId) => {
      if (op === 'state.get') {
        restarted = true
        return token === 's1' ? { ok: false, kind: 'session-expired' } : { ok: true, data: { data: null, revision: 0 } }
      }
      if (restarted && token === 's1') return { ok: false, kind: 'session-expired' }
      if (confirmationId === undefined) return asked(`c-${token}`)
      return confirmationId === `c-${token}`
        ? { ok: true, data: { ok: true } }
        : { ok: false, kind: 'invalid', code: 'CONFIRMATION_INVALID', message: 'Wrong session' }
    }, () => {
      if (++dialogs > 1) return Promise.resolve('approved')
      firstDialog.resolve()
      return firstApproval.promise
    })
    await client.start()
    const notification = client.call('notifications.send', note)
    await firstDialog.promise
    expect(await client.call('state.get', {})).toEqual({ data: null, revision: 0 })
    firstApproval.resolve('approved')
    expect(await notification).toEqual({ ok: true })
    expect(dialogs).toBe(2)
    expect(api.gateway.mock.calls.filter((call) => call[0] === 'notifications.send').map((call) => [call[1], call[3]])).toEqual([
      ['s1', undefined], ['s1', 'c-s1'], ['s2', undefined], ['s2', 'c-s2'],
    ])
    await client.close()
  })

  it('keeps a newer session when the last retry fails on an older token', async () => {
    const expiredRetry = deferred<ApiResult<unknown>>()
    const retryStarted = deferred<void>()
    const { client, onSessionLost } = setup(async (op, token) => {
      if (token === 's1') return { ok: false, kind: 'session-expired' }
      if (token === 's2') {
        if (op === 'state.get') { retryStarted.resolve(); return expiredRetry.promise }
        return { ok: false, kind: 'session-expired' }
      }
      return { ok: true, data: op === 'state.get' ? { data: null, revision: 0 } : { ok: true } }
    })
    await client.start()
    const read = client.call('state.get', {}).catch((error: unknown) => error)
    await retryStarted.promise
    expect(await client.call('notifications.send', note)).toEqual({ ok: true })
    expiredRetry.resolve({ ok: false, kind: 'session-expired' })
    expect(await read).toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(onSessionLost).not.toHaveBeenCalled()
    expect(await client.call('state.get', {})).toEqual({ data: null, revision: 0 })
    await client.close()
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

  it('reports an upstream failure as UNAVAILABLE with its message', async () => {
    const { client } = setup(answers({ ok: false, kind: 'upstream', message: 'The service did not answer in time' }))
    await expect(client.call('http.get', { url: 'http://127.0.0.1:8787/' })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'The service did not answer in time',
    })
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

  it('sends no operation when close runs after session creation but before the waiting call resumes', async () => {
    const session = deferred<ApiResult<{ widgetSession: string; grants: [] }>>()
    const { api, client } = setup(async () => ({ ok: true, data: { data: null, revision: 0 } }))
    api.createWidgetSession.mockImplementation(() => session.promise)
    const pending = client.call('state.get', {}).catch((error: unknown) => error)
    void session.promise.then(() => client.close())
    session.resolve({ ok: true, data: { widgetSession: 'created-before-close', grants: [] } })
    expect(await pending).toMatchObject({ code: 'DECLINED' })
    expect(api.gateway).not.toHaveBeenCalled()
    expect(api.endWidgetSession.mock.calls).toEqual([['created-before-close']])
  })
})
