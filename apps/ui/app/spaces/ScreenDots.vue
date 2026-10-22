<script setup lang="ts">
// Screen navigation of the active space. Absolutely centred by the header; hidden for one screen outside edit mode.
defineProps<{
  count: number
  index: number
  editing: boolean
  disabled: boolean
  canAdd: boolean
  canRemove: boolean
  removeTitle: string
}>()
const emit = defineEmits<{
  go: [index: number]
  add: []
  remove: []
}>()
</script>

<template>
  <nav v-if="count > 1 || editing" class="dots" aria-label="Экраны">
    <button
      type="button"
      class="dots__arrow"
      aria-label="Предыдущий экран"
      :disabled="disabled || index <= 0"
      @click="emit('go', index - 1)"
    >
      ‹
    </button>
    <div class="dots__list">
      <span v-for="position in count" :key="position" class="dots__item">
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
          aria-label="Удалить экран"
          :title="canRemove ? 'Удалить экран' : removeTitle"
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
.dots {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.375rem 0.625rem;
  border-radius: var(--ld-radius-pill);
}

.dots:hover {
  background: var(--ld-state-hover);
}

.dots__list {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.dots__item {
  position: relative;
  display: flex;
  justify-content: center;
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
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
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

/* The ✕ sits under the active dot: shown on hover, and on keyboard focus of that dot. */
.dots__remove {
  position: absolute;
  top: calc(100% + 0.375rem);
  left: 50%;
  width: 1.375rem;
  height: 1.375rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--ld-danger);
  color: var(--ld-on-danger);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  transform: translateX(-50%);
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
