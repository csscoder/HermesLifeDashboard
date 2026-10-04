<script setup lang="ts">
import { computed } from 'vue'
import type { WidgetSource } from './board-document'
import type { Size } from './grid'
import { builtinWidgetRenderers } from './registry'
import WidgetFrame from './WidgetFrame.vue'

const props = defineProps<{ source: WidgetSource; size: Size }>()

const renderer = computed(() => builtinWidgetRenderers.get(props.source.type))
</script>

<template>
  <WidgetFrame>
    <component :is="renderer" v-if="renderer" :size="size" />
    <div v-else class="widget-host__unknown">Неизвестный виджет</div>
  </WidgetFrame>
</template>

<style scoped>
.widget-host__unknown {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 0.875rem;
  opacity: 0.7;
  text-align: center;
}
</style>
