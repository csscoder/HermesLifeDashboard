import Fastify, { type FastifyInstance } from 'fastify'

export function buildApp({ logger = false }: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger })
  app.get('/health', async () => ({ status: 'ok' as const }))
  return app
}
