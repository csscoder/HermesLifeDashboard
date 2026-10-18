import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { SECRET_MIN_LENGTH, secretsOf, type BoundSecret } from '@lifedashboard/contracts/widget-secrets'
import { ApiError, ok } from './errors.ts'
import { resolveWidget } from './widget-gateway.ts'

export function secretValues(db: DatabaseSync, widgetId: string): Map<string, string> {
  const rows = db.prepare('SELECT key, value FROM widget_secrets WHERE widget_id = ?').all(widgetId) as { key: string; value: string }[]
  return new Map(rows.map(({ key, value }) => [key, value]))
}

export function registerWidgetSecrets(app: FastifyInstance, { db, now }: { db: DatabaseSync; now: () => Date }): void {
  function secretsFor(widgetId: string, key?: string): BoundSecret[] {
    const secrets = secretsOf(resolveWidget(db, widgetId).settings)
    if (key !== undefined && !secrets.some((secret) => secret.key === key)) throw new ApiError('NOT_FOUND', 'Secret setting not found')
    return secrets
  }

  function status(widgetId: string, secrets: BoundSecret[]): Record<string, boolean> {
    const rows = db.prepare('SELECT key FROM widget_secrets WHERE widget_id = ?').all(widgetId) as { key: string }[]
    const stored = new Set(rows.map(({ key }) => key))
    return Object.fromEntries(secrets.map(({ key }) => [key, stored.has(key)]))
  }

  // The auth onRequest hook requires a dashboard session for every /api/v1 route here.
  app.get<{ Params: { widgetId: string } }>('/api/v1/widgets/:widgetId/secrets', async (request) => {
    const { widgetId } = request.params
    return ok(request, status(widgetId, secretsFor(widgetId)))
  })

  app.put<{ Params: { widgetId: string; key: string }; Body: { value?: unknown } | undefined }>(
    '/api/v1/widgets/:widgetId/secrets/:key',
    async (request) => {
      const { widgetId, key } = request.params
      const secrets = secretsFor(widgetId, key)
      const value = request.body?.value
      if (typeof value !== 'string' || value.length < SECRET_MIN_LENGTH || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new ApiError('VALIDATION_ERROR', 'The secret must be at least 16 characters without control characters or surrounding spaces')
      }
      if (secrets.some((secret) => secret.key === key && 'header' in secret.bind) && /[^\u0000-\u00ff]/.test(value)) {
        throw new ApiError('VALIDATION_ERROR', 'A header secret may contain only Latin-1 characters')
      }
      db.prepare(
        'INSERT INTO widget_secrets (widget_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (widget_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      ).run(widgetId, key, value, now().toISOString())
      return ok(request, status(widgetId, secrets))
    },
  )

  app.delete<{ Params: { widgetId: string; key: string } }>('/api/v1/widgets/:widgetId/secrets/:key', async (request) => {
    const { widgetId, key } = request.params
    const secrets = secretsFor(widgetId, key)
    db.prepare('DELETE FROM widget_secrets WHERE widget_id = ? AND key = ?').run(widgetId, key)
    return ok(request, status(widgetId, secrets))
  })
}
