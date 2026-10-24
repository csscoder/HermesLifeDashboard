import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { isUuid, type BackgroundMedia, type ScreenBoard } from '@lifedashboard/contracts/board'
import { ApiError, ok } from './errors.ts'
import { parseRange } from './sandbox.ts'

const DAY = 24 * 60 * 60_000
const BASE = '/api/v1/background-media'
interface MediaRow extends BackgroundMedia { created_at: number; committed: number; cleanup_requested: number }
interface MediaDeps { db: DatabaseSync; dataDir: string; now: () => Date }

export interface BackgroundMediaStore {
  validate(screens: ScreenBoard[]): void
  commit(screens: ScreenBoard[]): void
  cleanup(): void
}

// Legacy QuickTime may start with padding/wide atoms instead of an ISO-BMFF ftyp.
function legacyQuickTime(prefix: Buffer, size: number): boolean {
  let offset = 0
  let wide = false
  while (offset + 8 <= prefix.length) {
    let length = prefix.readUInt32BE(offset)
    const type = prefix.toString('ascii', offset + 4, offset + 8)
    let header = 8
    if (length === 1) {
      if (offset + 16 > prefix.length) return false
      const extended = prefix.readBigUInt64BE(offset + 8)
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return false
      length = Number(extended)
      header = 16
    } else if (length === 0) length = size - offset
    if (length < header || length > size - offset) return false
    if (type === 'wide') {
      if (length !== 8) return false
      wide = true
    } else if (type === 'moov') {
      if (length < header + 8 || offset + header + 8 > prefix.length) return false
      const childLength = prefix.readUInt32BE(offset + header)
      const childType = prefix.toString('ascii', offset + header + 4, offset + header + 8)
      return childLength >= 8 && childLength <= length - header && ['mvhd', 'trak', 'udta', 'iods', 'meta', 'cmov'].includes(childType)
    } else if (type === 'mdat') return wide && length > header
    else if (type !== 'free' && type !== 'skip') return false
    offset += length
  }
  return false
}

function rasterImage(prefix: Buffer, size: number, mime: string): boolean {
  if (mime === 'image/png') return prefix.length >= 24 &&
    prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    prefix.readUInt32BE(8) === 13 && prefix.toString('ascii', 12, 16) === 'IHDR' &&
    prefix.readUInt32BE(16) > 0 && prefix.readUInt32BE(20) > 0
  if (mime === 'image/jpeg') return prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 &&
    prefix[3]! >= 192 && prefix[3]! <= 254 && prefix[3] !== 216 && prefix[3] !== 217
  if (mime === 'image/webp') return prefix.length >= 20 && prefix.toString('ascii', 0, 4) === 'RIFF' &&
    prefix.readUInt32LE(4) + 8 === size && prefix.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(prefix.toString('ascii', 12, 16)) && prefix.readUInt32LE(16) <= size - 20
  if (mime === 'image/avif' && prefix.length >= 16 && prefix.toString('ascii', 4, 8) === 'ftyp') {
    const length = prefix.readUInt32BE(0)
    if (length < 16 || length > size || length % 4 !== 0) return false
    for (let offset = 8; offset + 4 <= Math.min(length, prefix.length); offset += 4) {
      if (offset === 12) continue // ftyp minor version is not a brand.
      if (['avif', 'avis'].includes(prefix.toString('ascii', offset, offset + 4))) return true
    }
  }
  return false
}

