<script setup lang="ts">
import { useWidget } from '@lifedashboard/widget-sdk'

const widget = useWidget()
</script>

<template>
  <div class="widget">Размер виджета: {{ widget.context.sizeClass }}</div>
</template>

<style scoped>
.widget {
  color: var(--ld-text-primary);
  background: var(--ld-surface-1);
  font-family: var(--ld-font-ui);
}
</style>
