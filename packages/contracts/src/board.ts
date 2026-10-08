import { GRID, inBounds, overlaps, type Rect } from './grid.ts'
import { fail, isRecord, type ParseResult } from './parse.ts'
import { isPackageId, isPackageVersion } from './widget-package.ts'

export type { ParseResult } from './parse.ts'

export type WidgetSource =
  | { kind: 'builtin'; type: string }
  | { kind: 'package'; packageId: string; version: string }

export interface WidgetInstance {
  id: string
  source: WidgetSource
  // Schema version of `config` (base design §12.2); every widget type starts at 1.
  configVersion: number
  config: Record<string, unknown>
}

export interface WidgetPlacement extends Rect {
  instanceId: string
}

export interface ScreenBoard {
  id: string
  instances: WidgetInstance[]
  layout: WidgetPlacement[]
}

export interface RoomBoard {
  roomId: string
  revision: number
  // Ordered by screen position.
  screens: ScreenBoard[]
}

export interface RoomSummary {
  id: string
  title: string
  position: number
  revision: number
}

export interface SaveBoardRequest {
  expectedRevision: number
  screens: ScreenBoard[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

// Single validation point for a screen from outside the process: API requests now, file import later.
export function parseScreenBoard(raw: unknown): ParseResult<ScreenBoard> {
  if (!isRecord(raw)) return fail('screen must be an object')
  if (!isUuid(raw.id)) return fail('screen id must be a UUID')
  if (!Array.isArray(raw.instances) || !Array.isArray(raw.layout)) return fail('instances and layout must be arrays')

  const instances: WidgetInstance[] = []
  const ids = new Set<string>()
  for (const [index, item] of raw.instances.entries()) {
    if (!isRecord(item) || !isUuid(item.id)) return fail(`instances[${index}]: id must be a UUID`)
    if (ids.has(item.id)) return fail(`instances[${index}]: duplicate id "${item.id}"`)
    const source = parseSource(item.source)
    if (!source) return fail(`instances[${index}]: invalid source`)
    const version = item.configVersion
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return fail(`instances[${index}]: configVersion must be a positive integer`)
    }
    if (!isRecord(item.config)) return fail(`instances[${index}]: config must be an object`)
    ids.add(item.id)
    instances.push({ id: item.id, source, configVersion: version, config: item.config })
  }

  const layout: WidgetPlacement[] = []
  const placed = new Set<string>()
  for (const [index, item] of raw.layout.entries()) {
    if (!isRecord(item) || typeof item.instanceId !== 'string' || !ids.has(item.instanceId)) {
      return fail(`layout[${index}]: unknown instanceId ${JSON.stringify(isRecord(item) ? item.instanceId : item)}`)
    }
    if (placed.has(item.instanceId)) return fail(`layout[${index}]: instance "${item.instanceId}" placed twice`)
    const rect = toRect(item)
    if (!rect) {
      return fail(`layout[${index}]: x, y, w, h must be integers with w, h >= 1 inside the ${GRID.cols}x${GRID.rows} grid`)
    }
    if (layout.some((other) => overlaps(other, rect))) return fail(`layout[${index}]: overlaps another placement`)
    placed.add(item.instanceId)
    layout.push({ instanceId: item.instanceId, ...rect })
  }

  const unplaced = instances.find((instance) => !placed.has(instance.id))
  if (unplaced) return fail(`instance "${unplaced.id}" has no placement`)

  return { ok: true, value: { id: raw.id, instances, layout } }
}

function parseSource(raw: unknown): WidgetSource | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'builtin') return isNonEmptyString(raw.type) ? { kind: 'builtin', type: raw.type } : null
  if (raw.kind === 'package' && isPackageId(raw.packageId) && isPackageVersion(raw.version)) {
    return { kind: 'package', packageId: raw.packageId, version: raw.version }
  }
  return null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function toRect(item: Record<string, unknown>): Rect | null {
  const { x, y, w, h } = item
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) return null
  const rect = { x, y, w, h } as Rect
  return inBounds(rect) ? rect : null
}
