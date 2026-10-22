<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { SPACE_COLORS, SPACE_ICONS, type SpaceColor, type SpacePatch, type SpaceSummary } from '@lifedashboard/contracts/space'

// Icon and colour of one space. The selection is the server state: it changes only when the patch is saved.
const props = defineProps<{ space: SpaceSummary }>()
const emit = defineEmits<{ pick: [patch: SpacePatch]; close: [] }>()

const COLOR_NAMES: Record<SpaceColor, string> = {
  violet: 'фиолетовый',
  blue: 'синий',
  teal: 'бирюзовый',
  green: 'зелёный',
  amber: 'жёлтый',
  orange: 'оранжевый',
  red: 'красный',
  pink: 'розовый',
}
const colors = Object.keys(SPACE_COLORS) as SpaceColor[]

// A click outside the switcher closes the picker. Clicks on the corner button, the fan and the badges do not.
function onPointerDown(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('.space-switcher')) return
  emit('close')
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div class="space-picker" role="group" :aria-label="`Иконка и цвет: ${space.title}`">
    <h4 class="space-picker__heading">Иконка</h4>
    <div class="space-picker__icons">
      <button
        v-for="icon in SPACE_ICONS"
        :key="icon"
        type="button"
        class="space-picker__icon"
        :aria-label="icon"
        :aria-pressed="icon === space.icon"
        @click="icon !== space.icon && emit('pick', { icon })"
      >
        {{ icon }}
      </button>
    </div>
    <h4 class="space-picker__heading">Цвет</h4>
    <div class="space-picker__colors">
      <button
        v-for="color in colors"
        :key="color"
        type="button"
        class="space-picker__color"
        :aria-label="COLOR_NAMES[color]"
        :aria-pressed="color === space.color"
        :style="{ background: `oklch(0.6 0.12 ${SPACE_COLORS[color]})` }"
        @click="color !== space.color && emit('pick', { color })"
      />
    </div>
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

.space-picker__colors {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.space-picker__color {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 0.125rem solid transparent;
  border-radius: 50%;
  cursor: pointer;
}

.space-picker__color[aria-pressed='true'] {
  border-color: var(--ld-text-primary);
  box-shadow: inset 0 0 0 0.125rem var(--ld-surface-2);
}

.space-picker__icon:focus-visible,
.space-picker__color:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
