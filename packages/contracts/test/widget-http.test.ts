/// <reference types="vitest/node" />
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayFailure } from '../src/widget-gateway.ts'
import type { BoundSecret } from '../src/widget-secrets.ts'
import { performHttp, proxyHttp } from '../src/widget-http.ts'

describe('HTTP listener integration (controller-run)', () => {
  let server: Server
  let port = 0
  let origin = ''
  let handle: (request: IncomingMessage, response: ServerResponse) => void
  const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      request.on('end', () => {
        seen.push({ method: request.method!, url: request.url!, headers: request.headers, body })
        handle(request, response)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    port = (server.address() as AddressInfo).port
    origin = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => {
    seen.length = 0
    handle = (_request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  })

  const allowed = () => new Set([origin])

  async function rejection(promise: Promise<unknown>): Promise<GatewayFailure> {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(GatewayFailure)
    return error as GatewayFailure
  }

  describe('proxyHttp', () => {
    it('returns the status, content type and text body', async () => {
      expect(await proxyHttp({ url: `${origin}/api/v1/tasks?due=today`, method: 'GET', headers: { accept: 'application/json' } }, allowed())).toEqual({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}',
      })
      expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/v1/tasks?due=today' })
      expect(seen[0]!.headers.accept).toBe('application/json')
    })

    it('sends the method, content type and body, and never an origin or cookie', async () => {
      await proxyHttp({ url: `${origin}/api/v1/tasks`, method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":1}' }, allowed())
      expect(seen[0]).toMatchObject({ method: 'POST', body: '{"t":1}' })
      expect(seen[0]!.headers['content-type']).toBe('application/json')
      expect(seen[0]!.headers.origin).toBeUndefined()
      expect(seen[0]!.headers.cookie).toBeUndefined()
      expect(seen[0]!.headers.authorization).toBeUndefined()
    })

    it('returns an error status as data', async () => {
      handle = (_request, response) => response.writeHead(409, { 'content-type': 'application/json' }).end('{"ok":false}')
      expect((await proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed())).status).toBe(409)
    })

    it('checks the normalized origin and treats another host spelling as another origin', async () => {
      expect((await proxyHttp({ url: `HTTP://127.0.0.1:${port}/x`, method: 'GET' }, allowed())).status).toBe(200)
      expect((await rejection(proxyHttp({ url: `http://localhost:${port}/x`, method: 'GET' }, allowed()))).code).toBe('PERMISSION_DENIED')
      expect((await rejection(proxyHttp({ url: 'http://evil.example/', method: 'GET' }, allowed()))).code).toBe('PERMISSION_DENIED')
      expect(seen).toHaveLength(1)
    })

    it('returns a redirect without following it', async () => {
      handle = (_request, response) => response.writeHead(302, { location: 'http://evil.example/' }).end()
      expect((await proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed())).status).toBe(302)
      expect(seen).toHaveLength(1)
    })

    it('ends a slow answer with UPSTREAM_ERROR', async () => {
      handle = () => {}
      const error = await rejection(proxyHttp({ url: `${origin}/slow`, method: 'GET' }, allowed(), 200))
      expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The service did not answer in time'])
    })

    it('reports a dropped connection as unreachable', async () => {
      handle = (request) => request.socket.destroy()
      const error = await rejection(proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed()))
      expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The service is unreachable'])
    })

    it('accepts a body of exactly 100 KB and aborts one byte more', async () => {
      handle = (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(102_400))
      expect((await proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed())).body).toHaveLength(102_400)
      handle = (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(102_401))
      const error = await rejection(proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed()))
      expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The response is larger than 100 KB'])
    })

    it('rejects an answer whose JSON form passes 120 KB', async () => {
      // Each quote becomes \" in JSON: 70 000 bytes of body serialize to more than 140 000.
      handle = (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('"'.repeat(70_000))
      const error = await rejection(proxyHttp({ url: `${origin}/x`, method: 'GET' }, allowed()))
      expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'The response is too large'])
    })
  })

  describe('UTF-8 response compatibility', () => {
    it('preserves a leading BOM and a multi-byte character split across chunks', async () => {
      const chunks = [Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0xe2]), Buffer.from([0x82, 0xac, 0x62])]
      handle = (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.write(chunks[0])
        setTimeout(() => response.end(chunks[1]), 10)
      }
      expect((await proxyHttp({ url: `${origin}/utf8`, method: 'GET' }, allowed())).body).toBe(Buffer.concat(chunks).toString('utf8'))
    })
  })

  describe('performHttp', () => {
    it('reports a missing secret before sending a request', async () => {
      const error = await rejection(performHttp({ url: `${origin}/echo`, method: 'GET' }, {
        origins: allowed(), secrets: [{ key: 'apiKey', title: 'Ключ', bind: { origin, header: 'Authorization' } }], values: new Map(),
      }))
      expect([error.code, error.message]).toEqual(['UPSTREAM_ERROR', 'Secret «Ключ» is not set'])
      expect(seen).toHaveLength(0)
    })

    it('injects header and query values and redacts an echo and content type', async () => {
      const value = 'SECRETSECRETSECRET1'
      const queryValue = 'ключ ab+cd/ef=ghijklmnop'
      handle = (request, response) => response.writeHead(201, { 'content-type': `application/${value}` }).end(`${request.headers.authorization}|${request.url}`)
      const output = await performHttp({ url: `${origin}/echo`, method: 'GET' }, {
        origins: allowed(),
        secrets: [
          { key: 'apiKey', title: 'Ключ', bind: { origin, header: 'Authorization', prefix: 'Bearer ' } },
          { key: 'queryKey', title: 'Query key', bind: { origin, query: 'apikey' } },
        ],
        values: new Map([['apiKey', value], ['queryKey', queryValue]]),
      })
      expect(seen[0]!.headers.authorization).toBe(`Bearer ${value}`)
      expect(seen[0]!.url).toBe(`/echo?apikey=${encodeURIComponent(queryValue)}`)
      expect(output).toEqual({ status: 201, contentType: 'application/[REDACTED]', body: 'Bearer [REDACTED]|/echo?apikey=[REDACTED]' })
    })
  })
})

