import type { ScreenBoard } from '@lifedashboard/contracts/board'

/** Single screen: the plain title. Several: the title plus the 1-based index. */
export function headerTitle(title: string, index: number, count: number): string {
  return count > 1 ? `${title} (${index + 1})` : title
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
