<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWidget, WidgetError } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const count = ref(0)
const revision = ref(0)
const status = ref('')

async function load() {
  const state = await widget.state.get<{ count: number }>()
  count.value = state.data?.count ?? 0
  revision.value = state.revision
}

async function increment() {
  try {
    revision.value = (await widget.state.set({ count: count.value + 1 }, revision.value)).revision
    count.value += 1
    status.value = ''
  } catch (error) {
    if (!(error instanceof WidgetError) || error.code !== 'CONFLICT') throw error
    status.value = 'Изменено в другой вкладке'
    await load()
  }
}

async function remind() {
  await widget.notify({ title: 'Напоминание', body: `Счётчик: ${count.value}` })
}

onMounted(load)
</script>

<template>
  <div class="hello" :data-size="widget.context.sizeClass">
    <p class="hello__count">{{ count }}</p>
    <div class="hello__actions">
      <button type="button" class="hello__button" @click="increment">+1</button>
      <button type="button" class="hello__button" @click="remind">Напомнить</button>
    </div>
    <p class="hello__status" role="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.hello {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.5rem;
  height: 100vh;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.hello__count {
  margin: 0;
  font-size: 2rem;
  font-weight: var(--ld-weight-strong);
}

.hello__actions {
  display: flex;
  gap: 0.5rem;
}

.hello__button {
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.hello__status {
  min-height: 1rem;
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}
</style>
