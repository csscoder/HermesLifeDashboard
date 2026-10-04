import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { gsap } from 'gsap'
import { useDraftMotion } from '../app/board/draft-motion'

const rest = { rotate: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 }
let time = 0
const scopes: ReturnType<typeof effectScope>[] = []

// Drives GSAP manually so the tests control every frame.
function advance(ms: number, interval = 1000 / 60) {
  const end = time + ms
  while (time < end) {
    time = Math.min(time + interval, end)
    gsap.updateRoot(time / 1000)
    gsap.ticker.sleep()
  }
}

function motion(initial = { x: 100, y: 100 }) {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useDraftMotion(initial))!
}

function activeTweens() {
  return gsap.globalTimeline.getChildren().filter((animation) => animation.isActive())
}

beforeEach(() => {
  gsap.ticker.remove(gsap.updateRoot)
  gsap.globalTimeline.clear()
  gsap.updateRoot(0)
  gsap.ticker.sleep()
  time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
})

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  gsap.globalTimeline.clear()
  gsap.ticker.add(gsap.updateRoot)
  gsap.ticker.sleep()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useDraftMotion', () => {
  it('follows a pull softly instead of jumping to the pointer', () => {
    const jelly = motion()
    jelly.moveTo({ x: 280, y: 100 }, true)
    expect(jelly.pose.value.x).toBe(100)
    advance(80)
    expect(jelly.pose.value.x).toBeGreaterThan(100)
    expect(jelly.pose.value.x).toBeLessThan(280)
    advance(2400)
    expect(jelly.pose.value.x).toBeCloseTo(280, 1)
  })

  it('stretches along the pull direction within a bounded range', () => {
    const jelly = motion()
    jelly.moveTo({ x: 100, y: 100 }, true)
    for (let step = 1; step <= 12; step++) {
      advance(16)
      jelly.moveTo({ x: 100 + step * 40, y: 100 }, true)
      expect(jelly.pose.value.scaleX).toBeLessThan(1.4)
      expect(jelly.pose.value.scaleY).toBeGreaterThan(0.8)
      expect(Math.abs(jelly.pose.value.rotate)).toBeLessThanOrEqual(6)
      expect(Math.abs(jelly.pose.value.skewX)).toBeLessThanOrEqual(8)
    }
    expect(jelly.pose.value.scaleX).toBeGreaterThan(1.15)
    expect(jelly.pose.value.scaleY).toBeLessThan(1)
  })

  it('stretches vertically on a vertical pull', () => {
    const jelly = motion()
    jelly.moveTo({ x: 100, y: 280 }, true)
    advance(80)
    expect(jelly.pose.value.scaleY).toBeGreaterThan(jelly.pose.value.scaleX)
  })

  it('does not invent velocity when a settling draft is grabbed in place', () => {
    const jelly = motion()
    jelly.moveTo({ x: 400, y: 100 }, false)
    advance(80)
    jelly.moveTo({ x: jelly.pose.value.x, y: jelly.pose.value.y }, true)
    advance(80)
    expect(Math.abs(jelly.pose.value.scaleX - jelly.pose.value.scaleY)).toBeLessThan(0.02)
  })

  it('settles exactly on the target after release and leaves no running tweens', () => {
    const jelly = motion()
    jelly.moveTo({ x: 280, y: 100 }, true)
    advance(120)
    jelly.moveTo({ x: 176, y: 100 }, false)
    advance(80)
    expect(jelly.pose.value.scaleX).not.toBe(1)
    advance(2400)
    expect(jelly.pose.value).toEqual({ x: 176, y: 100, ...rest })
    expect(activeTweens()).toHaveLength(0)
  })

  it('reset places the draft immediately with a neutral shape', () => {
    const jelly = motion()
    jelly.moveTo({ x: 280, y: 100 }, true)
    advance(80)
    jelly.reset({ x: 0, y: 76 })
    expect(jelly.pose.value).toEqual({ x: 0, y: 76, ...rest })
    advance(500)
    expect(jelly.pose.value).toEqual({ x: 0, y: 76, ...rest })
  })

  it('stops updating after its scope is disposed', () => {
    const jelly = motion()
    jelly.moveTo({ x: 280, y: 100 }, true)
    advance(120)
    const before = { ...jelly.pose.value }
    scopes[0]!.stop()
    advance(1000)
    expect(jelly.pose.value).toEqual(before)
    expect(activeTweens()).toHaveLength(0)
  })

  it('jumps without deformation under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const jelly = motion()
    jelly.moveTo({ x: 280, y: 176 }, true)
    expect(jelly.pose.value).toEqual({ x: 280, y: 176, ...rest })
    expect(activeTweens()).toHaveLength(0)
  })
})
