import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { api, type ApiResult } from '../app/api'
import { refreshSecretFlags, useSecretFlags } from '../app/widgets/secret-flags'

const scopes: ReturnType<typeof effectScope>[] = []

function setup(widgetId: () => string | undefined) {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useSecretFlags(widgetId))!
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('secret flags', () => {
  beforeEach(() => {
    vi.spyOn(api, 'widgetSecrets').mockResolvedValue({ ok: true, data: { apiKey: true, unused: false } })
  })

  it('loads only true flags and refreshes all hosts sharing the id', async () => {
    const first = setup(() => 'shared')
    const second = setup(() => 'shared')
    await vi.waitFor(() => expect(first.value).toEqual(new Set(['apiKey'])))
    expect(second.value).toBe(first.value)
    expect(api.widgetSecrets).toHaveBeenCalledExactlyOnceWith('shared')

    refreshSecretFlags('shared', { apiKey: false, otherKey: true })
    expect(first.value).toEqual(new Set(['otherKey']))
    expect(second.value).toBe(first.value)

    const later = setup(() => 'shared')
    expect(later.value).toBe(first.value)
    expect(api.widgetSecrets).toHaveBeenCalledTimes(1)
  })

  it('does not request without an id and follows id changes without mixing flags', async () => {
    const widgetId = ref<string>()
    const flags = setup(() => widgetId.value)
    expect(flags.value).toEqual(new Set())
    expect(api.widgetSecrets).not.toHaveBeenCalled()

    widgetId.value = 'changing'
    await nextTick()
    await vi.waitFor(() => expect(flags.value).toEqual(new Set(['apiKey'])))
    refreshSecretFlags('separate', { otherKey: true })
    widgetId.value = 'separate'
    await nextTick()
    expect(flags.value).toEqual(new Set(['otherKey']))

    widgetId.value = undefined
    await nextTick()
    expect(flags.value).toEqual(new Set())
    expect(api.widgetSecrets).toHaveBeenCalledExactlyOnceWith('changing')
  })

  it.each(['failure', 'rejection'] as const)('evicts a %s so the next use retries', async (kind) => {
    const id = `retry-${kind}`
    const mock = vi.mocked(api.widgetSecrets)
    if (kind === 'failure') mock.mockResolvedValueOnce({ ok: false, kind: 'unavailable' })
    else mock.mockRejectedValueOnce(new Error('offline'))
    const flags = setup(() => id)
    await nextTick()
    await nextTick()
    expect(flags.value).toEqual(new Set())
    expect(mock).toHaveBeenCalledExactlyOnceWith(id)
    const retried = setup(() => id)
    await vi.waitFor(() => expect(retried.value).toEqual(new Set(['apiKey'])))
    expect(mock).toHaveBeenCalledTimes(2)
    expect(flags.value).toEqual(new Set())
  })

  it.each(['failure', 'rejection'] as const)('keeps a newer refresh cached after an initial GET %s', async (kind) => {
    let resolve!: (result: ApiResult<Record<string, boolean>>) => void
    let reject!: (reason: Error) => void
    vi.mocked(api.widgetSecrets).mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail }))
    const id = `refreshed-${kind}`
    const flags = setup(() => id)
    refreshSecretFlags(id, { newerKey: true })
    if (kind === 'failure') resolve({ ok: false, kind: 'unavailable' })
    else reject(new Error('offline'))
    await nextTick()
    await nextTick()
    expect(flags.value).toEqual(new Set(['newerKey']))
    expect(setup(() => id).value).toBe(flags.value)
    expect(api.widgetSecrets).toHaveBeenCalledExactlyOnceWith(id)
  })

  it('keeps a refresh when the initial request finishes later', async () => {
    let resolve!: (result: ApiResult<Record<string, boolean>>) => void
    vi.mocked(api.widgetSecrets).mockReturnValue(new Promise((done) => { resolve = done }))
    const flags = setup(() => 'in-flight')
    refreshSecretFlags('in-flight', { newerKey: true })
    resolve({ ok: true, data: { apiKey: true } })
    await nextTick()
    expect(flags.value).toEqual(new Set(['newerKey']))
  })
})

describe('secret API calls', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { apiKey: true } }))))
  })

  it('gets flags using an encoded widget id', async () => {
    expect(await api.widgetSecrets('widget/a ?')).toEqual({ ok: true, data: { apiKey: true } })
    expect(fetch).toHaveBeenCalledWith('/api/v1/widgets/widget%2Fa%20%3F/secrets', expect.objectContaining({ method: 'GET', body: undefined }))
  })

  it('puts a secret with encoded widget id and key', async () => {
    expect(await api.setWidgetSecret('widget/a ?', 'key/b ?', '0123456789abcdef')).toEqual({ ok: true, data: { apiKey: true } })
    expect(fetch).toHaveBeenCalledWith('/api/v1/widgets/widget%2Fa%20%3F/secrets/key%2Fb%20%3F', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ value: '0123456789abcdef' }),
    }))
  })

  it('deletes a secret with encoded widget id and key and a JSON body', async () => {
    expect(await api.clearWidgetSecret('widget/a ?', 'key/b ?')).toEqual({ ok: true, data: { apiKey: true } })
    expect(fetch).toHaveBeenCalledWith('/api/v1/widgets/widget%2Fa%20%3F/secrets/key%2Fb%20%3F', expect.objectContaining({ method: 'DELETE', body: '{}' }))
  })
})
