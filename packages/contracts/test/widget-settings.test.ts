import { describe, expect, it } from 'vitest'
import { isSecretOriginAllowed, isValidSettingValue, parseSettingsSchema, type PlainSetting } from '../src/widget-settings.ts'

const city = { type: 'string', title: 'Город', default: 'Москва' }
const origin = 'https://a.example'
const secret = { type: 'secret', title: 'Ключ', bind: { origin, header: 'Authorization', prefix: 'Bearer ' } }

function schema(setting: unknown, key = 'key') {
  return { type: 'object', properties: { [key]: setting } }
}

function expectInvalid(raw: unknown, key: string, network: string[] = []) {
  const result = parseSettingsSchema(raw, network)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toMatch(/^settings\./)
    expect(result.error).toContain(key)
  }
}

describe('parseSettingsSchema', () => {
  it('accepts a string setting without an explicit length limit', () => {
    expect(parseSettingsSchema({ type: 'object', properties: { city } }, [])).toEqual({
      ok: true,
      value: { type: 'object', properties: { city: { type: 'string', title: 'Город', default: 'Москва' } } },
    })
  })

  it('preserves every supported plain field and required keys', () => {
    const raw = {
      type: 'object',
      properties: {
        city: { ...city, description: 'Where to show weather', enum: ['Москва', 'Пермь'], maxLength: 10 },
        count: { type: 'integer', title: 'Count', default: 2, minimum: 1, maximum: 3 },
        scale: { type: 'number', title: 'Scale', default: 1.5, minimum: 0, maximum: 2 },
        enabled: { type: 'boolean', title: 'Enabled', default: false },
      },
      required: ['city', 'enabled'],
    }
    expect(parseSettingsSchema(raw, [])).toEqual({ ok: true, value: raw })
  })

  it('requires an object schema with object properties', () => {
    for (const raw of [null, [], {}, { type: 'array', properties: {} }, { type: 'object' }, { type: 'object', properties: [] }]) {
      expectInvalid(raw, 'settings.')
    }
    expect(parseSettingsSchema({ type: 'object', properties: {} }, [])).toEqual({ ok: true, value: { type: 'object', properties: {} } })
  })

  it('allows at most 32 properties', () => {
    const properties = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`key${i}`, city]))
    expect(parseSettingsSchema({ type: 'object', properties }, []).ok).toBe(true)
    expectInvalid({ type: 'object', properties: { ...properties, extra: city } }, 'properties')
  })

  it('requires keys to start with a letter and contain at most 40 allowed characters', () => {
    for (const key of ['A', 'city_2', 'a'.repeat(40), 'constructor']) expect(parseSettingsSchema(schema(city, key), []).ok).toBe(true)
    for (const key of ['', '_key', '2key', 'city-name', 'город', 'a'.repeat(41), '__proto__', 'city\n', 'city\r', 'city\r\n']) expectInvalid(schema(city, key), key)
  })

  it('requires each property to be a supported scalar or secret setting', () => {
    for (const setting of [null, [], 'string', {}, { ...city, type: 'object' }, { ...city, type: 'array' }, { ...city, type: 'null' }]) {
      expectInvalid(schema(setting), 'key')
    }
  })

  it('requires a 1–60 character title without control characters', () => {
    for (const title of ['', 'x'.repeat(61), 'line\nbreak', '\u0000', '\u007f', 1, undefined]) {
      expectInvalid(schema({ ...city, title }), 'key.title')
    }
    expect(parseSettingsSchema(schema({ ...city, title: 'x'.repeat(60) }), []).ok).toBe(true)
  })

  it('limits descriptions to strings of at most 200 characters', () => {
    for (const description of ['', 'x'.repeat(200)]) expect(parseSettingsSchema(schema({ ...city, description }), []).ok).toBe(true)
    for (const description of [null, 1, 'x'.repeat(201)]) expectInvalid(schema({ ...city, description }), 'key.description')
    expectInvalid(schema({ ...secret, description: 'x'.repeat(201) }), 'key.description', [origin])
  })

  it('requires defaults with the declared scalar type', () => {
    for (const setting of [
      { type: 'string', title: 'Missing' }, { ...city, default: undefined }, { ...city, default: null },
      { ...city, default: 1 }, { type: 'boolean', title: 'Bool', default: 'false' },
      { type: 'number', title: 'Number', default: '1' }, { type: 'integer', title: 'Int', default: 1.5 },
      { type: 'number', title: 'Number', default: NaN }, { type: 'number', title: 'Number', default: Infinity },
    ]) expectInvalid(schema(setting), 'key.default')
  })

  it('rejects defaults outside their declared constraints with the specified error', () => {
    expect(parseSettingsSchema(schema({ type: 'integer', title: 'N', default: 50, minimum: 1, maximum: 10 }, 'n'), [])).toEqual({
      ok: false, error: 'settings.n.default must satisfy its own type and constraints',
    })
    for (const setting of [
      { ...city, enum: ['Пермь'] }, { ...city, maxLength: 2 },
      { type: 'number', title: 'N', default: -1, minimum: 0 },
    ]) expectInvalid(schema(setting), 'key.default')
  })

  it('permits enum only on strings', () => {
    for (const type of ['number', 'integer', 'boolean']) expectInvalid(schema({ type, title: 'N', default: 1, enum: ['1'] }), 'key.enum')
  })

  it('requires enums to contain 1–50 distinct strings', () => {
    for (const values of [[], ['Москва', 'Москва'], ['Москва', 1], 'Москва', Array.from({ length: 51 }, (_, i) => `${i}`)]) {
      expectInvalid(schema({ ...city, enum: values }), 'key.enum')
    }
    expect(parseSettingsSchema(schema({ ...city, default: '0', enum: Array.from({ length: 50 }, (_, i) => `${i}`) }), []).ok).toBe(true)
  })

  it('permits minimum and maximum only on numeric settings', () => {
    for (const field of ['minimum', 'maximum']) {
      for (const setting of [city, { type: 'boolean', title: 'Bool', default: false }]) {
        expectInvalid(schema({ ...setting, [field]: 0 }), `key.${field}`)
      }
    }
  })

  it('requires finite numeric bounds', () => {
    for (const field of ['minimum', 'maximum']) {
      for (const value of [NaN, Infinity, -Infinity, '1', null]) {
        expectInvalid(schema({ type: 'number', title: 'N', default: 1, [field]: value }), `key.${field}`)
      }
    }
  })

  it('requires minimum not to exceed maximum', () => {
    expectInvalid(schema({ type: 'number', title: 'N', default: 1, minimum: 2, maximum: 0 }), 'key.minimum')
    expect(parseSettingsSchema(schema({ type: 'integer', title: 'N', default: 1, minimum: 1, maximum: 1 }), []).ok).toBe(true)
  })

  it('permits maxLength only on strings with an integer limit of 1–1000', () => {
    for (const maxLength of [0, -1, 1.5, 1001, Infinity, '10', null]) expectInvalid(schema({ ...city, maxLength }), 'key.maxLength')
    for (const type of ['number', 'integer', 'boolean']) expectInvalid(schema({ type, title: 'N', default: 1, maxLength: 10 }), 'key.maxLength')
    expect(parseSettingsSchema(schema({ ...city, default: 'x', maxLength: 1 }), []).ok).toBe(true)
  })

  it('caps strings without maxLength at 1000 characters', () => {
    expect(parseSettingsSchema(schema({ ...city, default: 'x'.repeat(1000) }), []).ok).toBe(true)
    expectInvalid(schema({ ...city, default: 'x'.repeat(1001) }), 'key.default')
  })

  it('requires required to contain distinct own keys of properties', () => {
    for (const required of ['city', ['missing'], ['city', 'city'], [1], ['toString']]) {
      expectInvalid({ type: 'object', properties: { city }, required }, 'required')
    }
    expect(parseSettingsSchema({ type: 'object', properties: { city }, required: [] }, []).ok).toBe(true)
    expect(parseSettingsSchema({ ...schema(city, 'constructor'), required: ['constructor'] }, []).ok).toBe(true)
  })

  it('rejects unknown schema and property fields including refs, nesting, arrays and formats', () => {
    for (const field of ['$ref', 'additionalProperties']) expectInvalid({ ...schema(city), [field]: false }, field)
    for (const field of ['$ref', 'properties', 'items', 'format', 'bind']) expectInvalid(schema({ ...city, [field]: {} }), `key.${field}`)
  })

  it('accepts header and query secret bindings with optional header prefix', () => {
    for (const bind of [{ origin, header: 'Authorization', prefix: 'Bearer ' }, { origin, header: 'X-Api-Key' }, { origin, query: 'api.key_1-v2' }]) {
      const raw = schema({ type: 'secret', title: 'Ключ', description: 'API key', bind })
      expect(parseSettingsSchema(raw, [origin])).toEqual({ ok: true, value: raw })
    }
  })

  it('rejects default and all plain constraints on secrets', () => {
    for (const [field, value] of Object.entries({ default: '', enum: ['a'], minimum: 0, maximum: 1, maxLength: 16 })) {
      expectInvalid(schema({ ...secret, [field]: value }), `key.${field}`, [origin])
    }
  })

  it('requires a secret origin to belong to manifest.network', () => {
    expect(parseSettingsSchema(schema({ ...secret, bind: { origin: 'https://b.example', query: 'apikey' } }), [origin])).toEqual({
      ok: false, error: 'settings.key.bind.origin must be one of manifest.network',
    })
    expectInvalid(schema(secret), 'key.bind.origin')
  })

  it('rejects a remote http secret origin with the specified error', () => {
    expect(parseSettingsSchema(schema({ ...secret, bind: { origin: 'http://api.example.com', header: 'Authorization', prefix: 'Bearer ' } }), ['http://api.example.com'])).toEqual({
      ok: false, error: 'settings.key.bind.origin must be https, or http on 127.0.0.1, localhost or [::1]',
    })
  })

  it('accepts http loopback origins for secrets', () => {
    for (const local of ['http://127.0.0.1:8787', 'http://localhost', 'http://[::1]:8787']) {
      expect(parseSettingsSchema(schema({ ...secret, bind: { origin: local, query: 'apikey' } }), [local]).ok).toBe(true)
    }
  })

  it('requires a binding object with exactly one injection point', () => {
    for (const bind of [undefined, null, [], { origin }, { origin, header: 'X-Key', query: 'key' }, { origin, query: 'key', prefix: 'Bearer ' }, { header: 'X-Key' }]) {
      expectInvalid(schema({ ...secret, bind }), 'key.bind', [origin])
    }
    expectInvalid(schema({ ...secret, bind: { origin, header: 'X-Key', unknown: true } }), 'key.bind.unknown', [origin])
  })

  it('requires a 1–64 character header name of letters, digits or hyphens', () => {
    for (const header of ['', 'X_Key', 'X:Key', 'X\r\nKey', 'x'.repeat(65), 1, 'X-Key\n', 'X-Key\r', 'X-Key\r\n']) {
      expectInvalid(schema({ ...secret, bind: { origin, header } }), 'key.bind.header', [origin])
    }
    expect(parseSettingsSchema(schema({ ...secret, bind: { origin, header: 'X'.repeat(64) } }), [origin]).ok).toBe(true)
  })

  it('rejects protected header names case-insensitively', () => {
    for (const header of ['Accept', 'CONTENT-TYPE', 'host', 'Cookie', 'Content-Length']) {
      expectInvalid(schema({ ...secret, bind: { origin, header } }), 'key.bind.header', [origin])
    }
  })

  it('allows at most 32 prefix characters without control characters', () => {
    for (const prefix of ['', 'x'.repeat(32)]) expect(parseSettingsSchema(schema({ ...secret, bind: { origin, header: 'X-Key', prefix } }), [origin]).ok).toBe(true)
    for (const prefix of ['x'.repeat(33), 'Bearer\r\n', '\u0000', '\u007f', 1]) {
      expectInvalid(schema({ ...secret, bind: { origin, header: 'X-Key', prefix } }), 'key.bind.prefix', [origin])
    }
  })

  it('requires a 1–64 character query name of letters, digits, underscores, dots or hyphens', () => {
    for (const query of ['', 'api key', 'api&key', 'api=key', 'x'.repeat(65), 1, 'apikey\n', 'apikey\r', 'apikey\r\n']) {
      expectInvalid(schema({ ...secret, bind: { origin, query } }), 'key.bind.query', [origin])
    }
    expect(parseSettingsSchema(schema({ ...secret, bind: { origin, query: 'x'.repeat(64) } }), [origin]).ok).toBe(true)
  })
})

