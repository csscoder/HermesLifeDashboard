<script setup lang="ts">
import { computed, ref } from 'vue'
import TaskRow from './TaskRow.vue'
import type { Tasks } from './use-tasks.ts'
import { VIEWS } from './views.ts'

const props = defineProps<{ tasks: Tasks }>()
const text = ref('')
const title = computed(() => {
  const label = VIEWS.find((item) => item.id === props.tasks.view)?.label ?? ''
  return props.tasks.tag === null ? label : `${label} · #${props.tasks.tag}`
})
const count = computed(() => props.tasks.list.overdue.length + props.tasks.list.items.length)

async function add(): Promise<void> {
  if (await props.tasks.create(text.value)) text.value = ''
}
</script>

<template>
  <section class="list">
    <header class="list__head">
      <h2 class="list__title">{{ title }}</h2>
      <span v-if="tasks.loaded" class="list__count">{{ count }}</span>
    </header>
    <div class="list__scroll">
      <p v-if="!tasks.loaded" class="list__empty">Загрузка…</p>
      <template v-else>
        <template v-if="tasks.list.overdue.length > 0">
          <h3 class="list__group list__group--late">Просрочено · {{ tasks.list.overdue.length }}</h3>
          <TaskRow v-for="item in tasks.list.overdue" :key="item.occurrenceId" :item="item" :tasks="tasks" />
          <h3 v-if="tasks.list.items.length > 0" class="list__group">Сегодня · {{ tasks.list.items.length }}</h3>
        </template>
        <TaskRow v-for="item in tasks.list.items" :key="item.occurrenceId" :item="item" :tasks="tasks" />
        <p v-if="count === 0" class="list__empty">Задач нет</p>
        <p v-if="tasks.list.truncated" class="list__note">Показаны первые 1000</p>
      </template>
    </div>
    <!-- No form: the sandbox omits allow-forms, so submit never fires; Enter is handled on the input. -->
    <div class="list__add">
      <input
        v-model="text"
        class="list__input"
        placeholder="Новая задача… #тег завтра"
        aria-label="Новая задача"
        enterkeyhint="done"
        @keydown.enter.prevent="add"
      />
    </div>
  </section>
</template>

<style scoped>
.list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.list__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.list__title {
  margin: 0;
  overflow: hidden;
  font-family: var(--ld-font-display);
  font-size: 1rem;
  font-weight: var(--ld-weight-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list__count {
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}

.list__scroll {
  flex: 1;
  min-height: 0;
  margin: 0 -0.25rem;
  padding: 0 0.25rem;
  overflow-y: auto;
  scrollbar-width: thin;
}

.list__group {
  margin: 0.75rem 0 0.25rem;
  color: var(--ld-text-muted);
  font-size: 0.68rem;
  font-weight: var(--ld-weight-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.list__group--late {
  color: var(--ld-danger-text);
}

.list__empty,
.list__note {
  margin: 0;
  padding: 1.5rem 0;
  color: var(--ld-text-muted);
  text-align: center;
}

.list__note {
  padding: 0.5rem 0;
  font-size: 0.75rem;
}

.list__add {
  margin-top: var(--ld-gap);
}

.list__input {
  width: 100%;
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-2);
}

.list__input::placeholder {
  color: var(--ld-text-muted);
}
</style>
