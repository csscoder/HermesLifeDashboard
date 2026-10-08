<script setup lang="ts">
// Test package: probes the sandbox boundary and shows what each probe got (spec «Testing»).
import { onMounted, ref } from 'vue'
import { useWidget, WidgetError } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const results = ref<{ name: string; result: string }[]>([])

function describe(error: unknown): string {
  if (error instanceof WidgetError) return `blocked: ${error.code}`
  return `blocked: ${error instanceof Error ? error.name : String(error)}`
}

async function probe(name: string, run: () => unknown) {
  try {
    results.value.push({ name, result: `value: ${JSON.stringify(await run())}` })
  } catch (error) {
    results.value.push({ name, result: describe(error) })
  }
}

function fail() {
  throw new Error('hostile: thrown on purpose')
}

function leave() {
  location.href = 'https://example.com/'
}

onMounted(async () => {
  await probe('document.cookie', () => document.cookie)
  await probe('parent.document', () => parent.document.title)
  await probe('localStorage', () => localStorage.length)
  await probe('fetch /api/v1/rooms', async () => (await fetch('/api/v1/rooms')).status)
  // The manifest grants `state` only.
  await probe('notifications.send', () => widget.notify({ title: 'hostile' }))
})
</script>

<template>
  <div class="hostile">
    <ul class="hostile__list">
      <li v-for="item in results" :key="item.name" :data-probe="item.name">{{ item.name }} → {{ item.result }}</li>
    </ul>
    <div class="hostile__actions">
      <button type="button" class="hostile__button" @click="fail">Ошибка</button>
      <button type="button" class="hostile__button" @click="leave">Уйти</button>
    </div>
  </div>
</template>

<style scoped>
.hostile {
  display: grid;
  gap: 0.5rem;
  height: 100vh;
  padding: 0.5rem;
  box-sizing: border-box;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
  font-size: 0.75rem;
}

.hostile__list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.hostile__actions {
  display: flex;
  gap: 0.5rem;
}

.hostile__button {
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}
</style>
