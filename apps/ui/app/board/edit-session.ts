import { normalizeAppearance, type ScreenBoard, type WidgetAppearance, type WidgetPlacement } from '@lifedashboard/contracts/board'
import { ROWS, type Rect } from '@lifedashboard/contracts/grid'

/** Board interaction mode: display only, the builder draft, or editing the placed widgets. */
export type BoardMode = 'view' | 'build' | 'edit'

export function setPlacement(doc: ScreenBoard, id: string, rect: Rect): ScreenBoard {
  // Only the rect fields are copied: callers may pass a placement or a rect with extra keys.
  const placement = { instanceId: id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  return { ...doc, layout: doc.layout.map((item) => (item.instanceId === id ? placement : item)) }
}

export function removeInstance(doc: ScreenBoard, id: string): ScreenBoard {
  return {
    ...doc,
    instances: doc.instances.filter((item) => item.id !== id),
    layout: doc.layout.filter((item) => item.instanceId !== id),
  }
}

/** The board with `id`'s appearance replaced; an empty one removes the key (normalizeAppearance). */
export function setAppearance(doc: ScreenBoard, id: string, next: WidgetAppearance | null | undefined): ScreenBoard {
  const appearance = normalizeAppearance(next)
  return {
    ...doc,
    instances: doc.instances.map((item) => {
      if (item.id !== id) return item
      // Rebuilt without the old key, so a new appearance goes last, as the API returns it.
      const { appearance: _old, ...rest } = item
      return appearance ? { ...rest, appearance } : rest
    }),
  }
}

/** The board with new configured rows; anything but an integer in ROWS.min..ROWS.max changes nothing. */
export function withRows(doc: ScreenBoard, rows: number): ScreenBoard {
  return Number.isInteger(rows) && rows >= ROWS.min && rows <= ROWS.max ? { ...doc, rows } : doc
}

// ponytail: JSON comparison is key-order sensitive; both sides come from the API response or the
// helpers above, which keep its key order. Switch to a structural compare if other sources appear.
export function isSameBoard(a: ScreenBoard, b: ScreenBoard): boolean {
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
