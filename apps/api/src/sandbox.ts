import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { classifyPath, fileExtension, SERVED_TYPES, type WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { allowedHosts } from './auth.ts'
import type { ApiConfig } from './config.ts'
import { ApiError } from './errors.ts'
import { resolveInside, userwidgetsDir, versionDir } from './userwidgets.ts'

const require = createRequire(import.meta.url)
const HASH = /^[0-9a-f]{64}$/
const IMMUTABLE = 'public, max-age=31536000, immutable'
const JS = 'text/javascript; charset=utf-8'

// Resolved per request: in development `vite build --watch` rewrites sdk.js while the API runs.
const RUNTIME_FILES = new Map<string, () => string>([
  ['vue.js', () => require.resolve('vue/dist/vue.runtime.esm-browser.prod.js')],
  ['sdk.js', () => join(dirname(require.resolve('@lifedashboard/widget-sdk/package.json')), 'dist', 'sandbox.js')],
])

export interface SandboxDeps {
  db: DatabaseSync
  config: Pick<ApiConfig, 'port' | 'uiOrigins' | 'dataDir'>
}

/**
 * The document of one package version. `base` is built from a validated Host, the hash is hex and
 * file names match the package pattern, so nothing here needs HTML escaping. No instance or user
 * data: config, theme and size arrive over the port.
 */
export function sandboxDocument(base: string, hash: string, manifest: WidgetPackageManifest): { html: string; csp: string } {
  const runtime = `${base}/sandbox/runtime/`
  const packageDir = `${base}/sandbox/packages/${hash}/`
  const importMap = JSON.stringify({
    imports: {
      vue: `${runtime}vue.js`,
      '@lifedashboard/widget-sdk': `${runtime}sdk.js`,
      '@lifedashboard/widget-entry': `${packageDir}${manifest.entry}`,
    },
  })
  const links = manifest.styles.map((name) => `  <link rel="stylesheet" href="${packageDir}${name}">\n`).join('')
  const html =
    '<!doctype html>\n<html>\n<head>\n' +
    // Relative URLs (assets/…) must resolve against the API origin, not the proxying UI origin.
    `  <base href="${packageDir}">\n` +
    '  <meta charset="utf-8">\n' +
    `  <script type="importmap">${importMap}</script>\n` +
    links +
    `  <script type="module" src="${runtime}sdk.js"></script>\n` +
    '</head>\n<body><div id="app"></div></body>\n</html>\n'
  // Explicit URLs, not 'self': engines treat 'self' differently in opaque-origin documents.
  const csp = [
    "default-src 'none'",
    `script-src ${runtime} ${packageDir} 'sha256-${createHash('sha256').update(importMap).digest('base64')}' 'wasm-unsafe-eval'`,
    `style-src ${packageDir} 'unsafe-inline'`,
    `img-src ${packageDir} data: blob:`,
    `media-src ${packageDir} blob:`,
    `font-src ${packageDir} data:`,
    `connect-src ${packageDir} data: blob:`,
    'worker-src blob:',
    "frame-src 'none'",
    "object-src 'none'",
    `base-uri ${packageDir}`,
    "form-action 'none'",
  ].join('; ')
  return { html, csp }
}

/** A single `bytes=` range; null means «send the whole file» (absent, malformed or multi-range). */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  let start: number
  let end: number
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (suffix === 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  return start >= size || start > end ? 'unsatisfiable' : { start, end }
}

// Spec «Sandbox serving»: public by hash, no session (the cookie has Path=/api).
export function registerSandbox(app: FastifyInstance, { db, config }: SandboxDeps): void {
  const hosts = allowedHosts(config)
  const origins = new Set(config.uiOrigins)

  const root = userwidgetsDir(config.dataDir)

  function findVersion(hash: string): { manifest: WidgetPackageManifest; dir: string } {
    const row = HASH.test(hash)
      ? (db.prepare('SELECT package_id, version, manifest FROM widget_package_versions WHERE hash = ?').get(hash) as
          | { package_id: string; version: string; manifest: string }
          | undefined)
      : undefined
    if (!row) throw new ApiError('NOT_FOUND', 'Widget package not found')
    return { manifest: JSON.parse(row.manifest) as WidgetPackageManifest, dir: versionDir(root, row.package_id, row.version) }
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/sandbox/')) return
    // Module scripts from an opaque-origin frame are CORS requests with Origin: null.
    reply.header('access-control-allow-origin', '*').header('x-content-type-options', 'nosniff')
    const host = request.headers.host
    if (host === undefined || !hosts.has(host)) throw new ApiError('FORBIDDEN', 'Host is not allowed')
    const origin = request.headers.origin
    if (origin !== undefined && origin !== 'null' && !origins.has(origin)) throw new ApiError('FORBIDDEN', 'Origin is not allowed')
  })

  app.get<{ Params: { file: string } }>('/sandbox/runtime/:file', async (request, reply) => {
    const locate = RUNTIME_FILES.get(request.params.file)
    if (!locate) throw new ApiError('NOT_FOUND', 'Runtime file not found')
    let body: string
    try {
      body = await readFile(locate(), 'utf8')
    } catch {
      throw new ApiError('NOT_FOUND', 'Runtime file is missing; run pnpm -C packages/widget-sdk build')
    }
    return reply.header('cache-control', 'no-cache').type(JS).send(body)
  })

  app.get<{ Params: { hash: string } }>('/sandbox/packages/:hash/', async (request, reply) => {
    const { manifest } = findVersion(request.params.hash)
    const { html, csp } = sandboxDocument(`${request.protocol}://${request.headers.host}`, request.params.hash, manifest)
    return reply.header('cache-control', IMMUTABLE).header('content-security-policy', csp).type('text/html; charset=utf-8').send(html)
  })

  // Spec «Sandbox serving»: root code and assets/** from the version folder; never source/** or widget.json.
  app.get<{ Params: { hash: string; '*': string } }>('/sandbox/packages/:hash/*', async (request, reply) => {
    const { dir } = findVersion(request.params.hash)
    const path = request.params['*']
    const fileClass = classifyPath(path, Infinity)
    const full = fileClass === 'code' || fileClass === 'asset' ? resolveInside(dir, path) : null
    const info = full === null ? null : await stat(full).catch(() => null)
    if (full === null || info === null || !info.isFile()) throw new ApiError('NOT_FOUND', 'File not found')
    reply
      .header('cache-control', IMMUTABLE)
      .header('accept-ranges', 'bytes')
      // A file opened directly in a tab runs in an opaque origin without scripts.
      .header('content-security-policy', "sandbox; default-src 'none'")
      .type(SERVED_TYPES[fileExtension(path)]!)
    const range = parseRange(request.headers.range, info.size)
    if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${info.size}`).send()
    if (range === null) return reply.header('content-length', info.size).send(createReadStream(full))
    return reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
      .header('content-length', range.end - range.start + 1)
      .send(createReadStream(full, { start: range.start, end: range.end }))
  })
}