export function registerBackgroundMedia(app: FastifyInstance, { db, dataDir, now }: MediaDeps): BackgroundMediaStore {
  const root = join(dataDir, 'background-media')
  mkdirSync(root, { recursive: true })
  const pathOf = (id: string) => join(root, id)
  const metadata = ({ id, name, size, mime }: MediaRow): BackgroundMedia => ({ id, name, size, mime })
  function find(id: string): MediaRow {
    const row = isUuid(id) ? db.prepare('SELECT * FROM background_media WHERE id = ?').get(id) as MediaRow | undefined : undefined
    if (!row) throw new ApiError('NOT_FOUND', 'Background video not found')
    return row
  }
  function referenced(id: string): boolean {
    return db.prepare("SELECT 1 FROM screens WHERE COALESCE(json_extract(background, '$.mediaId'), json_extract(background, '$.videoId')) = ? LIMIT 1").get(id) !== undefined
  }
  function leased(id: string): boolean {
    return db.prepare('SELECT 1 FROM background_media_leases WHERE video_id = ? AND expires_at > ? LIMIT 1').get(id, now().getTime()) !== undefined
  }
  function unlinkOwned(path: string): void {
    try { unlinkSync(path) } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  function remove(row: MediaRow): void {
    unlinkOwned(`${pathOf(row.id)}.part`)
    unlinkOwned(pathOf(row.id))
    db.prepare('DELETE FROM background_media WHERE id = ?').run(row.id)
  }
  function cleanup(): void {
    db.prepare('DELETE FROM background_media_leases WHERE expires_at <= ?').run(now().getTime())
    const rows = db.prepare('SELECT * FROM background_media WHERE committed = 1 OR cleanup_requested = 1 OR created_at <= ?').all(now().getTime() - DAY) as unknown as MediaRow[]
    for (const row of rows) {
      if (referenced(row.id) || leased(row.id)) continue
      try { remove(row) } catch (error) { app.log.warn({ err: error, mediaId: row.id }, 'Background cleanup failed; metadata retained for retry') }
    }
  }
  // Only UUID-named staging files belong to this importer; unrelated files are never swept.
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.part') || !isUuid(name.slice(0, -5))) continue
    try { unlinkSync(join(root, name)) } catch (error) { app.log.warn({ err: error }, 'Background staging cleanup failed') }
  }
  cleanup()
  const timer = setInterval(cleanup, 60_000)
  timer.unref()
  app.addHook('onClose', async () => { clearInterval(timer) })

  app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload))
    scope.post<{ Querystring: { name?: string; size?: string; mime?: string } }>(BASE, async (request) => {
      const { name, size: declared, mime } = request.query
      const size = Number(declared)
      if (typeof name !== 'string' || !name || name.length > 1024 || name.includes('\0') ||
        typeof declared !== 'string' || !/^\d+$/.test(declared) || !Number.isSafeInteger(size) || size < 12 ||
        !['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(mime ?? '')) {
        throw new ApiError('VALIDATION_ERROR', 'Expected a media name, supported MIME and a safe integer size of at least 12 bytes')
      }
      const id = randomUUID()
      const staging = `${pathOf(id)}.part`
      let received = 0
      let prefix = Buffer.alloc(0)
      const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
        received += chunk.length
        if (prefix.length < 4096) prefix = Buffer.concat([prefix, chunk.subarray(0, 4096 - prefix.length)])
        done(null, received > size ? null : chunk)
      } })
      let moved = false
      let recorded = false
      const body = (request.body as Readable | undefined) ?? Readable.from([])
      const forwardError = (error: Error) => limit.destroy(error)
      body.on('error', forwardError)
      try {
        // Keep the HTTP request outside pipeline: a disk error must still permit an error reply.
        body.pipe(limit)
        await pipeline(limit, createWriteStream(staging, { flags: 'wx' }))
        if (received !== size) throw new ApiError('VALIDATION_ERROR', 'Video size differs from its declared size')
        const webm = prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && prefix.includes(Buffer.from('webm'))
        const mp4 = prefix.subarray(4, 8).toString('ascii') === 'ftyp' && prefix.readUInt32BE(0) >= 16 && prefix.readUInt32BE(0) <= size && !rasterImage(prefix, size, 'image/avif')
        const quickTime = mime === 'video/quicktime' && legacyQuickTime(prefix, size)
        const valid = mime!.startsWith('image/') ? rasterImage(prefix, size, mime!) : mime === 'video/webm' ? webm : mp4 || quickTime
        if (!valid) throw new ApiError('VALIDATION_ERROR', 'Unsupported or mismatched video container')
        const result: BackgroundMedia = { id, name, size, mime: mime! }
        // Journal before rename: a crash cannot leave a completed file outside managed cleanup.
        db.prepare('INSERT INTO background_media (id, name, size, mime, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, size, mime!, now().getTime())
        recorded = true
        renameSync(staging, pathOf(id)); moved = true
        return ok(request, result)
      } catch (error) {
        try {
          unlinkOwned(moved ? pathOf(id) : staging)
          if (recorded) db.prepare('DELETE FROM background_media WHERE id = ?').run(id)
        } catch (cleanupError) {
          if (recorded) db.prepare('UPDATE background_media SET cleanup_requested = 1 WHERE id = ?').run(id)
          app.log.warn({ err: cleanupError }, 'Partial background cleanup failed')
        }
        throw error
      } finally {
        body.unpipe(limit)
        body.off('error', forwardError)
        if (!body.destroyed) body.resume()
      }
    })
  })

  app.get<{ Params: { id: string } }>(`${BASE}/:id/metadata`, async (request) => ok(request, metadata(find(request.params.id))))
  app.get<{ Params: { id: string } }>(`${BASE}/:id`, async (request, reply) => {
    const row = find(request.params.id)
    const info = statSync(pathOf(row.id), { throwIfNoEntry: false })
    if (!info?.isFile() || info.size !== row.size) throw new ApiError('NOT_FOUND', 'Background video file unavailable')
    reply.type(row.mime).header('accept-ranges', 'bytes').header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff')
    const range = parseRange(request.headers.range, row.size)
    if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${row.size}`).send()
    if (range === null) return reply.header('content-length', row.size).send(createReadStream(pathOf(row.id)))
    return reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${row.size}`).header('content-length', range.end - range.start + 1).send(createReadStream(pathOf(row.id), range))
  })
  app.delete<{ Params: { id: string } }>(`${BASE}/:id`, async (request) => {
    const row = find(request.params.id)
    if (referenced(row.id) || leased(row.id)) throw new ApiError('CONFLICT', 'Background video is still in use')
    db.prepare('UPDATE background_media SET cleanup_requested = 1 WHERE id = ?').run(row.id)
    remove(row)
    return ok(request, null)
  })
  app.post<{ Body: { leaseId?: unknown; videoIds?: unknown } }>(`${BASE}/leases`, async (request) => {
    const { leaseId, videoIds } = request.body ?? {}
    if (!isUuid(leaseId) || !Array.isArray(videoIds) || videoIds.length > 10000 || !videoIds.every(isUuid)) throw new ApiError('VALIDATION_ERROR', 'Invalid background media lease')
    const owner = db.prepare('SELECT session_hash FROM background_media_leases WHERE lease_id = ? LIMIT 1').get(leaseId) as { session_hash: string } | undefined
    if (owner && owner.session_hash !== request.sessionHash) throw new ApiError('FORBIDDEN', 'Lease belongs to another session')
    // Validate every replacement before touching the existing lease or running GC.
    for (const id of videoIds) {
      try { const row = find(id); if (!statSync(pathOf(row.id), { throwIfNoEntry: false })?.isFile()) throw new Error('missing') }
      catch { throw new ApiError('VALIDATION_ERROR', 'Background video unavailable for lease') }
    }
    const old = db.prepare('SELECT video_id FROM background_media_leases WHERE lease_id = ?').all(leaseId) as { video_id: string }[]
    db.prepare('DELETE FROM background_media_leases WHERE lease_id = ?').run(leaseId)
    const insert = db.prepare('INSERT INTO background_media_leases (lease_id, session_hash, video_id, expires_at) VALUES (?, ?, ?, ?)')
    for (const id of new Set(videoIds)) insert.run(leaseId, request.sessionHash, id, now().getTime() + DAY)
    for (const { video_id } of old) if (!videoIds.includes(video_id)) db.prepare('UPDATE background_media SET cleanup_requested = 1 WHERE id = ?').run(video_id)
    cleanup()
    return ok(request, null)
  })
  app.delete<{ Params: { leaseId: string } }>(`${BASE}/leases/:leaseId`, async (request) => {
    if (!isUuid(request.params.leaseId)) throw new ApiError('VALIDATION_ERROR', 'Invalid lease ID')
    const rows = db.prepare('SELECT video_id FROM background_media_leases WHERE lease_id = ? AND session_hash = ?').all(request.params.leaseId, request.sessionHash) as { video_id: string }[]
    db.prepare('DELETE FROM background_media_leases WHERE lease_id = ? AND session_hash = ?').run(request.params.leaseId, request.sessionHash)
    for (const { video_id } of rows) db.prepare('UPDATE background_media SET cleanup_requested = 1 WHERE id = ?').run(video_id)
    cleanup()
    return ok(request, null)
  })
  return {
    validate(screens) {
      for (const screen of screens) if (screen.background) {
        let row: MediaRow
        try { row = find(screen.background.mediaId) } catch { throw new ApiError('VALIDATION_ERROR', 'Background video is not imported') }
        if ((row.mime.startsWith('image/') ? 'image' : 'video') !== screen.background.kind) throw new ApiError('VALIDATION_ERROR', 'Background media kind does not match its MIME')
        const info = statSync(pathOf(row.id), { throwIfNoEntry: false })
        if (!info?.isFile() || info.size !== row.size) throw new ApiError('VALIDATION_ERROR', 'Background video is incomplete')
      }
    },
    commit(screens) {
      for (const screen of screens) if (screen.background) db.prepare('UPDATE background_media SET committed = 1 WHERE id = ?').run(screen.background.mediaId)
    },
    cleanup,
  }
}
