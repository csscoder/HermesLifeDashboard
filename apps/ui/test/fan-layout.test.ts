import { describe, expect, it } from 'vitest'
import { FAN_GEOMETRY, fanLayout } from '../app/spaces/fan-layout'

const g = { r0: 9.125, step: 6.75, size: 5, gap: 1.5 }

describe('fanLayout', () => {
  it('fits all 21 production slots inside a compact corner without overlapping hovered bubbles', () => {
    const { r0, step, size } = FAN_GEOMETRY
    const points = fanLayout(21, FAN_GEOMETRY).map(({ ring, angle }) => {
      const radius = r0 + ring * step
      // Include the 10 px inset at the minimum viewport's 16 px/rem scale.
      return { x: 2.625 + radius * Math.cos(angle * Math.PI / 180), y: 2.375 + radius * Math.sin(angle * Math.PI / 180) }
    })
    for (const point of points) {
      expect(point.x - size / 2).toBeGreaterThanOrEqual(0)
      expect(point.y - size / 2).toBeGreaterThanOrEqual(0)
      expect(point.x + size / 2).toBeLessThanOrEqual(20)
      expect(point.y + size / 2).toBeLessThanOrEqual(20)
    }
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++)
        expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)).toBeGreaterThanOrEqual(size)
  })

  it('places three items on the first ring', () => {
    const layout = fanLayout(3, g)
    expect(layout.map((p) => p.ring)).toEqual([0, 0, 0])
    expect(layout.map((p) => p.angle)).toEqual([
      expect.closeTo(8, 2),
      expect.closeTo(45, 2),
      expect.closeTo(82, 2),
    ])
  })

  it('splits six items into a full first ring and a second ring of three', () => {
    const layout = fanLayout(6, g)
    expect(layout.map((p) => p.ring)).toEqual([0, 0, 0, 1, 1, 1])
    expect(layout.slice(3).map((p) => p.angle)).toEqual([
      expect.closeTo(20.33, 2),
      expect.closeTo(45, 2),
      expect.closeTo(69.67, 2),
    ])
  })

  it('centres a single item at 45 degrees', () => {
    expect(fanLayout(1, g)).toEqual([{ ring: 0, angle: 45 }])
  })

  it('returns no items for an empty fan', () => {
    expect(fanLayout(0, g)).toEqual([])
  })

  it('fills rings of capacity 3, 4, 6, 8 for 21 items', () => {
    const layout = fanLayout(21, g)
    expect(layout).toHaveLength(21)
    const counts = new Map<number, number>()
    for (const p of layout) counts.set(p.ring, (counts.get(p.ring) ?? 0) + 1)
    expect([...counts.entries()]).toEqual([
      [0, 3],
      [1, 4],
      [2, 6],
      [3, 8],
    ])
    expect(Math.max(...layout.map((p) => p.ring))).toBe(3)
  })

  it('keeps every angle within [8, 82]', () => {
    for (const p of fanLayout(21, g)) {
      expect(p.angle).toBeGreaterThanOrEqual(8 - 0.01)
      expect(p.angle).toBeLessThanOrEqual(82 + 0.01)
    }
  })
})
