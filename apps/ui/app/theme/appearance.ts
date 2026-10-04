export const APPEARANCE_STORAGE_KEY = 'lifedashboard.appearance'

// Workspace appearance until settings move to SQLite (E1).
export interface Appearance {
  schemaVersion: 1
  themeId: string | null
}

/** Never throws: missing, malformed or unreadable data yields the defaults. */
export function loadAppearance(): Appearance {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'schemaVersion' in raw &&
      raw.schemaVersion === 1 &&
      'themeId' in raw &&
      (raw.themeId === null || typeof raw.themeId === 'string')
    )
      return { schemaVersion: 1, themeId: raw.themeId }
  } catch {
    // Unreadable storage or malformed JSON: fall through to the defaults.
  }
  return { schemaVersion: 1, themeId: null }
}

/** Never throws; false means the choice stays applied in memory only. */
export function saveAppearance(appearance: Appearance): boolean {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance))
    return true
  } catch {
    return false
  }
}
