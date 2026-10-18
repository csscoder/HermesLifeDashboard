import type { SecretBinding, SettingsSchema } from './widget-settings.ts'

export const SECRET_MIN_LENGTH = 16
export const REDACTED = '[REDACTED]'

export interface BoundSecret {
  key: string
  title: string
  bind: SecretBinding
}

export function secretsOf(schema: SettingsSchema | undefined): BoundSecret[] {
  return Object.entries(schema?.properties ?? {}).flatMap(([key, setting]): BoundSecret[] =>
    setting.type === 'secret' ? [{ key, title: setting.title, bind: setting.bind }] : [],
  )
}

export function injectSecret(
  request: { url: string; headers: Record<string, string> },
  bind: SecretBinding,
  value: string,
): { url: string; headers: Record<string, string> } | { error: 'QUERY_COLLISION' } {
  if ('header' in bind) {
    return { url: request.url, headers: { ...request.headers, [bind.header.toLowerCase()]: (bind.prefix ?? '') + value } }
  }
  const url = new URL(request.url)
  if (url.searchParams.has(bind.query)) return { error: 'QUERY_COLLISION' }
  url.searchParams.append(bind.query, value)
  return { url: url.href, headers: request.headers }
}

export function redactSecrets(text: string, values: readonly string[]): string {
  for (const value of values) {
    if (value !== '') text = text.replaceAll(value, REDACTED)
  }
  return text
}
