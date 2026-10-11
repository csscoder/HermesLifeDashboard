import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../src/errors.ts'
import { proxyHttp } from '../src/http-proxy.ts'

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

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
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
