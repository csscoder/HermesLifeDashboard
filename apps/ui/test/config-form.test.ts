import type { PlainSetting, SecretSetting, SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import { describe, expect, it } from 'vitest'
import type { ApiFailure } from '../app/api'
import { controlFor, parseFieldInput, plainConfig, secretStatusMessage } from '../app/board/config-form'

const text: PlainSetting = { type: 'string', title: 'Title', default: 'Hello', maxLength: 5 }
const choice: PlainSetting = { type: 'string', title: 'Mode', default: 'a', enum: ['a', 'b'] }
const integer: PlainSetting = { type: 'integer', title: 'Count', default: 1, minimum: 1, maximum: 5 }
const number: PlainSetting = { type: 'number', title: 'Scale', default: 1, minimum: 0, maximum: 2 }
const boolean: PlainSetting = { type: 'boolean', title: 'Enabled', default: false }
const secret: SecretSetting = { type: 'secret', title: 'Token', bind: { origin: 'https://example.com', header: 'Authorization' } }

describe('controlFor', () => {
  it.each([
    [text, 'text'], [choice, 'select'], [integer, 'number'],
    [number, 'number'], [boolean, 'checkbox'], [secret, 'secret'],
  ] as const)('maps %j to %s', (setting, control) => {
    expect(controlFor(setting)).toBe(control)
  })
})

describe('parseFieldInput', () => {
  it.each(['0', '1.5', '6', '', '  ', 'NaN', 'Infinity'])('rejects invalid integer input %j', (raw) => {
    expect(parseFieldInput(integer, raw)).toEqual({ ok: false })
  })

  it('parses a valid integer', () => {
    expect(parseFieldInput(integer, '3')).toEqual({ ok: true, value: 3 })
  })

  it('accepts fractional numbers within bounds', () => {
    expect(parseFieldInput(number, '1.5')).toEqual({ ok: true, value: 1.5 })
    expect(parseFieldInput(number, '2.1')).toEqual({ ok: false })
    expect(parseFieldInput(number, '-1')).toEqual({ ok: false })
    expect(parseFieldInput(number, true)).toEqual({ ok: false })
  })

  it('validates strings and enum membership without coercion', () => {
    expect(parseFieldInput(text, 'Hello')).toEqual({ ok: true, value: 'Hello' })
    expect(parseFieldInput(text, '')).toEqual({ ok: true, value: '' })
    expect(parseFieldInput(text, 'Too long')).toEqual({ ok: false })
    expect(parseFieldInput(text, true)).toEqual({ ok: false })
    expect(parseFieldInput(choice, 'b')).toEqual({ ok: true, value: 'b' })
    expect(parseFieldInput(choice, 'c')).toEqual({ ok: false })
  })

  it('accepts checkbox booleans without coercing strings', () => {
    expect(parseFieldInput(boolean, true)).toEqual({ ok: true, value: true })
    expect(parseFieldInput(boolean, false)).toEqual({ ok: true, value: false })
    expect(parseFieldInput(boolean, 'false')).toEqual({ ok: false })
  })
})

describe('plainConfig', () => {
  it('keeps only plain schema keys, dropping secret values and normalized flags without mutation', () => {
    const schema: SettingsSchema = { type: 'object', properties: { title: text, token: secret, otherToken: secret } }
    const config = { title: 'Hello', token: true, otherToken: 'private input', unknown: 42 }
    expect(plainConfig(schema, config)).toEqual({ title: 'Hello' })
    expect(config).toEqual({ title: 'Hello', token: true, otherToken: 'private input', unknown: 42 })
    expect(plainConfig(schema, {})).toEqual({})
  })
})

describe('secretStatusMessage', () => {
  const hint = 'Сохраните доску, чтобы задать секрет'

  it('asks to save for an unsaved instance or a 404', () => {
    expect(secretStatusMessage(null)).toBe(hint)
    expect(secretStatusMessage({ ok: false, kind: 'invalid', code: 'NOT_FOUND', message: 'Not found' })).toBe(hint)
  })

  it('shows the API message for validation and other invalid failures', () => {
    expect(secretStatusMessage({ ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'At least 16 characters' })).toBe('At least 16 characters')
    expect(secretStatusMessage({ ok: false, kind: 'invalid', code: 'FORBIDDEN', message: 'Denied' })).toBe('Denied')
  })

  it.each<ApiFailure>([
    { kind: 'unauthorized' }, { kind: 'session-expired' }, { kind: 'conflict' },
    { kind: 'rate-limited' }, { kind: 'confirmation-required', confirmationId: 'id' },
    { kind: 'upstream', message: 'Unavailable upstream' }, { kind: 'unavailable' },
  ])('shows the generic failure message for $kind', (failure) => {
    expect(secretStatusMessage({ ok: false, ...failure })).toBe('Не удалось сохранить секрет')
  })

  it('has no error message on success', () => {
    expect(secretStatusMessage({ ok: true, data: {} })).toBeNull()
  })
})
