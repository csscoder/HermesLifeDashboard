import { isValidSettingValue, type PlainSetting, type Setting, type SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import type { ApiResult } from '../api'

export type FieldControl = 'text' | 'select' | 'number' | 'checkbox' | 'secret'

export function controlFor(setting: Setting): FieldControl {
  switch (setting.type) {
    case 'secret': return 'secret'
    case 'boolean': return 'checkbox'
    case 'number':
    case 'integer': return 'number'
    case 'string': return setting.enum === undefined ? 'text' : 'select'
  }
}

export function parseFieldInput(setting: PlainSetting, raw: string | boolean): { ok: true; value: string | number | boolean } | { ok: false } {
  let value: string | number | boolean = raw
  if (setting.type === 'number' || setting.type === 'integer') {
    if (typeof raw !== 'string' || raw.trim() === '') return { ok: false }
    value = Number(raw)
  }
  return isValidSettingValue(setting, value) ? { ok: true, value } : { ok: false }
}

export function plainConfig(schema: SettingsSchema, config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([key]) =>
    Object.hasOwn(schema.properties, key) && schema.properties[key]!.type !== 'secret',
  ))
}

export function isRequiredSetting(schema: SettingsSchema, key: string): boolean {
  return schema.required?.includes(key) ?? false
}

export function mergeConfigField(
  schema: SettingsSchema,
  draft: Record<string, unknown>,
  key: string,
  value: PlainSetting['default'],
): Record<string, unknown> {
  return plainConfig(schema, { ...draft, [key]: value })
}

export function secretStatusMessage(result: ApiResult<unknown> | null): string | null {
  if (result === null || (!result.ok && result.kind === 'invalid' && result.code === 'NOT_FOUND')) {
    return 'Сохраните доску, чтобы задать секрет'
  }
  if (result.ok) return null
  return result.kind === 'invalid' ? result.message : 'Не удалось сохранить секрет'
}
