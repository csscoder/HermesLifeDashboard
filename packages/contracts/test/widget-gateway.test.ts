import { describe, expect, it } from 'vitest'
import {
  BRIDGE_LIMITS,
  CONFIRMATION_DIALOG_MS,
  CONFIRMATION_TTL_MS,
  confirmablePermissions,
  GATEWAY_OPS,
  isGatewayOp,
  parseGatewayInput,
  parseSandboxMessage,
  sizeClass,
} from '../src/widget-gateway.ts'

// JSON of 'x'.repeat(n) is n + 2 bytes (the quotes).
const exactly64k = 'x'.repeat(65_534)

describe('isGatewayOp', () => {
  it('knows the three operations and nothing from the prototype', () => {
    expect(['state.get', 'state.set', 'notifications.send'].every(isGatewayOp)).toBe(true)
    expect(isGatewayOp('http.get')).toBe(false)
    expect(isGatewayOp('toString')).toBe(false)
    expect(isGatewayOp('constructor')).toBe(false)
    expect(isGatewayOp(1)).toBe(false)
  })
})

describe('parseGatewayInput', () => {
  it.each([
    ['state.get', {}, {}],
    ['state.set', { data: { n: 1 }, expectedRevision: 0 }, { data: { n: 1 }, expectedRevision: 0 }],
    ['state.set', { data: null, expectedRevision: 3 }, { data: null, expectedRevision: 3 }],
    ['state.set', { data: exactly64k, expectedRevision: 0 }, { data: exactly64k, expectedRevision: 0 }],
    ['notifications.send', { title: 'Hi', body: '' }, { title: 'Hi', body: '' }],
    ['notifications.send', { title: 'x'.repeat(80), body: 'y'.repeat(300) }, { title: 'x'.repeat(80), body: 'y'.repeat(300) }],
  ] as const)('accepts %s %j', (op, raw, value) => {
    expect(parseGatewayInput(op, raw)).toEqual({ ok: true, value })
  })

  it('normalizes state data to JSON', () => {
    const result = parseGatewayInput('state.set', { data: { at: new Date(0), skip: undefined }, expectedRevision: 0 })
    expect(result).toEqual({ ok: true, value: { data: { at: '1970-01-01T00:00:00.000Z' }, expectedRevision: 0 } })
  })

  it.each([
    ['state.get', { x: 1 }],
    ['state.get', null],
    ['state.set', { expectedRevision: 0 }],
    ['state.set', { data: 1 }],
    ['state.set', { data: 1, expectedRevision: -1 }],
    ['state.set', { data: 1, expectedRevision: 1.5 }],
    ['state.set', { data: 1, expectedRevision: 0, extra: 1 }],
    ['state.set', { data: undefined, expectedRevision: 0 }],
    ['state.set', { data: 10n, expectedRevision: 0 }],
    ['state.set', { data: `${exactly64k}x`, expectedRevision: 0 }],
    ['notifications.send', { title: '', body: '' }],
    ['notifications.send', { title: 'x'.repeat(81), body: '' }],
    ['notifications.send', { title: 'x', body: 'y'.repeat(301) }],
    ['notifications.send', { title: 'x' }],
    ['notifications.send', { title: 'x', body: '', html: '<b>' }],
  ] as const)('rejects %s %s', (op, raw) => {
    expect(parseGatewayInput(op, raw).ok).toBe(false)
  })
})

describe('parseSandboxMessage', () => {
  it('accepts a request and an error report', () => {
    expect(parseSandboxMessage({ t: 'req', id: 0, op: 'state.get', input: {} })).toEqual({ t: 'req', id: 0, op: 'state.get', input: {} })
    expect(parseSandboxMessage({ t: 'error', message: 'boom' })).toEqual({ t: 'error', message: 'boom' })
  })

  it.each([
    null,
    'req',
    { t: 'req', id: -1, op: 'state.get', input: {} },
    { t: 'req', id: 1.5, op: 'state.get', input: {} },
    { t: 'req', id: 1, op: '', input: {} },
    { t: 'req', id: 1, op: 'x'.repeat(101), input: {} },
    { t: 'req', id: 1, op: 'state.get' },
    { t: 'error', message: 1 },
    { t: 'ld:hello', sdk: 1 },
  ])('drops %j', (raw) => {
    expect(parseSandboxMessage(raw)).toBeNull()
  })
})

describe('sizeClass', () => {
  it.each([
    [{ w: 1, h: 8 }, 'xs'],
    [{ w: 2, h: 2 }, 's'],
    [{ w: 12, h: 2 }, 's'],
    [{ w: 3, h: 4 }, 'm'],
    [{ w: 4, h: 4 }, 'm'],
    [{ w: 5, h: 6 }, 'l'],
    [{ w: 6, h: 6 }, 'l'],
    [{ w: 7, h: 7 }, 'xl'],
    [{ w: 12, h: 8 }, 'xl'],
  ] as const)('%j is %s', (size, expected) => {
    expect(sizeClass(size)).toBe(expected)
  })
})

describe('confirmation policy', () => {
  it('asks only for notifications.send, so only notifications offers a mode', () => {
    expect(Object.fromEntries(Object.entries(GATEWAY_OPS).map(([op, spec]) => [op, spec.confirm]))).toEqual({
      'state.get': 'never',
      'state.set': 'never',
      'notifications.send': 'optional',
    })
    expect(confirmablePermissions()).toEqual(['notifications'])
  })

  it('lets the dialog deadline, not the transport, end an unanswered call', () => {
    expect(CONFIRMATION_DIALOG_MS).toBeLessThan(CONFIRMATION_TTL_MS)
    // Spec «Contracts»: two dialogs and five API calls of 5 s (the UI's API_TIMEOUT_MS) fit inside the bridge timeout.
    expect(2 * CONFIRMATION_DIALOG_MS + 5 * 5_000).toBeLessThan(BRIDGE_LIMITS.confirmTimeoutMs)
  })
})
