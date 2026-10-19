// Controller-run: requires a listening socket.
import { cp, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { startDevServer } from '../src/dev/server.ts'

const fixture = fileURLToPath(new URL('./fixtures/vue-lib/', import.meta.url))
const library = fileURLToPath(new URL('./fixtures/fake-vue-lib/', import.meta.url))
const servers: Awaited<ReturnType<typeof startDevServer>>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  vi.restoreAllMocks()
})

it('serves one Vue runtime, sandbox, API and live manifest/secrets with production media rules', async () => {
  const print = vi.spyOn(console, 'log').mockImplementation(() => {})
  const dir = await mkdtemp(join(tmpdir(), 'ld-dev-server-'))
  await cp(fixture, dir, { recursive: true })
  await cp(library, join(dir, 'node_modules/fake-vue-lib'), { recursive: true })
  const manifestPath = join(dir, 'widget.json')
  const raw = JSON.parse(await readFile(manifestPath, 'utf8'))
  raw.sdk = 2
  raw.permissions.push('network')
  raw.network = ['https://service.example']
  raw.settings = { type: 'object', properties: {
    apiKey: { type: 'secret', title: 'Key', bind: { origin: 'https://service.example', header: 'Authorization' } },
  } }
  await writeFile(manifestPath, JSON.stringify(raw))
  const server = await startDevServer(dir, { port: 0 })
  servers.push(server)
  const get = (path: string) => fetch(new URL(path, server.url))
  const info = async () => (await get('/@ld/api/info')).json()
  const declaration = () => readFile(join(dir, 'widget-env.d.ts'), 'utf8')
  expect(await declaration()).toContain('apiKey: boolean')
  const entryResponse = await get('/@ld/pkg/src/index.vue')
  expect(entryResponse.headers.get('access-control-allow-origin')).toBe('*')
  const entry = await entryResponse.text()
  expect(entry).toContain(`${server.url}@ld/runtime/vue.js`)
  const visited = new Set<string>()
  async function follow(url: string): Promise<void> {
    if (visited.has(url)) return
    visited.add(url)
    expect(url).not.toContain('vue.runtime.esm-bundler')
    const response = await fetch(url)
    expect(response.status, url).toBe(200)
    const code = await response.text()
    expect(code).not.toContain('vue.runtime.esm-bundler')
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)) {
      const specifier = match[1]!
      // Vite client imports are browser infrastructure; the widget graph is the assertion target.
      if (specifier.includes('@vite/client')) continue
      expect(/^(?:https?:|\/|\.)/.test(specifier), specifier).toBe(true)
      await follow(new URL(specifier, url).href)
    }
  }
  await follow(`${server.url}@ld/pkg/src/index.vue`)
  expect([...visited].some((url) => url.includes('/node_modules/.vite/deps/fake-vue-lib'))).toBe(true)
  expect((await get('/@ld/sandbox')).headers.get('content-security-policy')).toContain('connect-src')
  const runtime = await get('/@ld/runtime/vue.js')
  expect(runtime.status).toBe(200)
  expect(runtime.headers.get('access-control-allow-origin')).toBe('*')
  expect(await (await fetch(new URL('/@ld/api/call', server.url), {
    method: 'POST', body: JSON.stringify({ op: 'state.get', input: {}, confirm: 'allow' }),
  })).json()).toEqual({ ok: true, value: { data: null, revision: 0 } })
  const before = await info()
  raw.settings.properties.city = { type: 'string', title: 'City', default: '' }
  raw.sizing.max = { w: 6, h: 5 }
  raw.network.push('https://second.example')
  await writeFile(manifestPath, JSON.stringify(raw))
  await expect.poll(async () => (await info()).revision).toBeGreaterThan(before.revision)
  const valid = await info()
  expect(valid.manifest.settings.properties.city.type).toBe('string')
  expect(valid.manifest.sizing.max).toEqual({ w: 6, h: 5 })
  expect(valid.manifest.network).toEqual(raw.network)
  expect(await declaration()).toContain('city: string')
  const validDeclaration = await declaration()
  await writeFile(manifestPath, '{')
  await expect.poll(async () => readFile(join(dir, '.ld-widget/dev.log'), 'utf8')).toContain('[manifest]')
  expect(await info()).toEqual(valid)
  expect(await declaration()).toBe(validDeclaration)
  raw.title = 'Updated again'
  await writeFile(manifestPath, JSON.stringify(raw))
  await expect.poll(async () => (await info()).revision).toBeGreaterThan(valid.revision)
  const revision = (await info()).revision
  await writeFile(join(dir, '.env.local'), 'LD_SECRET_apiKey=0123456789abcdef\n')
  expect((await info()).secrets.apiKey).toBe(true)
  await writeFile(join(dir, '.env.local'), 'LD_SECRET_apiKey=short\n')
  const invalidSecret = await info()
  expect(invalidSecret.secrets.apiKey).toBe(false)
  expect(invalidSecret.settingsProblems).toEqual(['apiKey: The secret must be at least 16 characters without control characters or surrounding spaces'])
  await unlink(join(dir, '.env.local'))
  expect((await info()).secrets.apiKey).toBe(false)
  expect((await info()).settingsProblems).toEqual([])
  expect((await info()).revision).toBe(revision)
  const secretLog = await readFile(join(dir, '.ld-widget/dev.log'), 'utf8')
  const secretConsole = JSON.stringify(print.mock.calls)
  for (const secret of ['0123456789abcdef', 'short']) {
    expect(secretLog).not.toContain(secret)
    expect(secretConsole).not.toContain(secret)
  }
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets/x.mp4'), 'media')
  await writeFile(join(dir, 'src/index.vue'), '<script setup>import media from "../assets/x.mp4"</script><template><video :src="media" /></template>')
  await get('/@ld/pkg/src/index.vue')
  const failed = await get('/@ld/pkg/assets/x.mp4?import')
  expect(failed.status).toBe(500)
  expect(await failed.text()).toContain('reference media by URL: assets/x.mp4')
  await expect.poll(async () => readFile(join(dir, '.ld-widget/dev.log'), 'utf8')).toMatch(/\[error\].*reference media by URL: assets\/x.mp4/)
}, 30_000)

