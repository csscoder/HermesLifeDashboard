import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ErrorCode, ErrorEnvelope, SuccessEnvelope } from '@lifedashboard/contracts/api'

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SESSION_EXPIRED: 401,
  UNKNOWN_OP: 404,
  PERMISSION_DENIED: 403,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  PACKAGE_IN_USE: 409,
}

export class ApiError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function newRequestId(): string {
  return randomUUID()
}

export function ok<T>(request: FastifyRequest, data: T): SuccessEnvelope<T> {
  return { data, meta: { requestId: request.id } }
}

function envelope(code: ErrorCode, message: string, requestId: string): ErrorEnvelope {
  return { error: { code, message, requestId, retryable: code === 'RATE_LIMITED' } }
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined
}

// The UI shows a generic text for a rejected save; the reason is in the API log (spec «UI flow»).
// Only the message is logged: never the body, cookies or a pairing code.
function logRejection(request: FastifyRequest, reason: string): void {
  request.log.warn({ code: 'VALIDATION_ERROR', reason }, 'request rejected')
}

// Base design §11.1: one envelope for every error, no stack traces or internal details.
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.code === 'VALIDATION_ERROR') logRejection(request, error.message)
      return reply.status(STATUS[error.code]).send(envelope(error.code, error.message, request.id))
    }
    const status = statusOf(error)
    // Fastify's own client errors: malformed JSON, schema validation, body too large.
    if (status !== undefined && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      logRejection(request, message)
      return reply.status(400).send(envelope('VALIDATION_ERROR', message, request.id))
    }
    request.log.error(error)
    return reply.status(500).send(envelope('INTERNAL_ERROR', 'Internal error', request.id))
  })
  app.setNotFoundHandler((request, reply) => reply.status(404).send(envelope('NOT_FOUND', 'Route not found', request.id)))
}
