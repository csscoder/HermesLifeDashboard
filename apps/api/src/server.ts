import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { buildApp } from './app.ts'
import { type ApiConfig, loadConfig } from './config.ts'
import { DB_FILE, openDatabase } from './db.ts'

let config: ApiConfig
let db: DatabaseSync
try {
  config = loadConfig(process.env)
  mkdirSync(config.dataDir, { recursive: true })
  db = await openDatabase(join(config.dataDir, DB_FILE))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const app = buildApp({
  db,
  config,
  logger: true,
  // Printed apart from the JSON log so the code is easy to find in the `pnpm dev` terminal.
  onPairingCode: (code, expiresAt) => {
    console.log(`\nLifeDashboard pairing code: ${code} (valid until ${expiresAt.toLocaleTimeString()})\n`)
  },
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      db.close()
      process.exit(0)
    })
  })
}

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
