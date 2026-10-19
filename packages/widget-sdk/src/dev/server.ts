import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { createLogger, createServer, type Plugin } from 'vite'
import { sandboxDocument } from '@lifedashboard/contracts/sandbox-document'
import { SDK_TARGET_LEVEL } from '@lifedashboard/contracts/widget-gateway'
import { parseWidgetManifest, type WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { secretsOf } from '@lifedashboard/contracts/widget-secrets'
import { widgetVitePlugins } from '../build.ts'
import { writeConfigDeclaration } from '../config-declaration.ts'
import { packageRoot } from '../package-root.ts'
import { createDevGateway, type DevGateway } from './gateway.ts'
import { createDevLog, type DevLog, type DevLogKind } from './log.ts'
import { readDevSecrets } from './secrets.ts'
import type { DevTheme } from './themes.ts'

export const DEV_PATHS = { pkg: '/@ld/pkg/', runtime: '/@ld/runtime/', sandbox: '/@ld/sandbox', api: '/@ld/api/', shell: '/@ld/shell/' } as const

export interface DevInfo {
  revision: number
  manifest: WidgetPackageManifest
  themes: DevTheme[]
  secrets: Record<string, boolean>
  settingsProblems: string[]
}

export function devSandboxDocument(origin: string, wsOrigin: string): Promise<{ html: string; csp: string }> {
  const runtime = origin + DEV_PATHS.runtime
  const packageDir = origin + DEV_PATHS.pkg
  return sandboxDocument({ runtime, packageDir, entry: packageDir + 'src/index.vue' }, [], {
    scripts: [packageDir + '@vite/client', runtime + 'probe.js'], connectSrc: [wsOrigin],
  })
}

const logKinds: readonly DevLogKind[] = ['gateway', 'error', 'csp', 'overflow', 'manifest', 'secret']
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function createDevApi(deps: { gateway: DevGateway; info: () => DevInfo; log: DevLog; reset: () => void }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (!path.startsWith(DEV_PATHS.api)) return false
    const route = path.slice(DEV_PATHS.api.length)
    const reply = (status: number, value?: unknown) => {
      res.statusCode = status
      if (value !== undefined) res.setHeader('content-type', 'application/json')
      res.end(value === undefined ? undefined : JSON.stringify(value))
    }
    let body: unknown
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > 256 * 1024) {
          reply(413)
          req.resume()
          return true
        }
        chunks.push(buffer)
      }
      if (size > 0) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
        catch { reply(400); return true }
      }
    }
    if (req.method === 'POST' && route === 'call') {
      if (!isObject(body) || typeof body.op !== 'string' || (body.confirm !== 'allow' && body.confirm !== 'decline')
        || (body.shell !== undefined && typeof body.shell !== 'string')) reply(400)
      else reply(200, await deps.gateway.call(body.op, body.input, body.confirm, body.shell))
    } else if (req.method === 'POST' && route === 'log') {
      if (!isObject(body) || !logKinds.includes(body.kind as DevLogKind) || typeof body.message !== 'string'
        || (body.shell !== undefined && typeof body.shell !== 'string')) reply(400)
      else {
        deps.log.write(body.kind as DevLogKind, body.message, body.shell)
        reply(204)
      }
    } else if (req.method === 'GET' && route === 'info') reply(200, deps.info())
    else if (req.method === 'POST' && route === 'reset') {
      deps.reset()
      reply(204)
    } else reply(404)
    return true
  }
}

