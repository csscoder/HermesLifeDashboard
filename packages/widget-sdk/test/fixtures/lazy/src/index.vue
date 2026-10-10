<script setup lang="ts">
import { onMounted, ref } from 'vue'

const text = ref('')
onMounted(async () => {
  text.value = (await import('./heavy.ts')).heavy
})
</script>

<template>
  <p>{{ text }}</p>
</template>
