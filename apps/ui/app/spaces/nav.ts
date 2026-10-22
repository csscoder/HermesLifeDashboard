import type { ScreenBoard } from '@lifedashboard/contracts/board'

/** The part after the space title: « (2)» of the second of several screens, empty for one screen. */
export function screenSuffix(index: number, count: number): string {
  return count > 1 ? ` (${index + 1})` : ''
}

/** Single screen: the plain title. Several: the title plus the 1-based index. */
export function headerTitle(title: string, index: number, count: number): string {
  return title + screenSuffix(index, count)
}

/** Screen to open after `deletedId`: the previous one, or the next when the first is deleted. */
export function afterDelete(ids: readonly string[], deletedId: string): string | null {
  const index = ids.indexOf(deletedId)
  const rest = ids.filter((id) => id !== deletedId)
  return rest[Math.max(index - 1, 0)] ?? null
}

/** Confirmation is needed when the saved or the working screen still holds widgets. */
export function needsDeleteConfirm(
  saved: ScreenBoard | undefined,
  working: ScreenBoard | null,
): boolean {
  return (saved?.instances.length ?? 0) > 0 || (working?.instances.length ?? 0) > 0
}
