<script setup lang="ts">
import type { Tasks } from './use-tasks.ts'
import { VIEWS } from './views.ts'

defineProps<{ tasks: Tasks }>()
</script>

<template>
  <nav class="rail" aria-label="Списки">
    <button
      v-for="item in VIEWS"
      :key="item.id"
      type="button"
      class="rail__item"
      :class="{ 'rail__item--on': tasks.view === item.id }"
      :aria-pressed="tasks.view === item.id"
      @click="tasks.view = item.id"
    >
      {{ item.label }}
    </button>
    <p v-if="tasks.tags.length > 0" class="rail__section">Теги</p>
    <button
      v-for="item in tasks.tags"
      :key="item.name"
      type="button"
      class="rail__item"
      :class="{ 'rail__item--on': tasks.tag === item.name }"
      :aria-pressed="tasks.tag === item.name"
      @click="tasks.tag = tasks.tag === item.name ? null : item.name"
    >
      <span class="rail__name"># {{ item.name }}</span>
      <span class="rail__count">{{ item.openCount }}</span>
    </button>
  </nav>
</template>

<style scoped>
.rail {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 0.1rem;
  width: 9.5rem;
  padding-right: var(--ld-gap);
  overflow-y: auto;
  border-right: var(--ld-border-width) solid var(--ld-border-subtle);
  scrollbar-width: thin;
}

.rail__item {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  border: 0;
  border-radius: var(--ld-radius-control);
  background: none;
  color: var(--ld-text-secondary);
  text-align: left;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), color var(--ld-duration-fast) var(--ld-ease-standard);
}

.rail__item:hover {
  background: var(--ld-state-hover);
}

.rail__item--on {
  background: var(--ld-state-selected);
  color: var(--ld-text-primary);
}

.rail__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail__count {
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}

.rail__section {
  margin: 0.9rem 0.6rem 0.25rem;
  color: var(--ld-text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
