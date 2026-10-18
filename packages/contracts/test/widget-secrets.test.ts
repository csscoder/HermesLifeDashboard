import { describe, expect, it } from 'vitest'
import { GATEWAY_OPS, RATE_LIMITS } from '../src/widget-gateway.ts'
import { REDACTED, SECRET_MIN_LENGTH, injectSecret, redactSecrets, secretsOf } from '../src/widget-secrets.ts'
import type { SettingsSchema } from '../src/widget-settings.ts'

const origin = 'https://a.example'
const value = 'k'.repeat(16)

describe('secret constants', () => {
  it('exports the specified minimum length and redaction marker', () => {
    expect(SECRET_MIN_LENGTH).toBe(16)
    expect(REDACTED).toBe('[REDACTED]')
  })
})

describe('secretsOf', () => {
  it('returns no secrets without a schema or with only plain settings', () => {
    expect(secretsOf(undefined)).toEqual([])
    expect(secretsOf({ type: 'object', properties: {} })).toEqual([])
    expect(secretsOf({ type: 'object', properties: { city: { type: 'string', title: 'City', default: '' } } })).toEqual([])
  })

  it('returns only secret keys, titles and bindings in schema property order', () => {
    const settings: SettingsSchema = { type: 'object', properties: {
      zKey: { type: 'secret', title: 'Header key', description: 'Private', bind: { origin, header: 'Authorization', prefix: 'Bearer ' } },
      city: { type: 'string', title: 'City', default: '' },
      aKey: { type: 'secret', title: 'Query key', bind: { origin, query: 'apikey' } },
    } }
    expect(secretsOf(settings)).toEqual([
      { key: 'zKey', title: 'Header key', bind: { origin, header: 'Authorization', prefix: 'Bearer ' } },
      { key: 'aKey', title: 'Query key', bind: { origin, query: 'apikey' } },
    ])
  })
})

describe('injectSecret', () => {
  it('writes a lower-case header with the optional prefix', () => {
    expect(injectSecret({ url: 'https://a.example/v1?q=1', headers: {} }, { origin, header: 'Authorization', prefix: 'Bearer ' }, value))
      .toEqual({ url: 'https://a.example/v1?q=1', headers: { authorization: `Bearer ${value}` } })
  })

  it('injects a header without a prefix and preserves the original request', () => {
    const request = { url: 'https://a.example/v1?q=1', headers: { accept: 'application/json', 'x-api-key': 'old' } }
    expect(injectSecret(request, { origin, header: 'X-Api-Key' }, value)).toEqual({
      url: request.url, headers: { accept: 'application/json', 'x-api-key': value },
    })
    expect(request).toEqual({ url: 'https://a.example/v1?q=1', headers: { accept: 'application/json', 'x-api-key': 'old' } })
  })

  it('appends a query parameter after existing parameters', () => {
    expect(injectSecret({ url: 'https://a.example/v1?q=1', headers: {} }, { origin, query: 'apikey' }, value))
      .toEqual({ url: `https://a.example/v1?q=1&apikey=${value}`, headers: {} })
  })

  it('preserves the raw URL, headers and fragment while URI-encoding only the injected value', () => {
    const request = { url: 'https://a.example/v1?q=a%20b&path=:/,~&escaped=%2f#section', headers: { accept: 'application/json' } }
    expect(injectSecret(request, { origin, query: 'apikey' }, 'a b+c&d=?/#')).toEqual({
      url: 'https://a.example/v1?q=a%20b&path=:/,~&escaped=%2f&apikey=a%20b%2Bc%26d%3D%3F%2F%23#section', headers: request.headers,
    })
    expect(request.url).toBe('https://a.example/v1?q=a%20b&path=:/,~&escaped=%2f#section')
    expect(request.headers).toEqual({ accept: 'application/json' })
  })

  it('redacts the exact query value injected before a fragment', () => {
    const secret = 'ключ ab+cd/ef=ghijklmnop'
    const result = injectSecret({ url: 'https://a.example/v1#section', headers: {} }, { origin, query: 'apikey' }, secret)
    expect(result).toEqual({ url: `https://a.example/v1?apikey=${encodeURIComponent(secret)}#section`, headers: {} })
    if ('url' in result) expect(redactSecrets(result.url, [secret])).toBe('https://a.example/v1?apikey=[REDACTED]#section')
  })

  it('adds a query parameter when no query exists', () => {
    expect(injectSecret({ url: 'https://a.example/v1', headers: {} }, { origin, query: 'apikey' }, value))
      .toEqual({ url: `https://a.example/v1?apikey=${value}`, headers: {} })
  })

  it.each(['', '#f'])('reuses an empty query delimiter before fragment %j', (fragment) => {
    expect(injectSecret({ url: `https://a.example/v1?${fragment}`, headers: {} }, { origin, query: 'apikey' }, value))
      .toEqual({ url: `https://a.example/v1?apikey=${value}${fragment}`, headers: {} })
  })

  it.each(['apikey=x', 'apikey=', 'apikey', 'api%6bey=x', 'q=1&apikey=x&apikey=y'])('rejects a query collision in %s', (query) => {
    const request = { url: `https://a.example/v1?${query}`, headers: { accept: 'application/json' } }
    expect(injectSecret(request, { origin, query: 'apikey' }, value)).toEqual({ error: 'QUERY_COLLISION' })
    expect(request).toEqual({ url: `https://a.example/v1?${query}`, headers: { accept: 'application/json' } })
  })
})

