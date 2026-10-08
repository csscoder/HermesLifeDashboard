import type { Size } from './grid.ts'
import { byteLength, fail, isRecord, unknownKey, type ParseResult } from './parse.ts'
import type { WidgetPermission } from './widget-package.ts'

export const GATEWAY_OPS = {
  'state.get': { permission: 'state' },
  'state.set': { permission: 'state' },
  'notifications.send': { permission: 'notifications' },
} as const satisfies Record<string, { permission: WidgetPermission }>

export type GatewayOp = keyof typeof GATEWAY_OPS

export const STATE_MAX_BYTES = 65_536
const NOTIFICATION_TITLE_MAX = 80
const NOTIFICATION_BODY_MAX = 300

export interface StateGetOutput {
  data: unknown
  revision: number
}

export interface StateSetInput {
  data: unknown
  expectedRevision: number
}

export interface StateSetOutput {
  revision: number
}

export interface NotificationInput {
  title: string
  body: string
}

export interface GatewayInputs {
  'state.get': Record<string, never>
  'state.set': StateSetInput
  'notifications.send': NotificationInput
}

/** `POST /widget-sessions` answers with this. */
export interface WidgetSessionResponse {
  widgetSession: string
  grants: WidgetPermission[]
}

export function isGatewayOp(op: unknown): op is GatewayOp {
  return typeof op === 'string' && Object.hasOwn(GATEWAY_OPS, op)
}

function parseStateSet(raw: Record<string, unknown>): ParseResult<StateSetInput> {
  if (unknownKey(raw, ['data', 'expectedRevision']) !== undefined) return fail('state.set takes data and expectedRevision only')
  const revision = raw.expectedRevision
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    return fail('expectedRevision must be a non-negative integer')
  }
  let json: string | undefined
  try {
    json = JSON.stringify(raw.data)
  } catch {
    json = undefined
  }
  if (json === undefined) return fail('data must be a JSON value')
  if (byteLength(json) > STATE_MAX_BYTES) return fail('data must be at most 64 KB as JSON')
  // The stored value is exactly what was measured: dates become strings, undefined fields disappear.
  return { ok: true, value: { data: JSON.parse(json) as unknown, expectedRevision: revision } }
}

function parseNotification(raw: Record<string, unknown>): ParseResult<NotificationInput> {
  if (unknownKey(raw, ['title', 'body']) !== undefined) return fail('notifications.send takes title and body only')
  const { title, body } = raw
  if (typeof title !== 'string' || title.length < 1 || title.length > NOTIFICATION_TITLE_MAX) {
    return fail('title must be 1–80 characters')
  }
  if (typeof body !== 'string' || body.length > NOTIFICATION_BODY_MAX) return fail('body must be at most 300 characters')
  return { ok: true, value: { title, body } }
}

// Validated twice: by the host broker before the API call and by the API (spec «RPC bridge»).
export function parseGatewayInput<Op extends GatewayOp>(op: Op, raw: unknown): ParseResult<GatewayInputs[Op]> {
  if (!isRecord(raw)) return fail('input must be an object')
  let result: ParseResult<unknown>
  if (op === 'state.get') {
    result = Object.keys(raw).length === 0 ? { ok: true, value: {} } : fail('state.get takes no input')
  } else if (op === 'state.set') {
    result = parseStateSet(raw)
  } else {
    result = parseNotification(raw)
  }
  return result as ParseResult<GatewayInputs[Op]>
}

export type SizeClass = 'xs' | 's' | 'm' | 'l' | 'xl'

/** Base design §7.4 size classes, by the smaller side in cells. One function for both hosts. */
export function sizeClass(size: Size): SizeClass {
  const side = Math.min(size.w, size.h)
  if (side <= 1) return 'xs'
  if (side <= 2) return 's'
  if (side <= 4) return 'm'
  if (side <= 6) return 'l'
  return 'xl'
}

export interface WidgetContext {
  size: Size
  sizeClass: SizeClass
  // Tokens are full custom property names (`--ld-bg`) with resolved values.
  theme: { id: string; scheme: 'light' | 'dark'; tokens: Record<string, string> }
  // px of the dashboard's html font-size, so `rem` in a frame matches the board (§7.4).
  rootFontSize: number
  config: Record<string, unknown>
  locale: string
  visible: boolean
}

export type WidgetErrorCode =
  | 'SESSION_EXPIRED'
  | 'UNKNOWN_OP'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'TIMEOUT'
  | 'BRIDGE_CLOSED'
  | 'UNAVAILABLE'

export const SDK_VERSION = 1

export interface HelloMessage {
  t: 'ld:hello'
  sdk: number
}

export interface InitMessage {
  t: 'ld:init'
  context: WidgetContext
}

export interface RequestMessage {
  t: 'req'
  id: number
  op: string
  input: unknown
}

export type ResponseMessage =
  | { t: 'res'; id: number; ok: true; value: unknown }
  | { t: 'res'; id: number; ok: false; error: { code: WidgetErrorCode; message: string } }

export interface ContextMessage {
  t: 'context'
  patch: Partial<WidgetContext>
}

export interface ErrorReportMessage {
  t: 'error'
  message: string
}

export const BRIDGE_LIMITS = {
  maxMessageBytes: 131_072,
  maxInFlight: 16,
  requestTimeoutMs: 10_000,
  helloTimeoutMs: 10_000,
  maxMalformed: 20,
} as const

/** A message from a sandbox frame, or null when it is malformed. */
export function parseSandboxMessage(raw: unknown): RequestMessage | ErrorReportMessage | null {
  if (!isRecord(raw)) return null
  if (raw.t === 'error') return typeof raw.message === 'string' ? { t: 'error', message: raw.message } : null
  if (raw.t !== 'req' || !('input' in raw)) return null
  const { id, op } = raw
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return null
  if (typeof op !== 'string' || op.length < 1 || op.length > 100) return null
  return { t: 'req', id, op, input: raw.input }
}
