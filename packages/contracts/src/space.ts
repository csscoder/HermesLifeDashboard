import { BARE_THEME_ID, isThemeId } from './board.ts'
import { fail, isRecord, unknownKey, type ParseResult } from './parse.ts'

export const SPACE_LIMITS = { spaces: 20, screens: 20, title: 40 } as const
export const NEW_SPACE_TITLE = 'Новое пространство'
export const NEW_SPACE_ICON = '⭐'

export const SPACE_ICONS: readonly string[] = [
  '🏠', '💼', '🫀', '📚', '💰', '🎸', '✈️', '👨‍👩‍👧', '🧩', '📖', '🏃', '🎧',
  '🌿', '🍳', '🎮', '🧘', '🎨', '📷', '🚗', '🐾', '☕', '🌙', '⭐', '🔥',
]

export type SpaceColor = 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'pink'

// Key → oklch hue. The key order is the palette order used by nextColor.
export const SPACE_COLORS: Readonly<Record<SpaceColor, number>> = {
  violet: 280,
  blue: 240,
  teal: 200,
  green: 150,
  amber: 80,
  orange: 50,
  red: 25,
  pink: 330,
}

export interface SpaceSummary {
  id: string
  title: string
  icon: string
  color: SpaceColor
  themeId: string | null
  position: number
  revision: number
}

export interface SpacePatch {
  title?: string
  icon?: string
  color?: SpaceColor
  themeId?: string | null
}

export interface DeleteRequest {
  expectedRevision: number
}

export type AddScreenRequest = DeleteRequest

const PATCH_KEYS = ['title', 'icon', 'color', 'themeId']

function isSpaceColor(value: unknown): value is SpaceColor {
  return typeof value === 'string' && Object.keys(SPACE_COLORS).includes(value)
}

// Returns only the keys present in `raw`; the title comes back trimmed.
export function parseSpacePatch(raw: unknown): ParseResult<SpacePatch> {
  if (!isRecord(raw)) return fail('space must be an object')
  const extra = unknownKey(raw, PATCH_KEYS)
  if (extra !== undefined) return fail(`unknown field "${extra}"`)

  const patch: SpacePatch = {}
  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string') return fail('title must be a string')
    const title = raw.title.trim()
    const length = [...title].length
    if (length < 1 || length > SPACE_LIMITS.title) return fail(`title must be 1..${SPACE_LIMITS.title} characters`)
    patch.title = title
  }
  if (raw.icon !== undefined) {
    if (typeof raw.icon !== 'string' || !SPACE_ICONS.includes(raw.icon)) return fail('icon must be one of the space icons')
    patch.icon = raw.icon
  }
  if (raw.color !== undefined) {
    if (!isSpaceColor(raw.color)) return fail('color must be one of the space colours')
    patch.color = raw.color
  }
  if (raw.themeId !== undefined) {
    if (raw.themeId !== null && (!isThemeId(raw.themeId) || raw.themeId === BARE_THEME_ID)) return fail('invalid space themeId')
    patch.themeId = raw.themeId
  }
  if (Object.keys(patch).length === 0) return fail('nothing to change')
  return { ok: true, value: patch }
}

// The first free colour in palette order; once all are used, wrap around by the count.
export function nextColor(used: readonly SpaceColor[]): SpaceColor {
  const keys = Object.keys(SPACE_COLORS) as SpaceColor[]
  return keys.find((key) => !used.includes(key)) ?? keys[used.length % keys.length]!
}
