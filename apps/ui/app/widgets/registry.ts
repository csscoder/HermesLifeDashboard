import { defineAsyncComponent, type Component } from 'vue'

// Explicit list: only renderers registered here are executable widget UI.
// A Map (not an object) so types like "toString" never resolve to prototype members.
export const builtinWidgetRenderers: ReadonlyMap<string, Component> = new Map<string, Component>([
  ['placeholder', defineAsyncComponent(() => import('./builtin/PlaceholderWidget.vue'))],
])
