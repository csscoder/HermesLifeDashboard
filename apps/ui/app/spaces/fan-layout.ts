export interface FanGeometry {
  r0: number
  step: number
  size: number
  gap: number
}

export interface FanSlot {
  ring: number
  angle: number
}

const ARC_DEGREES = 74
const CENTRE_DEGREES = 45

/** Places items on concentric arcs from the top edge (0 degrees) to the right edge (90). */
export function fanLayout(count: number, geometry: FanGeometry): FanSlot[] {
  const slots: FanSlot[] = []
  let remaining = count
  for (let ring = 0; remaining > 0; ring++) {
    const radius = geometry.r0 + ring * geometry.step
    const arc = (Math.PI / 2) * radius
    const fit = Math.max(2, Math.floor(arc / (geometry.size + geometry.gap)) + 1)
    const take = Math.min(fit, remaining)
    const spacing = ARC_DEGREES / (fit - 1)
    const start = CENTRE_DEGREES - (spacing * (take - 1)) / 2
    for (let i = 0; i < take; i++) slots.push({ ring, angle: start + i * spacing })
    remaining -= take
  }
  return slots
}
