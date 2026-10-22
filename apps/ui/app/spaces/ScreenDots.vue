<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'

// Screen navigation of the active space. Absolutely centred by the header; hidden for one screen outside edit mode.
const props = defineProps<{
  count: number
  index: number
  editing: boolean
  disabled: boolean
  canAdd: boolean
  canRemove: boolean
  removeTitle: string
}>()
// With one screen, ✕ deletes the whole space.
const removeLabel = computed(() => (props.count > 1 ? 'Удалить экран' : 'Удалить пространство'))

// The list scrolls inside its capped column; the active dot is kept in view when it moves.
const list = useTemplateRef<HTMLElement>('list')
watch(
  [() => props.index, () => props.count, () => props.editing],
  () => list.value?.querySelector('.dots__item--on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }),
  { flush: 'post' },
)
onMounted(() => list.value?.querySelector('.dots__item--on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }))
const emit = defineEmits<{
  go: [index: number]
  add: []
  remove: []
}>()
</script>

<template>
  <nav v-if="count > 1 || editing" class="dots" :class="{ 'dots--edit': editing }" aria-label="Экраны">
    <button
      type="button"
      class="dots__arrow"
      aria-label="Предыдущий экран"
      :disabled="disabled || index <= 0"
      @click="emit('go', index - 1)"
    >
      ‹
    </button>
    <div ref="list" class="dots__list">
      <span v-for="position in count" :key="position" class="dots__item" :class="{ 'dots__item--on': position - 1 === index }">
        <button
          type="button"
          class="dots__dot"
          :class="{ 'dots__dot--on': position - 1 === index }"
          :aria-label="`Экран ${position}`"
          :aria-current="position - 1 === index ? 'true' : undefined"
          :disabled="disabled"
          @click="emit('go', position - 1)"
        />
        <button
          v-if="editing && position - 1 === index"
          type="button"
          class="dots__remove"
          :aria-label="removeLabel"
          :title="canRemove ? removeLabel : removeTitle"
          :disabled="disabled || !canRemove"
          @click="emit('remove')"
        >
          ✕
        </button>
      </span>
    </div>
    <button
      type="button"
      class="dots__arrow"
      aria-label="Следующий экран"
      :disabled="disabled || index >= count - 1"
      @click="emit('go', index + 1)"
    >
      ›
    </button>
    <button
      v-if="editing"
      type="button"
      class="dots__add"
      aria-label="Новый экран"
      :title="canAdd ? 'Новый экран' : 'Не больше 20 экранов'"
      :disabled="disabled || !canAdd"
      @click="emit('add')"
    >
      +
    </button>
  </nav>
</template>

<style scoped>
/* The middle column takes no more than the side columns leave: at 1280 px the view-mode controls need
   33rem, the edit-mode controls 26rem. The list scrolls inside the cap. */
.dots {
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  max-width: 8.5rem;
  padding: 0.25rem 0.375rem;
  border-radius: var(--ld-radius-pill);
}

.dots--edit {
  max-width: 22rem;
}

.dots:hover {
  background: var(--ld-state-hover);
}

/* Padding keeps the focus rings and the ✕ inside the scroll box; scroll-padding keeps the active dot off the edges. */
.dots__list {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 0 1 auto;
  min-width: 0;
  overflow-x: auto;
  padding: 0.25rem;
  scroll-padding-inline: 1.5rem;
  scrollbar-width: none;
}

.dots__list::-webkit-scrollbar {
  display: none;
}

.dots__item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.dots__dot {
  width: 0.625rem;
  height: 0.625rem;
  padding: 0;
  border: 0;
  border-radius: var(--ld-radius-pill);
  background: var(--ld-border-strong);
  cursor: pointer;
  transition:
    width var(--ld-duration-base) var(--ld-ease-standard),
    background var(--ld-duration-fast) var(--ld-ease-standard);
}

.dots__dot:hover:not(:disabled) {
  background: var(--ld-text-muted);
}

.dots__dot--on {
  width: 1.75rem;
  background: var(--ld-accent);
}

.dots__dot:focus-visible,
.dots__arrow:focus-visible,
.dots__add:focus-visible,
.dots__remove:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.dots__arrow,
.dots__add {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: 50%;
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}

.dots__add {
  border-style: dashed;
  color: var(--ld-text-muted);
}

.dots__arrow:disabled,
.dots__add:disabled,
.dots__dot:disabled {
  opacity: 0.4;
  cursor: default;
}

/* The ✕ sits beside the active dot, inside the header. It is shown on hover and on keyboard focus of
   that dot; it keeps its place while hidden, so the dots do not move. */
.dots__remove {
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--ld-danger);
  color: var(--ld-on-danger);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
}

.dots__item:hover .dots__remove,
.dots__item:focus-within .dots__remove {
  opacity: 1;
  pointer-events: auto;
}

/* Same specificity as the hover rule above and later in the file, so a disabled ✕ stays dimmed on hover. */
.dots__item .dots__remove:disabled {
  opacity: 0.4;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .dots__dot {
    transition: none;
  }
}
</style>
