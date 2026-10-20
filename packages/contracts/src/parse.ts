export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Maximum length, in UTF-16 code units, of plain-text fields such as manifest title and author. */
export const PLAIN_TEXT_MAX = 60

export function isPlainText(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= PLAIN_TEXT_MAX && !/[\u0000-\u001f\u007f]/.test(value)
}

/** The first key of `record` outside `allowed`, or undefined. */
export function unknownKey(record: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(record).find((key) => !allowed.includes(key))
}

/** UTF-8 size: limits are bytes on the wire, not UTF-16 code units. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