it('rejects an invalid initial manifest before listening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ld-dev-invalid-'))
  await writeFile(join(dir, 'widget.json'), '{')
  await expect(startDevServer(dir, { port: 0 })).rejects.toThrow('Invalid widget.json:')
})

async function errorLines(dir: string): Promise<string[]> {
  const text = await readFile(join(dir, '.ld-widget/dev.log'), 'utf8').catch(() => '')
  return text.split('\n').filter((line) => line.includes('[error]'))
}

it('logs a request-time transform error exactly once', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const dir = await mkdtemp(join(tmpdir(), 'ld-dev-request-error-'))
  await cp(fixture, dir, { recursive: true })
  await cp(library, join(dir, 'node_modules/fake-vue-lib'), { recursive: true })
  await writeFile(join(dir, 'src/util.ts'), 'export const n: number = (\n')
  const server = await startDevServer(dir, { port: 0 })
  servers.push(server)
  expect((await fetch(new URL('/@ld/pkg/src/util.ts', server.url))).status).toBe(500)
  await expect.poll(() => errorLines(dir)).toHaveLength(1)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(await errorLines(dir)).toHaveLength(1)
}, 30_000)

it('logs a live HMR syntax error once, keeps serving and applies the next valid edit', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const dir = await mkdtemp(join(tmpdir(), 'ld-dev-hmr-error-'))
  await cp(fixture, dir, { recursive: true })
  await cp(library, join(dir, 'node_modules/fake-vue-lib'), { recursive: true })
  const source = await readFile(join(dir, 'src/index.vue'), 'utf8')
  const server = await startDevServer(dir, { port: 0 })
  servers.push(server)
  const module = () => fetch(new URL('/@ld/pkg/src/index.vue', server.url)).then((response) => response.text())
  await module()
  await writeFile(join(dir, 'src/index.vue'), source.replace('const count = ref(0)', 'const count = ref(0'))
  await expect.poll(() => errorLines(dir)).toHaveLength(1)
  expect((await errorLines(dir))[0]).toContain('[vue/compiler-sfc] Unexpected token')
  expect((await fetch(new URL('/@ld/api/info', server.url))).status).toBe(200)
  await writeFile(join(dir, 'src/index.vue'), source.replace('const count = ref(0)', 'const count = ref(7)'))
  await expect.poll(module).toContain('ref(7)')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(await errorLines(dir)).toHaveLength(1)
}, 30_000)
