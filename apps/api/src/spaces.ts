import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import {
  parseScreenBoard,
  type SpaceBoard,
  type SpaceSummary,
  type SaveBoardRequest,
  type ScreenBoard,
  type WidgetAppearance,
  type WidgetSource,
} from '@lifedashboard/contracts/board'
import { ApiError, ok } from './errors.ts'

interface WidgetRow {
  id: string
  screen_id: string
  source_kind: string
  source_type: string
  source_version: string | null
  config: string
  config_version: number
  appearance: string | null
  x: number
  y: number
  w: number
  h: number
}

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555

const SAVE_SCHEMA = {
  body: {
    type: 'object',
    required: ['expectedRevision', 'screens'],
    properties: {
      expectedRevision: { type: 'integer', minimum: 1 },
      screens: { type: 'array', maxItems: 100 },
    },
  },
} as const

export interface SpacesDeps {
  db: DatabaseSync
  now: () => Date
}

export function registerSpaces(app: FastifyInstance, { db, now }: SpacesDeps): void {
  app.get('/api/v1/spaces', async (request) => ok(request, listSpaces(db)))

  app.get<{ Params: { spaceId: string } }>('/api/v1/spaces/:spaceId/board', async (request) =>
    ok(request, readBoard(db, request.params.spaceId)),
  )

  app.put<{ Params: { spaceId: string }; Body: SaveBoardRequest }>(
    '/api/v1/spaces/:spaceId/board',
    { schema: SAVE_SCHEMA },
    async (request) => ok(request, saveBoard(db, request.params.spaceId, request.body, now())),
  )
}

function listSpaces(db: DatabaseSync): SpaceSummary[] {
  return db.prepare('SELECT id, title, position, revision FROM spaces ORDER BY position, created_at').all() as unknown as SpaceSummary[]
}

function spaceRevision(db: DatabaseSync, spaceId: string): number {
  const space = db.prepare('SELECT revision FROM spaces WHERE id = ?').get(spaceId) as { revision: number } | undefined
  if (!space) throw new ApiError('NOT_FOUND', 'Space not found')
  return space.revision
}

function screenIds(db: DatabaseSync, spaceId: string): string[] {
  const rows = db.prepare('SELECT id FROM screens WHERE space_id = ? ORDER BY position').all(spaceId) as unknown as { id: string }[]
  return rows.map((row) => row.id)
}

function readBoard(db: DatabaseSync, spaceId: string): SpaceBoard {
  const revision = spaceRevision(db, spaceId)
  // rowid keeps the insertion order: instances read back in the sent order, the layout follows them.
  const widgets = db
    .prepare('SELECT w.* FROM widgets w JOIN screens s ON s.id = w.screen_id WHERE s.space_id = ? ORDER BY w.rowid')
    .all(spaceId) as unknown as WidgetRow[]
  const screens = db
    .prepare('SELECT id, rows FROM screens WHERE space_id = ? ORDER BY position')
    .all(spaceId) as unknown as { id: string; rows: number }[]
  return {
    spaceId,
    revision,
    screens: screens.map(({ id, rows }) => {
      const placed = widgets.filter((row) => row.screen_id === id)
      return {
        id,
        rows,
        instances: placed.map((row) => ({
          id: row.id,
          source: sourceOf(row),
          configVersion: row.config_version,
          config: JSON.parse(row.config) as Record<string, unknown>,
          // Last, as parseScreenBoard builds it: the UI compares boards as JSON.
          ...(row.appearance !== null && { appearance: JSON.parse(row.appearance) as WidgetAppearance }),
        })),
        layout: placed.map((row) => ({ instanceId: row.id, x: row.x, y: row.y, w: row.w, h: row.h })),
      }
    }),
  }
}

function sourceOf(row: WidgetRow): WidgetSource {
  return row.source_kind === 'package'
    ? { kind: 'package', packageId: row.source_type, version: row.source_version ?? '' }
    : { kind: 'builtin', type: row.source_type }
}

