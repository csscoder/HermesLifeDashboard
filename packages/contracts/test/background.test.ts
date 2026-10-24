import { describe, expect, it } from 'vitest'
import { defaultBackground, parseScreenBoard } from '../src/board.ts'
import * as board from '../src/board.ts'
const id = '00000000-0000-4000-8000-000000000001'
const background = { mediaId: id, kind: 'video', opacity: 1, dim: .35, pattern: { shape: 'circles', color: '#000000', opacity: .25, scale: 1 } }
const screen = { id, rows: 12, instances: [], layout: [] }
describe('screen backgrounds', () => {
  it('preserves canonical background before instances', () => {
    const parsed = parseScreenBoard({ ...screen, themeId: 'builtin:obsidian', background })
    expect(parsed).toEqual({ ok: true, value: { id, rows: 12, themeId: 'builtin:obsidian', background, instances: [], layout: [] } })
    if (parsed.ok) expect(Object.keys(parsed.value)).toEqual(['id', 'rows', 'themeId', 'background', 'instances', 'layout'])
  })
  it('omits absent and null backgrounds', () => {
    expect(parseScreenBoard({ ...screen, background: null })).toEqual(parseScreenBoard(screen))
  })
  it.each([
    { ...background, mediaId: '../media' }, { ...background, kind: 'audio' }, { ...background, opacity: -1 }, { ...background, dim: Infinity },
    { ...background, pattern: { ...background.pattern, shape: 'random' } },
    { ...background, pattern: { ...background.pattern, color: 'red' } },
    { ...background, pattern: { ...background.pattern, opacity: 2 } },
    { ...background, pattern: { ...background.pattern, scale: .1 } },
  ])('rejects invalid background %j', (invalid) => expect(parseScreenBoard({ ...screen, background: invalid }).ok).toBe(false))
  it('normalizes legacy videoIds and creates independent image defaults', () => {
    const { mediaId, kind, ...settings } = background
    const parsed = parseScreenBoard({ ...screen, background: { videoId: mediaId, ...settings } })
    expect(parsed).toEqual({ ok: true, value: { ...screen, background } })
    if (parsed.ok) expect(Object.keys(parsed.value.background!)).toEqual(['mediaId', 'kind', 'opacity', 'dim', 'pattern'])
    expect(defaultBackground(id)).toEqual({ ...background, pattern: { ...background.pattern, shape: 'diagonal' } })
    expect(defaultBackground(id, 'image')).toEqual({ ...background, kind: 'image', pattern: { ...background.pattern, shape: 'diagonal' } })
    expect(parseScreenBoard({ ...screen, background: { ...background, kind: 'image' } }).ok).toBe(true)
  })

  it.each(['none', 'diagonal', 'squares', 'crosses', 'circles', 'triangles', 'diamonds'])('accepts %s with legacy scale values', (shape) => {
    const settings = { ...background, pattern: { ...background.pattern, shape, scale: .25 } }
    const result = parseScreenBoard({ ...screen, background: settings })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.background).toEqual(settings)
  })

  it('publishes native pixel tile dimensions', () => {
    expect(board.BACKGROUND_PATTERN_SIZES).toEqual({
      diagonal: { width: 2, height: 2 }, squares: { width: 3, height: 3 }, crosses: { width: 3, height: 3 },
      circles: { width: 6, height: 6 }, triangles: { width: 3, height: 3 }, diamonds: { width: 3, height: 3 },
    })
  })

})
