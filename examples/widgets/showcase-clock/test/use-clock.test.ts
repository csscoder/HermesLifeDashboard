import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useClock } from '../src/use-clock.ts'

let scope: EffectScope
let media: EventTarget & { matches: boolean }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id))
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useClock', () => {
  it('updates the real time on animation frames', () => {
    const clock = scope.run(() => useClock(() => true))!
    vi.advanceTimersByTime(16)
    expect(clock.now.value).toBe(100_016)
  })

  it('stops hidden work and catches up immediately when visible again', async () => {
    const visible = ref(true)
    const clock = scope.run(() => useClock(() => visible.value))!
    vi.advanceTimersByTime(32)
    visible.value = false
    await nextTick()
    vi.advanceTimersByTime(5_000)
    expect(clock.now.value).toBe(100_032)
    expect(vi.getTimerCount()).toBe(0)
    visible.value = true
    await nextTick()
    expect(clock.now.value).toBe(105_032)
    vi.advanceTimersByTime(16)
    expect(clock.now.value).toBe(105_048)
  })

  it('starts without scheduling work when hidden', () => {
    const clock = scope.run(() => useClock(() => false))!
    vi.advanceTimersByTime(5_000)
    expect(clock.now.value).toBe(100_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ticks once per second for reduced motion', () => {
    media.matches = true
    const clock = scope.run(() => useClock(() => true))!
    expect(clock.reducedMotion.value).toBe(true)
    vi.advanceTimersByTime(999)
    expect(clock.now.value).toBe(100_000)
    vi.advanceTimersByTime(1)
    expect(clock.now.value).toBe(101_000)
  })

  it('switches scheduling when the motion preference changes', async () => {
    const clock = scope.run(() => useClock(() => true))!
    media.matches = true
    media.dispatchEvent(new Event('change'))
    await nextTick()
    expect(clock.reducedMotion.value).toBe(true)
    vi.advanceTimersByTime(16)
    expect(clock.now.value).toBe(100_000)
    vi.advanceTimersByTime(984)
    expect(clock.now.value).toBe(101_000)
    media.matches = false
    media.dispatchEvent(new Event('change'))
    await nextTick()
    vi.advanceTimersByTime(16)
    expect(clock.now.value).toBe(101_016)
  })

  it('cancels scheduled work and removes the preference listener on disposal', () => {
    const clock = scope.run(() => useClock(() => true))!
    scope.stop()
    vi.advanceTimersByTime(5_000)
    expect(clock.now.value).toBe(100_000)
    expect(vi.getTimerCount()).toBe(0)
    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(clock.reducedMotion.value).toBe(false)
  })
})
