import {
  BARE_THEME_ID,
  normalizeAppearance,
  type ScreenBoard,
  type WidgetAppearance,
  type WidgetInstance,
  type WidgetPlacement,
  type WidgetSource,
} from '@lifedashboard/contracts/board'
import { isFree, ROWS, type Rect } from '@lifedashboard/contracts/grid'
import type { InstalledPackage } from '@lifedashboard/contracts/widget-package'
import { normalizeConfig, plainConfig } from '@lifedashboard/contracts/widget-settings'
import type { ParseResult } from '@lifedashboard/contracts/parse'

/** Board interaction mode: display only, the builder draft, or editing the placed widgets. */
export type BoardMode = 'view' | 'build' | 'edit'

/** The board with a new widget last in both lists. A `frameless` package widget starts with the bare theme (spec 2026-10-20). */
export function addInstance(doc: ScreenBoard, id: string, source: WidgetSource, rect: Rect, frame: 'framed' | 'frameless' | undefined): ScreenBoard {
  const appearance = frame === 'frameless' ? normalizeAppearance({ themeId: BARE_THEME_ID, shadow: null }) : undefined
  const instance: WidgetInstance = { id, source: { ...source }, configVersion: 1, config: {}, ...(appearance ? { appearance } : {}) }
  return {
    ...doc,
    instances: [...doc.instances, instance],
    layout: [...doc.layout, { instanceId: id, x: rect.x, y: rect.y, w: rect.w, h: rect.h }],
  }
}

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

export function setConfig(board: ScreenBoard, instanceId: string, config: Record<string, unknown>): ScreenBoard {
  return {
    ...board,
    instances: board.instances.map((item) => item.id === instanceId ? { ...item, config } : item),
  }
}

/** Switches an instance within its installed package, keeping its ID, data and position. */
export function setPackageVersion(board: ScreenBoard, id: string, version: string, packages: readonly InstalledPackage[]): ParseResult<ScreenBoard> {
  const instance = board.instances.find((item) => item.id === id)
  const rect = board.layout.find((item) => item.instanceId === id)
  if (!instance || instance.source.kind !== 'package' || !rect) return { ok: false, error: 'Выберите установленный виджет' }
  const source = instance.source
  const target = packages.find((pkg) => pkg.id === source.packageId)?.versions.find((item) => item.version === version)
  if (!target) return { ok: false, error: 'Версия виджета не установлена' }
  const { sizing, settings } = target.manifest
  const next = { ...rect, w: Math.max(sizing.min.w, Math.min(rect.w, sizing.max.w)), h: Math.max(sizing.min.h, Math.min(rect.h, sizing.max.h)) }
  if (!isFree(next, board.layout.filter((item) => item.instanceId !== id), Math.max(board.rows, rect.y + rect.h))) {
    return { ok: false, error: `Для этой версии нужно свободное место ${next.w}×${next.h}. Передвиньте виджет или освободите место рядом` }
  }
  const config = settings ? plainConfig(settings, normalizeConfig(settings, instance.config, new Set())) : {}
  return { ok: true, value: { ...board,
    instances: board.instances.map((item) => item.id === id ? { ...item, source: { ...source, version }, config } : item),
    layout: board.layout.map((item) => item.instanceId === id ? next : item),
  } }
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
