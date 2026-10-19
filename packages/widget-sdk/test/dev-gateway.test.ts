import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkGatewayCall, RATE_LIMITS, STATE_MAX_BYTES, widgetFailure } from '@lifedashboard/contracts/widget-gateway'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDevGateway } from '../src/dev/gateway.ts'
import { readDevSecrets } from '../src/dev/secrets.ts'

const origin = 'https://service.example'
const shell = 'w=4 h=3 theme=builtin:glass frame=framed'
const secret = '0123456789abcdef'
const shortSecret = '0123456789'
const secretError = 'The secret must be at least 16 characters without control characters or surrounding spaces'

function manifest(host = origin): WidgetPackageManifest {
  return {
    id: 'dev.test.gateway', version: '1.0.0', title: 'Gateway', author: 'test', sdk: 2,
    entry: 'index.js', styles: [],
    sizing: { default: { w: 4, h: 3 }, min: { w: 1, h: 1 }, max: { w: 8, h: 8 } },
    permissions: ['state', 'notifications', 'network'], network: [host],
    settings: { type: 'object', properties: {
      apiKey: { type: 'secret', title: 'Ключ', bind: { origin: host, header: 'Authorization' } },
      label: { type: 'string', title: 'Label', default: '' },
    } },
  }
}

function setup(current = manifest()) {
  const values = new Map<string, string>()
  const log = vi.fn()
  let time = 0
  const gateway = createDevGateway({ manifest: () => current, secrets: () => values, log, now: () => time })
  return { gateway, log, values, current, advance: (ms: number) => { time += ms } }
}

afterEach(() => vi.unstubAllGlobals())

