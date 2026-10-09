import { GRID_COLS, ROWS, inBounds, overlaps, type Rect } from './grid.ts'
import { fail, isRecord, type ParseResult } from './parse.ts'
import { isPackageId, isPackageVersion } from './widget-package.ts'

export type { ParseResult } from './parse.ts'

export type WidgetSource =
  | { kind: 'builtin'; type: string }
  | { kind: 'package'; packageId: string; version: string }

export interface DropShadow {
  x: number // integer px, SHADOW_LIMITS.x
  y: number // integer px, SHADOW_LIMITS.y
  blur: number // integer px, SHADOW_LIMITS.blur
  color: string // '#rrggbb'
  opacity: number // 0..1
}

// Host-owned look of one widget; never part of `config` (spec 2026-10-09-widget-appearance).
export interface WidgetAppearance {
  themeId: string | null // null: inherit the board theme; BARE_THEME_ID: no frame
  shadow: DropShadow | null // null: the theme's own shadow
}

export interface WidgetInstance {
  id: string
  source: WidgetSource
  // Schema version of `config` (base design §12.2); every widget type starts at 1.
  configVersion: number
  config: Record<string, unknown>
  // Absent when nothing is set (normalizeAppearance).
  appearance?: WidgetAppearance
}

export const BARE_THEME_ID = 'builtin:bare'
export const SHADOW_LIMITS = { x: [-32, 32], y: [-32, 32], blur: [0, 48] } as const
export const DEFAULT_SHADOW: DropShadow = { x: 0, y: 8, blur: 16, color: '#000000', opacity: 0.5 }

export interface WidgetPlacement extends Rect {
  instanceId: string
}

export interface ScreenBoard {
  id: string
  // Configured rows (ROWS.min..ROWS.max); placements may lie below them (base design §7.4).
  rows: number
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

/**
 * Canonical appearance: absent when nothing is set, keys in a fixed order. The parser and the UI
 * both build it here, so boards compare equal as JSON (isSameBoard).
 */
export function normalizeAppearance(appearance: WidgetAppearance | null | undefined): WidgetAppearance | undefined {
  if (!appearance || (appearance.themeId === null && appearance.shadow === null)) return undefined
  const { shadow } = appearance
  return {
    themeId: appearance.themeId,
    shadow: shadow && { x: shadow.x, y: shadow.y, blur: shadow.blur, color: shadow.color, opacity: shadow.opacity },
  }
}

// Single validation point for a screen from outside the process: API requests now, file import later.
export function parseScreenBoard(raw: unknown): ParseResult<ScreenBoard> {
  if (!isRecord(raw)) return fail('screen must be an object')
  if (!isUuid(raw.id)) return fail('screen id must be a UUID')
  const rows = raw.rows
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < ROWS.min || rows > ROWS.max) {
    return fail(`rows must be an integer ${ROWS.min}..${ROWS.max}`)
  }
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
    const appearance = parseAppearance(item.appearance)
    if (appearance === null) return fail(`instances[${index}]: invalid appearance`)
    ids.add(item.id)
    // appearance goes last, as rooms.ts reads it back: isSameBoard compares JSON.
    instances.push({ id: item.id, source, configVersion: version, config: item.config, ...(appearance && { appearance }) })
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
      return fail(`layout[${index}]: x, y, w, h must be integers with w, h >= 1 inside the ${GRID_COLS}x${ROWS.max} grid`)
    }
    if (layout.some((other) => overlaps(other, rect))) return fail(`layout[${index}]: overlaps another placement`)
    placed.add(item.instanceId)
    layout.push({ instanceId: item.instanceId, ...rect })
  }

  const unplaced = instances.find((instance) => !placed.has(instance.id))
  if (unplaced) return fail(`instance "${unplaced.id}" has no placement`)

  return { ok: true, value: { id: raw.id, rows, instances, layout } }
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

const BUILTIN_THEME = /^builtin:[a-z0-9-]+$/
const HEX_COLOR = /^#[0-9a-f]{6}$/i

// undefined: nothing set (absent, null or both fields null); null: invalid.
function parseAppearance(raw: unknown): WidgetAppearance | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) return null
  const { themeId, shadow } = raw
  if (themeId !== null && !isThemeId(themeId)) return null
  if (shadow !== null && !isDropShadow(shadow)) return null
  return normalizeAppearance({ themeId, shadow })
}

// A well-formed unknown id is valid: rendering treats it as unset, the stored reference stays.
function isThemeId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return BUILTIN_THEME.test(value) || (value.startsWith('user:') && isUuid(value.slice('user:'.length)))
}

function isDropShadow(value: unknown): value is DropShadow {
  if (!isRecord(value)) return false
  const within = (n: unknown, [min, max]: readonly [number, number]) =>
    typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  const { opacity, color } = value
  return (
    within(value.x, SHADOW_LIMITS.x) &&
    within(value.y, SHADOW_LIMITS.y) &&
    within(value.blur, SHADOW_LIMITS.blur) &&
    typeof color === 'string' &&
    HEX_COLOR.test(color) &&
    typeof opacity === 'number' &&
    Number.isFinite(opacity) &&
    opacity >= 0 &&
    opacity <= 1
  )
}

function toRect(item: Record<string, unknown>): Rect | null {
  const { x, y, w, h } = item
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) return null
  const rect = { x, y, w, h } as Rect
  return inBounds(rect) ? rect : null
}
