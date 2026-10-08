import { findBuiltinWidget } from '@lifedashboard/contracts/builtin-widgets'

// One trusted list shared with the API; the UI adds only renderers (registry.ts).
export { BUILTIN_WIDGETS, findBuiltinWidget, type BuiltinWidgetManifest } from '@lifedashboard/contracts/builtin-widgets'

export const placeholderManifest = findBuiltinWidget('placeholder')!
