import type { WidgetSizing } from './grid.ts'
import type { WidgetPermission } from './widget-package.ts'

/** A widget compiled into the app build. The API reads its grants here; there is no install screen. */
export interface BuiltinWidgetManifest {
  type: string
  title: string
  sizing: WidgetSizing
  permissions: readonly WidgetPermission[]
}

export const BUILTIN_WIDGETS: readonly BuiltinWidgetManifest[] = [
  {
    type: 'placeholder',
    title: 'Заглушка',
    sizing: { default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 12, h: 8 } },
    permissions: [],
  },
]

// A Map (not an object) so types like "toString" never resolve to prototype members.
const byType = new Map(BUILTIN_WIDGETS.map((manifest) => [manifest.type, manifest]))

export function findBuiltinWidget(type: string): BuiltinWidgetManifest | undefined {
  return byType.get(type)
}
