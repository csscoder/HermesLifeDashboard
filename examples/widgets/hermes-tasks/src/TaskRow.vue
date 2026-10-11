<script setup lang="ts">
import { computed } from 'vue'
import type { ListItem, Schedule } from './api.ts'
import { addDays, formatDue } from './dates.ts'
import type { Tasks } from './use-tasks.ts'

const props = defineProps<{ item: ListItem; tasks: Tasks }>()
const busy = computed(() => props.tasks.pending.includes(props.item.occurrenceId))
const due = computed(() => (props.item.due && props.tasks.today ? formatDue(props.item.due, props.tasks.today) : null))

function tomorrow(): void {
  const today = props.tasks.today
  if (today === null) return
  const date = addDays(today, 1)
  const time = props.item.due?.slice(11, 16)
  const schedule: Schedule = time ? { kind: 'datetime', datetime: `${date}T${time}` } : { kind: 'date', date }
  void props.tasks.reschedule(props.item.occurrenceId, props.item.occurrenceVersion, schedule)
}
</script>

<template>
  <div class="row" :class="{ 'row--busy': busy }">
    <button
      type="button"
      class="row__check"
      :class="`row__check--${item.priority ?? 'none'}`"
      :disabled="busy"
      :aria-label="`Выполнить: ${item.title}`"
      @click="tasks.close(item.occurrenceId, item.occurrenceVersion, 'complete')"
    />
    <button type="button" class="row__body" :aria-label="`Открыть: ${item.title}`" @click="tasks.openTask(item.taskId)">
      <span class="row__title">{{ item.title }}</span>
      <span class="row__meta">
        <span v-if="due" :class="{ 'row__due--late': item.overdue }">{{ due }}</span>
        <span v-if="item.recurring" title="Повторяется">↻</span>
        <span v-if="item.projectName" class="row__project">{{ item.projectName }}</span>
        <span v-for="name in item.tags ?? []" :key="name" class="row__tag">#{{ name }}</span>
      </span>
    </button>
    <div class="row__actions">
      <button
        v-if="item.recurring"
        type="button"
        class="row__action"
        :disabled="busy"
        title="Пропустить"
        :aria-label="`Пропустить: ${item.title}`"
        @click="tasks.close(item.occurrenceId, item.occurrenceVersion, 'skip')"
      >
        ⤼
      </button>
      <button type="button" class="row__action" :disabled="busy" title="На завтра" :aria-label="`Перенести на завтра: ${item.title}`" @click="tomorrow">
        →
      </button>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.4rem 0.35rem;
  border-radius: var(--ld-radius-control);
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), opacity var(--ld-duration-base) var(--ld-ease-standard);
}

.row:hover {
  background: var(--ld-state-hover);
}

.row--busy {
  opacity: 0.45;
}

.row__check {
  flex: none;
  width: 1.05rem;
  height: 1.05rem;
  margin-top: 0.15rem;
  padding: 0;
  border: 0.1rem solid var(--ld-text-muted);
  border-radius: 50%;
  background: transparent;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard);
}

.row__check:hover:not(:disabled) {
  background: var(--ld-state-active);
}

.row__check--high {
  border-color: var(--ld-danger);
}

.row__check--medium {
  border-color: var(--ld-warning);
}

.row__check--low {
  border-color: var(--ld-info);
}

.row__body {
  display: grid;
  flex: 1;
  gap: 0.1rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
}

.row__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  color: var(--ld-text-muted);
  font-size: 0.72rem;
}

.row__due--late {
  color: var(--ld-danger-text);
}

.row__tag {
  color: var(--ld-accent-text);
}

.row__actions {
  display: flex;
  gap: 0.15rem;
  opacity: 0;
  transition: opacity var(--ld-duration-fast) var(--ld-ease-standard);
}

.row:hover .row__actions,
.row:focus-within .row__actions {
  opacity: 1;
}

.row__action {
  width: 1.6rem;
  height: 1.6rem;
  border: 0;
  border-radius: var(--ld-radius-control);
  background: none;
  color: var(--ld-text-secondary);
}

.row__action:hover:not(:disabled) {
  background: var(--ld-state-hover);
  color: var(--ld-text-primary);
}
</style>
