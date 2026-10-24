<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { SPACE_ICONS, type SpacePatch, type SpaceSummary } from '@lifedashboard/contracts/space'

import { BUILTIN_THEMES } from '../theme/builtin'

// Icon and theme of one space. The selection is the server state: it changes only when the patch is saved.
const props = defineProps<{ space: SpaceSummary; disabled: boolean }>()
const emit = defineEmits<{ pick: [patch: SpacePatch]; close: [] }>()

// A click outside the switcher closes the picker. Clicks on the corner button, the fan and the badges do not.
function onPointerDown(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('.space-switcher')) return
  emit('close')
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div class="space-picker" role="group" :aria-label="`Иконка и тема: ${space.title}`">
    <h4 class="space-picker__heading">Иконка</h4>
    <div class="space-picker__icons">
      <button
        v-for="icon in SPACE_ICONS"
        :key="icon"
        type="button"
        class="space-picker__icon"
        :aria-label="icon"
        :aria-pressed="icon === space.icon"
        :disabled="disabled"
        @click="icon !== space.icon && emit('pick', { icon })"
      >
        {{ icon }}
      </button>
    </div>
    <label class="space-picker__heading space-picker__theme">
      Тема пространства
      <select
        aria-label="Тема пространства"
        :value="space.themeId ?? ''"
        :disabled="disabled"
        @change="emit('pick', { themeId: ($event.target as HTMLSelectElement).value || null })"
      >
        <option value="">Наследовать тему дашборда</option>
        <option v-if="space.themeId && !BUILTIN_THEMES.some(theme => theme.id === space.themeId)" :value="space.themeId" disabled>Тема недоступна — наследуется</option>
        <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.space-picker {
  display: grid;
  gap: 0.625rem;
  width: 21.25rem;
  padding: 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: 0.875rem;
  background: var(--ld-surface-2);
  box-shadow: var(--ld-shadow-raised);
}

.space-picker__heading {
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.75rem;
  font-weight: var(--ld-weight-medium);
}

.space-picker__icons {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 0.25rem;
}

.space-picker__icon {
  height: 2rem;
  padding: 0;
  border: var(--ld-border-width) solid transparent;
  border-radius: var(--ld-radius-control);
  background: none;
  font: inherit;
  font-size: 1.25rem;
  cursor: pointer;
}

.space-picker__icon:hover {
  background: var(--ld-state-hover);
}

.space-picker__icon[aria-pressed='true'] {
  border-color: var(--ld-accent);
  background: var(--ld-accent-subtle);
}

.space-picker__theme { display: grid; gap: 0.5rem; }
.space-picker__theme select {
  width: 100%;
  padding: 0.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font: inherit;
}
.space-picker :disabled { opacity: 0.5; cursor: default; }

.space-picker__icon:focus-visible,
.space-picker__theme select:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
