import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'
import { gsap } from 'gsap'
import { useActiveRect } from '../app/board/use-active-rect'
import type { Rect, SizeLimits } from '@lifedashboard/contracts/grid'

// A 12×8 grid of 64 px cells with 12 px gaps: the pitch is 76 px on both axes.
const PITCH = 76
const box = { left: 0, top: 0, width: 12 * 64 + 11 * 12, height: 8 * 64 + 7 * 12 }
const limits: SizeLimits = { min: { w: 1, h: 1 }, max: { w: 3, h: 3 } }
let time = 0
const scopes: ReturnType<typeof effectScope>[] = []

function setup(others: Rect[] = [], sizing: SizeLimits | null = limits) {
  const gridEl = shallowRef<HTMLElement | null>({ getBoundingClientRect: () => box } as unknown as HTMLElement)
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useActiveRect({ gridEl, others: () => others, sizing: () => sizing }))!
}

// Vitest runs in Node: a pointer event is a plain object with a capturing target.
function pointer(clientX: number, clientY: number) {
  return {
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    preventDefault() {},
    currentTarget: { setPointerCapture() {} },
  } as unknown as PointerEvent
}

// Drives GSAP manually so the tests control every frame (as in draft-motion.test.ts).
function advance(ms: number, interval = 1000 / 60) {
  const end = time + ms
  while (time < end) {
    time = Math.min(time + interval, end)
    gsap.updateRoot(time / 1000)
    gsap.ticker.sleep()
  }
}

// The card's absolute x in px: its offset from the slot plus the slot origin.
function cardX(active: ReturnType<typeof setup>) {
  const offset = /translate3d\(([^p]+)px/.exec(active.cardStyle.value.transform ?? '')
  return Number(offset![1]) + active.rect.value!.x * PITCH
}

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ columnGap: '12px', rowGap: '12px' }))
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

describe('useActiveRect', () => {
  it('activate keeps a plain rect and snaps the card to the slot', () => {
    const active = setup()
    active.activate({ instanceId: 'a', x: 2, y: 1, w: 2, h: 2 } as Rect)
    expect(active.rect.value).toEqual({ x: 2, y: 1, w: 2, h: 2 })
    expect(active.cardStyle.value).toMatchObject({ width: `${2 * PITCH - 12}px`, height: `${2 * PITCH - 12}px` })
    expect(active.cardStyle.value.transform).toMatch(/^translate3d\(0px, 0px, 0\)/)
  })

  it('deactivate clears the rect and the card style', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.deactivate()
    expect(active.rect.value).toBeNull()
    expect(active.cardStyle.value).toEqual({})
  })

  it('steps by one cell and is blocked by occupied cells and grid bounds', () => {
    const active = setup([{ x: 2, y: 0, w: 1, h: 1 }])
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.step(1, 0, false)
    expect(active.rect.value).toEqual({ x: 1, y: 0, w: 1, h: 1 })
    active.step(1, 0, false)
    expect(active.rect.value).toEqual({ x: 1, y: 0, w: 1, h: 1 })
    active.step(0, -1, false)
    expect(active.rect.value).toEqual({ x: 1, y: 0, w: 1, h: 1 })
  })

  it('resizes by steps within the sizing limits', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 2, h: 2 })
    active.step(1, 0, true)
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
    active.step(1, 0, true)
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
  })

  it('does not resize without sizing limits', () => {
    const active = setup([], null)
    active.activate({ x: 0, y: 0, w: 2, h: 2 })
    active.step(1, 1, true)
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 2, h: 2 })
    active.onPointerDown(pointer(100, 100), 'resize')
    active.onPointerMove(pointer(5 * PITCH + 1, 5 * PITCH + 1))
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })

  it('snaps a pointer move to the nearest free cell and keeps the last valid slot', () => {
    const active = setup([{ x: 6, y: 1, w: 1, h: 1 }])
    active.activate({ x: 0, y: 0, w: 2, h: 2 })
    active.onPointerDown(pointer(10, 10), 'move')
    expect(active.moving.value).toBe(true)
    // Free position 248 px, 106 px → cell 3, 1.
    active.onPointerMove(pointer(10 + 3 * PITCH + 20, 10 + PITCH + 30))
    expect(active.rect.value).toEqual({ x: 3, y: 1, w: 2, h: 2 })
    // Cell 5, 1 would overlap the widget at 6, 1.
    active.onPointerMove(pointer(10 + 5 * PITCH, 10 + PITCH))
    expect(active.rect.value).toEqual({ x: 3, y: 1, w: 2, h: 2 })
    active.onPointerUp()
    expect(active.moving.value).toBe(false)
  })

  it('limits a pointer resize to the sizing limits', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.onPointerDown(pointer(50, 50), 'resize')
    active.onPointerMove(pointer(2 * PITCH + 5, PITCH + 5))
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
    active.onPointerMove(pointer(5 * PITCH + 5, PITCH + 5))
    expect(active.rect.value).toEqual({ x: 0, y: 0, w: 3, h: 2 })
  })

  it('grabbing the active rect again while it settles starts from the visible pose', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.onPointerDown(pointer(0, 0), 'move')
    active.onPointerMove(pointer(300, 0))
    advance(80)
    active.onPointerUp()
    advance(80)
    const settling = active.cardStyle.value.transform
    const visibleX = cardX(active)
    // Still on its way to the slot at x = 4 (304 px), so the slot and the visible pose differ.
    expect(Math.abs(visibleX - 4 * PITCH)).toBeGreaterThan(1)
    active.onPointerDown(pointer(0, 0), 'move')
    expect(active.cardStyle.value.transform).toBe(settling)
    // A move without pointer offset holds the card where it was grabbed, not at the slot.
    active.onPointerMove(pointer(0, 0))
    advance(2400)
    expect(cardX(active)).toBeCloseTo(visibleX, 0)
  })

  it('switching the active rect during a drag ignores the old drag', () => {
    const active = setup()
    active.activate({ x: 0, y: 0, w: 1, h: 1 })
    active.onPointerDown(pointer(0, 0), 'move')
    active.activate({ x: 5, y: 5, w: 1, h: 1 })
    expect(active.moving.value).toBe(false)
    active.onPointerMove(pointer(3 * PITCH, 0))
    expect(active.rect.value).toEqual({ x: 5, y: 5, w: 1, h: 1 })
  })
})
