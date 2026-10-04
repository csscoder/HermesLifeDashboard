import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

describe('loadConfig', () => {
  it('defaults to loopback and port 3001', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3001 })
  })

  it('reads LIFEGAME_API_PORT', () => {
    expect(loadConfig({ LIFEGAME_API_PORT: '4010' })).toEqual({ host: '127.0.0.1', port: 4010 })
  })

  it.each(['', 'abc', '0', '65536', '3001.5', ' 4010', '-1'])('rejects %j', (value) => {
    expect(() => loadConfig({ LIFEGAME_API_PORT: value })).toThrow(
      `Invalid LIFEGAME_API_PORT: "${value}"`,
    )
  })
})
