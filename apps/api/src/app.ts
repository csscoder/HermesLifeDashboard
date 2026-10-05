import Fastify, { type FastifyInstance } from 'fastify'
import { newRequestId, registerErrorHandling } from './errors.ts'

export function buildApp({ logger = false }: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger, genReqId: newRequestId })
  registerErrorHandling(app)
  app.get('/health', async () => ({ status: 'ok' as const }))
  return app
}
