import { buildApp } from './app.ts'
import { type ApiConfig, loadConfig } from './config.ts'

let config: ApiConfig
try {
  config = loadConfig(process.env)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const app = buildApp({ logger: true })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
