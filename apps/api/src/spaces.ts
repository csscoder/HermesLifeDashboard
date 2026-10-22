import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import {
  parseScreenBoard,
  type SpaceBoard,
  type SaveBoardRequest,
  type ScreenBoard,
  type WidgetAppearance,
  type WidgetSource,
} from '@lifedashboard/contracts/board'
import { ROWS } from '@lifedashboard/contracts/grid'
import {
  NEW_SPACE_ICON,
  NEW_SPACE_TITLE,
  SPACE_LIMITS,
  nextColor,
  parseSpacePatch,
  type DeleteRequest,
  type SpaceColor,
  type SpaceSummary,
} from '@lifedashboard/contracts/space'
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

const DELETE_SCHEMA = {
  body: {
    type: 'object',
    required: ['expectedRevision'],
    properties: { expectedRevision: { type: 'integer', minimum: 1 } },
  },
} as const

const SPACE_COLUMNS = 'SELECT id, title, icon, color, position, revision FROM spaces'

export interface SpacesDeps {
  db: DatabaseSync
  now: () => Date
}

export function registerSpaces(app: FastifyInstance, { db, now }: SpacesDeps): void {
  app.get('/api/v1/spaces', async (request) => ok(request, listSpaces(db)))

  app.post('/api/v1/spaces', async (request) => ok(request, createSpace(db, now())))

  app.patch<{ Params: { spaceId: string } }>('/api/v1/spaces/:spaceId', async (request) =>
    ok(request, updateSpace(db, request.params.spaceId, request.body, now())),
  )

  app.delete<{ Params: { spaceId: string }; Body: DeleteRequest }>(
    '/api/v1/spaces/:spaceId',
    { schema: DELETE_SCHEMA },
    async (request) => ok(request, deleteSpace(db, request.params.spaceId, request.body.expectedRevision)),
  )

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
  return db.prepare(`${SPACE_COLUMNS} ORDER BY position, created_at`).all() as unknown as SpaceSummary[]
}

function readSpace(db: DatabaseSync, spaceId: string): SpaceSummary {
  return db.prepare(`${SPACE_COLUMNS} WHERE id = ?`).get(spaceId) as unknown as SpaceSummary
}

// One BEGIN IMMEDIATE transaction: the checks and the write see the same revisions.
function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function createSpace(db: DatabaseSync, now: Date): SpaceSummary {
  return transaction(db, () => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM spaces').get() as { count: number }
    if (count >= SPACE_LIMITS.spaces) throw new ApiError('VALIDATION_ERROR', `At most ${SPACE_LIMITS.spaces} spaces`)
    const used = (db.prepare('SELECT color FROM spaces').all() as { color: SpaceColor }[]).map((row) => row.color)
    const { next } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM spaces').get() as { next: number }
    const id = randomUUID()
    const stamp = now.toISOString()
    db.prepare(
      'INSERT INTO spaces (id, title, icon, color, position, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(id, NEW_SPACE_TITLE, NEW_SPACE_ICON, nextColor(used), next, stamp, stamp)
    db.prepare('INSERT INTO screens (id, space_id, position, rows) VALUES (?, ?, 0, ?)').run(randomUUID(), id, ROWS.default)
    return readSpace(db, id)
  })
}

// Does not change the revision: the board is not touched.
function updateSpace(db: DatabaseSync, spaceId: string, raw: unknown, now: Date): SpaceSummary {
  const result = parseSpacePatch(raw)
  if (!result.ok) throw new ApiError('VALIDATION_ERROR', result.error)
  const { title = null, icon = null, color = null } = result.value
  spaceRevision(db, spaceId)
  const sql = 'UPDATE spaces SET title = COALESCE(?, title), icon = COALESCE(?, icon), color = COALESCE(?, color), updated_at = ? WHERE id = ?'
  db.prepare(sql).run(title, icon, color, now.toISOString(), spaceId)
  return readSpace(db, spaceId)
}

// Cascades to the screens and widgets of the space (spec «Data»).
function deleteSpace(db: DatabaseSync, spaceId: string, expectedRevision: number): null {
  transaction(db, () => {
    if (spaceRevision(db, spaceId) !== expectedRevision) {
      throw new ApiError('REVISION_CONFLICT', 'The space changed since it was loaded')
    }
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM spaces').get() as { count: number }
    if (count <= 1) throw new ApiError('VALIDATION_ERROR', 'The last space cannot be deleted')
    db.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId)
    dropOrphanWidgetData(db)
  })
  return null
}

// widget_state and widget_secrets have no foreign key: drop the rows of widgets that no longer exist.
function dropOrphanWidgetData(db: DatabaseSync): void {
  db.prepare('DELETE FROM widget_state WHERE widget_id NOT IN (SELECT id FROM widgets)').run()
  db.prepare('DELETE FROM widget_secrets WHERE widget_id NOT IN (SELECT id FROM widgets)').run()
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
  transaction(db, () => {
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
    dropOrphanWidgetData(db)
    db.prepare('UPDATE spaces SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now.toISOString(), spaceId)
  })
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
