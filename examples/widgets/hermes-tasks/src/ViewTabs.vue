<script setup lang="ts">
import type { Tasks } from './use-tasks.ts'
import { VIEWS } from './views.ts'

defineProps<{ tasks: Tasks }>()
</script>

<template>
  <nav class="tabs" aria-label="Списки">
    <div class="segment-group">
      <button
        v-for="item in VIEWS"
        :key="item.id"
        type="button"
        class="segment"
        :class="{ 'segment--on': tasks.view === item.id }"
        :aria-pressed="tasks.view === item.id"
        @click="tasks.view = item.id"
      >
        {{ item.label }}
      </button>
    </div>
    <div v-if="tasks.tags.length > 0" class="tabs__tags">
      <button type="button" class="chip" :class="{ 'chip--on': tasks.tag === null }" :aria-pressed="tasks.tag === null" @click="tasks.tag = null">
        все
      </button>
      <button
        v-for="item in tasks.tags"
        :key="item.name"
        type="button"
        class="chip"
        :class="{ 'chip--on': tasks.tag === item.name }"
        :aria-pressed="tasks.tag === item.name"
        @click="tasks.tag = tasks.tag === item.name ? null : item.name"
      >
        {{ item.name }} <span class="chip__count">{{ item.openCount }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
  gap: 0.5rem;
}

.tabs__tags {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  scrollbar-width: none;
}
</style>
