import { ref } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { BUILTIN_WIDGETS, findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'
import type { WidgetSizing } from '@lifedashboard/contracts/grid'
import { confirmablePermissions } from '@lifedashboard/contracts/widget-gateway'
import {
  parseWidgetFolder,
  type FolderFile,
  type Grant,
  type GrantMode,
  type InstalledPackage,
  type WidgetPermission,
} from '@lifedashboard/contracts/widget-package'
import type { ApiFailure, api } from '../api'

// One trusted list shared with the API; the UI adds only renderers (registry.ts).
export { BUILTIN_WIDGETS, findBuiltinWidget }
export type { BuiltinWidgetManifest } from '@lifedashboard/contracts/builtin-widgets'

export interface SourceInfo {
  title: string
  sizing: WidgetSizing
  // The sandbox document of a package version; null for built-in widgets.
  hash: string | null
}

export interface PickerEntry {
  key: string
  title: string
  source: WidgetSource
}

export interface PickedFile {
  path: string
  file: Blob
}

// `picked` is `files` with the same filtering, for the upload.
export type FolderRead = { ok: true; manifest: unknown; files: FolderFile[]; picked: PickedFile[] } | { ok: false; message: string }

export type UploadOutcome = { ok: true } | { ok: false; path: string; failure: ApiFailure }

/** Installed packages, newest version first in each. Loaded when the app is ready and after install or delete. */
export const installedPackages = ref<InstalledPackage[]>([])

export async function loadPackages(client: Pick<typeof api, 'widgetPackages'>): Promise<boolean> {
  const result = await client.widgetPackages()
  if (result.ok) installedPackages.value = result.data
  return result.ok
}

/** Title, sizing and document of a source; a placed package widget stays on its own version. */
export function describeSource(source: WidgetSource, packages: readonly InstalledPackage[] = installedPackages.value): SourceInfo | null {
  if (source.kind === 'builtin') {
    const manifest = findBuiltinWidget(source.type)
    return manifest ? { title: manifest.title, sizing: manifest.sizing, hash: null } : null
  }
  const version = packages.find((pkg) => pkg.id === source.packageId)?.versions.find((item) => item.version === source.version)
  return version ? { title: version.manifest.title, sizing: version.manifest.sizing, hash: version.hash } : null
}

/** «Добавить виджет»: built-in widgets, then the newest installed version of each package. */
export function pickerEntries(packages: readonly InstalledPackage[] = installedPackages.value): PickerEntry[] {
  const builtins = BUILTIN_WIDGETS.map((manifest): PickerEntry => ({
    key: `builtin:${manifest.type}`,
    title: manifest.title,
    source: { kind: 'builtin', type: manifest.type },
  }))
  const latest = packages.flatMap((pkg): PickerEntry[] => {
    const newest = pkg.versions[0]
    return newest
      ? [{ key: `package:${pkg.id}`, title: newest.manifest.title, source: { kind: 'package', packageId: pkg.id, version: newest.version } }]
      : []
  })
  return [...builtins, ...latest]
}

/** `<input webkitdirectory>`: paths relative to the picked folder. */
export function filesFromInput(files: ArrayLike<File>): PickedFile[] {
  return Array.from(files, (file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), file }))
}

/** A dropped folder (`DataTransferItem.webkitGetAsEntry()`), walked recursively. */
export async function filesFromEntry(entry: FileSystemDirectoryEntry, prefix = ''): Promise<PickedFile[]> {
  const reader = entry.createReader()
  const children: FileSystemEntry[] = []
  // readEntries answers in batches; an empty batch ends the directory.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    children.push(...batch)
  }
  const nested = await Promise.all(
    children.map(async (child): Promise<PickedFile[]> => {
      const path = `${prefix}${child.name}`
      if (child.isDirectory) return filesFromEntry(child as FileSystemDirectoryEntry, `${path}/`)
      const file = await new Promise<File>((resolve, reject) => (child as FileSystemFileEntry).file(resolve, reject))
      return [{ path, file }]
    }),
  )
  return nested.flat()
}

