import type { SpaceSummary } from '@lifedashboard/contracts/space'

export const LAST_OPEN_STORAGE_KEY = 'lifedashboard.lastOpen'

// Last space and screen per space, remembered per browser. Stale ids fall back to the first entry.
export interface LastOpen {
  schemaVersion: 1
  spaceId: string | null
  screens: Record<string, string>
}

/** Never throws: missing, malformed or unreadable data yields the defaults. */
export function loadLastOpen(): LastOpen {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LAST_OPEN_STORAGE_KEY) ?? 'null')
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'schemaVersion' in raw &&
      raw.schemaVersion === 1 &&
      'spaceId' in raw &&
      (raw.spaceId === null || typeof raw.spaceId === 'string') &&
      'screens' in raw &&
      typeof raw.screens === 'object' &&
      raw.screens !== null &&
      !Array.isArray(raw.screens)
    ) {
      // Non-string screen values are dropped, the rest of the memory is kept.
      const screens = Object.fromEntries(
        Object.entries(raw.screens).filter(([, id]) => typeof id === 'string'),
      )
      return { schemaVersion: 1, spaceId: raw.spaceId, screens }
    }
  } catch {
    // Unreadable storage or malformed JSON: fall through to the defaults.
  }
  return { schemaVersion: 1, spaceId: null, screens: {} }
}

/** Never throws; false means the choice is not remembered. */
export function saveLastOpen(value: LastOpen): boolean {
  try {
    localStorage.setItem(LAST_OPEN_STORAGE_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function resolveLastOpen(stored: LastOpen, spaces: readonly SpaceSummary[]): string | null {
  const listed = spaces.some((space) => space.id === stored.spaceId)
  return listed ? stored.spaceId : (spaces[0]?.id ?? null)
}

export function screenFor(
  stored: LastOpen,
  spaceId: string,
  screenIds: readonly string[],
): string | null {
  const remembered = stored.screens[spaceId]
  if (remembered !== undefined && screenIds.includes(remembered)) return remembered
  return screenIds[0] ?? null
}