function checkPackagesInstalled(db: DatabaseSync, screens: ScreenBoard[]): void {
  const installed = db.prepare('SELECT 1 FROM widget_package_versions WHERE package_id = ? AND version = ?')
  for (const { source } of screens.flatMap((screen) => screen.instances)) {
    if (source.kind === 'package' && !installed.get(source.packageId, source.version)) {
      throw new ApiError('VALIDATION_ERROR', `Widget package ${source.packageId}@${source.version} is not installed`)
    }
  }
}

// One transaction: 404, then 409, then 400, then the replacement (spec «PUT /spaces/:spaceId/board»).
function saveBoard(db: DatabaseSync, spaceId: string, body: SaveBoardRequest, now: Date): SpaceBoard {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (spaceRevision(db, spaceId) !== body.expectedRevision) {
      throw new ApiError('REVISION_CONFLICT', 'The board changed since it was loaded')
    }
    const screens = validateScreens(body.screens as unknown[], screenIds(db, spaceId))
    checkPackagesInstalled(db, screens)
    const setRows = db.prepare('UPDATE screens SET rows = ? WHERE id = ?')
    for (const screen of screens) setRows.run(screen.rows, screen.id)
    db.prepare('DELETE FROM widgets WHERE screen_id IN (SELECT id FROM screens WHERE space_id = ?)').run(spaceId)
    const insert = db.prepare(
      'INSERT INTO widgets (id, screen_id, source_kind, source_type, source_version, config, config_version, appearance, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (const screen of screens) {
      for (const instance of screen.instances) {
        // parseScreenBoard guarantees exactly one placement per instance.
        const place = screen.layout.find((item) => item.instanceId === instance.id)!
        const { source } = instance
        try {
          insert.run(
            instance.id,
            screen.id,
            source.kind,
            source.kind === 'package' ? source.packageId : source.type,
            source.kind === 'package' ? source.version : null,
            JSON.stringify(instance.config),
            instance.configVersion,
            // parseScreenBoard already dropped an empty appearance.
            instance.appearance ? JSON.stringify(instance.appearance) : null,
            place.x,
            place.y,
            place.w,
            place.h,
          )
        } catch (error) {
          if ((error as { errcode?: unknown }).errcode === SQLITE_CONSTRAINT_PRIMARYKEY) {
            throw new ApiError('VALIDATION_ERROR', `Widget id "${instance.id}" is already used`)
          }
          throw error
        }
      }
    }
    // widget_state has no foreign key (spec «Data»): drop the state of widgets this save removed.
    db.prepare('DELETE FROM widget_state WHERE widget_id NOT IN (SELECT id FROM widgets)').run()
    db.prepare('DELETE FROM widget_secrets WHERE widget_id NOT IN (SELECT id FROM widgets)').run()
    db.prepare('UPDATE spaces SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now.toISOString(), spaceId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return readBoard(db, spaceId)
}

function validateScreens(raw: unknown[], expectedIds: string[]): ScreenBoard[] {
  const screens: ScreenBoard[] = []
  const instanceIds = new Set<string>()
  for (const [index, item] of raw.entries()) {
    const result = parseScreenBoard(item)
    if (!result.ok) throw new ApiError('VALIDATION_ERROR', `screens[${index}]: ${result.error}`)
    for (const instance of result.value.instances) {
      if (instanceIds.has(instance.id)) {
        throw new ApiError('VALIDATION_ERROR', `screens[${index}]: widget id "${instance.id}" is used on another screen`)
      }
      instanceIds.add(instance.id)
    }
    screens.push(result.value)
  }
  // Step 1 of GO-3 cannot create or delete screens.
  if (screens.map((screen) => screen.id).join() !== expectedIds.join()) {
    throw new ApiError('VALIDATION_ERROR', 'Screens do not match the space')
  }
  return screens
}
