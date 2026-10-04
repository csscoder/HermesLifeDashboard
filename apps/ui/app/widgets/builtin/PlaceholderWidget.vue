<script setup lang="ts">
import type { Size } from '../grid'

defineProps<{ size: Size }>()
</script>

<template>
  <div class="placeholder">{{ size.w }}×{{ size.h }}</div>
</template>

<style scoped>
.placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 1.5rem;
  font-weight: 600;
  opacity: 0.85;
}
</style>
