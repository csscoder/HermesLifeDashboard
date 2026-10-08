import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'
import {
  GATEWAY_OPS,
  isGatewayOp,
  parseGatewayInput,
  type GatewayInputs,
  type GatewayOp,
  type WidgetSessionResponse,
} from '@lifedashboard/contracts/widget-gateway'
import type { WidgetPermission } from '@lifedashboard/contracts/widget-package'
import { ApiError, ok } from './errors.ts'
import { grantsOf } from './widget-packages.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SESSION_IDLE_MS = HOUR
const MAX_SESSIONS = 200
const AUDIT_TTL_MS = 30 * DAY
const RATE_LIMITS: Record<GatewayOp, { max: number; windowMs: number }> = {
  'state.get': { max: 120, windowMs: MINUTE },
  'state.set': { max: 60, windowMs: MINUTE },
  'notifications.send': { max: 10, windowMs: HOUR },
}

/** What an operation handler may use; sub-project 2 adds a secret resolver here without changing the pipeline. */
export interface GatewayContext {
  widgetId: string
  packageId: string | null
  grants: ReadonlySet<WidgetPermission>
}

interface WidgetSession extends GatewayContext {
  // Hash of the dashboard session that created it; a call must carry the same cookie.
  dashboard: string
  lastUsedAt: number
}

type Handlers = { [Op in GatewayOp]: (context: GatewayContext, input: GatewayInputs[Op]) => unknown }

export interface WidgetGatewayDeps {
  db: DatabaseSync
  now: () => Date
}

// Spec «Widget sessions» and «Gateway pipeline»: the widget never states who it is.
export function registerWidgetGateway(app: FastifyInstance, { db, now }: WidgetGatewayDeps): void {
  db.prepare('DELETE FROM widget_audit WHERE at < ?').run(new Date(now().getTime() - AUDIT_TTL_MS).toISOString())
  // ponytail: sessions and rate counters are in memory; a restart drops them and the host renews the session.
  const sessions = new Map<string, WidgetSession>()
  const hits = new Map<string, number[]>()
  const handlers = operationHandlers(db, now)

  function useSession(request: FastifyRequest): WidgetSession {
    const token = request.headers['x-widget-session']
    const session = typeof token === 'string' ? sessions.get(token) : undefined
    if (typeof token !== 'string' || !session || session.dashboard !== request.sessionHash) {
      throw new ApiError('SESSION_EXPIRED', 'Widget session expired')
    }
    const t = now().getTime()
    sessions.delete(token)
    if (t - session.lastUsedAt >= SESSION_IDLE_MS) throw new ApiError('SESSION_EXPIRED', 'Widget session expired')
    session.lastUsedAt = t
    // Re-inserted last: the Map's first key is always the least recently used session.
    sessions.set(token, session)
    return session
  }

  function rateLimit(widgetId: string, op: GatewayOp): void {
    const { max, windowMs } = RATE_LIMITS[op]
    const t = now().getTime()
    const key = `${widgetId} ${op}`
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      throw new ApiError('RATE_LIMITED', `Too many ${op} calls`)
    }
    recent.push(t)
    hits.set(key, recent)
  }

  function audit(session: WidgetSession, op: string, outcome: string): void {
    db.prepare('INSERT INTO widget_audit (at, widget_id, package_id, op, outcome) VALUES (?, ?, ?, ?, ?)').run(
      now().toISOString(),
      session.widgetId,
      session.packageId,
      op.slice(0, 100),
      outcome,
    )
  }

  app.post<{ Body: { widgetId?: unknown } | undefined }>('/api/v1/widget-sessions', async (request) => {
    const widgetId = request.body?.widgetId
    if (typeof widgetId !== 'string') throw new ApiError('VALIDATION_ERROR', 'widgetId must be a string')
    const { packageId, grants } = resolveWidget(db, widgetId)
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, { dashboard: request.sessionHash, widgetId, packageId, grants: new Set(grants), lastUsedAt: now().getTime() })
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
    const response: WidgetSessionResponse = { widgetSession: token, grants }
    return ok(request, response)
  })

  app.delete<{ Params: { widgetSession: string } }>('/api/v1/widget-sessions/:widgetSession', async (request) => {
    const { widgetSession } = request.params
    if (sessions.get(widgetSession)?.dashboard === request.sessionHash) sessions.delete(widgetSession)
    return ok(request, null)
  })

  app.post<{ Params: { op: string } }>('/api/v1/widget-gateway/:op', async (request) => {
    // Step 1 (dashboard session) ran in the auth hook. A rejected widget session has no trusted identity: no audit.
    const session = useSession(request)
    const { op } = request.params
    let outcome = 'ok'
    try {
      if (!isGatewayOp(op)) throw new ApiError('UNKNOWN_OP', `Unknown operation "${op.slice(0, 100)}"`)
      const { permission } = GATEWAY_OPS[op]
      if (!session.grants.has(permission)) throw new ApiError('PERMISSION_DENIED', `The widget has no "${permission}" permission`)
      const input = parseGatewayInput(op, request.body)
      if (!input.ok) throw new ApiError('INVALID_INPUT', input.error)
      rateLimit(session.widgetId, op)
      const handler = handlers[op] as (context: GatewayContext, input: unknown) => unknown
      return ok(request, handler({ widgetId: session.widgetId, packageId: session.packageId, grants: session.grants }, input.value))
    } catch (error) {
      outcome = error instanceof ApiError ? error.code : 'INTERNAL_ERROR'
      throw error
    } finally {
      audit(session, op, outcome)
    }
  })
}

function resolveWidget(db: DatabaseSync, widgetId: string): { packageId: string | null; grants: WidgetPermission[] } {
  const row = db.prepare('SELECT source_kind, source_type, source_version FROM widgets WHERE id = ?').get(widgetId) as
    | { source_kind: string; source_type: string; source_version: string | null }
    | undefined
  if (!row) throw new ApiError('NOT_FOUND', 'Widget not found')
  if (row.source_kind === 'package') {
    const installed = db.prepare('SELECT 1 FROM widget_package_versions WHERE package_id = ? AND version = ?').get(row.source_type, row.source_version)
    if (!installed) throw new ApiError('NOT_FOUND', 'Widget package version is not installed')
    return { packageId: row.source_type, grants: grantsOf(db, row.source_type) }
  }
  const manifest = findBuiltinWidget(row.source_type)
  if (!manifest) throw new ApiError('NOT_FOUND', 'Unknown built-in widget')
  return { packageId: null, grants: [...manifest.permissions] }
}

function operationHandlers(db: DatabaseSync, now: () => Date): Handlers {
  const read = db.prepare('SELECT data, revision FROM widget_state WHERE widget_id = ?')
  return {
    'state.get': ({ widgetId }) => {
      const row = read.get(widgetId) as { data: string; revision: number } | undefined
      return row ? { data: JSON.parse(row.data) as unknown, revision: row.revision } : { data: null, revision: 0 }
    },
    // node:sqlite is synchronous, so the read and the write cannot interleave with another call.
    'state.set': ({ widgetId }, { data, expectedRevision }) => {
      const row = read.get(widgetId) as { revision: number } | undefined
      const current = row?.revision ?? 0
      if (current !== expectedRevision) throw new ApiError('CONFLICT', 'The widget state changed since it was read')
      db.prepare(
        'INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (widget_id) DO UPDATE SET data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at',
      ).run(widgetId, JSON.stringify(data), current + 1, now().toISOString())
      return { revision: current + 1 }
    },
    // The host displays the notification after this answer (toast now, Tauri plugin at E7).
    'notifications.send': () => ({ ok: true }),
  }
}
