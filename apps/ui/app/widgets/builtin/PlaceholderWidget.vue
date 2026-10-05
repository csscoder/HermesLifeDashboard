<script setup lang="ts">
import type { Size } from '@lifedashboard/contracts/grid'

defineProps<{ size: Size }>()
</script>

<template>
  <div class="grid place-items-center h-full text-2xl font-strong text-secondary">{{ size.w }}×{{ size.h }}</div>
</template>
