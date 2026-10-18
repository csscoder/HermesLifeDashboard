import { fail, isPlainText, isRecord, unknownKey, type ParseResult } from './parse.ts'

export type PlainSettingType = 'string' | 'number' | 'integer' | 'boolean'

export interface PlainSetting {
  type: PlainSettingType
  title: string
  description?: string
  default: string | number | boolean
  enum?: string[]
  minimum?: number
  maximum?: number
  maxLength?: number
}

export type SecretBinding = { origin: string; header: string; prefix?: string } | { origin: string; query: string }

export interface SecretSetting {
  type: 'secret'
  title: string
  description?: string
  bind: SecretBinding
}

export type Setting = PlainSetting | SecretSetting

export interface SettingsSchema {
  type: 'object'
  properties: Record<string, Setting>
  required?: string[]
}

export const SETTINGS_LIMITS = { properties: 32, descriptionLength: 200, enumItems: 50, maxLength: 1000 } as const

const PLAIN_KEYS = ['type', 'title', 'description', 'default', 'enum', 'minimum', 'maximum', 'maxLength']
const SECRET_KEYS = ['type', 'title', 'description', 'bind']
const PROTECTED_HEADERS = ['accept', 'content-type', 'host', 'cookie', 'content-length']

export function parseSettingsSchema(raw: unknown, network: readonly string[]): ParseResult<SettingsSchema> {
  if (!isRecord(raw)) return fail('settings.type must describe an object schema')
  const extra = unknownKey(raw, ['type', 'properties', 'required'])
  if (extra !== undefined) return fail(`settings.${extra} is an unknown field`)
  if (raw.type !== 'object') return fail('settings.type must be object')
  if (!isRecord(raw.properties) || Object.keys(raw.properties).length > SETTINGS_LIMITS.properties) {
    return fail('settings.properties must be an object with at most 32 properties')
  }
  const properties: Record<string, Setting> = {}
  const injectionPoints = new Map<string, string>()
  for (const [key, value] of Object.entries(raw.properties)) {
    const path = `settings.${key}`
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) return fail(`${path} has an invalid setting key`)
    const parsed = parseSetting(value, path, network)
    if (!parsed.ok) return parsed
    if (parsed.value.type === 'secret') {
      const bind = parsed.value.bind
      const point = JSON.stringify([bind.origin, 'header' in bind ? 'header' : 'query', 'header' in bind ? bind.header.toLowerCase() : bind.query])
      const previous = injectionPoints.get(point)
      if (previous !== undefined) return fail(`${path}.bind duplicates the injection point of settings.${previous}`)
      injectionPoints.set(point, key)
    }
    properties[key] = parsed.value
  }
  let required: string[] | undefined
  if (Object.hasOwn(raw, 'required')) {
    if (
      !Array.isArray(raw.required) ||
      !raw.required.every((key): key is string => typeof key === 'string' && Object.hasOwn(properties, key)) ||
      new Set(raw.required).size !== raw.required.length
    ) return fail('settings.required must contain distinct keys of settings.properties')
    required = [...raw.required]
  }
  return { ok: true, value: { type: 'object', properties, ...(required === undefined ? {} : { required }) } }
}

