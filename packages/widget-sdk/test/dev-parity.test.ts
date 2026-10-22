import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sandboxDocument } from '@lifedashboard/contracts/sandbox-document'
import {
  checkGatewayCall, GatewayFailure, RATE_LIMITS, STATE_MAX_BYTES, widgetFailure,
} from '@lifedashboard/contracts/widget-gateway'
import { performHttp } from '@lifedashboard/contracts/widget-http'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { secretsOf } from '@lifedashboard/contracts/widget-secrets'
import { describe, expect, it, vi } from 'vitest'
import { SEED_SPACE_ID, SEED_SCREEN_ID } from '../../../apps/api/src/migrations.ts'
import { call, installPackage, pair, testApp, widgetPackage } from '../../../apps/api/test/helpers.ts'
import { REQUIRED_TOKENS } from '../../../apps/ui/app/theme/contract.ts'
import { createDevGateway } from '../src/dev/gateway.ts'
import { DEV_SANDBOX_DIFFERENCES, devSandboxDocument } from '../src/dev/server.ts'
import { extractCssBlock, type DevTheme } from '../src/dev/themes.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const repo = join(root, '../..')
const ui = (path: string) => readFile(join(repo, 'apps/ui', path), 'utf8')
const dist = (name: string) => readFile(join(root, 'dist/dev', name), 'utf8')
const O = 'http://localhost:5273'
const W = 'ws://localhost:5273'
const allowed = 'https://service.example'

describe('sandbox document', () => {
  it('differs from production only by the declared scripts and WebSocket origin', async () => {
    const prod = await sandboxDocument({ runtime: O + '/@ld/runtime/', packageDir: O + '/@ld/pkg/', entry: O + '/@ld/pkg/src/index.vue' }, [])
    const dev = await devSandboxDocument(O, W)
    expect(dev.csp).toBe(prod.csp.replace(/(connect-src [^;]*)/, '$1 ' + W))
    const sdk = `  <script type="module" src="${O}/@ld/runtime/sdk.js"></script>\n`
    expect(prod.html.split(sdk)).toHaveLength(2)
    const added = `  <script type="module" src="${O}/@ld/pkg/@vite/client"></script>\n`
      + `  <script type="module" src="${O}/@ld/runtime/probe.js"></script>\n`
    expect(dev.html).toBe(prod.html.replace(sdk, added + sdk))
  })

  it('declares exactly the six differences', () => {
    expect(DEV_SANDBOX_DIFFERENCES.map(({ id }) => id)).toEqual([
      'vue-dev-build', 'vite-client', 'probe', 'hmr-websocket', 'styles-via-vite', 'frame-reload',
    ])
  })
})

describe('assets', () => {
  it('ships the development build of the Vue version the API serves', async () => {
    const require = createRequire(join(repo, 'apps/api/package.json'))
    const { version } = JSON.parse(await readFile(require.resolve('vue/package.json'), 'utf8')) as { version: string }
    const banner = (source: string) => source.match(/^\/\*[\s\S]*?\*\//)![0]
    const served = await readFile(require.resolve('vue/dist/vue.runtime.esm-browser.prod.js'), 'utf8')
    expect(banner(served)).toContain(`v${version}`)
    expect(banner(await dist('vue.js'))).toContain(`v${version}`)
  })

  it('covers the built-in themes with every required token', async () => {
    const { BUILTIN_THEMES } = await import(pathToFileURL(join(repo, 'apps/ui/app/theme/builtin.ts')).href)
    const themes: DevTheme[] = JSON.parse(await dist('themes.json'))
    expect(themes.map(({ id }) => id)).toEqual(BUILTIN_THEMES.map(({ id }: { id: string }) => id))
    for (const theme of themes) {
      for (const name of Object.keys(REQUIRED_TOKENS)) expect(theme.tokens[`--ld-${name}`], `${theme.id}: --ld-${name}`).toBeTruthy()
    }
  })

  it('contains every production frame geometry source verbatim', async () => {
    const css = await dist('frame.css')
    const sandboxStyle = (await ui('app/widgets/SandboxWidget.vue')).split('<style scoped>')[1]!.split('</style>')[0]!
    const sources = [
      extractCssBlock(await ui('app/theme/styles/layers.css'), '@layer ld.reset'),
      await ui('app/theme/styles/frame.css'),
      ...await Promise.all(['bare', 'glass', 'paper', 'solid'].map((skin) => ui(`app/theme/styles/skins/${skin}.css`))),
      sandboxStyle.match(/^\.sandbox \{[^}]*\}/m)![0],
      sandboxStyle.match(/^\.sandbox__frame \{[^}]*\}/m)![0],
    ]
    for (const source of sources) expect(css).toContain(source.trimEnd())
  })
})

