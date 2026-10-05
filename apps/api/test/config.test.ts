import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

const HOME = '/Users/u'

describe('loadConfig', () => {
  it('defaults to loopback, port 3001, the macOS data directory and the dev UI origin', () => {
    expect(loadConfig({}, 'darwin', HOME)).toEqual({
      host: '127.0.0.1',
      port: 3001,
      dataDir: '/Users/u/Library/Application Support/LifeDashboard',
      uiOrigins: ['http://127.0.0.1:3000'],
    })
  })

  it('reads LIFEDASHBOARD_API_PORT', () => {
    expect(loadConfig({ LIFEDASHBOARD_API_PORT: '4010' }, 'darwin', HOME).port).toBe(4010)
  })

  it.each(['', 'abc', '0', '65536', '3001.5', ' 4010', '-1'])('rejects port %j', (value) => {
    expect(() => loadConfig({ LIFEDASHBOARD_API_PORT: value }, 'darwin', HOME)).toThrow(
      `Invalid LIFEDASHBOARD_API_PORT: "${value}"`,
    )
  })

  it('uses XDG_DATA_HOME on Linux and falls back to ~/.local/share', () => {
    expect(loadConfig({ XDG_DATA_HOME: '/data' }, 'linux', HOME).dataDir).toBe('/data/lifedashboard')
    expect(loadConfig({}, 'linux', HOME).dataDir).toBe('/Users/u/.local/share/lifedashboard')
    expect(loadConfig({ XDG_DATA_HOME: 'relative' }, 'linux', HOME).dataDir).toBe('/Users/u/.local/share/lifedashboard')
  })

  it('uses APPDATA on Windows', () => {
    expect(loadConfig({ APPDATA: '/appdata' }, 'win32', HOME).dataDir).toBe(join('/appdata', 'LifeDashboard'))
  })

  it('reads an absolute LIFEDASHBOARD_DATA_DIR and rejects a relative one', () => {
    expect(loadConfig({ LIFEDASHBOARD_DATA_DIR: '/tmp/ld' }, 'darwin', HOME).dataDir).toBe('/tmp/ld')
    expect(() => loadConfig({ LIFEDASHBOARD_DATA_DIR: 'data' }, 'darwin', HOME)).toThrow(
      'Invalid LIFEDASHBOARD_DATA_DIR: "data"',
    )
  })

  it('reads a comma-separated LIFEDASHBOARD_UI_ORIGINS', () => {
    expect(
      loadConfig({ LIFEDASHBOARD_UI_ORIGINS: 'http://127.0.0.1:3000, http://localhost:3000' }, 'darwin', HOME).uiOrigins,
    ).toEqual(['http://127.0.0.1:3000', 'http://localhost:3000'])
  })

  it.each(['', 'http://127.0.0.1:3000/', 'http://127.0.0.1:3000/app', 'ftp://host', 'not a url', 'http://a:3000,'])(
    'rejects origins %j',
    (value) => {
      expect(() => loadConfig({ LIFEDASHBOARD_UI_ORIGINS: value }, 'darwin', HOME)).toThrow(
        `Invalid LIFEDASHBOARD_UI_ORIGINS: "${value}"`,
      )
    },
  )
})
