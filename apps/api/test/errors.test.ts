import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { ApiError, newRequestId, ok, registerErrorHandling } from '../src/errors.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function appWithRoutes(log?: string[]) {
  const logger = log ? { level: 'warn', stream: { write: (line: string) => log.push(line) } } : false
  const app = Fastify({ genReqId: newRequestId, logger })
  registerErrorHandling(app)
  app.get('/ok', async (request) => ok(request, { a: 1 }))
  app.get('/conflict', async () => {
    throw new ApiError('REVISION_CONFLICT', 'changed')
  })
  app.get('/invalid', async () => {
    throw new ApiError('VALIDATION_ERROR', 'Widgets overlap')
  })
  app.get('/boom', async () => {
    throw new Error('secret detail')
  })
  app.post('/echo', { schema: { body: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } } } }, async (request) =>
    ok(request, request.body),
  )
  await app.ready()
  return app
}

describe('error handling', () => {
  it('wraps data in the success envelope with a UUID request id', async () => {
    const app = await appWithRoutes()
    const body = (await app.inject({ url: '/ok' })).json()
    expect(body.data).toEqual({ a: 1 })
    expect(body.meta.requestId).toMatch(UUID)
    await app.close()
  })

  it('maps an ApiError to its status and code', async () => {
    const app = await appWithRoutes()
    const response = await app.inject({ url: '/conflict' })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      error: { code: 'REVISION_CONFLICT', message: 'changed', requestId: expect.stringMatching(UUID), retryable: false },
    })
    await app.close()
  })

  it('hides unexpected errors behind INTERNAL_ERROR', async () => {
    const app = await appWithRoutes()
    const response = await app.inject({ url: '/boom' })
    expect(response.statusCode).toBe(500)
    expect(response.json().error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal error' })
    expect(response.body).not.toContain('secret detail')
    await app.close()
  })

  it.each([
    ['malformed JSON', '{"n":', 'application/json'],
    ['a schema violation', '{"n":"x"}', 'application/json'],
  ])('maps %s to VALIDATION_ERROR', async (_name, payload, contentType) => {
    const app = await appWithRoutes()
    const response = await app.inject({ method: 'POST', url: '/echo', payload, headers: { 'content-type': contentType } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
    await app.close()
  })

  it('logs the reason of a VALIDATION_ERROR with its request id, without the body', async () => {
    const log: string[] = []
    const app = await appWithRoutes(log)
    const invalid = await app.inject({ url: '/invalid' })
    await app.inject({ method: 'POST', url: '/echo', payload: '{"n":"secret-value"}', headers: { 'content-type': 'application/json' } })
    const entries = log.map((line) => JSON.parse(line))
    expect(entries).toContainEqual(
      expect.objectContaining({ code: 'VALIDATION_ERROR', reason: 'Widgets overlap', reqId: invalid.json().error.requestId }),
    )
    expect(entries.filter((entry) => entry.code === 'VALIDATION_ERROR')).toHaveLength(2)
    expect(log.join('')).not.toContain('secret-value')
    await app.close()
  })

  it.each([
    ['SESSION_EXPIRED', 401],
    ['PERMISSION_DENIED', 403],
    ['UNKNOWN_OP', 404],
    ['INVALID_INPUT', 400],
    ['CONFLICT', 409],
    ['PACKAGE_IN_USE', 409],
    ['CONFIRMATION_REQUIRED', 428],
    ['CONFIRMATION_INVALID', 409],
  ] as const)('maps %s to %i', async (code, status) => {
    const app = Fastify({ genReqId: newRequestId })
    registerErrorHandling(app)
    app.get('/x', async () => {
      throw new ApiError(code, 'm')
    })
    const response = await app.inject({ url: '/x' })
    expect(response.statusCode).toBe(status)
    expect(response.json().error).toMatchObject({ code, message: 'm', retryable: false })
    await app.close()
  })

  it('adds the confirmation id to the envelope only when the error has one', async () => {
    const app = Fastify({ genReqId: newRequestId })
    registerErrorHandling(app)
    app.get('/x', async () => {
      throw new ApiError('CONFIRMATION_REQUIRED', 'm', 'c1')
    })
    const response = await app.inject({ url: '/x' })
    expect(response.statusCode).toBe(428)
    expect(response.json().error).toMatchObject({ code: 'CONFIRMATION_REQUIRED', message: 'm', retryable: false, confirmationId: 'c1' })
    await app.close()
  })

  it('answers unknown routes with NOT_FOUND', async () => {
    const app = await appWithRoutes()
    const response = await app.inject({ url: '/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('NOT_FOUND')
    await app.close()
  })
})
