<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Priority, Schedule } from './api.ts'
import { createAutosave, shown, type AutosaveState } from './autosave.ts'
import { addDays, formatDue, nextMonday } from './dates.ts'
import type { Layout } from './layout.ts'
import type { Tasks } from './use-tasks.ts'

const props = defineProps<{ tasks: Tasks; layout: Layout }>()

const PRIORITIES: readonly { id: Priority; label: string }[] = [
  { id: 'none', label: 'Нет' },
  { id: 'low', label: 'Низкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'high', label: 'Высокий' },
]
const EVERY = { day: 'ежедневно', week: 'еженедельно', month: 'ежемесячно', year: 'ежегодно' } as const
const UNITS = { day: 'дн.', week: 'нед.', month: 'мес.', year: 'г.' } as const

// The panel is keyed by task id, so the id never changes for this instance.
const taskId = props.tasks.openTaskId!
const state = reactive<AutosaveState>({ version: 0, dirty: {}, saving: false, failed: null })
const autosave = createAutosave(state, {
  prepare: (patch, version) => props.tasks.api.update(taskId, version, patch),
  send: (attempt) => props.tasks.api.send(attempt),
  onSaved: () => void props.tasks.refresh(),
  onFailed: async (failure) => {
    // A lost answer keeps its attempt for «Повторить»; anything else re-reads the task first.
    if (failure.retryable) return
    if (failure.code === 'VERSION_CONFLICT') props.tasks.toast('Задача изменилась в Hermes. «Повторить» сохранит ваши правки')
    else if (failure.code === 'WORKSPACE_EPOCH_MISMATCH') props.tasks.toast('Данные Hermes Tasks могли быть восстановлены из резервной копии')
    else if (failure.code !== 'DECLINED') props.tasks.toast(failure.message)
    try {
      await props.tasks.loadDetail()
    } catch {
      return
    }
    if (props.tasks.detail) state.version = props.tasks.detail.task.version
  },
})

const task = computed(() => props.tasks.detail?.task ?? null)
const occurrence = computed(() => props.tasks.detail?.currentOccurrence ?? null)
const fields = computed(() => (task.value ? shown(task.value, state.dirty) : null))
const dueDate = computed(() => occurrence.value?.due?.slice(0, 10) ?? '')
const time = ref('')
const newTag = ref('')

const quick = computed(() => {
  const today = props.tasks.today
  if (today === null) return []
  return [
    { label: 'Сегодня', date: today },
    { label: 'Завтра', date: addDays(today, 1) },
    { label: 'След. неделя', date: nextMonday(today) },
  ]
})

const rule = computed(() => {
  const value = task.value?.recurrence
  if (!value) return null
  return value.interval === 1 ? EVERY[value.frequency] : `раз в ${value.interval} ${UNITS[value.frequency]}`
})

watch(
  task,
  (value) => {
    // Idle: follow versions bumped by Hermes, so the next PATCH is not a conflict with an old read.
    // Monotonic: a poll issued before a PATCH may answer with an older version (versions start at 1).
    if (value && !state.saving && state.failed === null && value.version > state.version) state.version = value.version
  },
  { immediate: true },
)

watch(
  () => occurrence.value?.due,
  (due) => {
    time.value = due?.slice(11, 16) ?? ''
  },
  { immediate: true },
)

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
}

function moveTo(date: string | null): void {
  const current = occurrence.value
  if (!current) return
  const schedule: Schedule = date === null ? null : time.value ? { kind: 'datetime', datetime: `${date}T${time.value}` } : { kind: 'date', date }
  void props.tasks.reschedule(current.id, current.version, schedule)
}

function changeTime(value: string): void {
  time.value = value
  if (dueDate.value) moveTo(dueDate.value)
}