function parseSetting(raw: unknown, path: string, network: readonly string[]): ParseResult<Setting> {
  if (!isRecord(raw)) return fail(`${path} must be a setting object`)
  const extra = unknownKey(raw, raw.type === 'secret' ? SECRET_KEYS : PLAIN_KEYS)
  if (extra !== undefined) return fail(`${path}.${extra} is an unknown field`)
  if (!isPlainText(raw.title)) return fail(`${path}.title must be 1–60 characters of plain text`)
  if (Object.hasOwn(raw, 'description') && (typeof raw.description !== 'string' || raw.description.length > SETTINGS_LIMITS.descriptionLength)) {
    return fail(`${path}.description must be a string of at most 200 characters`)
  }
  const metadata = { title: raw.title, ...(typeof raw.description === 'string' ? { description: raw.description } : {}) }
  if (raw.type === 'secret') {
    const bind = parseSecretBinding(raw.bind, path, network)
    if (!bind.ok) return bind
    return { ok: true, value: { type: 'secret', ...metadata, bind: bind.value } }
  }
  if (raw.type !== 'string' && raw.type !== 'number' && raw.type !== 'integer' && raw.type !== 'boolean') {
    return fail(`${path}.type must be string, number, integer, boolean or secret`)
  }
  const setting: PlainSetting = { type: raw.type, ...metadata, default: raw.default as PlainSetting['default'] }
  if (Object.hasOwn(raw, 'enum')) {
    if (
      raw.type !== 'string' || !Array.isArray(raw.enum) || raw.enum.length < 1 || raw.enum.length > SETTINGS_LIMITS.enumItems ||
      !raw.enum.every((value): value is string => typeof value === 'string') || new Set(raw.enum).size !== raw.enum.length
    ) return fail(`${path}.enum must contain 1–50 distinct strings on a string setting`)
    setting.enum = [...raw.enum]
  }
  for (const bound of ['minimum', 'maximum'] as const) {
    if (Object.hasOwn(raw, bound)) {
      const value = raw[bound]
      if ((raw.type !== 'number' && raw.type !== 'integer') || typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(`${path}.${bound} must be a finite number on a numeric setting`)
      }
      setting[bound] = value
    }
  }
  if (setting.minimum !== undefined && setting.maximum !== undefined && setting.minimum > setting.maximum) {
    return fail(`${path}.minimum must not exceed maximum`)
  }
  if (Object.hasOwn(raw, 'maxLength')) {
    if (raw.type !== 'string' || typeof raw.maxLength !== 'number' || !Number.isInteger(raw.maxLength) || raw.maxLength < 1 || raw.maxLength > SETTINGS_LIMITS.maxLength) {
      return fail(`${path}.maxLength must be an integer from 1 to 1000 on a string setting`)
    }
    setting.maxLength = raw.maxLength
  }
  if (!isValidSettingValue(setting, raw.default)) return fail(`${path}.default must satisfy its own type and constraints`)
  return { ok: true, value: setting }
}

function parseSecretBinding(raw: unknown, path: string, network: readonly string[]): ParseResult<SecretBinding> {
  if (!isRecord(raw)) return fail(`${path}.bind must be an object`)
  const extra = unknownKey(raw, ['origin', 'header', 'prefix', 'query'])
  if (extra !== undefined) return fail(`${path}.bind.${extra} is an unknown field`)
  if (typeof raw.origin !== 'string' || !network.includes(raw.origin)) {
    return fail(`${path}.bind.origin must be one of manifest.network`)
  }
  if (!isSecretOriginAllowed(raw.origin)) {
    return fail(`${path}.bind.origin must be https, or http on 127.0.0.1, localhost or [::1]`)
  }
  const header = Object.hasOwn(raw, 'header')
  const query = Object.hasOwn(raw, 'query')
  if (header === query) return fail(`${path}.bind must have exactly one of header or query`)
  if (header) {
    if (typeof raw.header !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(raw.header) || PROTECTED_HEADERS.includes(raw.header.toLowerCase())) {
      return fail(`${path}.bind.header must be an allowed header name`)
    }
    if (Object.hasOwn(raw, 'prefix') && (typeof raw.prefix !== 'string' || raw.prefix.length > 32 || /[\u0000-\u001f\u007f]/.test(raw.prefix))) {
      return fail(`${path}.bind.prefix must be at most 32 characters without control characters`)
    }
    return { ok: true, value: { origin: raw.origin, header: raw.header, ...(typeof raw.prefix === 'string' ? { prefix: raw.prefix } : {}) } }
  }
  if (Object.hasOwn(raw, 'prefix')) return fail(`${path}.bind.prefix is only allowed with a header`)
  if (typeof raw.query !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(raw.query)) {
    return fail(`${path}.bind.query must be an allowed query parameter name`)
  }
  return { ok: true, value: { origin: raw.origin, query: raw.query } }
}

export function isValidSettingValue(setting: PlainSetting, value: unknown): boolean {
  switch (setting.type) {
    case 'string':
      return typeof value === 'string' && value.length <= (setting.maxLength ?? SETTINGS_LIMITS.maxLength) &&
        (setting.enum === undefined || setting.enum.includes(value))
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value) &&
        (setting.type !== 'integer' || Number.isInteger(value)) &&
        (setting.minimum === undefined || value >= setting.minimum) &&
        (setting.maximum === undefined || value <= setting.maximum)
  }
}

export function normalizeConfig(
  schema: SettingsSchema | undefined,
  raw: Record<string, unknown>,
  secretsSet: ReadonlySet<string>,
): Record<string, unknown> {
  if (schema === undefined) return {}
  return Object.fromEntries(Object.entries(schema.properties).map(([key, setting]) => [
    key,
    setting.type === 'secret'
      ? secretsSet.has(key)
      : isValidSettingValue(setting, raw[key]) ? raw[key] : setting.default,
  ]))
}

export function isSecretOriginAllowed(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return url.origin === origin && !url.hostname.includes('*') && (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
}