describe('dev gateway rules', () => {
  const manifest = (permissions: WidgetPackageManifest['permissions']): WidgetPackageManifest => ({
    id: 'dev.test.parity', version: '1.0.0', title: 'Parity', author: 'test', sdk: 2, entry: 'index.js', styles: [],
    sizing: { default: { w: 4, h: 3 }, min: { w: 1, h: 1 }, max: { w: 8, h: 8 } },
    permissions, network: [allowed],
  })
  const gateway = (current: WidgetPackageManifest) =>
    createDevGateway({ manifest: () => current, secrets: () => new Map(), log: vi.fn() })

  it.each([
    ['unknown op', 'unknown', {}, ['state']],
    ['missing permission', 'state.get', {}, []],
    ['widget-supplied authorization header', 'http.get', { url: allowed + '/x', headers: { authorization: 'Bearer x' } }, ['network']],
    ['state.set over 64 KB', 'state.set', { data: 'x'.repeat(STATE_MAX_BYTES), expectedRevision: 0 }, ['state']],
  ] as const)('answers %s as the shared check does', async (_name, op, input, permissions) => {
    const current = manifest([...permissions])
    const expected = checkGatewayCall(op, input, new Set(current.permissions))
    expect(expected.ok).toBe(false)
    if (expected.ok) return
    expect(await gateway(current).call(op, input, 'allow')).toEqual({ ok: false, ...widgetFailure(expected.code, expected.message) })
  })

  it('answers an origin outside network as performHttp does', async () => {
    const current = manifest(['network'])
    const input = { url: 'https://other.example/x' }
    expect(checkGatewayCall('http.get', input, new Set(current.permissions)).ok).toBe(true)
    const failure = await performHttp({ ...input, method: 'GET' }, {
      origins: new Set(current.network), secrets: secretsOf(current.settings), values: new Map(),
    }).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(GatewayFailure)
    const { code, message } = failure as GatewayFailure
    expect(await gateway(current).call('http.get', input, 'allow')).toEqual({ ok: false, ...widgetFailure(code, message) })
  })

  // Production issues the confirmation (and spends the limit) before the user answers, so a declined
  // call costs capacity. The production side runs the real gateway in-process; the broker maps its
  // RATE_LIMITED answer with widgetFailure.
  it('answers a declined notification after the limit as production does', async () => {
    const op = 'notifications.send'
    const input = { title: 'x', body: '' }
    const dev = gateway(manifest(['notifications']))
    const declined = { ok: false, code: 'DECLINED', message: 'The user declined the call' }
    const t = await testApp()
    try {
      const cookie = await pair(t)
      await installPackage(t, cookie, widgetPackage((p) => { p.manifest.permissions = ['state', 'notifications'] }))
      const widgetId = '00000000-0000-4000-8000-0000000000a1'
      const screen = {
        id: SEED_SCREEN_ID,
        rows: 12,
        instances: [{ id: widgetId, source: { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }, configVersion: 1, config: {} }],
        layout: [{ instanceId: widgetId, x: 0, y: 0, w: 3, h: 3 }],
      }
      const board = { method: 'PUT', url: `/api/v1/spaces/${SEED_SPACE_ID}/board`, cookie, payload: { expectedRevision: 1, screens: [screen] } } as const
      expect((await call(t.app, board)).statusCode).toBe(200)
      const opened = await call(t.app, { method: 'POST', url: '/api/v1/widget-sessions', cookie, payload: { widgetId } })
      const headers = { 'x-widget-session': opened.json().data.widgetSession }
      const issue = () => call(t.app, { method: 'POST', url: `/api/v1/widget-gateway/${op}`, cookie, payload: input, headers })
      for (let i = 0; i < RATE_LIMITS[op].max; i++) {
        const issued = await issue()
        expect([issued.statusCode, issued.json().error.code]).toEqual([428, 'CONFIRMATION_REQUIRED'])
        const url = `/api/v1/widget-gateway/confirmations/${issued.json().error.confirmationId}`
        expect((await call(t.app, { method: 'DELETE', url, cookie, payload: {}, headers })).statusCode).toBe(200)
        expect(await dev.call(op, input, 'decline')).toEqual(declined)
      }
      const prod = (await issue()).json().error
      expect(prod.code).toBe('RATE_LIMITED')
      expect(await dev.call(op, input, 'decline')).toEqual({ ok: false, ...widgetFailure(prod.code, prod.message) })
    } finally {
      await t.close()
    }
  })
})
