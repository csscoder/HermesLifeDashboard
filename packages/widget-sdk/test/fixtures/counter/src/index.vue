<script setup lang="ts">
import { ref } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const count = ref(0)
</script>

<template>
  <button type="button" class="counter" @click="count++">{{ count }} · {{ widget.context.sizeClass }}</button>
</template>

<style scoped>
.counter {
  color: var(--ld-text-primary);
}
</style>