describe('isValidSettingValue', () => {
  it.each<[PlainSetting, unknown, boolean]>([
    [{ type: 'string', title: 'S', default: '' }, 'x'.repeat(1000), true],
    [{ type: 'string', title: 'S', default: '' }, 'x'.repeat(1001), false],
    [{ type: 'string', title: 'S', default: '' }, '', true],
    [{ type: 'string', title: 'S', default: '' }, 1, false],
    [{ type: 'string', title: 'S', default: 'a', enum: ['a', 'b'], maxLength: 1 }, 'b', true],
    [{ type: 'string', title: 'S', default: 'a', enum: ['a', 'bb'], maxLength: 1 }, 'bb', false],
    [{ type: 'string', title: 'S', default: 'a', enum: ['a'] }, 'b', false],
    [{ type: 'number', title: 'N', default: 1, minimum: 1, maximum: 2 }, 1.5, true],
    [{ type: 'number', title: 'N', default: 1, minimum: 1, maximum: 2 }, 1, true],
    [{ type: 'number', title: 'N', default: 1, minimum: 1, maximum: 2 }, 2, true],
    [{ type: 'number', title: 'N', default: 1, minimum: 1, maximum: 2 }, 0, false],
    [{ type: 'number', title: 'N', default: 1, minimum: 1, maximum: 2 }, 3, false],
    [{ type: 'number', title: 'N', default: 1 }, NaN, false],
    [{ type: 'number', title: 'N', default: 1 }, Infinity, false],
    [{ type: 'number', title: 'N', default: 1 }, '1', false],
    [{ type: 'integer', title: 'N', default: 1 }, 1, true],
    [{ type: 'integer', title: 'N', default: 1 }, 1.5, false],
    [{ type: 'boolean', title: 'B', default: false }, false, true],
    [{ type: 'boolean', title: 'B', default: false }, true, true],
    [{ type: 'boolean', title: 'B', default: false }, 'false', false],
    [{ type: 'boolean', title: 'B', default: false }, null, false],
  ])('validates %j against %j as %s', (setting, value, valid) => {
    expect(isValidSettingValue(setting, value)).toBe(valid)
  })
})

describe('isSecretOriginAllowed', () => {
  it.each([
    ['https://api.example.com', true], ['https://192.168.1.2', true],
    ['http://127.0.0.1:8787', true], ['http://localhost:8787', true], ['http://[::1]:8787', true],
    ['http://192.168.1.2', false], ['http://api.example.com', false], ['http://127.0.0.2', false],
    ['http://localhost.evil.example', false], ['http://127.0.0.1:8787@evil.example', false],
    ['http://127.1', false], ['https://api.example.com/path', false], ['https://api.example.com?q=1', false],
    ['https://user:password@api.example.com', false], ['https://*.example.com', false],
    ['ftp://localhost', false], ['invalid', false],
  ])('allows %s: %s', (value, allowed) => {
    expect(isSecretOriginAllowed(value)).toBe(allowed)
  })
})
