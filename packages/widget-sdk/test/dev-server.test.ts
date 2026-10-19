import { mkdtemp, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { createDevApi, devSandboxDocument, type DevInfo } from '../src/dev/server.ts'
import { createDevLog } from '../src/dev/log.ts'

afterEach(() => vi.restoreAllMocks())

it('uses the production sandbox with the dev entry, Vite client, probe and WebSocket', async () => {
  const { html, csp } = await devSandboxDocument('http://localhost:5273', 'ws://localhost:5273')
  expect(csp).toContain('connect-src http://localhost:5273/@ld/pkg/ data: blob: ws://localhost:5273')
  expect(JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)![1]!).imports['@lifedashboard/widget-entry'])
    .toBe('http://localhost:5273/@ld/pkg/src/index.vue')
  expect(html).toContain('src="http://localhost:5273/@ld/pkg/@vite/client"')
  expect(html).toContain('src="http://localhost:5273/@ld/runtime/probe.js"')
})

async function request(api: ReturnType<typeof createDevApi>, path: string, method = 'GET', body = '') {
  const req = Object.assign(Readable.from([Buffer.from(body)]), { url: path, method }) as IncomingMessage
  let output = ''
  const headers: Record<string, string> = {}
  const res = { statusCode: 200, setHeader: (key: string, value: string) => { headers[key] = value },
    end: (value = '') => { output = value } } as unknown as ServerResponse
  const handled = await api(req, res)
  return { handled, status: res.statusCode, output, headers }
}

it('routes call, log, info and reset and forwards shell state', async () => {
  const call = vi.fn().mockResolvedValue({ ok: true, value: { data: null, revision: 0 } })
  const log = { write: vi.fn() }
  const reset = vi.fn()
  const info = { revision: 3, manifest: {}, themes: [], secrets: {}, settingsProblems: [] } as unknown as DevInfo
  const api = createDevApi({ gateway: { call, reset: vi.fn() }, log, reset, info: () => info })
  const shell = 'w=4 h=3 theme=builtin:glass frame=framed'
  const response = await request(api, '/@ld/api/call', 'POST', JSON.stringify({ op: 'state.get', input: {}, confirm: 'allow', shell }))
  expect(JSON.parse(response.output)).toEqual({ ok: true, value: { data: null, revision: 0 } })
  expect(call).toHaveBeenCalledExactlyOnceWith('state.get', {}, 'allow', shell)
  expect((await request(api, '/@ld/api/log', 'POST', JSON.stringify({ kind: 'csp', message: 'blocked', shell }))).status).toBe(204)
  expect(log.write).toHaveBeenCalledExactlyOnceWith('csp', 'blocked', shell)
  expect(JSON.parse((await request(api, '/@ld/api/info')).output)).toEqual(info)
  expect((await request(api, '/@ld/api/reset', 'POST')).status).toBe(204)
  expect(reset).toHaveBeenCalledOnce()
  expect((await request(api, '/x')).handled).toBe(false)
  expect((await request(api, '/@ld/api/call', 'POST', 'x'.repeat(300 * 1024))).status).toBe(413)
})

it('rejects malformed JSON, unsupported methods and unrecognized log kinds', async () => {
  const log = { write: vi.fn() }
  const api = createDevApi({ gateway: { call: vi.fn(), reset: vi.fn() }, info: vi.fn(), log, reset: vi.fn() })
  expect((await request(api, '/@ld/api/call', 'POST', '{')).status).toBe(400)
  expect((await request(api, '/@ld/api/log', 'POST', '{"kind":"unknown","message":"bad"}')).status).toBe(400)
  expect((await request(api, '/@ld/api/info', 'POST')).status).toBe(404)
  expect(log.write).not.toHaveBeenCalled()
})

it('writes one timestamped line per event and escapes CR/LF in message and shell', async () => {
  const print = vi.spyOn(console, 'log').mockImplementation(() => {})
  const dir = await mkdtemp(join(tmpdir(), 'ld-dev-log-'))
  const log = createDevLog(dir)
  log.write('error', 'a\nb\r\nc')
  log.write('gateway', 'state.get ok', 'w=4\nh=3')
  expect(await readFile(join(dir, '.ld-widget/dev.log'), 'utf8')).toMatch(
    /^\d{4}-\d\d-\d\dT[^\n]+Z \[error\] a\\nb\\r\\nc\n\d{4}-\d\d-\d\dT[^\n]+Z \[gateway\] state.get ok \(w=4\\nh=3\)\n$/,
  )
  expect(print.mock.calls).toEqual([['[ld-widget] [error] a\\nb\\r\\nc'], ['[ld-widget] [gateway] state.get ok']])
})
