export interface ApiConfig {
  host: '127.0.0.1'
  port: number
}

const DEFAULT_PORT = 3001

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const raw = env.LIFEGAME_API_PORT
  if (raw === undefined) return { host: '127.0.0.1', port: DEFAULT_PORT }

  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid LIFEGAME_API_PORT: "${raw}"`)
  }
  return { host: '127.0.0.1', port }
}
