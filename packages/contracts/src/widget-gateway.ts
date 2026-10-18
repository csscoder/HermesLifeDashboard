import type { Size } from './grid.ts'
import { byteLength, fail, isRecord, unknownKey, type ParseResult } from './parse.ts'
import type { WidgetPermission } from './widget-package.ts'

export type ConfirmPolicy = 'never' | 'optional' | 'always'

// `confirm` (spec 2026-10-09): `optional` asks when the grant mode is `ask`, `always` asks every widget.
export const GATEWAY_OPS = {
  'state.get': { permission: 'state', confirm: 'never' },
  'state.set': { permission: 'state', confirm: 'never' },
  'notifications.send': { permission: 'notifications', confirm: 'optional' },
  // Spec 2026-10-11: polling must never open a dialog; writes follow the grant mode.
  'http.get': { permission: 'network', confirm: 'never' },
  'http.send': { permission: 'network', confirm: 'optional' },
} as const satisfies Record<string, { permission: WidgetPermission; confirm: ConfirmPolicy }>

export type GatewayOp = keyof typeof GATEWAY_OPS

const MINUTE = 60_000
const HOUR = 60 * MINUTE
export const RATE_LIMITS: Record<GatewayOp, { max: number; windowMs: number }> = {
  'state.get': { max: 120, windowMs: MINUTE },
  'state.set': { max: 60, windowMs: MINUTE },
  'notifications.send': { max: 10, windowMs: HOUR },
  'http.get': { max: 120, windowMs: MINUTE },
  'http.send': { max: 60, windowMs: MINUTE },
}

/** Permissions with at least one `optional` operation: only these offer a mode. */
export function confirmablePermissions(): WidgetPermission[] {
  const permissions = Object.values(GATEWAY_OPS).flatMap((spec): WidgetPermission[] => (spec.confirm === 'optional' ? [spec.permission] : []))
  return [...new Set(permissions)]
}

export const CONFIRMATION_TTL_MS = 120_000
// The host closes an unanswered dialog this long after the 428 arrived, before the id expires.
export const CONFIRMATION_DIALOG_MS = 110_000

export const STATE_MAX_BYTES = 65_536
export const NOTIFICATION_TITLE_MAX = 80
export const NOTIFICATION_BODY_MAX = 300

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

// Spec 2026-10-11 «Operations»: HTTP through the API to origins the user approved.
export const HTTP_LIMITS = {
  urlLength: 2048,
  headerValueLength: 200,
  bodyBytes: 65_536,
  responseBytes: 102_400,
  // JSON of the whole answer: escaping can grow a 100 KB body past BRIDGE_LIMITS.maxMessageBytes.
  answerBytes: 122_880,
  // Under the UI's API_TIMEOUT_MS (5 s), which is under BRIDGE_LIMITS.requestTimeoutMs.
  timeoutMs: 4_000,
} as const

export const HTTP_SEND_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HttpSendMethod = (typeof HTTP_SEND_METHODS)[number]

export interface HttpGetInput {
  url: string
  headers?: { accept?: string }
}

export interface HttpSendInput {
  url: string
  method: HttpSendMethod
  headers?: { accept?: string; 'content-type'?: string }
  body?: string
}

export interface HttpOutput {
  status: number
  contentType: string | null
  body: string
}

const CONTROL = /[\u0000-\u001f\u007f]/

function parseHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > HTTP_LIMITS.urlLength) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  return url.href
}

function parseHttpHeaders(raw: unknown, allowed: readonly string[]): ParseResult<Record<string, string> | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return fail('headers must be an object')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!allowed.includes(name)) return fail(`headers may name only ${allowed.join(' and ')}`)
    if (typeof value !== 'string' || value.length > HTTP_LIMITS.headerValueLength || CONTROL.test(value)) {
      return fail(`headers.${name} must be at most ${HTTP_LIMITS.headerValueLength} characters without control characters`)
    }
    headers[name] = value
  }
  return { ok: true, value: headers }
}

const URL_RULE = `url must be an absolute http(s) URL of at most ${HTTP_LIMITS.urlLength} characters without credentials`

export function parseHttpGet(raw: Record<string, unknown>): ParseResult<HttpGetInput> {
  if (unknownKey(raw, ['url', 'headers']) !== undefined) return fail('http.get takes url and headers only')
  const url = parseHttpUrl(raw.url)
  if (url === null) return fail(URL_RULE)
  const headers = parseHttpHeaders(raw.headers, ['accept'])
  if (!headers.ok) return headers
  return { ok: true, value: headers.value === undefined ? { url } : { url, headers: headers.value } }
}

export function parseHttpSend(raw: Record<string, unknown>): ParseResult<HttpSendInput> {
  if (unknownKey(raw, ['url', 'method', 'headers', 'body']) !== undefined) return fail('http.send takes url, method, headers and body only')
  const url = parseHttpUrl(raw.url)
  if (url === null) return fail(URL_RULE)
  const method = raw.method
  if (!(HTTP_SEND_METHODS as readonly unknown[]).includes(method)) return fail(`method must be one of ${HTTP_SEND_METHODS.join(', ')}`)
  const headers = parseHttpHeaders(raw.headers, ['accept', 'content-type'])
  if (!headers.ok) return headers
  const body = raw.body
  if (body !== undefined && (typeof body !== 'string' || byteLength(body) > HTTP_LIMITS.bodyBytes)) {
    return fail('body must be a string of at most 64 KB')
  }
  return {
    ok: true,
    value: {
      url,
      method: method as HttpSendMethod,
      ...(headers.value === undefined ? {} : { headers: headers.value }),
      ...(body === undefined ? {} : { body }),
    },
  }
}

export interface GatewayInputs {
  'state.get': Record<string, never>
  'state.set': StateSetInput
  'notifications.send': NotificationInput
  'http.get': HttpGetInput
  'http.send': HttpSendInput
}

export interface GatewayOutputs {
  'state.get': StateGetOutput
  'state.set': StateSetOutput
  'notifications.send': { ok: true }
  'http.get': HttpOutput
  'http.send': HttpOutput
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
  } else if (op === 'notifications.send') {
    result = parseNotification(raw)
  } else if (op === 'http.get') {
    result = parseHttpGet(raw)
  } else {
    result = parseHttpSend(raw)
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
  /**
   * Host-selected frame appearance.
   * @since sdk 2
   */
  frame: 'framed' | 'frameless'
  // Tokens are full custom property names (`--ld-bg`) with resolved values.
  theme: { id: string; scheme: 'light' | 'dark'; tokens: Record<string, string> }
  // px of the dashboard's html font-size, so `rem` in a frame matches the board (§7.4).
  rootFontSize: number
  /**
   * Values of the manifest settings, with defaults used for missing or invalid non-secret values;
   * an empty object when the manifest declares no settings. Each secret setting is only a boolean:
   * true when the user has set it, false otherwise, never the secret value.
   */
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
  | 'DECLINED'

export const SDK_VERSION = 1
export const SDK_LEVELS = [1, 2] as const
export type SdkLevel = (typeof SDK_LEVELS)[number]
export const SDK_TARGET_LEVEL: SdkLevel = 2

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
  // For ops with confirm !== 'never'. Worst case, one session renewal after an approval: two dialogs
  // (2 × CONFIRMATION_DIALOG_MS) and five API calls of 5 s (call, repeat, session, call, repeat) is 245 s,
  // so a dialog deadline, not this timeout, ends an unanswered call.
  confirmTimeoutMs: 250_000,
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
