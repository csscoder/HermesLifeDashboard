import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'
import { parseWidgetSource } from '@lifedashboard/contracts/board'
import {
  CONFIRMATION_TTL_MS,
  GATEWAY_OPS,
  checkGatewayCall,
  createRateLimiter,
  GatewayFailure,
  type ConfirmPolicy,
  type GatewayInputs,
  type GatewayOp,
  type HttpOutput,
  type WidgetSessionResponse,
} from '@lifedashboard/contracts/widget-gateway'
import { performHttp, type ProxyRequest } from '@lifedashboard/contracts/widget-http'
import { canonicalJson, type GrantMode, type WidgetPackageManifest, type WidgetPermission } from '@lifedashboard/contracts/widget-package'
import type { SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import { secretsOf, type BoundSecret } from '@lifedashboard/contracts/widget-secrets'
import { ApiError, ok } from './errors.ts'
import { grantsOf, originsOf } from './widget-packages.ts'
import { secretValues } from './widget-secrets.ts'

export { RATE_LIMITS } from '@lifedashboard/contracts/widget-gateway'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SESSION_IDLE_MS = HOUR
const MAX_SESSIONS = 200
const AUDIT_TTL_MS = 30 * DAY

/** What an operation handler may use; secret values are resolved only when making an HTTP call. */
export interface GatewayContext {
  widgetId: string
  packageId: string | null
  grants: ReadonlySet<WidgetPermission>
  // Manifest origins of the instance's version that the user approved for the package.
  origins: ReadonlySet<string>
  secrets: Array<BoundSecret & { title: string }>
}

interface PendingConfirmation {
  id: string
  op: GatewayOp
  inputHash: string
  expiresAt: number
}

interface WidgetSession extends GatewayContext {
  source: WidgetIdentity
  // Hash of the dashboard session that created it; a call must carry the same cookie.
  dashboard: string
  lastUsedAt: number
  // At most one; it ends with the session (DELETE, idle expiry, eviction, API restart).
  confirmation: PendingConfirmation | null
}

interface WidgetIdentity {
  source_kind: string
  source_type: string
  source_version: string | null
}

type Handlers = { [Op in GatewayOp]: (context: GatewayContext, input: GatewayInputs[Op]) => unknown }

/** Spec 2026-10-09 «Gateway pipeline» step 1. `mode` is null for a built-in widget, which counts as `allow`. */
export function needsConfirmation(policy: ConfirmPolicy, mode: GrantMode | null): boolean {
  return policy === 'always' || (policy === 'optional' && mode === 'ask')
}

// Spec 2026-10-11 audit: method and origin of an HTTP call; never its path, query or body.
function httpTarget(op: GatewayOp, input: unknown): string {
  if (op !== 'http.get' && op !== 'http.send') return ''
  const { url, method } = input as { url: string; method?: string }
  return ` ${method ?? 'GET'} ${new URL(url).origin}`
}

export interface WidgetGatewayDeps {
  db: DatabaseSync
  now: () => Date
}

// Spec «Widget sessions» and «Gateway pipeline»: the widget never states who it is.
export function registerWidgetGateway(app: FastifyInstance, { db, now }: WidgetGatewayDeps): (widgetIds: readonly string[]) => void {
  db.prepare('DELETE FROM widget_audit WHERE at < ?').run(new Date(now().getTime() - AUDIT_TTL_MS).toISOString())
  // ponytail: sessions and rate counters are in memory; a restart drops them and the host renews the session.
  const sessions = new Map<string, WidgetSession>()
  const allowCall = createRateLimiter(() => now().getTime())
  const handlers = operationHandlers(db, now)
  const readMode = db.prepare('SELECT mode FROM widget_grants WHERE package_id = ? AND permission = ?')

  // Read on every call, so a switch in the packages list takes effect at once. A missing row asks (fail closed).
  function grantMode(session: WidgetSession, permission: WidgetPermission): GrantMode | null {
    if (session.packageId === null) return null
    const row = readMode.get(session.packageId, permission) as { mode: string } | undefined
    return row?.mode === 'allow' ? 'allow' : 'ask'
  }

  // Steps 2–3: without the header, issue a single-use id (428); with it, spend the matching id or answer 409.
  function confirmCall(session: WidgetSession, op: GatewayOp, input: unknown, header: unknown): void {
    const t = now().getTime()
    const inputHash = createHash('sha256').update(canonicalJson(input)).digest('hex')
    const pending = session.confirmation !== null && session.confirmation.expiresAt > t ? session.confirmation : null
    if (typeof header === 'string') {
      if (!pending || pending.id !== header || pending.op !== op || pending.inputHash !== inputHash) {
        throw new ApiError('CONFIRMATION_INVALID', 'The confirmation is not valid for this call')
      }
      // Single use; the rate limit was spent when the id was issued.
      session.confirmation = null
      return
    }
    if (pending) throw new ApiError('RATE_LIMITED', 'A confirmation is already pending')
    rateLimit(session.widgetId, op)
    const id = randomBytes(32).toString('base64url')
    session.confirmation = { id, op, inputHash, expiresAt: t + CONFIRMATION_TTL_MS }
    throw new ApiError('CONFIRMATION_REQUIRED', 'The user must confirm this call', id)
  }

  function useSession(request: FastifyRequest): WidgetSession {
    const token = request.headers['x-widget-session']
    const session = typeof token === 'string' ? sessions.get(token) : undefined
    if (typeof token !== 'string' || !session || session.dashboard !== request.sessionHash) {
      throw new ApiError('SESSION_EXPIRED', 'Widget session expired')
    }
    const t = now().getTime()
    sessions.delete(token)
    const current = db.prepare('SELECT source_kind, source_type, source_version FROM widgets WHERE id = ?').get(session.widgetId) as WidgetIdentity | undefined
    if (!current || current.source_kind !== session.source.source_kind || current.source_type !== session.source.source_type || current.source_version !== session.source.source_version) {
      throw new ApiError('SESSION_EXPIRED', 'Widget source changed')
    }
    if (t - session.lastUsedAt >= SESSION_IDLE_MS) throw new ApiError('SESSION_EXPIRED', 'Widget session expired')
    session.lastUsedAt = t
    // Re-inserted last: the Map's first key is always the least recently used session.
    sessions.set(token, session)
    return session
  }

  function rateLimit(widgetId: string, op: GatewayOp): void {
    if (!allowCall(widgetId, op)) throw new ApiError('RATE_LIMITED', `Too many ${op} calls`)
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

  app.post<{ Body: { widgetId?: unknown; source?: unknown } | undefined }>('/api/v1/widget-sessions', async (request) => {
    const widgetId = request.body?.widgetId
    if (typeof widgetId !== 'string') throw new ApiError('VALIDATION_ERROR', 'widgetId must be a string')
    const { packageId, grants, origins, settings, source } = resolveWidget(db, widgetId)
    if (request.body?.source !== undefined) {
      const expected = parseWidgetSource(request.body.source)
      if (!expected) throw new ApiError('VALIDATION_ERROR', 'source must be a widget source')
      if (expected.kind !== source.source_kind || (expected.kind === 'package'
        ? expected.packageId !== source.source_type || expected.version !== source.source_version
        : expected.type !== source.source_type)) throw new ApiError('SESSION_EXPIRED', 'Widget source changed')
    }
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, {
      dashboard: request.sessionHash,
      source,
      widgetId,
      packageId,
      grants: new Set(grants),
      origins: new Set(origins),
      secrets: secretsOf(settings),
      lastUsedAt: now().getTime(),
      confirmation: null,
    })
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
    let target = ''
    try {
      const call = checkGatewayCall(op, request.body, session.grants)
      if (!call.ok) throw new ApiError(call.code, call.message)
      const checkedOp = call.op
      const { permission, confirm } = GATEWAY_OPS[checkedOp]
      target = httpTarget(checkedOp, call.input)
      if (needsConfirmation(confirm, grantMode(session, permission))) {
        confirmCall(session, checkedOp, call.input, request.headers['x-widget-confirmation'])
      } else {
        // An approval repeat spends its id even if the mode flipped to allow mid-dialog.
        if (session.confirmation?.id === request.headers['x-widget-confirmation']) session.confirmation = null
        rateLimit(session.widgetId, checkedOp)
      }
      const handler = handlers[checkedOp] as (context: GatewayContext, input: unknown) => unknown
      // Awaited inside try: an HTTP handler is asynchronous, and catch and audit must see its end.
      const output = await handler(
        { widgetId: session.widgetId, packageId: session.packageId, grants: session.grants, origins: session.origins, secrets: session.secrets },
        call.input,
      )
      if (target !== '') outcome = String((output as HttpOutput).status)
      return ok(request, output)
    } catch (error) {
      const failure = error instanceof GatewayFailure ? new ApiError(error.code, error.message) : error
      outcome = failure instanceof ApiError ? failure.code : 'INTERNAL_ERROR'
      throw failure
    } finally {
      audit(session, op, outcome + target)
    }
  })

  // The host declines (user, dialog deadline). An unknown or foreign id is a no-op.
  app.delete<{ Params: { id: string } }>('/api/v1/widget-gateway/confirmations/:id', async (request) => {
    const session = useSession(request)
    const pending = session.confirmation
    if (pending !== null && pending.id === request.params.id) {
      session.confirmation = null
      audit(session, pending.op, 'DECLINED')
    }
    return ok(request, null)
  })

  return (widgetIds) => {
    const changed = new Set(widgetIds)
    for (const [token, session] of sessions) if (changed.has(session.widgetId)) sessions.delete(token)
  }
}

export function resolveWidget(db: DatabaseSync, widgetId: string): {
  source: WidgetIdentity
  packageId: string | null
  grants: WidgetPermission[]
  origins: string[]
  settings: SettingsSchema | undefined
} {
  const row = db.prepare('SELECT source_kind, source_type, source_version FROM widgets WHERE id = ?').get(widgetId) as
    | WidgetIdentity
    | undefined
  if (!row) throw new ApiError('NOT_FOUND', 'Widget not found')
  if (row.source_kind === 'package') {
    const installed = db.prepare('SELECT manifest FROM widget_package_versions WHERE package_id = ? AND version = ?').get(row.source_type, row.source_version) as
      | { manifest: string }
      | undefined
    if (!installed) throw new ApiError('NOT_FOUND', 'Widget package version is not installed')
    // Stored manifests are not re-validated; an older one has no network field and so no origins.
    const manifest = JSON.parse(installed.manifest) as WidgetPackageManifest
    const approved = new Set(originsOf(db, row.source_type))
    return {
      source: row,
      packageId: row.source_type,
      grants: grantsOf(db, row.source_type).map((grant) => grant.permission),
      origins: (manifest.network ?? []).filter((origin) => approved.has(origin)),
      settings: manifest.settings,
    }
  }
  const manifest = findBuiltinWidget(row.source_type)
  if (!manifest) throw new ApiError('NOT_FOUND', 'Unknown built-in widget')
  return { source: row, packageId: null, grants: [...manifest.permissions], origins: [], settings: undefined }
}

function operationHandlers(db: DatabaseSync, now: () => Date): Handlers {
  const read = db.prepare('SELECT data, revision FROM widget_state WHERE widget_id = ?')

  async function http(context: GatewayContext, input: ProxyRequest): Promise<HttpOutput> {
    const values = secretValues(db, context.widgetId)
    return performHttp(input, { origins: context.origins, secrets: context.secrets, values })
  }

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
    'http.get': (context, { url, headers }) => http(context, { url, method: 'GET', headers: { ...headers } as Record<string, string> }),
    'http.send': (context, { url, method, headers, body }) =>
      http(context, { url, method, headers: { ...headers } as Record<string, string>, body }),
  }
}