describe('dev gateway', () => {
  it('starts empty, increments revisions and rejects stale writes without changing state', async () => {
    const { gateway, log } = setup()
    expect(await gateway.call('state.get', {}, 'decline')).toEqual({ ok: true, value: { data: null, revision: 0 } })
    expect(await gateway.call('state.set', { data: 'stale', expectedRevision: 1 }, 'allow'))
      .toEqual({ ok: false, ...widgetFailure('CONFLICT', 'The widget state changed since it was read') })
    expect(await gateway.call('state.set', { data: { count: 1 }, expectedRevision: 0 }, 'decline'))
      .toEqual({ ok: true, value: { revision: 1 } })
    expect(await gateway.call('state.set', { data: 'stale', expectedRevision: 0 }, 'allow'))
      .toEqual({ ok: false, code: 'CONFLICT', message: 'The widget state changed since it was read' })
    expect(await gateway.call('state.get', {}, 'allow')).toEqual({ ok: true, value: { data: { count: 1 }, revision: 1 } })
    expect(await gateway.call('state.set', { data: null, expectedRevision: 1 }, 'allow')).toEqual({ ok: true, value: { revision: 2 } })
    expect(log).toHaveBeenCalledTimes(6)
    expect(log).toHaveBeenNthCalledWith(4, 'gateway', 'state.set CONFLICT: The widget state changed since it was read', undefined)
  })

  it.each([
    ['unknown', {}, ['state']],
    ['state.get', {}, []],
    ['state.set', { data: 'x'.repeat(STATE_MAX_BYTES), expectedRevision: 0 }, ['state']],
  ] as const)('uses shared validation for %s', async (op, input, permissions) => {
    const current = manifest()
    current.permissions = [...permissions]
    const expected = checkGatewayCall(op, input, new Set(current.permissions))
    expect(expected.ok).toBe(false)
    const { gateway, log } = setup(current)
    const result = await gateway.call(op, input, 'decline', shell)
    expect(result).toEqual(expected)
    if (!expected.ok) expect(log).toHaveBeenCalledExactlyOnceWith('gateway', `${op} ${expected.code}: ${expected.message}`, shell)
  })

  it('logs exactly once with the unchanged caller shell', async () => {
    const { gateway, log } = setup()
    await gateway.call('state.get', {}, 'allow', shell)
    expect(log).toHaveBeenCalledExactlyOnceWith('gateway', 'state.get ok', shell)
  })

  it('uses shared rate limits and clock and resets both state and counters', async () => {
    const { gateway, advance } = setup()
    await gateway.call('state.set', { data: 42, expectedRevision: 0 }, 'allow')
    const { max, windowMs } = RATE_LIMITS['state.get']
    for (let i = 0; i < max; i++) expect((await gateway.call('state.get', {}, 'allow')).ok).toBe(true)
    expect(await gateway.call('state.get', {}, 'allow')).toEqual({ ok: false, ...widgetFailure('RATE_LIMITED', 'Too many calls') })
    advance(windowMs)
    expect(await gateway.call('state.get', {}, 'allow')).toEqual({ ok: true, value: { data: 42, revision: 1 } })
    for (let i = 1; i < max; i++) await gateway.call('state.get', {}, 'allow')
    expect((await gateway.call('state.get', {}, 'allow')).ok).toBe(false)
    gateway.reset()
    expect(await gateway.call('state.get', {}, 'allow')).toEqual({ ok: true, value: { data: null, revision: 0 } })
    expect(await gateway.call('state.set', { data: 7, expectedRevision: 0 }, 'allow')).toEqual({ ok: true, value: { revision: 1 } })
  })

  it('spends rate capacity on a declined notification, as production does, and allows notifications', async () => {
    const { gateway, log } = setup()
    const input = { title: 'Hello', body: 'Notification body' }
    const { max } = RATE_LIMITS['notifications.send']
    for (let i = 0; i < max; i++) {
      expect(await gateway.call('notifications.send', input, 'decline', shell))
        .toEqual({ ok: false, code: 'DECLINED', message: 'The user declined the call' })
    }
    expect(log).toHaveBeenLastCalledWith('gateway', 'notifications.send DECLINED: The user declined the call', shell)
    expect(await gateway.call('notifications.send', input, 'decline', shell))
      .toEqual({ ok: false, ...widgetFailure('RATE_LIMITED', 'Too many calls') })
    expect(await gateway.call('notifications.send', input, 'allow')).toEqual({ ok: false, ...widgetFailure('RATE_LIMITED', 'Too many calls') })
    gateway.reset()
    expect(await gateway.call('notifications.send', input, 'allow')).toEqual({ ok: true, value: { ok: true } })
  })

  it('logs missing secrets with the shared message and no URL path or query', async () => {
    const { gateway, log } = setup()
    expect(await gateway.call('http.get', { url: `${origin}/private-path?private-query=yes` }, 'decline', shell))
      .toEqual({ ok: false, code: 'UNAVAILABLE', message: 'Secret «Ключ» is not set' })
    expect(log).toHaveBeenCalledExactlyOnceWith('gateway', 'http.get UNAVAILABLE: Secret «Ключ» is not set', shell)
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret)
  })

  it('reads current permissions and origins on each call and refuses undeclared origins', async () => {
    const { gateway, current, log } = setup()
    expect(await gateway.call('http.get', { url: 'https://other.example/private?query=x' }, 'allow'))
      .toEqual({ ok: false, code: 'PERMISSION_DENIED', message: 'The widget may not reach this origin' })
    current.permissions = []
    expect(await gateway.call('state.get', {}, 'allow'))
      .toEqual({ ok: false, code: 'PERMISSION_DENIED', message: 'The widget has no "state" permission' })
    current.permissions = ['network']
    current.network = []
    expect(await gateway.call('http.get', { url: origin }, 'allow'))
      .toEqual({ ok: false, code: 'PERMISSION_DENIED', message: 'The widget may not reach this origin' })
    expect(log).toHaveBeenCalledTimes(3)
  })

  it('delegates HTTP to shared rules, reads current values and logs only method, origin and upstream status', async () => {
    const { gateway, values, log } = setup()
    const fetchSpy = vi.fn().mockImplementation(async () => new Response(secret, { status: 201, headers: { 'content-type': 'text/plain' } }))
    vi.stubGlobal('fetch', fetchSpy)
    values.set('apiKey', secret)
    expect(await gateway.call('http.get', { url: `${origin}/private?token=hidden` }, 'decline', shell))
      .toEqual({ ok: true, value: { status: 201, contentType: 'text/plain', body: '[REDACTED]' } })
    expect(fetchSpy).toHaveBeenCalledWith(`${origin}/private?token=hidden`, expect.objectContaining({ method: 'GET', headers: { authorization: secret } }))
    expect(log).toHaveBeenCalledExactlyOnceWith('gateway', `http.get ok GET ${origin} 201`, shell)
    expect(await gateway.call('http.send', { url: `${origin}/private`, method: 'POST', body: 'private body' }, 'decline', shell))
      .toEqual({ ok: false, code: 'DECLINED', message: 'The user declined the call' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockImplementation(async () => new Response('upstream failure', { status: 503 }))
    expect(await gateway.call('http.send', { url: `${origin}/private?hidden=true`, method: 'POST', body: 'private body' }, 'allow', shell))
      .toEqual({ ok: true, value: { status: 503, contentType: 'text/plain;charset=UTF-8', body: 'upstream failure' } })
    expect(fetchSpy).toHaveBeenLastCalledWith(`${origin}/private?hidden=true`, expect.objectContaining({ method: 'POST', body: 'private body' }))
    expect(log).toHaveBeenLastCalledWith('gateway', `http.send ok POST ${origin} 503`, shell)
    values.clear()
    expect(await gateway.call('http.get', { url: origin }, 'allow', shell))
      .toEqual({ ok: false, code: 'UNAVAILABLE', message: 'Secret «Ключ» is not set' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(4)
    const lines = JSON.stringify(log.mock.calls)
    for (const privateText of [secret, '/private', 'hidden', 'private body']) expect(lines).not.toContain(privateText)
  })
})

describe('readDevSecrets', () => {
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'ld-dev-secrets-'))
    return { dir, file: join(dir, '.env.local'), log: vi.fn() }
  }

  it('parses file contents with dotenv quoting and keeps only declared secrets', () => {
    const { dir, file, log } = fixture()
    writeFileSync(file, `export LD_SECRET_apiKey="${secret}" # comment\nLD_SECRET_label=not-a-secret\nLD_SECRET_unknown=ignored\napiKey=ignored\n`)
    expect(readDevSecrets(dir, manifest(), log)).toEqual(new Map([['apiKey', secret]]))
    expect(log).not.toHaveBeenCalled()
  })

  it('drops a short value and logs exactly the production message without its value', () => {
    const { dir, file, log } = fixture()
    writeFileSync(file, `LD_SECRET_apiKey=${shortSecret}\n`)
    expect(readDevSecrets(dir, manifest(), log)).toEqual(new Map())
    expect(log).toHaveBeenCalledExactlyOnceWith('secret', `apiKey: ${secretError}`)
    expect(JSON.stringify(log.mock.calls)).not.toContain(shortSecret)
  })

  it('deduplicates problems, clears fixed and absent entries, and logs recurring or changed problems', () => {
    const { dir, file, log } = fixture()
    const seen = new Map<string, string>()
    writeFileSync(file, `LD_SECRET_apiKey=${shortSecret}\n`)
    for (let i = 0; i < 3; i++) readDevSecrets(dir, manifest(), log, seen)
    expect(log).toHaveBeenCalledTimes(1)
    expect(seen.get('apiKey')).toBe(secretError)
    writeFileSync(file, `LD_SECRET_apiKey=${secret}\n`)
    expect(readDevSecrets(dir, manifest(), log, seen)).toEqual(new Map([['apiKey', secret]]))
    expect(seen.size).toBe(0)
    writeFileSync(file, `LD_SECRET_apiKey=${shortSecret}\n`)
    readDevSecrets(dir, manifest(), log, seen)
    expect(log).toHaveBeenCalledTimes(2)
    writeFileSync(file, `LD_SECRET_apiKey=${'я'.repeat(16)}\n`)
    readDevSecrets(dir, manifest(), log, seen)
    expect(log).toHaveBeenLastCalledWith('secret', 'apiKey: A header secret may contain only Latin-1 characters')
    expect(log).toHaveBeenCalledTimes(3)
    writeFileSync(file, '')
    readDevSecrets(dir, manifest(), log, seen)
    expect(seen.size).toBe(0)
    writeFileSync(file, `LD_SECRET_apiKey=${shortSecret}\n`)
    readDevSecrets(dir, manifest(), log, seen)
    expect(log).toHaveBeenCalledTimes(4)
  })

  it('treats an unreadable file as no secrets and logs the read error once', () => {
    const { dir, file, log } = fixture()
    mkdirSync(file)
    const seen = new Map<string, string>()
    for (let i = 0; i < 3; i++) expect(readDevSecrets(dir, manifest(), log, seen)).toEqual(new Map())
    expect(log).toHaveBeenCalledExactlyOnceWith('secret', expect.stringContaining('EISDIR'))
    expect(log.mock.calls[0]![1]).not.toContain(dir)
    rmSync(file, { recursive: true })
    writeFileSync(file, `LD_SECRET_apiKey=${secret}\n`)
    expect(readDevSecrets(dir, manifest(), log, seen)).toEqual(new Map([['apiKey', secret]]))
    expect(seen.size).toBe(0)
  })

  it('treats a missing file as no secrets without logging and clears stale seen entries', () => {
    const { dir, file, log } = fixture()
    const seen = new Map([['apiKey', secretError], ['removed', secretError]])
    expect(readDevSecrets(dir, manifest(), log, seen)).toEqual(new Map())
    expect(seen.size).toBe(0)
    expect(log).not.toHaveBeenCalled()
    writeFileSync(file, `LD_SECRET_apiKey=${shortSecret}\n`)
    readDevSecrets(dir, manifest(), log, seen)
    unlinkSync(file)
    expect(readDevSecrets(dir, manifest(), log, seen)).toEqual(new Map())
    expect(seen.size).toBe(0)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('clears problems when a setting stops being a secret', () => {
    const { dir, file, log } = fixture()
    writeFileSync(file, `LD_SECRET_apiKey=${shortSecret}\n`)
    const seen = new Map([['apiKey', secretError]])
    const current = manifest()
    delete current.settings
    expect(readDevSecrets(dir, current, log, seen)).toEqual(new Map())
    expect(seen.size).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('loopback echo (controller-run)', () => {
  it('injects and redacts a header secret and reports its removal without leaking into logs', async () => {
    let server: Server | undefined
    const received: string[] = []
    try {
      server = createServer((request, response) => {
        const authorization = request.headers.authorization ?? ''
        received.push(authorization)
        response.writeHead(200, { 'content-type': 'text/plain' }).end(authorization)
      })
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(0, '127.0.0.1', resolve)
      })
      const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const { gateway, values, log } = setup(manifest(host))
      values.set('apiKey', secret)
      expect(await gateway.call('http.get', { url: `${host}/private?query=hidden` }, 'allow', shell))
        .toEqual({ ok: true, value: { status: 200, contentType: 'text/plain', body: '[REDACTED]' } })
      expect(received).toEqual([secret])
      expect(log).toHaveBeenCalledExactlyOnceWith('gateway', `http.get ok GET ${host} 200`, shell)
      values.clear()
      expect(await gateway.call('http.get', { url: `${host}/private` }, 'allow', shell))
        .toEqual({ ok: false, code: 'UNAVAILABLE', message: 'Secret «Ключ» is not set' })
      expect(received).toHaveLength(1)
      expect(log).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenLastCalledWith('gateway', 'http.get UNAVAILABLE: Secret «Ключ» is not set', shell)
      for (const privateText of [secret, '/private', 'hidden']) expect(JSON.stringify(log.mock.calls)).not.toContain(privateText)
    } finally {
      if (server?.listening) {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
      }
    }
  })
})
