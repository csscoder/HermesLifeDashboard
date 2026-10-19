import type { SecretBinding, SettingsSchema } from './widget-settings.ts'

export const SECRET_MIN_LENGTH = 16
export const REDACTED = '[REDACTED]'

export interface BoundSecret {
  key: string
  title: string
  bind: SecretBinding
}

export function secretValueError(value: unknown, bind: SecretBinding): string | null {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length < SECRET_MIN_LENGTH || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    return 'The secret must be at least 16 characters without control characters or surrounding spaces'
  }
  if ('header' in bind && /[^\u0000-\u00ff]/.test(value)) return 'A header secret may contain only Latin-1 characters'
  return null
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
  const fragmentIndex = request.url.indexOf('#')
  const beforeFragment = fragmentIndex < 0 ? request.url : request.url.slice(0, fragmentIndex)
  const fragment = fragmentIndex < 0 ? '' : request.url.slice(fragmentIndex)
  const separator = url.search ? '&' : beforeFragment.endsWith('?') ? '' : '?'
  return { url: `${beforeFragment}${separator}${bind.query}=${encodeURIComponent(value)}${fragment}`, headers: request.headers }
}

export function redactSecrets(text: string, values: readonly string[]): string {
  const variants = new Set<string>()
  for (const value of values) {
    if (value === '') continue
    variants.add(value)
    variants.add(encodeURIComponent(value))
    variants.add(new URLSearchParams({ k: value }).toString().slice(2))
  }
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) text = text.replaceAll(variant, REDACTED)
  return text
}