async function readManifest(dir: string): Promise<WidgetPackageManifest> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dir, 'widget.json'), 'utf8'))
    const result = parseWidgetManifest(isObject(raw) ? { ...raw, format: 2, sdk: SDK_TARGET_LEVEL } : raw)
    if (!result.ok) throw new Error(result.error)
    return result.value
  } catch (error) {
    throw new Error(`Invalid widget.json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
}

export async function startDevServer(dir: string, options: { port?: number } = {}): Promise<{ url: string; close(): Promise<void> }> {
  const root = resolve(dir)
  let manifest = await readManifest(root)
  await writeConfigDeclaration(root)
  const log = createDevLog(root)
  const dist = join(packageRoot(), 'dist')
  const themes = JSON.parse(await readFile(join(dist, 'dev/themes.json'), 'utf8')) as DevTheme[]
  const seen = new Map<string, string>()
  const secrets = () => readDevSecrets(root, manifest, (kind, message) => log.write(kind, message), seen)
  let revision = 0
  const gateway = createDevGateway({ manifest: () => manifest, secrets, log: (kind, message, shell) => log.write(kind, message, shell) })
  const api = createDevApi({ gateway, log, reset: () => gateway.reset(), info: () => {
    const values = secrets()
    return { revision, manifest, themes,
      secrets: Object.fromEntries(secretsOf(manifest.settings).map(({ key }) => [key, values.has(key)])),
      settingsProblems: [...seen].map(([key, message]) => `${key}: ${message}`) }
  } })
  const port = options.port ?? 5273
  let origin = `http://localhost:${port}`
  const viteLogger = createLogger()
  const customLogger = { ...viteLogger, error: (...args: Parameters<typeof viteLogger.error>) => {
    log.write('error', args[0])
    viteLogger.error(...args)
  } }
  let pendingManifest = Promise.resolve()
  const ldDevPlugin: Plugin = {
    name: 'ld-widget-dev', enforce: 'pre',
    resolveId(id) {
      if (id === 'vue') return { id: origin + DEV_PATHS.runtime + 'vue.js', external: true }
      if (id === '@lifedashboard/widget-sdk') return { id: origin + DEV_PATHS.runtime + 'sdk.js', external: true }
    },
    configureServer(server) {
      const manifestPath = join(root, 'widget.json')
      server.watcher.add(manifestPath)
      server.watcher.on('all', (event, path) => {
        if (path !== manifestPath || !['add', 'change', 'unlink'].includes(event)) return
        pendingManifest = pendingManifest.then(async () => {
          try {
            const next = await readManifest(root)
            await writeConfigDeclaration(root)
            manifest = next
            revision++
          } catch (error) { log.write('manifest', error instanceof Error ? error.message : String(error)) }
        })
      })
      server.middlewares.use((req, res, next) => {
        const serve = async () => {
          const path = new URL(req.url ?? '/', origin).pathname
          if (path.startsWith(DEV_PATHS.pkg) || path.startsWith(DEV_PATHS.runtime)) res.setHeader('access-control-allow-origin', '*')
          if (await api(req, res)) return
          if (path === DEV_PATHS.sandbox) {
            const doc = await devSandboxDocument(origin, origin.replace(/^http/, 'ws'))
            res.setHeader('content-security-policy', doc.csp)
            res.setHeader('content-type', contentTypes['.html']!)
            res.end(doc.html)
            return
          }
          let file: string | undefined
          if (path.startsWith(DEV_PATHS.runtime)) {
            const files: Record<string, string> = { 'vue.js': 'dev/vue.js', 'sdk.js': 'sandbox.js', 'probe.js': 'dev/probe.js' }
            const key = path.slice(DEV_PATHS.runtime.length)
            const name = Object.hasOwn(files, key) ? files[key] : undefined
            if (name !== undefined) file = join(dist, name)
            else { res.statusCode = 404; res.end(); return }
          } else if (path === '/' || path.startsWith(DEV_PATHS.shell)) {
            const shellRoot = join(dist, 'shell')
            const name = path === '/' ? 'index.html' : decodeURIComponent(path.slice(DEV_PATHS.shell.length))
            file = resolve(shellRoot, name)
            if (!file.startsWith(shellRoot + sep)) { res.statusCode = 404; res.end(); return }
          } else { next(); return }
          try {
            const data = await readFile(file)
            res.setHeader('content-type', contentTypes[extname(file)] ?? 'application/octet-stream')
            res.end(data)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            res.statusCode = path === '/' ? 503 : 404
            res.end(path === '/' ? 'Dev shell not built. Fix: pnpm -C packages/widget-sdk build' : undefined)
          }
        }
        void serve().catch(next)
      })
    },
  }
  const server = await createServer({
    root, base: DEV_PATHS.pkg, configFile: false, envDir: false,
    plugins: [...widgetVitePlugins(), ldDevPlugin], customLogger,
    server: { port, strictPort: port !== 0, cors: false },
    optimizeDeps: { exclude: ['vue', '@lifedashboard/widget-sdk'] },
  })
  try {
    await server.listen()
    origin = `http://localhost:${(server.httpServer!.address() as AddressInfo).port}`
    return { url: origin + '/', async close() { await server.close(); await pendingManifest } }
  } catch (error) {
    await server.close()
    if (error instanceof Error && /(?:EADDRINUSE|Port .* is already in use)/.test(error.message)) {
      throw new Error(`Port ${port} is in use. Fix: npx ld-widget dev --port <another port>.`)
    }
    throw error
  }
}
