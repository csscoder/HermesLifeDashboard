import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { expect } from 'vitest'
import type { PackageInspection, UploadCreated } from '@lifedashboard/contracts/widget-package'
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
  dataDir: string
  codes: string[]
  clock: { now: number }
  close(): Promise<void>
}

/** A test app on an in-memory database and a temporary data dir, or on `base` (then the caller closes both). */
export async function testApp(base?: Pick<TestApp, 'db' | 'dataDir'>): Promise<TestApp> {
  const dataDir = base?.dataDir ?? mkdtempSync(join(tmpdir(), 'ld-api-'))
  const database = base?.db ?? (await openDatabase(':memory:', { dataDir }))
  const codes: string[] = []
  const clock = { now: T0 }
  const app = buildApp({
    db: database,
    config: { port: 3001, uiOrigins: [ORIGIN], dataDir },
    now: () => new Date(clock.now),
    onPairingCode: (code) => codes.push(code),
  })
  await app.ready()
  return {
    app,
    db: database,
    dataDir,
    codes,
    clock,
    async close() {
      await app.close()
      if (!base) {
        database.close()
        rmSync(dataDir, { recursive: true, force: true })
      }
    },
  }
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  payload?: unknown
  cookie?: string
  host?: string
  // null omits the header; the default is ORIGIN for mutations and no header for GET.
  origin?: string | null
  contentType?: string
  headers?: Record<string, string>
}

export function call(app: FastifyInstance, options: CallOptions): Promise<LightMyRequestResponse> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { host: options.host ?? HOST }
  const origin = options.origin === undefined ? (method === 'GET' ? null : ORIGIN) : options.origin
  if (origin !== null) headers.origin = origin
  if (options.cookie) headers.cookie = options.cookie
  if (options.contentType) headers['content-type'] = options.contentType
  Object.assign(headers, options.headers)
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

export interface TestPackage {
  manifest: Record<string, any>
  files: Record<string, string | Buffer>
}

/** A valid v2 folder; `widget.json` is written from `manifest` unless `files` has one. `change` edits it first. */
export function widgetPackage(change?: (pkg: any) => void): TestPackage {
  const pkg: TestPackage = {
    manifest: {
      format: 2,
      id: 'dev.test.hello',
      version: '1.0.0',
      title: 'Hello',
      author: 'test',
      sdk: 1,
      entry: 'index.js',
      styles: ['style.css'],
      sizing: { default: { w: 3, h: 3 }, min: { w: 2, h: 2 }, max: { w: 6, h: 6 } },
      permissions: ['state'],
    },
    files: { 'index.js': 'export default {}', 'style.css': '.hello{}' },
  }
  change?.(pkg)
  return pkg
}

export function folderFiles(pkg: TestPackage): Record<string, string | Buffer> {
  return { 'widget.json': JSON.stringify(pkg.manifest), ...pkg.files }
}

export function putFile(t: TestApp, cookie: string, uploadId: string, path: string, body: string | Buffer) {
  return call(t.app, {
    method: 'PUT',
    url: `/api/v1/widget-uploads/${uploadId}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
    cookie,
    contentType: 'application/octet-stream',
    payload: body,
  })
}

/** Creates an upload session and sends every file; does not install. */
export async function uploadPackage(t: TestApp, cookie: string, pkg: TestPackage = widgetPackage()): Promise<UploadCreated> {
  const files = folderFiles(pkg)
  const created = await call(t.app, {
    method: 'POST',
    url: '/api/v1/widget-uploads',
    cookie,
    payload: { manifest: pkg.manifest, files: Object.entries(files).map(([path, body]) => ({ path, size: Buffer.byteLength(body) })) },
  })
  expect(created.statusCode).toBe(200)
  const data: UploadCreated = created.json().data
  for (const [path, body] of Object.entries(files)) expect((await putFile(t, cookie, data.uploadId, path, body)).statusCode).toBe(200)
  return data
}

export async function installPackage(t: TestApp, cookie: string, pkg: TestPackage = widgetPackage()): Promise<PackageInspection> {
  const { uploadId } = await uploadPackage(t, cookie, pkg)
  const response = await call(t.app, { method: 'POST', url: `/api/v1/widget-uploads/${uploadId}/install`, cookie, payload: {} })
  expect(response.statusCode).toBe(200)
  return response.json().data
}