describe('shared HTTP rules without sockets', () => {
  const origin = 'https://a.example'
  const secrets: BoundSecret[] = [
    { key: 'header', title: 'Ключ', bind: { origin, header: 'Authorization', prefix: 'Bearer ' } },
    { key: 'query', title: 'Query key', bind: { origin, query: 'apikey' } },
  ]
  const values = new Map([['header', 'SECRETSECRETSECRET1'], ['query', 'ключ ab+cd/ef=ghijklmnop']])
  const context = { origins: new Set([origin]), secrets, values }
  afterEach(() => vi.unstubAllGlobals())

  it('checks origin, all missing secrets and query collisions before fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(performHttp({ url: 'https://other.example', method: 'GET' }, { ...context, values: new Map() }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', message: 'The widget may not reach this origin' })
    await expect(performHttp({ url: `${origin}/?apikey=x`, method: 'GET' }, { ...context, values: new Map() }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Secret «Ключ» is not set' })
    await expect(performHttp({ url: `${origin}/?apikey=x`, method: 'GET' }, { ...context, secrets: [...secrets].reverse(), values: new Map([['query', values.get('query')!]]) }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Secret «Ключ» is not set' })
    await expect(performHttp({ url: `${origin}/?apikey=x`, method: 'GET' }, context))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'The URL already contains the secret parameter "apikey"' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('injects only matching bindings and redacts all stored values', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => new Response(`${values.get('header')}|${encodeURIComponent(values.get('query')!)}|another-secret-value`, {
      status: 201, headers: { 'content-type': `application/${values.get('header')}` },
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const output = await performHttp({ url: `${origin}/echo`, method: 'POST', headers: { accept: 'text/plain' }, body: 'request' }, {
      ...context,
      secrets: [...secrets, { key: 'other', title: 'Other', bind: { origin: 'https://other.example', header: 'X-Other' } }],
      values: new Map([...values, ['other', 'another-secret-value']]),
    }, 200)
    expect(fetchSpy).toHaveBeenCalledWith(`${origin}/echo?apikey=${encodeURIComponent(values.get('query')!)}`, {
      method: 'POST', headers: { accept: 'text/plain', authorization: `Bearer ${values.get('header')}` }, body: 'request',
      redirect: 'manual', credentials: 'omit', signal: expect.any(AbortSignal),
    })
    expect(output).toEqual({ status: 201, contentType: 'application/[REDACTED]', body: '[REDACTED]|[REDACTED]|[REDACTED]' })
  })

  it('decodes concatenated UTF-8 bytes without dropping the BOM', async () => {
    const chunks = [new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xe2]), new Uint8Array([0x82, 0xac, 0x62])]
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }))))
    expect((await proxyHttp({ url: origin, method: 'GET' }, context.origins)).body).toBe('\ufeffa€b')
  })
})
