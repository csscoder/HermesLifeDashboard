import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { confirmablePermissions } from '@lifedashboard/contracts/widget-gateway'
import {
  compareVersions,
  type Grant,
  type InstalledPackage,
  type WidgetPackageManifest,
  type WidgetPermission,
} from '@lifedashboard/contracts/widget-package'
import { ApiError, ok } from './errors.ts'
import { cleanUserwidgets, userwidgetsDir, versionDir } from './userwidgets.ts'

export interface WidgetPackagesDeps {
  db: DatabaseSync
  now: () => Date
  dataDir: string
}

/** `"<id>/<version>"` of every installed version. */
export function installedVersions(db: DatabaseSync): Set<string> {
  const rows = db.prepare('SELECT package_id, version FROM widget_package_versions').all() as unknown as { package_id: string; version: string }[]
  return new Set(rows.map((row) => `${row.package_id}/${row.version}`))
}

// Spec «API»: packages arrive as files from other people; every body is validated again here.
export function registerWidgetPackages(app: FastifyInstance, { db, now, dataDir }: WidgetPackagesDeps): void {
  const root = userwidgetsDir(dataDir)
  // Spec «Startup cleanup»: runs once per process, after migrations.
  cleanUserwidgets(root, installedVersions(db), now())

  app.get('/api/v1/widget-packages', async (request) => ok(request, listPackages(db, root)))

  app.delete<{ Params: { id: string } }>('/api/v1/widget-packages/:id', async (request) => {
    deletePackage(db, root, request.params.id)
    return ok(request, null)
  })

  app.put<{ Params: { id: string; permission: string }; Body: { mode?: unknown } | undefined }>(
    '/api/v1/widget-packages/:id/grants/:permission',
    async (request) => ok(request, setGrantMode(db, request.params.id, request.params.permission, request.body?.mode)),
  )
}

export function grantsOf(db: DatabaseSync, packageId: string): Grant[] {
  return db.prepare('SELECT permission, mode FROM widget_grants WHERE package_id = ? ORDER BY permission').all(packageId) as unknown as Grant[]
}

export function newPermissionsOf(db: DatabaseSync, manifest: WidgetPackageManifest): WidgetPermission[] {
  const granted = new Set(grantsOf(db, manifest.id).map((grant) => grant.permission))
  return manifest.permissions.filter((permission) => !granted.has(permission))
}

/** Package, version and grants rows; the caller holds the transaction. */
export function insertVersion(db: DatabaseSync, manifest: WidgetPackageManifest, hash: string, at: string): void {
  db.prepare(
    'INSERT INTO widget_packages (id, title, author, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, author = excluded.author',
  ).run(manifest.id, manifest.title, manifest.author, at)
  db.prepare('INSERT INTO widget_package_versions (package_id, version, hash, manifest, installed_at) VALUES (?, ?, ?, ?, ?)').run(
    manifest.id, manifest.version, hash, JSON.stringify(manifest), at,
  )
  // A new confirmable grant asks; OR IGNORE keeps the mode of a grant the package already holds.
  const confirmable = new Set<WidgetPermission>(confirmablePermissions())
  const grant = db.prepare('INSERT OR IGNORE INTO widget_grants (package_id, permission, granted_at, mode) VALUES (?, ?, ?, ?)')
  for (const permission of manifest.permissions) grant.run(manifest.id, permission, at, confirmable.has(permission) ? 'ask' : 'allow')
}

function listPackages(db: DatabaseSync, root: string): InstalledPackage[] {
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
      .map((row) => {
        const dir = versionDir(root, row.package_id, row.version)
        const optional = (name: string) => (existsSync(join(dir, name)) ? join(dir, name) : null)
        return { version: row.version, hash: row.hash, manifest: JSON.parse(row.manifest) as WidgetPackageManifest, paths: { source: optional('source'), assets: optional('assets') } }
      })
      .sort((a, b) => compareVersions(b.version, a.version)),
    grants: grantsOf(db, pkg.id),
  }))
}

function deletePackage(db: DatabaseSync, root: string, id: string): void {
  if (!db.prepare('SELECT 1 FROM widget_packages WHERE id = ?').get(id)) throw new ApiError('NOT_FOUND', 'Widget package not found')
  if (db.prepare("SELECT 1 FROM widgets WHERE source_kind = 'package' AND source_type = ? LIMIT 1").get(id)) {
    throw new ApiError('PACKAGE_IN_USE', 'Widgets of this package are placed on a board')
  }
  // Versions and grants go with it (ON DELETE CASCADE).
  db.prepare('DELETE FROM widget_packages WHERE id = ?').run(id)
  rmSync(join(root, id), { recursive: true, force: true })
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
