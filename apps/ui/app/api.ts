import type { RoomBoard, RoomSummary, SaveBoardRequest } from '@lifedashboard/contracts/board'
import type { WidgetSessionResponse } from '@lifedashboard/contracts/widget-gateway'
import type { FolderFile, Grant, GrantMode, InstalledPackage, PackageInspection, UploadCreated, WidgetPermission } from '@lifedashboard/contracts/widget-package'

// packages/contracts/test/widget-gateway.test.ts hardcodes this same 5 s in its confirmation timing budget.
export const API_TIMEOUT_MS = 5000

export type ApiFailure =
  | { kind: 'unauthorized' }
  // A widget session ended (API restart, idle expiry): never a reason to pair again.
  | { kind: 'session-expired' }
  | { kind: 'conflict' }
  | { kind: 'rate-limited' }
  // The gateway asks the user first (spec 2026-10-09); the id goes back on one repeat of the call.
  | { kind: 'confirmation-required'; confirmationId: string }
  | { kind: 'invalid'; code: string; message: string }
  | { kind: 'unavailable' }

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure)

/**
 * Never throws: every failure, including a timeout while the body is read, becomes a typed result.
 * `timeout` is a duration, or the caller's signal for calls whose length grows with file size.
 * A `Blob` body is sent raw as `application/octet-stream`.
 */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeout: number | AbortSignal = API_TIMEOUT_MS,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  let response: Response
  let payload: unknown
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    const raw = body instanceof Blob
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      credentials: 'same-origin',
      signal: typeof timeout === 'number' ? AbortSignal.timeout(timeout) : timeout,
    })
    payload = await response.json()
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
  if (response.ok && isRecord(payload) && 'data' in payload) return { ok: true, data: payload.data as T }
  if (response.status === 401) {
    return errorField(payload, 'code') === 'SESSION_EXPIRED' ? { ok: false, kind: 'session-expired' } : { ok: false, kind: 'unauthorized' }
  }
  if (response.status === 428) {
    const confirmationId = errorField(payload, 'confirmationId')
    // Without an id (absent or empty) there is nothing to confirm: fall through to a rejected call (fail closed).
    if (confirmationId) return { ok: false, kind: 'confirmation-required', confirmationId }
  }
  if (response.status === 409 && errorField(payload, 'code') !== 'CONFIRMATION_INVALID') return { ok: false, kind: 'conflict' }
  if (response.status === 429) return { ok: false, kind: 'rate-limited' }
  if (response.status >= 400 && response.status < 500) {
    return {
      ok: false,
      kind: 'invalid',
      code: errorField(payload, 'code') ?? 'UNKNOWN',
      message: errorField(payload, 'message') ?? 'Request rejected',
    }
  }
  return { ok: false, kind: 'unavailable' }
}

const boardPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}/board`

export const api = {
  rooms: () => apiRequest<RoomSummary[]>('GET', '/rooms'),
  board: (roomId: string) => apiRequest<RoomBoard>('GET', boardPath(roomId)),
  saveBoard: (roomId: string, request: SaveBoardRequest) => apiRequest<RoomBoard>('PUT', boardPath(roomId), request),
  pair: (code: string) => apiRequest<null>('POST', '/auth/pair', { code }),
  // The API requires a JSON body on every mutation, DELETE included.
  pairCode: () => apiRequest<null>('POST', '/auth/pair-code', {}),
  widgetPackages: () => apiRequest<InstalledPackage[]>('GET', '/widget-packages'),
  createUpload: (manifest: unknown, files: FolderFile[]) => apiRequest<UploadCreated>('POST', '/widget-uploads', { manifest, files }),
  // No absolute timeout: the duration grows with the file; «Отмена» aborts through the signal.
  uploadFile: (uploadId: string, path: string, file: Blob, signal: AbortSignal) =>
    apiRequest<null>('PUT', `/widget-uploads/${encodeURIComponent(uploadId)}/files/${path.split('/').map(encodeURIComponent).join('/')}`, file, signal),
  installUpload: (uploadId: string, signal: AbortSignal) =>
    apiRequest<PackageInspection>('POST', `/widget-uploads/${encodeURIComponent(uploadId)}/install`, {}, signal),
  cancelUpload: (uploadId: string) => apiRequest<null>('DELETE', `/widget-uploads/${encodeURIComponent(uploadId)}`, {}),
  deletePackage: (id: string) => apiRequest<null>('DELETE', `/widget-packages/${encodeURIComponent(id)}`, {}),
  createWidgetSession: (widgetId: string) => apiRequest<WidgetSessionResponse>('POST', '/widget-sessions', { widgetId }),
  endWidgetSession: (token: string) => apiRequest<null>('DELETE', `/widget-sessions/${encodeURIComponent(token)}`, {}),
  gateway: (op: string, token: string, input: unknown, confirmationId?: string) =>
    apiRequest<unknown>('POST', `/widget-gateway/${encodeURIComponent(op)}`, input, API_TIMEOUT_MS, {
      'x-widget-session': token,
      ...(confirmationId === undefined ? {} : { 'x-widget-confirmation': confirmationId }),
    }),
  declineConfirmation: (token: string, id: string) =>
    apiRequest<null>('DELETE', `/widget-gateway/confirmations/${encodeURIComponent(id)}`, {}, API_TIMEOUT_MS, { 'x-widget-session': token }),
  setGrantMode: (id: string, permission: WidgetPermission, mode: GrantMode) =>
    apiRequest<Grant[]>('PUT', `/widget-packages/${encodeURIComponent(id)}/grants/${encodeURIComponent(permission)}`, { mode }),
}

function errorField(payload: unknown, field: 'code' | 'message' | 'confirmationId'): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined
  const value = payload.error[field]
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
