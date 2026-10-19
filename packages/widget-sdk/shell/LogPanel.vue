<script setup lang="ts">
defineProps<{ entries: { id: number; time: string; kind: string; message: string; shell: string }[] }>()
</script>

<template>
  <section class="shell-panel" aria-labelledby="log-title">
    <h2 id="log-title">Log</h2>
    <ol class="shell-log" aria-live="polite">
      <li v-for="entry in entries" :key="entry.id">
        <code>{{ entry.time }} [{{ entry.kind }}] {{ entry.message }}</code>
        <small>{{ entry.shell }}</small>
      </li>
    </ol>
  </section>
</template>
