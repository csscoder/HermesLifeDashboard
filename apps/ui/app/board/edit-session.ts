import type { BoardDocument, LoadError, WidgetPlacement } from '../widgets/board-document'
import type { Rect } from '../widgets/grid'

/** Board interaction mode: display only, the builder draft, or editing the placed widgets. */
export type BoardMode = 'view' | 'build' | 'edit'

/** What «Готово» does with an edit session. */
export type ConfirmOutcome = 'unchanged' | 'conflict' | 'save'

export function setPlacement(doc: BoardDocument, id: string, rect: Rect): BoardDocument {
  // Only the rect fields are copied: callers may pass a placement or a rect with extra keys.
  const placement = { instanceId: id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  return { ...doc, layout: doc.layout.map((item) => (item.instanceId === id ? placement : item)) }
}

export function removeInstance(doc: BoardDocument, id: string): BoardDocument {
  return {
    ...doc,
    instances: doc.instances.filter((item) => item.id !== id),
    layout: doc.layout.filter((item) => item.instanceId !== id),
  }
}

// ponytail: JSON comparison is key-order sensitive; every document comes from parseBoardDocument or
// the helpers above, which keep one key order. Switch to a structural compare if other sources appear.
export function isSameBoard(a: BoardDocument, b: BoardDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Placements by row, then column. */
export function readingOrder(layout: readonly WidgetPlacement[]): WidgetPlacement[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** The widget to focus after deleting `id`: the next in reading order, else the previous one. */
export function focusAfterRemoval(layout: readonly WidgetPlacement[], id: string): string | null {
  const order = readingOrder(layout)
  const index = order.findIndex((item) => item.instanceId === id)
  if (index < 0) return null
  return (order[index + 1] ?? order[index - 1])?.instanceId ?? null
}

/**
 * Decides «Готово» for an edit session. `doc` is the document the session started from; `stored`
 * is a fresh storage read, or null when an earlier save failed and memory is newer than storage
 * (known limitation: another tab's save made meanwhile is then overwritten). A failed read cannot
 * prove a conflict, so it never blocks the save — the builder's refresh() rule.
 */
export function confirmOutcome(
  working: BoardDocument,
  doc: BoardDocument,
  stored: { doc: BoardDocument; error?: LoadError } | null,
): ConfirmOutcome {
  if (isSameBoard(working, doc)) return 'unchanged'
  if (stored && !stored.error && !isSameBoard(stored.doc, doc)) return 'conflict'
  return 'save'
}
