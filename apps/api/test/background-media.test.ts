import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync, rmdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_SPACE_ID } from '../src/migrations.ts'
import { call, DAY, pair, testApp, type TestApp } from './helpers.ts'
const BASE = '/api/v1/background-media'
const BOARD = `/api/v1/spaces/${SEED_SPACE_ID}/board`
const MP4 = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432000000086d646174', 'hex')
let t: TestApp
let cookie: string
beforeEach(async () => { t = await testApp(); cookie = await pair(t) })
afterEach(async () => { await t.close() })
function upload(body: Buffer | Readable = MP4, size = MP4.length, mime = 'video/mp4') {
  return call(t.app, { method: 'POST', url: `${BASE}?${new URLSearchParams({ name: '../../my video.mp4', size: String(size), mime })}`, cookie, contentType: 'application/octet-stream', payload: body })
}
async function imported() { const r = await upload(); expect(r.statusCode).toBe(200); return r.json().data }
async function board() { return (await call(t.app, { url: BOARD, cookie })).json().data }
function background(mediaId: string, kind: 'video' | 'image' = 'video') { return { mediaId, kind, opacity: .8, dim: .3, pattern: { shape: 'diamonds', color: '#123456', opacity: .4, scale: 2 } } }
async function save(videoId?: string, revision?: number) {
  const b = await board(); return call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: revision ?? b.revision, screens: b.screens.map((s: object) => ({ ...s, background: videoId ? background(videoId) : null })) } })
}
function lease(leaseId: string, videoIds: string[]) { return call(t.app, { method: 'POST', url: `${BASE}/leases`, cookie, payload: { leaseId, videoIds } }) }
function discard(id: string) { return call(t.app, { method: 'DELETE', url: `${BASE}/${id}`, cookie, payload: {} }) }
describe('background media', () => {
  it('streams an owned copy, safe metadata, full and byte-range reads behind auth', async () => {
    const media = await imported()
    expect(media).toEqual({ id: expect.any(String), name: '../../my video.mp4', size: MP4.length, mime: 'video/mp4' })
    expect((await call(t.app, { url: `${BASE}/${media.id}/metadata`, cookie })).json().data).toEqual(media)
    expect((await call(t.app, { url: `${BASE}/${media.id}` })).statusCode).toBe(401)
    const full = await call(t.app, { url: `${BASE}/${media.id}`, cookie }); expect(full.rawPayload).toEqual(MP4)
    const range = await call(t.app, { url: `${BASE}/${media.id}`, cookie, headers: { range: 'bytes=4-11' } })
    expect(range.statusCode).toBe(206); expect(range.rawPayload).toEqual(MP4.subarray(4, 12)); expect(range.headers['content-range']).toBe(`bytes 4-11/${MP4.length}`)
    expect((await call(t.app, { url: `${BASE}/${media.id}`, cookie, headers: { range: 'bytes=999-' } })).statusCode).toBe(416)
  })
  it('accepts chunked WebM and rejects unsupported containers, sizes and partial uploads', async () => {
    const webm = Buffer.from('1a45dfa3100000007765626d', 'hex')
    const good = await upload(Readable.from([webm.subarray(0, 2), webm.subarray(2)]), webm.length, 'video/webm')
    expect(good.statusCode).toBe(200)
    for (const result of [await upload(Buffer.from('not a video')), await upload(MP4, MP4.length + 1), await upload(MP4, MP4.length - 1), await upload(MP4, 0), await upload(MP4, 3 * 1024 ** 3), await upload(MP4, MP4.length, 'text/plain')]) expect(result.statusCode).toBe(400)
    expect(readdirSync(join(t.dataDir, 'background-media')).filter((name) => name.endsWith('.part'))).toEqual([])
  })
  it('round trips background and rejects missing media without changing the saved board', async () => {
    const media = await imported(); const result = await save(media.id)
    expect(result.statusCode).toBe(200); expect(result.json().data.screens[0].background).toEqual(background(media.id))
    expect((await save(randomUUID())).statusCode).toBe(400)
    expect((await board()).screens[0].background).toEqual(background(media.id))
    expect((await discard(media.id)).statusCode).toBe(409)
    expect((await save(undefined, 1)).statusCode).toBe(409)
    expect((await call(t.app, { url: `${BASE}/${media.id}`, cookie })).statusCode).toBe(200)
    expect((await save()).statusCode).toBe(200)
    expect((await call(t.app, { url: `${BASE}/${media.id}/metadata`, cookie })).statusCode).toBe(404)
  })
  it('leases protect other tabs and renew drafts older than 24 hours until released', async () => {
    const media = await imported(); const a = randomUUID(); const b = randomUUID()
    expect((await lease(a, [media.id])).statusCode).toBe(200)
    t.clock.now += DAY - 1000; expect((await lease(b, [media.id])).statusCode).toBe(200)
    t.clock.now += 2000; expect((await lease(b, [media.id])).statusCode).toBe(200)
    expect((await discard(media.id)).statusCode).toBe(409)
    expect((await lease(b, [randomUUID()])).statusCode).toBe(400)
    expect((await discard(media.id)).statusCode).toBe(409)
    expect((await call(t.app, { method: 'DELETE', url: `${BASE}/leases/${b}`, cookie, payload: {} })).statusCode).toBe(200)
    expect((await call(t.app, { url: `${BASE}/${media.id}/metadata`, cookie })).statusCode).toBe(404)
  })
  it('a failed unlink retains metadata for cleanup retry', async () => {
    const media = await imported(); const file = join(t.dataDir, 'background-media', media.id)
    // A directory at an owned file path makes unlink fail on every platform.
    const fs = await import('node:fs'); fs.unlinkSync(file); mkdirSync(file)
    expect((await discard(media.id)).statusCode).toBe(500)
    expect(t.db.prepare('SELECT id FROM background_media WHERE id = ?').get(media.id)).toBeTruthy()
  })
  it('cleans interrupted owned staging files on startup while retaining unrelated files', async () => {
    const root = join(t.dataDir, 'background-media'); mkdirSync(root, { recursive: true })
    const interrupted = join(root, `${randomUUID()}.part`); writeFileSync(interrupted, 'partial'); writeFileSync(join(root, 'personal-file'), 'keep')
    const other = await testApp(t); await other.close()
    expect(existsSync(interrupted)).toBe(false); expect(existsSync(join(root, 'personal-file'))).toBe(true)
  })
  it('keeps origin, content-type, and session guards on imports and rejects traversal ids', async () => {
    const url = `${BASE}?name=a.mp4&size=${MP4.length}&mime=video%2Fmp4`
    expect((await call(t.app, { method: 'POST', url, contentType: 'application/octet-stream', payload: MP4 })).statusCode).toBe(401)
    expect((await call(t.app, { method: 'POST', url, cookie, origin: null, contentType: 'application/octet-stream', payload: MP4 })).statusCode).toBe(403)
    expect((await call(t.app, { method: 'POST', url, cookie, origin: 'null', contentType: 'application/octet-stream', payload: MP4 })).statusCode).toBe(403)
    expect((await call(t.app, { method: 'POST', url, cookie, payload: {} })).statusCode).toBe(403)
    expect((await call(t.app, { url: `${BASE}/not-a-uuid`, cookie })).statusCode).toBe(404)
  })
  it('protects shared saved references through screen and space deletion and then cleans the last reference', async () => {
    const media = await imported()
    const other = (await call(t.app, { method: 'POST', url: '/api/v1/spaces', cookie, payload: {} })).json().data
    const otherUrl = `/api/v1/spaces/${other.id}/board`
    const otherBoard = (await call(t.app, { url: otherUrl, cookie })).json().data
    expect((await call(t.app, { method: 'PUT', url: otherUrl, cookie, payload: { expectedRevision: 1, screens: otherBoard.screens.map((s: object) => ({ ...s, background: background(media.id) })) } })).statusCode).toBe(200)
    const added = (await call(t.app, { method: 'POST', url: `/api/v1/spaces/${SEED_SPACE_ID}/screens`, cookie, payload: { expectedRevision: 1 } })).json().data
    expect((await save(media.id)).statusCode).toBe(200)
    const revision = (await board()).revision
    expect((await call(t.app, { method: 'DELETE', url: `/api/v1/spaces/${SEED_SPACE_ID}/screens/${added.screens[1].id}`, cookie, payload: { expectedRevision: revision } })).statusCode).toBe(200)
    expect((await discard(media.id)).statusCode).toBe(409)
    expect((await call(t.app, { method: 'DELETE', url: `/api/v1/spaces/${other.id}`, cookie, payload: { expectedRevision: 2 } })).statusCode).toBe(200)
    expect((await discard(media.id)).statusCode).toBe(409)
    expect((await save()).statusCode).toBe(200)
    expect((await call(t.app, { url: `${BASE}/${media.id}`, cookie })).statusCode).toBe(404)
  })
  it('successful replacement retains another tab lease until release', async () => {
    const media = await imported(); await save(media.id)
    const leaseId = randomUUID(); await lease(leaseId, [media.id])
    expect((await save()).statusCode).toBe(200)
    expect((await call(t.app, { url: `${BASE}/${media.id}`, cookie })).statusCode).toBe(200)
    expect((await lease(leaseId, [])).statusCode).toBe(200)
    expect((await call(t.app, { url: `${BASE}/${media.id}`, cookie })).statusCode).toBe(404)
  })
  it('expires abandoned staged assets while saved assets survive', async () => {
    const staged = await imported(); const saved = await imported(); await save(saved.id)
    t.clock.now += DAY + 1
    await lease(randomUUID(), [])
    expect((await call(t.app, { url: `${BASE}/${staged.id}`, cookie })).statusCode).toBe(404)
    expect((await call(t.app, { url: `${BASE}/${saved.id}`, cookie })).statusCode).toBe(200)
  })
  it('cleanup failure does not fail a committed board save and retries on the next cleanup', async () => {
    const media = await imported(); await save(media.id)
    const path = join(t.dataDir, 'background-media', media.id)
    unlinkSync(path); mkdirSync(path)
    expect((await save()).statusCode).toBe(200)
    expect((await board()).screens[0].background).toBeUndefined()
    expect(t.db.prepare('SELECT id FROM background_media WHERE id = ?').get(media.id)).toBeTruthy()
    rmdirSync(path); writeFileSync(path, MP4)
    await lease(randomUUID(), [])
    expect(t.db.prepare('SELECT id FROM background_media WHERE id = ?').get(media.id)).toBeUndefined()
    expect(existsSync(path)).toBe(false)
  })
  it('rejects media with a missing or truncated application copy before saving', async () => {
    const media = await imported(); writeFileSync(join(t.dataDir, 'background-media', media.id), MP4.subarray(0, 12))
    expect((await save(media.id)).statusCode).toBe(400)
    expect((await board()).revision).toBe(1)
  })

  it('accepts declarations above 2 GiB and verifies the actual streamed count', async () => {
    const response = await upload(MP4, 3 * 1024 ** 3)
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toBe('Video size differs from its declared size')
  })

  it('handles a filesystem write failure without publishing metadata or a partial asset', async () => {
    const root = join(t.dataDir, 'background-media')
    renameSync(root, `${root}-saved`); writeFileSync(root, 'filesystem blocked')
    try {
      const response = await upload()
      expect(response.statusCode).toBe(500)
      expect(response.json().error.message).toBe('Internal error')
      expect(t.db.prepare('SELECT * FROM background_media').all()).toEqual([])
    } finally {
      unlinkSync(root); renameSync(`${root}-saved`, root)
    }
    expect(readdirSync(root)).toEqual([])
  })

  it('imports legacy QuickTime atoms without ftyp and keeps MIME matching strict', async () => {
    const atom = (type: string, payload = Buffer.alloc(0)) => {
      const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4, 'ascii')
      return Buffer.concat([header, payload])
    }
    const legacy = Buffer.concat([atom('free', Buffer.from('qt  ')), atom('wide'), atom('mdat', Buffer.alloc(5000)), atom('moov', atom('mvhd', Buffer.alloc(24)))])
    const accepted = await upload(Readable.from([legacy.subarray(0, 5), legacy.subarray(5, 17), legacy.subarray(17)]), legacy.length, 'video/quicktime')
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().data.mime).toBe('video/quicktime')
    expect((await call(t.app, { url: `${BASE}/${accepted.json().data.id}`, cookie })).rawPayload).toEqual(legacy)
    expect((await upload(legacy, legacy.length, 'video/mp4')).statusCode).toBe(400)
    expect((await upload(legacy, legacy.length, 'video/webm')).statusCode).toBe(400)
    const malformed = Buffer.from(legacy); malformed.writeUInt32BE(7, 0)
    expect((await upload(malformed, malformed.length, 'video/quicktime')).statusCode).toBe(400)
    const oversized = Buffer.from(legacy); oversized.writeUInt32BE(legacy.length + 1, 20)
    expect((await upload(oversized, oversized.length, 'video/quicktime')).statusCode).toBe(400)
    const arbitrary = Buffer.from('0000000877696465000000106a756e6b0000000000000000', 'hex')
    expect((await upload(arbitrary, arbitrary.length, 'video/quicktime')).statusCode).toBe(400)
  })

  it('imports supported raster images and validates the saved kind against MIME', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000000000000', 'hex')
    const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')
    const webp = Buffer.from('5249464614000000574542505650384c080000002f00000000000000', 'hex')
    const avif = Buffer.from('00000018667479706176696600000000617669666d696631', 'hex')
    for (const [mime, bytes] of [['image/png', png], ['image/jpeg', jpeg], ['image/webp', webp], ['image/avif', avif]] as const) {
      const result = await upload(bytes, bytes.length, mime)
      expect(result.statusCode).toBe(200)
      const media = result.json().data
      expect(media.mime).toBe(mime)
      expect((await save(media.id)).statusCode).toBe(400)
      const b = await board()
      const saved = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: b.revision, screens: b.screens.map((s: object) => ({ ...s, background: background(media.id, 'image') })) } })
      expect(saved.statusCode).toBe(200)
      expect(saved.json().data.screens[0].background).toEqual(background(media.id, 'image'))
      expect((await discard(media.id)).statusCode).toBe(409)
      const leaseId = randomUUID(); await lease(leaseId, [media.id])
      await save()
      expect((await call(t.app, { url: `${BASE}/${media.id}`, cookie })).rawPayload).toEqual(bytes)
      await lease(leaseId, [])
      expect((await call(t.app, { url: `${BASE}/${media.id}`, cookie })).statusCode).toBe(404)
    }
    expect((await upload(MP4, MP4.length, 'image/png')).statusCode).toBe(400)
    expect((await upload(png, png.length, 'video/mp4')).statusCode).toBe(400)
    expect((await upload(avif, avif.length, 'video/mp4')).statusCode).toBe(400)
    const video = await imported(); const b = await board()
    expect((await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: b.revision, screens: b.screens.map((s: object) => ({ ...s, background: background(video.id, 'image') })) } })).statusCode).toBe(400)
    expect((await upload(png, png.length, 'image/jpeg')).statusCode).toBe(400)
    expect((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 40, 'image/svg+xml')).statusCode).toBe(400)
    expect((await upload(Buffer.from('GIF89a000000'), 12, 'image/gif')).statusCode).toBe(400)
  })
  it('normalizes legacy video board payloads and readback without losing media references', async () => {
    const media = await imported()
    const { mediaId, kind, ...settings } = background(media.id)
    const b = await board()
    const response = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: { expectedRevision: b.revision, screens: b.screens.map((s: object) => ({ ...s, background: { videoId: mediaId, ...settings } })) } })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens[0].background).toEqual(background(media.id))
    t.db.prepare('UPDATE screens SET background = ?').run(JSON.stringify({ videoId: media.id, ...settings }))
    expect((await board()).screens[0].background).toEqual(background(media.id))
    expect((await discard(media.id)).statusCode).toBe(409)
  })

})