function addTag(): void {
  const name = newTag.value.trim().replace(/^#/, '').toLowerCase()
  newTag.value = ''
  if (!name || !fields.value || fields.value.tags.includes(name)) return
  void autosave.edit('tags', [...fields.value.tags, name].sort())
}

function removeTag(name: string): void {
  if (fields.value) void autosave.edit('tags', fields.value.tags.filter((item) => item !== name))
}

async function complete(): Promise<void> {
  const current = occurrence.value
  if (current && (await props.tasks.close(current.id, current.version, 'complete'))) props.tasks.closeTask()
}
</script>

<template>
  <aside class="panel" :class="`panel--${layout}`" aria-label="Задача">
    <header class="panel__head">
      <button type="button" class="panel__link" @click="tasks.closeTask()">← Назад</button>
      <span class="panel__status" role="status">
        <template v-if="state.saving">Сохранение…</template>
        <template v-else-if="state.failed">
          Не сохранено
          <button type="button" class="panel__link panel__link--accent" @click="autosave.retry()">Повторить</button>
        </template>
      </span>
      <button v-if="occurrence?.status === 'open'" type="button" class="panel__link panel__link--done" @click="complete">✓ Выполнить</button>
    </header>

    <p v-if="!fields" class="panel__muted">Загрузка…</p>
    <div v-else class="panel__body">
      <label class="panel__label" for="task-title">Название</label>
      <input
        id="task-title"
        class="panel__field panel__field--title"
        :value="fields.title"
        @input="autosave.draft('title', valueOf($event))"
        @change="autosave.edit('title', valueOf($event))"
      />

      <template v-if="occurrence">
        <span class="panel__label">
          Дата
          <span v-if="occurrence.due && tasks.today" class="panel__muted">· {{ formatDue(occurrence.due, tasks.today) }}</span>
        </span>
        <div class="panel__chips">
          <button
            v-for="item in quick"
            :key="item.label"
            type="button"
            class="chip"
            :class="{ 'chip--on': dueDate === item.date }"
            @click="moveTo(item.date)"
          >
            {{ item.label }}
          </button>
          <button v-if="!task?.recurrence" type="button" class="chip" :class="{ 'chip--on': dueDate === '' }" @click="moveTo(null)">Без даты</button>
        </div>
        <div class="panel__row">
          <input type="date" class="panel__field" aria-label="Дата" :value="dueDate" @change="moveTo(valueOf($event) || null)" />
          <input type="time" class="panel__field" aria-label="Время" :value="time" :disabled="!dueDate" @change="changeTime(valueOf($event))" />
        </div>
      </template>

      <span class="panel__label">Теги</span>
      <div class="panel__chips">
        <span v-for="name in fields.tags" :key="name" class="chip chip--on">
          #{{ name }}
          <button type="button" class="chip__x" :aria-label="`Убрать тег ${name}`" @click="removeTag(name)">×</button>
        </span>
        <form class="panel__tag" @submit.prevent="addTag">
          <input v-model="newTag" class="panel__field" list="task-tags" placeholder="+ тег" aria-label="Новый тег" @change="addTag" />
        </form>
        <datalist id="task-tags">
          <option v-for="item in tasks.tags" :key="item.name" :value="item.name" />
        </datalist>
      </div>

      <span class="panel__label">Приоритет</span>
      <div class="segment-group" role="group" aria-label="Приоритет">
        <button
          v-for="item in PRIORITIES"
          :key="item.id"
          type="button"
          class="segment"
          :class="[`segment--${item.id}`, { 'segment--on': fields.priority === item.id }]"
          :aria-pressed="fields.priority === item.id"
          @click="autosave.edit('priority', item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <label class="panel__label" for="task-project">Проект</label>
      <select id="task-project" class="panel__field" :value="fields.projectId ?? ''" @change="autosave.edit('projectId', valueOf($event) || null)">
        <option value="">Входящие</option>
        <option v-for="item in tasks.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>

      <label class="panel__label" for="task-note">Заметка</label>
      <textarea
        id="task-note"
        class="panel__field panel__field--note"
        :value="fields.description ?? ''"
        @input="autosave.draft('description', valueOf($event) || null)"
        @change="autosave.edit('description', valueOf($event) || null)"
      />

      <p v-if="rule" class="panel__muted">Повтор: {{ rule }} · меняется через Hermes</p>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.panel--rail {
  flex: 1;
}

.panel--stacked {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 2;
  width: 82%;
  padding: var(--ld-widget-padding);
  border-left: var(--ld-border-width) solid var(--ld-border-subtle);
  background: var(--ld-surface-1-solid);
  box-shadow: var(--ld-shadow-raised, none);
  animation: panel-in var(--ld-duration-base) var(--ld-ease-emphasized);
}

@keyframes panel-in {
  from {
    translate: 100% 0;
  }
}

.panel__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.panel__link {
  padding: 0.2rem 0.35rem;
  border: 0;
  border-radius: var(--ld-radius-control);
  background: none;
  color: var(--ld-text-secondary);
}

.panel__link:hover {
  background: var(--ld-state-hover);
}

.panel__link--accent {
  color: var(--ld-accent-text);
}

.panel__link--done {
  margin-left: auto;
  color: var(--ld-success-text);
}

.panel__status {
  color: var(--ld-text-muted);
  font-size: 0.75rem;
}

.panel__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

.panel__label {
  margin-top: 0.55rem;
  color: var(--ld-text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.panel__muted {
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.75rem;
  letter-spacing: normal;
  text-transform: none;
}

.panel__field {
  width: 100%;
  min-height: var(--ld-control-height);
  padding: 0.3rem 0.6rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-2);
}

.panel__field--title {
  font-size: 1rem;
  font-weight: var(--ld-weight-medium);
}

.panel__field--note {
  min-height: 4.5rem;
  resize: vertical;
}

.panel__row {
  display: flex;
  gap: 0.4rem;
}

.panel__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.panel__tag {
  flex: 1;
  min-width: 5rem;
}

.segment--on.segment--high {
  box-shadow: inset 0 0 0 0.1rem var(--ld-danger);
}

.segment--on.segment--medium {
  box-shadow: inset 0 0 0 0.1rem var(--ld-warning);
}

.segment--on.segment--low {
  box-shadow: inset 0 0 0 0.1rem var(--ld-info);
}
</style>
