<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import {
  BARE_THEME_ID,
  DEFAULT_SHADOW,
  SHADOW_LIMITS,
  type DropShadow,
  type WidgetAppearance,
} from '@lifedashboard/contracts/board'
import { BUILTIN_THEMES } from '../theme/builtin'
import { panelPosition, styleValue, withShadow, withStyle } from './widget-settings'

// One per board: a non-modal popover beside the «⚙» of the widget being tuned. It sits in the top
// layer, so the board never clips it; light dismiss and Esc are native (spec «Host UI»).
const props = defineProps<{ appearance: WidgetAppearance | undefined }>()
const emit = defineEmits<{
  change: [next: WidgetAppearance | null]
  toggle: [open: boolean]
}>()

const panel = useTemplateRef<HTMLElement>('panelBox')
const shadow = computed(() => props.appearance?.shadow ?? null)
// While the shadow is off the controls show DEFAULT_SHADOW, disabled; nothing is written.
const shown = computed(() => shadow.value ?? DEFAULT_SHADOW)
const percent = computed(() => Math.round(shown.value.opacity * 100))
const offsets = [
  { key: 'x', label: 'X', limits: SHADOW_LIMITS.x },
  { key: 'y', label: 'Y', limits: SHADOW_LIMITS.y },
  { key: 'blur', label: 'Размытие', limits: SHADOW_LIMITS.blur },
] as const

function isOpen(): boolean {
  return panel.value?.matches(':popover-open') ?? false
}

// Measured after showPopover(): a hidden popover has no size.
function open(anchor: Element) {
  const el = panel.value
  if (!el) return
  if (!isOpen()) el.showPopover()
  const { left, top } = panelPosition(anchor.getBoundingClientRect(), el.getBoundingClientRect(), {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

function close() {
  if (isOpen()) panel.value?.hidePopover()
}

function onToggle(event: ToggleEvent) {
  const opened = event.newState === 'open'
  if (opened) panel.value?.querySelector<HTMLElement>('select')?.focus()
  emit('toggle', opened)
}

const valueOf = (event: Event) => (event.target as HTMLInputElement | HTMLSelectElement).value

function setStyle(event: Event) {
  emit('change', withStyle(props.appearance, valueOf(event)))
}

function setShadowOn(event: Event) {
  emit('change', withShadow(props.appearance, (event.target as HTMLInputElement).checked ? DEFAULT_SHADOW : null))
}

function setShadow<K extends keyof DropShadow>(key: K, value: DropShadow[K]) {
  if (shadow.value) emit('change', withShadow(props.appearance, { ...shadow.value, [key]: value }))
}

defineExpose({ open, close, isOpen })
</script>

<template>
  <div ref="panelBox" popover="auto" role="dialog" aria-label="Настройки виджета" class="settings" @toggle="onToggle">
    <label class="settings__row">
      <span class="settings__label">Стиль</span>
      <select class="settings__control" :value="styleValue(appearance)" @change="setStyle">
        <option value="">Как у доски</option>
        <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
        <option :value="BARE_THEME_ID">Без оформления</option>
      </select>
    </label>
    <label class="settings__row">
      <span class="settings__label">Тень</span>
      <input type="checkbox" :checked="shadow !== null" @change="setShadowOn" />
    </label>
    <label v-for="item in offsets" :key="item.key" class="settings__row">
      <span class="settings__label">{{ item.label }}</span>
      <input
        type="range"
        class="settings__control"
        :min="item.limits[0]"
        :max="item.limits[1]"
        step="1"
        :value="shown[item.key]"
        :disabled="!shadow"
        @input="setShadow(item.key, Number(valueOf($event)))"
      />
      <output class="settings__value">{{ shown[item.key] }} px</output>
    </label>
    <label class="settings__row">
      <span class="settings__label">Цвет</span>
      <input type="color" :value="shown.color" :disabled="!shadow" @input="setShadow('color', valueOf($event))" />
    </label>
    <label class="settings__row">
      <span class="settings__label">Непрозрачность</span>
      <input
        type="range"
        class="settings__control"
        min="0"
        max="100"
        step="1"
        :value="percent"
        :disabled="!shadow"
        @input="setShadow('opacity', Number(valueOf($event)) / 100)"
      />
      <output class="settings__value">{{ percent }} %</output>
    </label>
    <button type="button" class="settings__reset" @click="emit('change', null)">Сбросить</button>
  </div>
</template>

<style scoped>
/* The UA centres a popover (inset: 0; margin: auto); open() sets left and top. A hidden popover keeps
   the UA display: none, so display is set only while open. */
.settings {
  position: fixed;
  inset: auto;
  margin: 0;
  width: 18rem;
  padding: 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-2);
  color: var(--ld-text-primary);
  box-shadow: var(--ld-shadow-raised, none);
  font: inherit;
}

.settings:popover-open {
  display: grid;
  gap: 0.5rem;
}

.settings__row {
  display: grid;
  grid-template-columns: 7rem 1fr 3rem;
  align-items: center;
  gap: 0.5rem;
}

.settings__label {
  color: var(--ld-text-secondary);
}

.settings__control {
  min-width: 0;
}

.settings__value {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.settings__reset {
  justify-self: start;
  padding: 0.25rem 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.settings select:focus-visible,
.settings input:focus-visible,
.settings__reset:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
