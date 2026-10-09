import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { confirmablePermissions } from '@lifedashboard/contracts/widget-gateway'
import {
  canonicalJson,
  compareVersions,
  PACKAGE_LIMITS,
  parseWidgetPackage,
  type Grant,
  type InstalledPackage,
  type PackageInspection,
  type WidgetPackage,
  type WidgetPackageManifest,
  type WidgetPermission,
} from '@lifedashboard/contracts/widget-package'
import { ApiError, ok } from './errors.ts'

const PACKAGE_BODY = { bodyLimit: PACKAGE_LIMITS.maxBytes }

interface ParsedPackage {
  pkg: WidgetPackage
  hash: string
}

export interface WidgetPackagesDeps {
  db: DatabaseSync
  now: () => Date
}

// Spec «API»: packages arrive as files from other people; every body is validated again here.
export function registerWidgetPackages(app: FastifyInstance, { db, now }: WidgetPackagesDeps): void {
  app.post('/api/v1/widget-packages/inspect', PACKAGE_BODY, async (request) => ok(request, inspect(db, parse(request.body))))

  app.post('/api/v1/widget-packages', PACKAGE_BODY, async (request) => ok(request, install(db, parse(request.body), now())))

  app.get('/api/v1/widget-packages', async (request) => ok(request, listPackages(db)))

  app.delete<{ Params: { id: string } }>('/api/v1/widget-packages/:id', async (request) => {
    deletePackage(db, request.params.id)
    return ok(request, null)
  })

  app.put<{ Params: { id: string; permission: string }; Body: { mode?: unknown } | undefined }>(
    '/api/v1/widget-packages/:id/grants/:permission',
    async (request) => ok(request, setGrantMode(db, request.params.id, request.params.permission, request.body?.mode)),
  )
}

export function packageHash(pkg: WidgetPackage): string {
  return createHash('sha256').update(canonicalJson({ manifest: pkg.manifest, files: pkg.files })).digest('hex')
}

export function grantsOf(db: DatabaseSync, packageId: string): Grant[] {
  return db.prepare('SELECT permission, mode FROM widget_grants WHERE package_id = ? ORDER BY permission').all(packageId) as unknown as Grant[]
}

function parse(body: unknown): ParsedPackage {
  const result = parseWidgetPackage(body)
  if (!result.ok) throw new ApiError('VALIDATION_ERROR', result.error)
  return { pkg: result.value, hash: packageHash(result.value) }
}

function inspect(db: DatabaseSync, { pkg, hash }: ParsedPackage): PackageInspection {
  const { manifest } = pkg
  const stored = db.prepare('SELECT hash FROM widget_package_versions WHERE package_id = ? AND version = ?').get(manifest.id, manifest.version) as
    | { hash: string }
    | undefined
  // A version is immutable: the same version with other content is never installed.
  if (stored && stored.hash !== hash) {
    throw new ApiError('CONFLICT', `Version ${manifest.version} of ${manifest.id} is already installed with different content`)
  }
  const granted = new Set(grantsOf(db, manifest.id).map((grant) => grant.permission))
  return {
    manifest,
    hash,
    installed: stored !== undefined,
    newPermissions: manifest.permissions.filter((permission) => !granted.has(permission)),
  }
}

function install(db: DatabaseSync, parsed: ParsedPackage, now: Date): PackageInspection {
  db.exec('BEGIN IMMEDIATE')
  try {
    const inspection = inspect(db, parsed)
    if (!inspection.installed) {
      const { manifest, files } = parsed.pkg
      const at = now.toISOString()
      db.prepare(
        'INSERT INTO widget_packages (id, title, author, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, author = excluded.author',
      ).run(manifest.id, manifest.title, manifest.author, at)
      db.prepare(
        'INSERT INTO widget_package_versions (package_id, version, hash, manifest, files, installed_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(manifest.id, manifest.version, parsed.hash, JSON.stringify(manifest), JSON.stringify(files), at)
      // A new confirmable grant asks; OR IGNORE keeps the mode of a grant the package already holds.
      const confirmable = new Set<WidgetPermission>(confirmablePermissions())
      const grant = db.prepare('INSERT OR IGNORE INTO widget_grants (package_id, permission, granted_at, mode) VALUES (?, ?, ?, ?)')
      for (const permission of manifest.permissions) grant.run(manifest.id, permission, at, confirmable.has(permission) ? 'ask' : 'allow')
    }
    db.exec('COMMIT')
    return { ...inspection, installed: true, newPermissions: [] }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function listPackages(db: DatabaseSync): InstalledPackage[] {
  const packages = db.prepare('SELECT id, title, author FROM widget_packages ORDER BY title, id').all() as unknown as {
    id: string
    title: string
    author: string
  }[]
  const versions = db.prepare('SELECT package_id, version, hash, manifest FROM widget_package_versions').all() as unknown as {
    package_id: string
    version: string
    hash: string
    manifest: string
  }[]
  return packages.map((pkg) => ({
    id: pkg.id,
    title: pkg.title,
    author: pkg.author,
    versions: versions
      .filter((row) => row.package_id === pkg.id)
      .map((row) => ({ version: row.version, hash: row.hash, manifest: JSON.parse(row.manifest) as WidgetPackageManifest }))
      .sort((a, b) => compareVersions(b.version, a.version)),
    grants: grantsOf(db, pkg.id),
  }))
}

function deletePackage(db: DatabaseSync, id: string): void {
  if (!db.prepare('SELECT 1 FROM widget_packages WHERE id = ?').get(id)) throw new ApiError('NOT_FOUND', 'Widget package not found')
  if (db.prepare("SELECT 1 FROM widgets WHERE source_kind = 'package' AND source_type = ? LIMIT 1").get(id)) {
    throw new ApiError('PACKAGE_IN_USE', 'Widgets of this package are placed on a board')
  }
  // Versions and grants go with it (ON DELETE CASCADE).
  db.prepare('DELETE FROM widget_packages WHERE id = ?').run(id)
}

function setGrantMode(db: DatabaseSync, packageId: string, permission: string, mode: unknown): Grant[] {
  if (!grantsOf(db, packageId).some((grant) => grant.permission === permission)) {
    throw new ApiError('NOT_FOUND', 'The package holds no such permission')
  }
  if (!(confirmablePermissions() as string[]).includes(permission)) throw new ApiError('VALIDATION_ERROR', 'This permission has no mode')
  if (mode !== 'allow' && mode !== 'ask') throw new ApiError('VALIDATION_ERROR', 'mode must be allow or ask')
  db.prepare('UPDATE widget_grants SET mode = ? WHERE package_id = ? AND permission = ?').run(mode, packageId, permission)
  return grantsOf(db, packageId)
}
