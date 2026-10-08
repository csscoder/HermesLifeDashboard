import type { RoomBoard, RoomSummary, SaveBoardRequest } from '@lifedashboard/contracts/board'
import type { WidgetSessionResponse } from '@lifedashboard/contracts/widget-gateway'
import type { InstalledPackage, PackageInspection } from '@lifedashboard/contracts/widget-package'

export const API_TIMEOUT_MS = 5000

export type ApiFailure =
  | { kind: 'unauthorized' }
  // A widget session ended (API restart, idle expiry): never a reason to pair again.
  | { kind: 'session-expired' }
  | { kind: 'conflict' }
  | { kind: 'rate-limited' }
  | { kind: 'invalid'; code: string; message: string }
  | { kind: 'unavailable' }

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure)

/** Never throws: every failure, including a timeout while the body is read, becomes a typed result. */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = API_TIMEOUT_MS,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  let response: Response
  let payload: unknown
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(timeoutMs),
    })
    payload = await response.json()
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
  if (response.ok && isRecord(payload) && 'data' in payload) return { ok: true, data: payload.data as T }
  if (response.status === 401) {
    return errorField(payload, 'code') === 'SESSION_EXPIRED' ? { ok: false, kind: 'session-expired' } : { ok: false, kind: 'unauthorized' }
  }
  if (response.status === 409) return { ok: false, kind: 'conflict' }
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
  inspectPackage: (pkg: unknown) => apiRequest<PackageInspection>('POST', '/widget-packages/inspect', pkg),
  installPackage: (pkg: unknown) => apiRequest<PackageInspection>('POST', '/widget-packages', pkg),
  deletePackage: (id: string) => apiRequest<null>('DELETE', `/widget-packages/${encodeURIComponent(id)}`, {}),
  createWidgetSession: (widgetId: string) => apiRequest<WidgetSessionResponse>('POST', '/widget-sessions', { widgetId }),
  endWidgetSession: (token: string) => apiRequest<null>('DELETE', `/widget-sessions/${encodeURIComponent(token)}`, {}),
  gateway: (op: string, token: string, input: unknown) =>
    apiRequest<unknown>('POST', `/widget-gateway/${encodeURIComponent(op)}`, input, API_TIMEOUT_MS, { 'x-widget-session': token }),
}

function errorField(payload: unknown, field: 'code' | 'message'): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined
  const value = payload.error[field]
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
