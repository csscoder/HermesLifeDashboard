import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface ApiConfig {
  host: '127.0.0.1'
  port: number
  dataDir: string
  uiOrigins: string[]
}

const DEFAULT_PORT = 3001
const DEFAULT_UI_ORIGINS = ['http://127.0.0.1:3000']

export function loadConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): ApiConfig {
  return {
    host: '127.0.0.1',
    port: parsePort(env.LIFEDASHBOARD_API_PORT),
    dataDir: parseDataDir(env, platform, home),
    uiOrigins: parseOrigins(env.LIFEDASHBOARD_UI_ORIGINS),
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid LIFEDASHBOARD_API_PORT: "${raw}"`)
  return port
}

// The user data directory, never the repository (base design §12.1).
function parseDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const raw = env.LIFEDASHBOARD_DATA_DIR
  if (raw !== undefined) {
    if (!isAbsolute(raw)) throw new Error(`Invalid LIFEDASHBOARD_DATA_DIR: "${raw}"`)
    return raw
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'LifeDashboard')
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'LifeDashboard')
  const xdg = env.XDG_DATA_HOME
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, '.local', 'share'), 'lifedashboard')
}

function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_UI_ORIGINS]
  const origins = raw.split(',').map((item) => item.trim())
  if (!origins.every(isOrigin)) throw new Error(`Invalid LIFEDASHBOARD_UI_ORIGINS: "${raw}"`)
  return origins
}

// An origin is exactly scheme://host[:port]; a path or trailing slash changes URL.origin and fails.
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  } catch {
    return false
  }
}
