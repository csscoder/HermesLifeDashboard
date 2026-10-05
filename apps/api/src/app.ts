import type { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from './auth.ts'
import type { ApiConfig } from './config.ts'
import { newRequestId, registerErrorHandling } from './errors.ts'

export interface AppDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins'>
  onPairingCode: (code: string, expiresAt: Date) => void
  now?: () => Date
  logger?: boolean
}

export function buildApp({ db, config, onPairingCode, now = () => new Date(), logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger, genReqId: newRequestId })
  registerErrorHandling(app)
  app.get('/health', async () => ({ status: 'ok' as const }))
  registerAuth(app, { db, config, now, onPairingCode })
  return app
}
