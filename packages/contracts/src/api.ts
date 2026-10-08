export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  // Widget runtime (spec 2026-10-08).
  | 'SESSION_EXPIRED'
  | 'UNKNOWN_OP'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'PACKAGE_IN_USE'

export interface SuccessEnvelope<T> {
  data: T
  meta: { requestId: string }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; requestId: string; retryable: boolean }
}

export interface PairRequest {
  code: string
}
