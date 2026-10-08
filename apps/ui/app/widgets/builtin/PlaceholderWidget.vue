<script setup lang="ts">
import { useWidget } from '@lifedashboard/widget-sdk'

// The size comes from useWidget(), like in an installed package (acceptance 6).
const { context } = useWidget()
</script>

<template>
  <div class="grid place-items-center h-full text-2xl font-strong text-secondary">{{ context.size.w }}×{{ context.size.h }}</div>
</template>
