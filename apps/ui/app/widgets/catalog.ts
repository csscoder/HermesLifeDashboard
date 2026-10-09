import { ref } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import { BUILTIN_WIDGETS, findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'
import type { WidgetSizing } from '@lifedashboard/contracts/grid'
import { confirmablePermissions } from '@lifedashboard/contracts/widget-gateway'
import { PACKAGE_LIMITS, type Grant, type GrantMode, type InstalledPackage, type WidgetPermission } from '@lifedashboard/contracts/widget-package'
import type { api } from '../api'

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

export type PackageFile = { ok: true; body: unknown } | { ok: false; message: string }

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

/** Reads a chosen package file; a file that is too large or not JSON never reaches the API. */
export async function readPackageFile(file: Blob): Promise<PackageFile> {
  if (file.size > PACKAGE_LIMITS.maxBytes) return { ok: false, message: 'Файл больше 1 МБ' }
  try {
    return { ok: true, body: JSON.parse(await file.text()) as unknown }
  } catch {
    return { ok: false, message: 'Это не пакет виджета' }
  }
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
