import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PairRequest } from '@lifedashboard/contracts/api'
import type { ApiConfig } from './config.ts'
import { ApiError, ok } from './errors.ts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const CODE_TTL_MS = 10 * MINUTE
const CODE_REQUEST_INTERVAL_MS = 10_000
const MAX_CODE_FAILURES = 5
const SESSION_TTL_MS = 30 * DAY
// Renewal at most once a day: only when 29 days or less are left.
const RENEW_THRESHOLD_MS = 29 * DAY

export const SESSION_COOKIE = 'ld_session'

const PUBLIC_PATHS = new Set(['/api/v1/auth/pair', '/api/v1/auth/pair-code'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const PAIR_SCHEMA = {
  body: {
    type: 'object',
    required: ['code'],
    properties: { code: { type: 'string', maxLength: 32 } },
  },
} as const

export interface AuthDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins'>
  now: () => Date
  onPairingCode: (code: string, expiresAt: Date) => void
}

// Base design §13.1: one-time pairing code -> HttpOnly session cookie; Host and Origin checks.
export function registerAuth(app: FastifyInstance, { db, config, now, onPairingCode }: AuthDeps): void {
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`])
  const origins = new Set(config.uiOrigins)
  // ponytail: pairing state is in memory; a restart prints a fresh code, which is the intended flow.
  let pairing: { code: string; expiresAt: number; failures: number } | null = null
  let lastCodeRequestAt = Number.NEGATIVE_INFINITY

  function issueCode(): void {
    const expiresAt = now().getTime() + CODE_TTL_MS
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    pairing = { code, expiresAt, failures: 0 }
    onPairingCode(code, new Date(expiresAt))
  }

  // No CSRF token (spec deviation): SameSite=Strict, an allowlisted Origin and a JSON body cover it.
  function checkRequest(request: FastifyRequest): void {
    const host = request.headers.host
    if (host === undefined || !hosts.has(host)) throw new ApiError('FORBIDDEN', 'Host is not allowed')
    const origin = request.headers.origin
    if (origin !== undefined && !origins.has(origin)) throw new ApiError('FORBIDDEN', 'Origin is not allowed')
    if (MUTATING_METHODS.has(request.method)) {
      if (origin === undefined) throw new ApiError('FORBIDDEN', 'Origin is required')
      const type = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
      if (type !== 'application/json') throw new ApiError('FORBIDDEN', 'A JSON body is required')
    }
  }

  function authenticate(request: FastifyRequest, reply: FastifyReply): void {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE)
    if (token === null) throw new ApiError('UNAUTHORIZED', 'Pairing required')
    const hash = hashToken(token)
    const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash) as
      | { expires_at: string }
      | undefined
    if (!row) throw new ApiError('UNAUTHORIZED', 'Pairing required')
    const t = now().getTime()
    const expiresAt = Date.parse(row.expires_at)
    if (expiresAt <= t) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash)
      throw new ApiError('UNAUTHORIZED', 'Session expired')
    }
    if (expiresAt <= t + RENEW_THRESHOLD_MS) {
      db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(t + SESSION_TTL_MS).toISOString(), hash)
      reply.header('set-cookie', sessionCookie(token))
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/')) return
    checkRequest(request)
    if (!PUBLIC_PATHS.has(path)) authenticate(request, reply)
  })

  app.post('/api/v1/auth/pair-code', async (request) => {
    const t = now().getTime()
    if (t - lastCodeRequestAt < CODE_REQUEST_INTERVAL_MS) {
      throw new ApiError('RATE_LIMITED', 'Wait a few seconds before requesting a new code')
    }
    lastCodeRequestAt = t
    issueCode()
    // The code goes to the API terminal only, never into a response.
    return ok(request, null)
  })

  app.post<{ Body: PairRequest }>('/api/v1/auth/pair', { schema: PAIR_SCHEMA }, async (request, reply) => {
    const t = now().getTime()
    const current = pairing
    if (current === null || current.expiresAt <= t) {
      pairing = null
      throw new ApiError('UNAUTHORIZED', 'No valid pairing code; request a new one')
    }
    if (!sameCode(request.body.code.trim(), current.code)) {
      current.failures += 1
      if (current.failures >= MAX_CODE_FAILURES) pairing = null
      throw new ApiError('UNAUTHORIZED', 'Wrong pairing code')
    }
    pairing = null
    const token = randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
      hashToken(token),
      new Date(t).toISOString(),
      new Date(t + SESSION_TTL_MS).toISOString(),
    )
    reply.header('set-cookie', sessionCookie(token))
    return ok(request, null)
  })

  issueCode()
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL_MS / 1000}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sameCode(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || null
  }
  return null
}
