import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { fileExtension, SERVED_TYPES } from '@lifedashboard/contracts/widget-package'
import { allowedHosts } from './auth.ts'
import type { ApiConfig } from './config.ts'
import { ApiError } from './errors.ts'
import { resolveInside } from './userwidgets.ts'

const HTML = 'text/html; charset=utf-8'
const UI_TYPES: Readonly<Record<string, string>> = {
  ...SERVED_TYPES,
  html: HTML,
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
}
const IMMUTABLE = 'public, max-age=31536000, immutable'
// Unmatched paths under these prefixes keep their JSON 404 instead of the SPA fallback.
const RESERVED = /^\/(api|sandbox)(\/|$|\?)/

export interface UiStaticDeps {
  config: Pick<ApiConfig, 'port'> & { uiDir: string }
}

// Spec 2026-10-11 «Static UI»: the generated SPA on the API origin, for the desktop app.
export function registerUiStatic(app: FastifyInstance, { config }: UiStaticDeps): void {
  const hosts = allowedHosts(config)

  app.get<{ Params: { '*': string } }>('/*', async (request, reply) => {
    const host = request.headers.host
    if (host === undefined || !hosts.has(host)) throw new ApiError('FORBIDDEN', 'Host is not allowed')
    if (RESERVED.test(request.url)) throw new ApiError('NOT_FOUND', 'Route not found')
    const path = request.params['*']
    const full = resolveInside(config.uiDir, path)
    const info = full === null ? null : await stat(full).catch(() => null)
    reply.header('x-content-type-options', 'nosniff')
    if (full !== null && info?.isFile()) {
      return reply
        .header('cache-control', path.startsWith('_nuxt/') ? IMMUTABLE : 'no-cache')
        .header('content-length', info.size)
        .type(UI_TYPES[fileExtension(path)] ?? 'application/octet-stream')
        .send(createReadStream(full))
    }
    if (fileExtension(path) !== '') throw new ApiError('NOT_FOUND', 'File not found')
    return reply.header('cache-control', 'no-cache').type(HTML).send(createReadStream(join(config.uiDir, 'index.html')))
  })
}