// Written by the file manager into folders the user opened; the API rejects them, so they never leave the browser.
const OS_METADATA = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

/** Reads widget.json and checks the folder with the API's rules before any request. */
export async function readFolder(all: readonly PickedFile[]): Promise<FolderRead> {
  const files = all.filter((item) => !OS_METADATA.has(item.path.split('/').pop()!.toLowerCase()))
  const manifestFile = files.find((item) => item.path === 'widget.json')
  if (!manifestFile) return { ok: false, message: 'В папке нет widget.json' }
  let manifest: unknown
  try {
    manifest = JSON.parse(await manifestFile.file.text())
  } catch {
    return { ok: false, message: 'widget.json не является JSON' }
  }
  const list = files.map((item) => ({ path: item.path, size: item.file.size }))
  const parsed = parseWidgetFolder(manifest, list)
  return parsed.ok ? { ok: true, manifest, files: list, picked: files } : { ok: false, message: `Папка отклонена: ${parsed.error}` }
}

/** Sends files three at a time; stops at the first failure and names its file. */
export async function uploadFiles(
  client: Pick<typeof api, 'uploadFile'>,
  uploadId: string,
  files: readonly PickedFile[],
  signal: AbortSignal,
  onSent: (file: PickedFile) => void,
): Promise<UploadOutcome> {
  let next = 0
  let failed: UploadOutcome | null = null
  async function worker(): Promise<void> {
    while (failed === null && next < files.length) {
      const item = files[next++]!
      const result = await client.uploadFile(uploadId, item.path, item.file, signal)
      if (!result.ok) {
        const { ok: _ok, ...failure } = result
        failed ??= { ok: false, path: item.path, failure }
        return
      }
      onSent(item)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return failed ?? { ok: true }
}

/** An ended session (API restart, expiry) cannot continue: start over. Any other failure keeps the session for a retry. */
export function describeUploadFailure(outcome: Extract<UploadOutcome, { ok: false }>): { restart: boolean; message: string } {
  const { failure, path } = outcome
  return failure.kind === 'invalid' && failure.code === 'NOT_FOUND'
    ? { restart: true, message: `Загрузка прервана на ${path}, начните заново` }
    : { restart: false, message: `Не удалось загрузить ${path}` }
}

/** The install call failed: an ended session needs a fresh start; null leaves the text to the caller. */
export function describeInstallFailure(failure: ApiFailure): string | null {
  return failure.kind === 'invalid' && failure.code === 'NOT_FOUND' ? 'Загрузка прервана, начните заново' : null
}

export function formatBytes(bytes: number): string {
  return bytes < 1_048_576 ? `${Math.ceil(bytes / 1024)} КБ` : `${(bytes / 1_048_576).toFixed(1)} МБ`
}

export type GrantModes = Partial<Record<WidgetPermission, GrantMode>>

/** Permissions that offer «Спрашивать каждый раз / Разрешить». */
export const CONFIRMABLE_PERMISSIONS: ReadonlySet<WidgetPermission> = new Set(confirmablePermissions())

/** Install screen: a new confirmable permission starts as «Спрашивать»; others offer no mode. */
export function initialModes(newPermissions: readonly WidgetPermission[]): GrantModes {
  return Object.fromEntries(newPermissions.filter((permission) => CONFIRMABLE_PERMISSIONS.has(permission)).map((permission) => [permission, 'ask']))
}

/** After an install: new confirmable permissions the user switched to «Разрешить». Held grants are never touched. */
export function relaxedPermissions(newPermissions: readonly WidgetPermission[], modes: GrantModes): WidgetPermission[] {
  return newPermissions.filter((permission) => CONFIRMABLE_PERMISSIONS.has(permission) && modes[permission] === 'allow')
}

/** The saved mode of a confirmable grant the package holds; null for other permissions. */
export function savedMode(grants: readonly Grant[], permission: WidgetPermission): GrantMode | null {
  if (!CONFIRMABLE_PERMISSIONS.has(permission)) return null
  return grants.find((grant) => grant.permission === permission)?.mode ?? null
}
