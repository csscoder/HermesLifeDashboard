<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { SPACE_LIMITS } from '@lifedashboard/contracts/space'
import { renameTo } from './space-flow'

// The space name in the header. In edit mode it becomes an inline input on click (or on startRename).
const props = defineProps<{
  title: string
  suffix: string
  editing: boolean
  startRename: boolean
}>()
const emit = defineEmits<{ rename: [title: string] }>()

const renaming = ref(false)
const draft = ref('')
const input = useTemplateRef<HTMLInputElement>('input')

function startEdit() {
  draft.value = props.title
  renaming.value = true
  void nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
}

// Enter, Esc and blur can all end one edit; only the first one counts.
function finish(save: boolean) {
  if (!renaming.value) return
  renaming.value = false
  const next = save ? renameTo(props.title, draft.value) : null
  if (next !== null) emit('rename', next)
}

watch(
  () => props.startRename,
  (on) => {
    if (on) startEdit()
  },
  { immediate: true },
)
</script>

<template>
  <div class="space-title">
    <input
      v-if="renaming"
      ref="input"
      v-model="draft"
      class="space-title__input"
      type="text"
      aria-label="Название пространства"
      :maxlength="SPACE_LIMITS.title"
      @keydown.enter.prevent="finish(true)"
      @keydown.esc.stop.prevent="finish(false)"
      @blur="finish(true)"
    />
    <button
      v-else-if="editing"
      type="button"
      class="space-title__button"
      aria-label="Переименовать пространство"
      @click="startEdit"
    >
      <span class="space-title__text">{{ title }}</span><sub v-if="suffix" class="space-title__number">{{ suffix.replace(/[()]/g, '').trim() }}</sub>
      <span class="space-title__pen" aria-hidden="true">✎</span>
    </button>
    <template v-else><span class="space-title__text">{{ title }}</span><sub v-if="suffix" class="space-title__number">{{ suffix.replace(/[()]/g, '').trim() }}</sub></template>
  </div>
</template>

<style scoped>
/* The title and screen number share a quiet pill; the title truncates first. */
.space-title {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
  max-width: calc(100vw - 7rem);
  padding: 0.25rem 1rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-pill);
  background: var(--ld-state-hover);
  box-shadow: inset 0 0 0 0.0625rem var(--ld-state-hover);
  font-size: 1rem;
  font-weight: var(--ld-weight-strong);
}

.space-title__number { align-self: flex-end; flex-shrink: 0; padding-bottom: 0.0625rem; color: var(--ld-text-muted); font-size: 0.625rem; }

.space-title__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.space-title__button {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  margin: 0 -0.375rem;
  padding: 0.125rem 0.375rem;
  border: 0;
  border-radius: var(--ld-radius-control);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.space-title__button:hover,
.space-title__button:focus-visible {
  background: var(--ld-state-hover);
}

.space-title__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.space-title__pen {
  color: var(--ld-text-muted);
  font-size: 0.875rem;
  opacity: 0;
  transition: opacity var(--ld-duration-fast) var(--ld-ease-standard);
}

.space-title__button:hover .space-title__pen,
.space-title__button:focus-visible .space-title__pen {
  opacity: 1;
}

.space-title__input {
  width: 11.25rem;
  max-width: 100%;
  padding: 0 0.375rem;
  border: var(--ld-border-width) solid var(--ld-accent);
  border-radius: var(--ld-radius-control);
  background: var(--ld-state-selected);
  color: var(--ld-text-primary);
  font: inherit;
  font-weight: var(--ld-weight-strong);
}

@media (prefers-reduced-motion: reduce) {
  .space-title__pen {
    transition: none;
  }
}
</style>
