import { plainConfig, type PlainSetting, type SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import type { ApiResult } from '../api'

export { controlFor, parseFieldInput, plainConfig, type FieldControl } from '@lifedashboard/contracts/widget-settings'

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
