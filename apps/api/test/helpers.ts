import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { expect } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase } from '../src/db.ts'

export const HOST = '127.0.0.1:3001'
export const ORIGIN = 'http://127.0.0.1:3000'
export const T0 = Date.parse('2026-10-05T10:00:00.000Z')
export const HOUR = 60 * 60_000
export const DAY = 24 * HOUR

export interface TestApp {
  app: FastifyInstance
  db: DatabaseSync
  codes: string[]
  clock: { now: number }
  close(): Promise<void>
}

/** A test app on an in-memory database, or on `db` when given (then the caller closes `db`). */
export async function testApp(db?: DatabaseSync): Promise<TestApp> {
  const database = db ?? (await openDatabase(':memory:'))
  const codes: string[] = []
  const clock = { now: T0 }
  const app = buildApp({
    db: database,
    config: { port: 3001, uiOrigins: [ORIGIN] },
    now: () => new Date(clock.now),
    onPairingCode: (code) => codes.push(code),
  })
  await app.ready()
  return {
    app,
    db: database,
    codes,
    clock,
    async close() {
      await app.close()
      if (!db) database.close()
    },
  }
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT'
  url: string
  payload?: unknown
  cookie?: string
  host?: string
  // null omits the header; the default is ORIGIN for mutations and no header for GET.
  origin?: string | null
  contentType?: string
}

export function call(app: FastifyInstance, options: CallOptions): Promise<LightMyRequestResponse> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { host: options.host ?? HOST }
  const origin = options.origin === undefined ? (method === 'GET' ? null : ORIGIN) : options.origin
  if (origin !== null) headers.origin = origin
  if (options.cookie) headers.cookie = options.cookie
  if (options.contentType) headers['content-type'] = options.contentType
  return app.inject({ method, url: options.url, headers, payload: options.payload as string | object | undefined })
}

export function sessionCookie(response: LightMyRequestResponse): string | null {
  const header = response.headers['set-cookie']
  const value = Array.isArray(header) ? header[0] : header
  return value ? value.split(';')[0]! : null
}

export async function pair(t: TestApp): Promise<string> {
  const response = await call(t.app, { method: 'POST', url: '/api/v1/auth/pair', payload: { code: t.codes.at(-1) } })
  expect(response.statusCode).toBe(200)
  const cookie = sessionCookie(response)
  expect(cookie).not.toBeNull()
  return cookie!
}

export function errorCode(response: LightMyRequestResponse): string {
  return response.json().error.code
}
