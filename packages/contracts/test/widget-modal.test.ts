import { describe, expect, it } from 'vitest'
import { parseModalMount, parseModalOpen } from '../src/widget-modal.ts'
import { isPlainText, type ParseResult } from '../src/parse.ts'
import type { InitMessage } from '../src/widget-gateway.ts'

function rejects(result: ParseResult<unknown>): void {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
}

function nested(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = {}
  for (let i = 1; i < depth; i++) value = { child: value }
  return value
}

describe('parseModalOpen', () => {
  it('defaults props to an empty object', () => {
    expect(parseModalOpen({ view: 'workspace' })).toEqual({ ok: true, value: { view: 'workspace', props: {} } })
  })

  it.each(['a', `a${'b'.repeat(63)}`])('accepts view %s', (view) => {
    expect(parseModalOpen({ view }).ok).toBe(true)
  })

  it.each(['', 'A', '1a', 'a'.repeat(65), '__proto__', 'constructor'])('rejects view %s', (view) => {
    rejects(parseModalOpen({ view }))
  })

  it.each(['x', 'x'.repeat(80), '<b>x</b>'])('accepts plain text title %s', (title) => {
    expect(parseModalOpen({ view: 'workspace', title }).ok).toBe(true)
  })

  it.each(['', 'x'.repeat(81), 'a\nb', 'a\u0000b', 'a\u007fb', 1, {}])('rejects title %j', (title) => {
    rejects(parseModalOpen({ view: 'workspace', title }))
  })

  it('keeps the default plain text limit and accepts an explicit 80-character limit', () => {
    expect(isPlainText('x'.repeat(60))).toBe(true)
    expect(isPlainText('x'.repeat(61))).toBe(false)
    expect(isPlainText('x'.repeat(80), 80)).toBe(true)
    expect(isPlainText('x'.repeat(81), 80)).toBe(false)
  })

  it('measures exactly 65536 UTF-8 bytes of props including JSON overhead', () => {
    const props = { text: `${'й'.repeat(32762)}x` }
    expect(new TextEncoder().encode(JSON.stringify(props)).length).toBe(65536)
    expect(parseModalOpen({ view: 'workspace', props }).ok).toBe(true)
    rejects(parseModalOpen({ view: 'workspace', props: { text: `${props.text}x` } }))
  })

  it('accepts depth 32 and rejects depth 33, counting the props object as depth 1', () => {
    expect(parseModalOpen({ view: 'workspace', props: nested(32) }).ok).toBe(true)
    rejects(parseModalOpen({ view: 'workspace', props: nested(33) }))
  })

  it('accepts finite JSON objects with nested arrays and shared references', () => {
    const shared = { valid: true }
    const props = { values: [null, false, 3, 'й', { nested: [] }], a: shared, b: shared }
    expect(parseModalOpen({ view: 'workspace', props })).toEqual({ ok: true, value: { view: 'workspace', props } })
  })

  it('rejects unsupported values before invoking JSON serialization', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const unsupported = [NaN, Infinity, undefined, () => {}, new Date(), new Map(), Object.create({ inherited: true }), cycle, 1n]
    for (const value of unsupported) rejects(parseModalOpen({ view: 'workspace', props: { value } }))
    for (const props of [...unsupported, [], null]) rejects(parseModalOpen({ view: 'workspace', props }))
    rejects(parseModalOpen({ view: 'workspace', props: { toJSON() { throw new Error('must not stringify') } } }))
  })

  it.each(['widgetId', 'url', 'token', 'entry', 'hash'])('rejects unknown top-level key %s', (key) => {
    rejects(parseModalOpen({ view: 'workspace', [key]: 'x' }))
  })

  it.each([null, [], 'workspace', {}])('rejects malformed input %j', (input) => {
    rejects(parseModalOpen(input))
  })
})

describe('parseModalMount', () => {
  it('accepts a valid view and props', () => {
    expect(parseModalMount({ view: 'workspace', props: { n: 1 } })).toEqual({ ok: true, value: { view: 'workspace', props: { n: 1 } } })
  })

  it('rejects title and invalid props or views', () => {
    rejects(parseModalMount({ view: 'workspace', props: {}, title: 'Title' }))
    rejects(parseModalMount({ view: 'A', props: {} }))
    rejects(parseModalMount({ view: 'workspace', props: [] }))
  })
})

describe('InitMessage modal mount type', () => {
  it('allows an optional validated mount alongside context', () => {
    const context: InitMessage['context'] = {
      size: { w: 2, h: 2 }, sizeClass: 's', frame: 'frameless',
      theme: { id: 'default', scheme: 'light', tokens: {} },
      rootFontSize: 16, config: {}, locale: 'en', visible: true,
    }
    const message = {
      t: 'ld:init', context,
      mount: { view: 'workspace', props: { n: 1 } },
    } satisfies InitMessage
    expect(parseModalMount(message.mount).ok).toBe(true)
    const withoutMount = { t: 'ld:init', context } satisfies InitMessage
    expect(withoutMount.t).toBe('ld:init')
  })
})
