import { onScopeDispose, shallowRef } from 'vue'
import { gsap } from 'gsap'

type Point = { x: number; y: number }
const neutral = { rotate: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 }
const shapeKeys = Object.keys(neutral) as (keyof typeof neutral)[]
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * GSAP pose of the builder draft in px from the grid origin: the position eases towards the
 * target and the shape stretches with pointer velocity, then springs back. Grid cells, bounds
 * and collisions stay with the board. Ported from HermesPersonalOS weather-motion.
 */
export function useDraftMotion(initial: Point) {
  const pose = shallowRef({ ...initial, ...neutral })
  const position = { ...initial }
  const shape = { ...neutral }
  let deformation: gsap.core.Tween | undefined
  let relaxation: gsap.core.Tween | undefined
  let lastPoint = initial
  let lastTime: number | undefined
  let dragging = false

  function publish() {
    pose.value = {
      x: position.x,
      y: position.y,
      rotate: shape.rotate,
      scaleX: Math.max(0.2, shape.scaleX),
      scaleY: Math.max(0.2, shape.scaleY),
      skewX: shape.skewX,
      skewY: shape.skewY,
    }
  }
  const xTo = gsap.quickTo(position, 'x', { duration: 0.28, ease: 'power3.out', onUpdate: publish })
  const yTo = gsap.quickTo(position, 'y', { duration: 0.28, ease: 'power3.out', onUpdate: publish })
  const shapeTo = Object.fromEntries(
    shapeKeys.map((key) => [key, gsap.quickTo(shape, key, { duration: 0.18, ease: 'power2.out', onUpdate: publish })]),
  ) as Record<keyof typeof neutral, ReturnType<typeof gsap.quickTo>>

  function stopShape() {
    relaxation?.kill()
    deformation?.kill()
    shapeKeys.forEach((key) => shapeTo[key].tween.pause())
  }

  function relax(lift: number) {
    stopShape()
    deformation = gsap.to(shape, {
      ...neutral,
      scaleX: lift,
      scaleY: lift,
      duration: 1.05,
      ease: 'elastic.out(1, .38)',
      onUpdate: publish,
    })
  }

  function reset(point: Point) {
    xTo.tween.pause()
    yTo.tween.pause()
    stopShape()
    Object.assign(position, point)
    Object.assign(shape, neutral)
    lastPoint = { ...point }
    lastTime = undefined
    dragging = false
    publish()
  }

  /** `held` = the pointer still drags; a release (false) springs the shape back to neutral. */
  function moveTo(target: Point, held = false) {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reset(target)
      return
    }
    const time = performance.now()
    if (held && !dragging) {
      // A fresh grab measures velocity from the visible pose, not from the last target.
      lastPoint = { x: position.x, y: position.y }
      lastTime = undefined
    }
    dragging = held
    const elapsed = lastTime === undefined ? 1000 / 60 : Math.max(time - lastTime, 8)
    const vx = (target.x - lastPoint.x) / elapsed
    const vy = (target.y - lastPoint.y) / elapsed
    lastPoint = target
    lastTime = time
    xTo(target.x, position.x)
    yTo(target.y, position.y)
    if (!held) {
      lastTime = undefined
      relax(1)
      return
    }
    const speed = Math.hypot(vx, vy)
    const stretch = Math.min(speed * 0.18, 0.3)
    const nx = speed ? vx / speed : 0
    const ny = speed ? vy / speed : 0
    const desired = {
      rotate: clamp(vx * 2, -6, 6),
      scaleX: Math.max(0.2, 1.035 + stretch * (nx * nx - 0.65 * ny * ny)),
      scaleY: Math.max(0.2, 1.035 + stretch * (ny * ny - 0.65 * nx * nx)),
      skewX: clamp(vx * 1.2 + nx * ny * stretch * 20, -8, 8),
      skewY: clamp(vy * 1.2 + nx * ny * stretch * 20, -8, 8),
    }
    stopShape()
    shapeKeys.forEach((key) => shapeTo[key](desired[key], shape[key]))
    // Reusable tweens survive frequent pointer events; relaxation begins only after movement stops.
    relaxation = gsap.delayedCall(0.1, () => relax(1.035))
  }

  onScopeDispose(() => {
    xTo.tween.kill()
    yTo.tween.kill()
    stopShape()
    shapeKeys.forEach((key) => shapeTo[key].tween.kill())
  })

  return { pose, moveTo, reset }
}
