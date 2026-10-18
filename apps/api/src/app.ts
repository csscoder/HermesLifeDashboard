import type { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from './auth.ts'
import type { ApiConfig } from './config.ts'
import { newRequestId, registerErrorHandling } from './errors.ts'
import { registerRooms } from './rooms.ts'
import { registerSandbox } from './sandbox.ts'
import { registerUiStatic } from './ui-static.ts'
import { registerWidgetGateway } from './widget-gateway.ts'
import { registerWidgetSecrets } from './widget-secrets.ts'
import { registerWidgetPackages } from './widget-packages.ts'
import { registerWidgetUploads } from './widget-uploads.ts'

export interface AppDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir' | 'uiDir' | 'runtimeDir'>
  onPairingCode: (code: string, expiresAt: Date) => void
  now?: () => Date
  logger?: boolean
}

export function buildApp({ db, config, onPairingCode, now = () => new Date(), logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger, genReqId: newRequestId })
  registerErrorHandling(app)
  app.get('/health', async () => ({ status: 'ok' as const }))
  registerAuth(app, { db, config, now, onPairingCode })
  registerRooms(app, { db, now })
  registerWidgetPackages(app, { db, now, dataDir: config.dataDir })
  registerWidgetUploads(app, { db, now, dataDir: config.dataDir })
  registerWidgetGateway(app, { db, now })
  registerWidgetSecrets(app, { db, now })
  registerSandbox(app, { db, config })
  if (config.uiDir !== undefined) registerUiStatic(app, { config: { port: config.port, uiDir: config.uiDir } })
  return app
}
