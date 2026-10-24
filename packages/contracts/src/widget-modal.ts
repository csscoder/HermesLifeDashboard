import { byteLength, fail, isPlainText, isRecord, unknownKey, type ParseResult } from './parse.ts'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface ModalOpenInput {
  view: string
  title?: string
  props: Record<string, JsonValue>
}

export interface ModalMount {
  view: string
  props: Record<string, JsonValue>
}

export const MODAL_VIEW_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
export const MODAL_LIMITS = { propsBytes: 65536, propsDepth: 32, titleLength: 80, opens: 10, windowMs: 60000 } as const

function isJson(value: unknown, depth: number, ancestors: Set<object>): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > MODAL_LIMITS.propsDepth || ancestors.has(value)) return false
  const array = Array.isArray(value)
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return false
  ancestors.add(value)
  const keys = Reflect.ownKeys(value).filter((key) => !(array && key === 'length'))
  const valid = (!array || keys.length === value.length) && keys.every((key, index) => {
    if (typeof key !== 'string' || (array && key !== String(index))) return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    return descriptor.enumerable && 'value' in descriptor && isJson(descriptor.value, depth + 1, ancestors)
  })
  ancestors.delete(value)
  return valid
}

function parseModal(input: unknown, allowTitle: boolean): ParseResult<ModalOpenInput> {
  if (!isRecord(input) || Object.getPrototypeOf(input) !== Object.prototype) return fail('modal input must be a plain object')
  if (unknownKey(input, allowTitle ? ['view', 'title', 'props'] : ['view', 'props']) !== undefined) return fail('unknown modal input key')
  const { view, title } = input
  if (typeof view !== 'string' || !MODAL_VIEW_PATTERN.test(view) || view === 'constructor') return fail('invalid modal view')
  if (Object.hasOwn(input, 'title') && !isPlainText(title, MODAL_LIMITS.titleLength)) return fail('title must be 1–80 characters of plain text')
  const props = Object.hasOwn(input, 'props') ? input.props : {}
  if (!isRecord(props) || !isJson(props, 1, new Set())) return fail('props must be a finite JSON object of depth at most 32')
  if (byteLength(JSON.stringify(props)) > MODAL_LIMITS.propsBytes) return fail('props must be at most 65536 bytes as JSON')
  return { ok: true, value: { view, ...(typeof title === 'string' ? { title } : {}), props } }
}

export function parseModalOpen(input: unknown): ParseResult<ModalOpenInput> {
  return parseModal(input, true)
}

export function parseModalMount(input: unknown): ParseResult<ModalMount> {
  return parseModal(input, false)
}
