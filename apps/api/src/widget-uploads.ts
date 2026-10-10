import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import {
  canonicalJson,
  parseWidgetFolder,
  parseWidgetManifest,
  type FolderSizes,
  type PackageInspection,
  type UploadCreated,
  type WidgetPackageManifest,
} from '@lifedashboard/contracts/widget-package'
import { ApiError, ok } from './errors.ts'
import { moveToOrphaned, stagingDir, userwidgetsDir, versionDir, versionHash } from './userwidgets.ts'
import { insertVersion, newPermissionsOf } from './widget-packages.ts'

const MAX_UPLOADS = 3
const UPLOAD_IDLE_MS = 30 * 60_000

interface UploadSession {
  id: string
  manifest: WidgetPackageManifest
  files: Map<string, number>
  sizes: FolderSizes
  dir: string
  lastUsedAt: number
  busy: boolean
  // PUTs currently writing a file.
  writes: number
}

export interface WidgetUploadsDeps {
  db: DatabaseSync
  now: () => Date
  dataDir: string
}

// Spec 2026-10-10 «Upload sessions»: create with the file list, one streamed PUT per file, install.
export function registerWidgetUploads(app: FastifyInstance, { db, now, dataDir }: WidgetUploadsDeps): void {
  const root = userwidgetsDir(dataDir)
  // ponytail: in memory like widget sessions; a restart drops them and startup cleanup removes the folders.
  const sessions = new Map<string, UploadSession>()

  function end(session: UploadSession): void {
    sessions.delete(session.id)
    rmSync(session.dir, { recursive: true, force: true })
  }

  function sweep(t: number): void {
    for (const session of [...sessions.values()]) if (t - session.lastUsedAt > UPLOAD_IDLE_MS && !session.busy && session.writes === 0) end(session)
  }

  function find(id: string): UploadSession {
    const t = now().getTime()
    sweep(t)
    const session = sessions.get(id)
    if (!session) throw new ApiError('NOT_FOUND', 'Upload not found or expired')
    if (session.busy) throw new ApiError('CONFLICT', 'The upload is being installed')
    session.lastUsedAt = t
    return session
  }

  app.post<{ Body: { manifest?: unknown; files?: unknown } | undefined }>('/api/v1/widget-uploads', async (request) => {
    const parsed = parseWidgetFolder(request.body?.manifest, request.body?.files)
    if (!parsed.ok) throw new ApiError('VALIDATION_ERROR', parsed.error)
    const t = now().getTime()
    sweep(t)
    const oldest = [...sessions.values()].filter((item) => !item.busy && item.writes === 0).sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    while (sessions.size >= MAX_UPLOADS && oldest.length > 0) end(oldest.shift()!)
    const id = randomBytes(16).toString('hex')
    const session: UploadSession = {
      id,
      manifest: parsed.value.manifest,
      files: new Map(parsed.value.files.map((file) => [file.path, file.size])),
      sizes: parsed.value.sizes,
      dir: stagingDir(root, id),
      lastUsedAt: t,
      busy: false,
      writes: 0,
    }
    mkdirSync(session.dir, { recursive: true })
    sessions.set(id, session)
    const { id: packageId, version } = session.manifest
    const installed = db.prepare('SELECT 1 FROM widget_package_versions WHERE package_id = ? AND version = ?').get(packageId, version) !== undefined
    const result: UploadCreated = {
      uploadId: id,
      inspection: { manifest: session.manifest, hash: null, installed, newPermissions: newPermissionsOf(db, session.manifest), sizes: session.sizes },
    }
    return ok(request, result)
  })

  app.register(async (scope) => {
    // The raw body stream; Fastify applies no body limit to it, the route enforces the declared size.
    scope.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload))

    scope.put<{ Params: { id: string; '*': string } }>('/api/v1/widget-uploads/:id/files/*', async (request) => {
      const session = find(request.params.id)
      // While a write is in flight the session is not installed, evicted, expired or deleted.
      session.writes += 1
      try {
        const path = request.params['*']
        const size = session.files.get(path)
        if (size === undefined) throw new ApiError('VALIDATION_ERROR', `"${path}" is not in the declared file list`)
        const target = join(session.dir, path)
        mkdirSync(dirname(target), { recursive: true })
        let received = 0
        // Past the declared size the chunks are dropped, not errored: destroying the request would leave the reply unsent.
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            received += chunk.length
            done(null, received > size ? null : chunk)
          },
        })
        // An empty body may arrive without a parsed stream.
        const body = (request.body as Readable | undefined) ?? Readable.from([])
        try {
          await pipeline(body, limit, createWriteStream(target))
        } catch (error) {
          rmSync(target, { force: true })
          throw error
        }
        if (received !== size) {
          rmSync(target, { force: true })
          throw new ApiError('VALIDATION_ERROR', received > size ? `"${path}" is larger than declared (${size} bytes)` : `"${path}" has ${received} bytes, ${size} declared`)
        }
        session.lastUsedAt = now().getTime()
        return ok(request, null)
      } finally {
        session.writes -= 1
      }
    })
  })

  app.post<{ Params: { id: string } }>('/api/v1/widget-uploads/:id/install', async (request) => {
    const session = find(request.params.id)
    if (session.writes > 0) throw new ApiError('CONFLICT', 'A file is still being uploaded')
    session.busy = true
    try {
      for (const [path, size] of session.files) {
        const info = statSync(join(session.dir, path), { throwIfNoEntry: false })
        if (info?.size !== size) throw new ApiError('VALIDATION_ERROR', `"${path}" is missing or has another size`)
      }
      let onDisk: unknown
      try {
        onDisk = JSON.parse(readFileSync(join(session.dir, 'widget.json'), 'utf8'))
      } catch {
        throw new ApiError('VALIDATION_ERROR', 'widget.json is not valid JSON')
      }
      const parsed = parseWidgetManifest(onDisk)
      if (!parsed.ok || canonicalJson(parsed.value) !== canonicalJson(session.manifest)) {
        throw new ApiError('VALIDATION_ERROR', 'widget.json differs from the declared manifest')
      }
      const hash = await versionHash(session.dir)
      return ok(request, commit(session, hash))
    } finally {
      end(session)
    }
  })

  // Spec «Install» steps 4–7: synchronous, so no other request's write falls inside the transaction.
  function commit(session: UploadSession, hash: string): PackageInspection {
    const { id, version } = session.manifest
    db.exec('BEGIN IMMEDIATE')
    let moved = false
    const target = versionDir(root, id, version)
    try {
      const stored = db.prepare('SELECT hash FROM widget_package_versions WHERE package_id = ? AND version = ?').get(id, version) as
        | { hash: string }
        | undefined
      if (stored && stored.hash !== hash) throw new ApiError('CONFLICT', `Version ${version} of ${id} is already installed with different content`)
      if (!stored) {
        if (existsSync(target)) moveToOrphaned(root, id, version, now())
        mkdirSync(join(root, id), { recursive: true })
        renameSync(session.dir, target)
        moved = true
        insertVersion(db, session.manifest, hash, now().toISOString())
      }
      db.exec('COMMIT')
      return { manifest: session.manifest, hash, installed: true, newPermissions: [], sizes: session.sizes }
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      if (moved) renameSync(target, session.dir)
      throw error
    }
  }

  app.delete<{ Params: { id: string } }>('/api/v1/widget-uploads/:id', async (request) => {
    const session = sessions.get(request.params.id)
    if (session && !session.busy && session.writes === 0) end(session)
    return ok(request, null)
  })
}
