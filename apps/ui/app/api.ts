import type { RoomBoard, RoomSummary, SaveBoardRequest } from '@lifedashboard/contracts/board'

export const API_TIMEOUT_MS = 5000

export type ApiFailure =
  | { kind: 'unauthorized' }
  | { kind: 'conflict' }
  | { kind: 'rate-limited' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable' }

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure)

/** Never throws: every failure, including a timeout while the body is read, becomes a typed result. */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  timeoutMs = API_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  let response: Response
  let payload: unknown
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(timeoutMs),
    })
    payload = await response.json()
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
  if (response.ok && isRecord(payload) && 'data' in payload) return { ok: true, data: payload.data as T }
  if (response.status === 401) return { ok: false, kind: 'unauthorized' }
  if (response.status === 409) return { ok: false, kind: 'conflict' }
  if (response.status === 429) return { ok: false, kind: 'rate-limited' }
  if (response.status >= 400 && response.status < 500) return { ok: false, kind: 'invalid', message: errorMessage(payload) }
  return { ok: false, kind: 'unavailable' }
}

const boardPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}/board`

export const api = {
  rooms: () => apiRequest<RoomSummary[]>('GET', '/rooms'),
  board: (roomId: string) => apiRequest<RoomBoard>('GET', boardPath(roomId)),
  saveBoard: (roomId: string, request: SaveBoardRequest) => apiRequest<RoomBoard>('PUT', boardPath(roomId), request),
  pair: (code: string) => apiRequest<null>('POST', '/auth/pair', { code }),
  // The API requires a JSON body on every mutation.
  pairCode: () => apiRequest<null>('POST', '/auth/pair-code', {}),
}

function errorMessage(payload: unknown): string {
  return isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
    ? payload.error.message
    : 'Request rejected'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
