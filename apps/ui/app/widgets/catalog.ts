import type { Size, SizeLimits } from '@lifedashboard/contracts/grid'

export interface WidgetSizing extends SizeLimits {
  default: Size
}

// Describes a widget type without its Vue renderer; moves to packages/contracts once the API needs it.
export interface WidgetManifest {
  type: string
  title: string
  sizing: WidgetSizing
}

export const placeholderManifest: WidgetManifest = {
  type: 'placeholder',
  title: 'Заглушка',
  sizing: { default: { w: 4, h: 4 }, min: { w: 1, h: 1 }, max: { w: 12, h: 8 } },
}

export const builtinWidgetCatalog: readonly WidgetManifest[] = [placeholderManifest]

export function findManifest(type: string): WidgetManifest | undefined {
  return builtinWidgetCatalog.find((manifest) => manifest.type === type)
}
