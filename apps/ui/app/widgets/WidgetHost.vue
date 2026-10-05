<script setup lang="ts">
import { computed } from 'vue'
import type { WidgetSource } from '@lifedashboard/contracts/board'
import type { Size } from '@lifedashboard/contracts/grid'
import { builtinWidgetRenderers } from './registry'
import WidgetFrame from './WidgetFrame.vue'

const props = defineProps<{ source: WidgetSource; size: Size; themeId: string }>()

const renderer = computed(() => builtinWidgetRenderers.get(props.source.type))
</script>

<template>
  <WidgetFrame :theme-id="themeId">
    <component :is="renderer" v-if="renderer" :size="size" />
    <div v-else class="grid place-items-center h-full text-center text-sm text-muted">Неизвестный виджет</div>
  </WidgetFrame>
</template>
