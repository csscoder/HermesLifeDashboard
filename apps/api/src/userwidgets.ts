import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

// Spec «Data»: installed versions live on disk; SQLite keeps metadata only.
export const STAGING = '.staging'
export const ORPHANED = '.orphaned'

export function userwidgetsDir(dataDir: string): string {
  return join(dataDir, 'userwidgets')
}

export function versionDir(root: string, id: string, version: string): string {
  return join(root, id, version)
}

export function stagingDir(root: string, uploadId: string): string {
  return join(root, STAGING, uploadId)
}

/** Regular files under `dir` as sorted '/'-separated relative paths. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/** Spec «Version hash»: sha256 over `<path>\0<sha256 of the file>\n`, sorted by path. */
export async function versionHash(dir: string): Promise<string> {
  const outer = createHash('sha256')
  for (const path of listFiles(dir)) {
    const inner = createHash('sha256')
    for await (const chunk of createReadStream(join(dir, path))) inner.update(chunk as Buffer)
    outer.update(`${path}\0${inner.digest('hex')}\n`)
  }
  return outer.digest('hex')
}

/** A version folder without a database row is moved aside, never deleted: it may hold the only sources. */
export function moveToOrphaned(root: string, id: string, version: string, now: Date): string {
  const target = join(root, ORPHANED, `${id}-${version}-${now.getTime()}`)
  mkdirSync(join(root, ORPHANED), { recursive: true })
  renameSync(versionDir(root, id, version), target)
  return target
}

/** Startup: uploads that were never installed go; version folders without a row move to `.orphaned/`. */
export function cleanUserwidgets(root: string, installed: ReadonlySet<string>, now: Date): void {
  rmSync(join(root, STAGING), { recursive: true, force: true })
  if (!existsSync(root)) return
  for (const pkg of readdirSync(root, { withFileTypes: true })) {
    if (!pkg.isDirectory() || pkg.name.startsWith('.')) continue
    for (const version of readdirSync(join(root, pkg.name), { withFileTypes: true })) {
      if (version.isDirectory() && !installed.has(`${pkg.name}/${version.name}`)) moveToOrphaned(root, pkg.name, version.name, now)
    }
    if (readdirSync(join(root, pkg.name)).length === 0) rmSync(join(root, pkg.name), { recursive: true })
  }
}

/** A v1 package as a v2 version folder. `wx`: an existing file is an error, never overwritten. */
export function writeV1Version(dir: string, manifest: object, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, { flag: 'wx' })
  writeFileSync(join(dir, 'widget.json'), `${JSON.stringify({ format: 2, ...manifest }, null, 2)}\n`, { flag: 'wx' })
}

/** The absolute path of `path` when it stays inside `dir`, otherwise null. */
export function resolveInside(dir: string, path: string): string | null {
  const full = resolve(dir, path)
  return full.startsWith(`${resolve(dir)}${sep}`) ? full : null
}
