import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive } from 'vue'
import { useWeather } from '../src/use-weather.ts'
import { forecast } from './fixture.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const reply = (status = 200, body: unknown = forecast()) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const scopes: ReturnType<typeof effectScope>[] = []

function setup(visible = true) {
  const context = reactive({ visible, config: { city: 'London', latitude: 51.5074, longitude: -0.1278 } })
  const requests: { url: string; accept: string | undefined; answer: ReturnType<typeof deferred<ReturnType<typeof reply>>> }[] = []
  const scope = effectScope()
  scopes.push(scope)
  const weather = scope.run(() => useWeather({
    context,
    http: { get: (url: string, options?: { accept?: string }) => {
      const answer = deferred<ReturnType<typeof reply>>()
      requests.push({ url, accept: options?.accept, answer })
      return answer.promise
    } },
  }))!
  return { context, requests, scope, weather }
}

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})

describe('weather refresh lifecycle', () => {
  it('loads real HTTP data and prevents overlapping manual refreshes', async () => {
    const { requests, weather } = setup()
    expect(weather.loading.value).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.accept).toBe('application/json')
    expect(new URL(requests[0]!.url).searchParams.get('latitude')).toBe('51.5074')
    await weather.refresh()
    expect(requests).toHaveLength(1)
    requests[0]!.answer.resolve(reply())
    await vi.waitFor(() => expect(weather.loading.value).toBe(false))
    expect(weather.data.value).toMatchObject({ temperature: 14.3, humidity: 55 })
    expect(weather.error.value).toBe(false)
    expect(weather.stale.value).toBe(false)
  })

  it('retains verified weather when the host replaces config with identical values', async () => {
    const { context, requests, weather } = setup()
    requests[0]!.answer.resolve(reply())
    await vi.waitFor(() => expect(weather.data.value?.temperature).toBe(14.3))
    context.config = { city: 'London', latitude: 51.5074, longitude: -0.1278 }
    expect(weather.data.value?.temperature).toBe(14.3)
    expect(weather.loading.value).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it('retains verified weather when only the city label changes', async () => {
    const { context, requests, weather } = setup()
    requests[0]!.answer.resolve(reply())
    await vi.waitFor(() => expect(weather.data.value?.temperature).toBe(14.3))
    context.config.city = 'Home in London'
    expect(context.config.city).toBe('Home in London')
    expect(weather.data.value?.temperature).toBe(14.3)
    expect(weather.loading.value).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it.each([reply(503), reply(200, { current: null }), { status: 200, contentType: 'text/plain', body: 'broken JSON' }])(
    'shows unavailable without invented weather on failed or invalid response %j', async (response) => {
      const { requests, weather } = setup()
      expect(requests).toHaveLength(1)
      requests[0]!.answer.resolve(response)
      await vi.waitFor(() => expect(weather.error.value).toBe(true))
      expect(weather.data.value).toBeNull()
      expect(weather.loading.value).toBe(false)
    },
  )

  it('retains last verified data as stale after a refresh failure and clears the failure after recovery', async () => {
    const { requests, weather } = setup()
    expect(requests).toHaveLength(1)
    requests[0]!.answer.resolve(reply())
    await vi.waitFor(() => expect(weather.data.value?.temperature).toBe(14.3))
    const refresh = weather.refresh()
    requests[1]!.answer.reject(new Error('upstream timeout'))
    await refresh
    expect(weather.data.value?.temperature).toBe(14.3)
    expect(weather.stale.value).toBe(true)
    expect(weather.error.value).toBe(true)
    const retry = weather.refresh()
    const next = forecast()
    next.current.temperature_2m = 13
    requests[2]!.answer.resolve(reply(200, next))
    await retry
    expect(weather.data.value?.temperature).toBe(13)
    expect(weather.stale.value).toBe(false)
    expect(weather.error.value).toBe(false)
  })

  it('ignores an old location response and never presents the old city data under a new label', async () => {
    const { context, requests, weather } = setup()
    expect(requests).toHaveLength(1)
    context.config = { city: 'Sydney', latitude: -33.8688, longitude: 151.2093 }
    expect(requests).toHaveLength(2)
    expect(weather.data.value).toBeNull()
    expect(new URL(requests[1]!.url).searchParams.get('latitude')).toBe('-33.8688')
    requests[0]!.answer.resolve(reply())
    await Promise.resolve()
    expect(weather.data.value).toBeNull()
    expect(weather.loading.value).toBe(true)
    const next = forecast()
    next.current.temperature_2m = 26
    requests[1]!.answer.resolve(reply(200, next))
    await vi.waitFor(() => expect(weather.loading.value).toBe(false))
    expect(weather.data.value?.temperature).toBe(26)
  })

  it('ignores an old request failure after the new location has loaded', async () => {
    const { context, requests, weather } = setup()
    expect(requests).toHaveLength(1)
    context.config = { city: 'Paris', latitude: 48.85, longitude: 2.35 }
    requests[1]!.answer.resolve(reply())
    await vi.waitFor(() => expect(weather.data.value?.temperature).toBe(14.3))
    requests[0]!.answer.reject(new Error('old location failure'))
    await Promise.resolve()
    expect(weather.error.value).toBe(false)
    expect(weather.stale.value).toBe(false)
    expect(weather.loading.value).toBe(false)
  })

  it('polls every fifteen minutes only while visible and stops after disposal', async () => {
    vi.useFakeTimers()
    const { context, requests, scope, weather } = setup(false)
    expect(requests).toHaveLength(0)
    context.visible = true
    expect(requests).toHaveLength(1)
    requests[0]!.answer.resolve(reply())
    await Promise.resolve()
    expect(weather.data.value?.temperature).toBe(14.3)
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(requests).toHaveLength(2)
    requests[1]!.answer.resolve(reply())
    await Promise.resolve()
    context.visible = false
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(requests).toHaveLength(2)
    context.visible = true
    expect(requests).toHaveLength(3)
    requests[2]!.answer.resolve(reply())
    await Promise.resolve()
    scope.stop()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(requests).toHaveLength(3)
  })

  it('does not change data after disposal even if a request later succeeds', async () => {
    const { requests, scope, weather } = setup()
    expect(requests).toHaveLength(1)
    scope.stop()
    requests[0]!.answer.resolve(reply())
    await Promise.resolve()
    expect(weather.data.value).toBeNull()
    expect(weather.loading.value).toBe(false)
  })
})
