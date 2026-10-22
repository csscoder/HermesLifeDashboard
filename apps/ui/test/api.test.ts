import { afterEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_LIMITS, HTTP_LIMITS } from '@lifedashboard/contracts/widget-gateway'
import { api, apiRequest, API_TIMEOUT_MS } from '../app/api'

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit]

function respond(status: number, body: unknown) {
  return vi.fn(async (..._args: FetchArgs) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('returns the data of a success envelope and sends a same-origin request with a timeout signal', async () => {
    const fetchMock = respond(200, { data: [{ id: 'r' }], meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.spaces()).toEqual({ ok: true, data: [{ id: 'r' }] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/spaces')
    expect(init?.method).toBe('GET')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.body).toBeUndefined()
  })

  it('sends a JSON body on PUT', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.saveBoard('space 1', { expectedRevision: 3, screens: [] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/spaces/space%201/board')
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe('{"expectedRevision":3,"screens":[]}')
  })

  it('sends space and screen mutations as JSON', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.createSpace()
    await api.deleteSpace('s1', 2)
    await api.addScreen('s1', 3)
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/v1/spaces', 'POST', '{}'],
      ['/api/v1/spaces/s1', 'DELETE', '{"expectedRevision":2}'],
      ['/api/v1/spaces/s1/screens', 'POST', '{"expectedRevision":3}'],
    ])
  })

  it('updates a space with PATCH and the JSON patch', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.updateSpace('space 1', { title: 'Дом', color: 'teal' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/spaces/space%201')
    expect(init?.method).toBe('PATCH')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe('{"title":"Дом","color":"teal"}')
  })

  it('deletes a screen with its revision', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.deleteScreen('s1', 'sc 2', 4)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/spaces/s1/screens/sc%202')
    expect(init?.method).toBe('DELETE')
    expect(init?.body).toBe('{"expectedRevision":4}')
  })

  it('sends an empty JSON object for a new pairing code', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.pairCode()
    expect(fetchMock.mock.calls[0]![1]?.body).toBe('{}')
  })

  it.each([
    [401, 'unauthorized'],
    [409, 'conflict'],
    [429, 'rate-limited'],
    [500, 'unavailable'],
    [502, 'unavailable'],
  ])('maps %i to %s', async (status, kind) => {
    vi.stubGlobal('fetch', respond(status, { error: { code: 'X', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.spaces()).toEqual({ ok: false, kind })
  })

  it('keeps the message of a 502 UPSTREAM_ERROR; another 502 stays unavailable', async () => {
    vi.stubGlobal('fetch', respond(502, { error: { code: 'UPSTREAM_ERROR', message: 'The service is unreachable', requestId: 'x', retryable: false } }))
    expect(await api.gateway('http.get', 't', { url: 'http://127.0.0.1:8787/' })).toEqual({ ok: false, kind: 'upstream', message: 'The service is unreachable' })
    vi.stubGlobal('fetch', respond(502, { error: { code: 'X', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.spaces()).toEqual({ ok: false, kind: 'unavailable' })
  })

  it('maps another 4xx to invalid with the server message', async () => {
    vi.stubGlobal('fetch', respond(400, { error: { code: 'VALIDATION_ERROR', message: 'bad rect', requestId: 'x', retryable: false } }))
    expect(await api.spaces()).toEqual({ ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'bad rect' })
  })

  it('maps 401 SESSION_EXPIRED apart from a lost dashboard session', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'SESSION_EXPIRED', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('state.get', 'tok', {})).toEqual({ ok: false, kind: 'session-expired' })
    vi.stubGlobal('fetch', respond(401, { error: { code: 'UNAUTHORIZED', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('state.get', 'tok', {})).toEqual({ ok: false, kind: 'unauthorized' })
  })

  it('sends the widget session header and the input on a gateway call', async () => {
    const fetchMock = respond(200, { data: { revision: 1 }, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.gateway('state.set', 'tok', { data: 1, expectedRevision: 0 })).toEqual({ ok: true, data: { revision: 1 } })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-gateway/state.set')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-widget-session': 'tok' })
    expect(init?.body).toBe('{"data":1,"expectedRevision":0}')
  })

  it('maps 428 to confirmation-required with its id, and a 428 without an id to invalid', async () => {
    vi.stubGlobal('fetch', respond(428, { error: { code: 'CONFIRMATION_REQUIRED', message: 'm', requestId: 'x', retryable: false, confirmationId: 'c1' } }))
    expect(await api.gateway('notifications.send', 'tok', {})).toEqual({ ok: false, kind: 'confirmation-required', confirmationId: 'c1' })
    vi.stubGlobal('fetch', respond(428, { error: { code: 'CONFIRMATION_REQUIRED', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('notifications.send', 'tok', {})).toEqual({ ok: false, kind: 'invalid', code: 'CONFIRMATION_REQUIRED', message: 'm' })
  })

  it('treats a 428 with an empty confirmationId as invalid', async () => {
    vi.stubGlobal('fetch', respond(428, { error: { code: 'CONFIRMATION_REQUIRED', message: 'm', requestId: 'x', retryable: false, confirmationId: '' } }))
    expect(await api.gateway('notifications.send', 'tok', {})).toEqual({ ok: false, kind: 'invalid', code: 'CONFIRMATION_REQUIRED', message: 'm' })
  })

  it('maps 409 CONFIRMATION_INVALID to invalid, not to a state conflict', async () => {
    vi.stubGlobal('fetch', respond(409, { error: { code: 'CONFIRMATION_INVALID', message: 'm', requestId: 'x', retryable: false } }))
    expect(await api.gateway('notifications.send', 'tok', {}, 'c1')).toEqual({ ok: false, kind: 'invalid', code: 'CONFIRMATION_INVALID', message: 'm' })
  })

  it('sends the confirmation header only with a confirmation id', async () => {
    const fetchMock = respond(200, { data: { ok: true }, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.gateway('notifications.send', 'tok', { title: 'Hi', body: '' }, 'c1')
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-widget-session': 'tok',
      'x-widget-confirmation': 'c1',
    })
  })

  it('declines a confirmation with the widget session and an empty JSON body', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.declineConfirmation('tok', 'c1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-gateway/confirmations/c1')
    expect(init?.method).toBe('DELETE')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-widget-session': 'tok' })
    expect(init?.body).toBe('{}')
  })

  it('sets a grant mode', async () => {
    const fetchMock = respond(200, { data: [{ permission: 'notifications', mode: 'allow' }], meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.setGrantMode('dev.a.clock', 'notifications', 'allow')).toEqual({ ok: true, data: [{ permission: 'notifications', mode: 'allow' }] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-packages/dev.a.clock/grants/notifications')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe('{"mode":"allow"}')
  })

  it('sends an empty JSON body on DELETE', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    await api.deletePackage('dev.a.clock')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-packages/dev.a.clock')
    expect(init?.method).toBe('DELETE')
    expect(init?.body).toBe('{}')
  })

  it('maps a network error to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await api.spaces()).toEqual({ ok: false, kind: 'unavailable' })
  })

  it('maps a non-JSON body to unavailable', async () => {
    vi.stubGlobal('fetch', respond(200, '<html>proxy error</html>'))
    expect(await api.spaces()).toEqual({ ok: false, kind: 'unavailable' })
  })

  it('times out when the headers never arrive', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    ))
    expect(await apiRequest('GET', '/spaces', undefined, 20)).toEqual({ ok: false, kind: 'unavailable' })
  })

  it('times out when the body never arrives', async () => {
    // Real fetch aborts reading the body when its signal fires; the stub does the same.
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    })))
    expect(await apiRequest('GET', '/spaces', undefined, 20)).toEqual({ ok: false, kind: 'unavailable' })
  })
})

describe('upload calls', () => {
  it('sends a file raw as octet-stream with encoded segments and the caller signal', async () => {
    const fetchMock = respond(200, { data: null, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const file = new Blob(['abc'])
    await api.uploadFile('u1', 'assets/a b.png', file, controller.signal)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-uploads/u1/files/assets/a%20b.png')
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/octet-stream' })
    expect(init?.body).toBe(file)
    expect(init?.signal).toBe(controller.signal)
  })

  it('installs with the caller signal and an empty JSON body', async () => {
    const fetchMock = respond(200, { data: {}, meta: { requestId: 'x' } })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await api.installUpload('u1', controller.signal)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/widget-uploads/u1/install')
    expect(init?.body).toBe('{}')
    expect(init?.signal).toBe(controller.signal)
  })
})

describe('gateway timeout chain', () => {
  // The upstream proxy must time out before the UI's API call, which must time out before the bridge reply window.
  it('keeps HTTP_LIMITS.timeoutMs < API_TIMEOUT_MS < BRIDGE_LIMITS.requestTimeoutMs', () => {
    expect(HTTP_LIMITS.timeoutMs).toBeLessThan(API_TIMEOUT_MS)
    expect(API_TIMEOUT_MS).toBeLessThan(BRIDGE_LIMITS.requestTimeoutMs)
  })
})
