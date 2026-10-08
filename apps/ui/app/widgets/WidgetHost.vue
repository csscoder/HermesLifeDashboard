<script setup lang="ts">
import { computed, onUnmounted, useTemplateRef } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import type { Size } from '@lifedashboard/contracts/grid'
import { provideInProcessWidget } from '@lifedashboard/widget-sdk'
import { api } from '../api'
import { showToast } from '../toasts'
import { createGatewayClient } from './broker'
import { describeSource } from './catalog'
import { useWidgetContext } from './context'
import { builtinWidgetRenderers } from './registry'
import SandboxWidget from './SandboxWidget.vue'
import WidgetFrame from './WidgetFrame.vue'

// Without a widgetId (the build draft) the host shows a static title card: no session, no sandbox.
// The runtime starts once the board save gave the widget an id.
const props = defineProps<{
  source: WidgetSource
  size: Size
  themeId: string
  widgetId?: string
  config?: Record<string, unknown>
}>()

const frame = useTemplateRef<{ $el: Element }>('frameBox')
const info = computed(() => describeSource(props.source))
const title = computed(() => info.value?.title ?? 'Неизвестный виджет')
const renderer = computed(() => (props.source.kind === 'builtin' ? builtinWidgetRenderers.get(props.source.type) : undefined))
const context = useWidgetContext({
  size: () => props.size,
  themeId: () => props.themeId,
  config: () => props.config ?? {},
  frame: () => frame.value?.$el ?? null,
})

// A placed built-in widget runs in-process behind the same broker client as a sandboxed one;
// its widget session is created on the first gateway call.
if (props.widgetId && props.source.kind === 'builtin') {
  const client = createGatewayClient({
    api,
    widgetId: props.widgetId,
    onNotify: (message) => showToast({ source: title.value, ...message }),
    // ponytail: no error state for built-ins; the rejected call reaches the widget. Add one with the first built-in that uses the gateway.
    onSessionLost: () => {},
  })
  provideInProcessWidget({ call: client.call, context })
  onUnmounted(() => void client.close())
}
</script>

<template>
  <WidgetFrame ref="frameBox" :theme-id="themeId">
    <div v-if="!widgetId" class="grid place-items-center h-full text-center text-base font-strong text-secondary">{{ title }}</div>
    <component :is="renderer" v-else-if="renderer" />
    <SandboxWidget v-else-if="info?.hash" :widget-id="widgetId" :hash="info.hash" :title="title" :context="context" />
    <div v-else class="grid place-items-center h-full text-center text-sm text-muted">Неизвестный виджет</div>
  </WidgetFrame>
</template>