describe('redactSecrets', () => {
  it('redacts the specified echoed secret in JSON', () => {
    expect(redactSecrets('{"echo":"SECRETSECRETSECRET1","n":15}', ['SECRETSECRETSECRET1']))
      .toBe('{"echo":"[REDACTED]","n":15}')
  })

  it('leaves text unchanged when no secrets are provided', () => {
    expect(redactSecrets('abc', [])).toBe('abc')
  })

  it('replaces every literal occurrence of multiple secrets, including special characters', () => {
    expect(redactSecrets('a.*$& a.*$& other+secret other+secret', ['a.*$&', 'other+secret']))
      .toBe('[REDACTED] [REDACTED] [REDACTED] [REDACTED]')
  })

  it('skips empty values and leaves unrelated text intact', () => {
    expect(redactSecrets('abc', ['', 'missing', ''])).toBe('abc')
    expect(redactSecrets('', ['', value])).toBe('')
  })

  it.each([
    ['ab+cd/ef=gh ijklmnop', 'ab%2Bcd%2Fef%3Dgh%20ijklmnop', 'ab%2Bcd%2Fef%3Dgh+ijklmnop'],
    ['ключ+ab/cd=ef ghijklmnop', '%D0%BA%D0%BB%D1%8E%D1%87%2Bab%2Fcd%3Def%20ghijklmnop', '%D0%BA%D0%BB%D1%8E%D1%87%2Bab%2Fcd%3Def+ghijklmnop'],
  ])('redacts literal, URI-encoded and form-encoded variants of %s', (secret, uriEncoded, formEncoded) => {
    const text = [secret, uriEncoded, formEncoded, uriEncoded, formEncoded].join('|')
    expect(redactSecrets(text, [secret])).toBe(Array(5).fill('[REDACTED]').join('|'))
  })

  it('deduplicates variants and redacts overlapping values longest first', () => {
    expect(redactSecrets('token+suffix|token%2Bsuffix|token', ['token', 'token+suffix', 'token']))
      .toBe('[REDACTED]|[REDACTED]|[REDACTED]')
  })

  it('redacts literal echoes in content types', () => {
    expect(redactSecrets(`application/${value}; echo=${value}`, [value])).toBe('application/[REDACTED]; echo=[REDACTED]')
  })
})

describe('RATE_LIMITS', () => {
  it('preserves the existing limits for exactly the gateway operations', () => {
    expect(RATE_LIMITS).toEqual({
      'state.get': { max: 120, windowMs: 60_000 },
      'state.set': { max: 60, windowMs: 60_000 },
      'notifications.send': { max: 10, windowMs: 3_600_000 },
      'http.get': { max: 120, windowMs: 60_000 },
      'http.send': { max: 60, windowMs: 60_000 },
    })
    expect(Object.keys(RATE_LIMITS)).toEqual(Object.keys(GATEWAY_OPS))
  })
})
