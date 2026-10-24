import { sizeClass, type WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { normalizeConfig, type SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import type { ConfirmMode } from './gateway.ts'
import type { DevTheme } from './themes.ts'

export interface ShellState {
  w: number
  h: number
  theme: string
  frame: 'framed' | 'frameless'
  confirm: ConfirmMode
}

export function parseShellState(search: string, manifest: WidgetPackageManifest, themeIds: readonly string[]): ShellState {
  const params = new URLSearchParams(search)
  const dimension = (key: 'w' | 'h') => {
    const raw = params.get(key)
    const value = raw?.trim() ? Number(raw) : NaN
    return Number.isInteger(value)
      ? Math.max(manifest.sizing.min[key], Math.min(manifest.sizing.max[key], value))
      : manifest.sizing.default[key]
  }
  const theme = params.get('theme')
  const frameParam = params.get('frame')
  return {
    w: dimension('w'), h: dimension('h'),
    theme: theme !== null && themeIds.includes(theme) ? theme : themeIds[0] ?? '',
    frame: frameParam === 'framed' || frameParam === 'frameless' ? frameParam : manifest.frame ?? 'framed',
    confirm: params.get('confirm') === 'decline' ? 'decline' : 'allow',
  }
}

export function serializeShellState(state: ShellState): string {
  return `?${new URLSearchParams({ w: String(state.w), h: String(state.h), theme: state.theme, frame: state.frame, confirm: state.confirm })}`
}

export function describeShell(state: ShellState): string {
  return `w=${state.w} h=${state.h} theme=${state.theme} frame=${state.frame}`
}

export function frameSizePx(state: ShellState, cellPx: number, gapPx: number): { width: number; height: number } {
  return { width: state.w * cellPx + (state.w - 1) * gapPx, height: state.h * cellPx + (state.h - 1) * gapPx }
}

export function shellContext(
  state: ShellState,
  theme: DevTheme,
  settings: SettingsSchema | undefined,
  rawConfig: Record<string, unknown>,
  secretsSet: ReadonlySet<string>,
  env: { locale: string; rootFontSize: number },
): WidgetContext {
  const size = { w: state.w, h: state.h }
  return {
    size, sizeClass: sizeClass(size), frame: state.frame,
    theme: { id: theme.id, scheme: theme.mode, tokens: theme.tokens },
    config: normalizeConfig(settings, rawConfig, secretsSet),
    locale: env.locale, rootFontSize: env.rootFontSize, visible: true,
  }
}

export function createFrameSession(open: () => { close(): void }): { hello(): void; dispose(): void } {
  let current: { close(): void } | undefined
  const dispose = () => {
    current?.close()
    current = undefined
  }
  return {
    hello() {
      dispose()
      current = open()
    },
    dispose,
  }
}

export function secretsChanged(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = Object.keys(a)
  return keys.length !== Object.keys(b).length || keys.some((key) => !Object.hasOwn(b, key) || a[key] !== b[key])
}

/** CSS class suffix of a theme id; the same rule as themeClass in apps/ui/app/theme/resolve.ts (parity-tested). */
export function themeClass(id: string): string {
  if (id.startsWith('builtin:')) return id.slice('builtin:'.length)
  if (id.startsWith('user:')) return `u-${id.slice('user:'.length)}`
  throw new Error(`Unknown theme id format: ${id}`)
}

export const LOG_ENTRY_LIMIT = 200
export const LOG_MESSAGE_LIMIT = 500

/** The shell's on-screen log: newest LOG_ENTRY_LIMIT entries, each message cut to LOG_MESSAGE_LIMIT characters. The dev log file keeps the full text. */
export function appendLogEntry<T extends { message: string }>(entries: readonly T[], entry: T): T[] {
  const message = entry.message.length > LOG_MESSAGE_LIMIT ? `${entry.message.slice(0, LOG_MESSAGE_LIMIT - 1)}…` : entry.message
  return [...entries, { ...entry, message }].slice(-LOG_ENTRY_LIMIT)
}

export const DEV_MODAL_DRAIN_MS = 5000
