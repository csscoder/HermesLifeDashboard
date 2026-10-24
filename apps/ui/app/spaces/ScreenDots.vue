<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, useTemplateRef, watch } from 'vue'
import type { ScreenBackground } from '@lifedashboard/contracts/board'
import BackgroundEditor from '../background/BackgroundEditor.vue'
import { BUILTIN_THEMES } from '../theme/builtin'

// Screen navigation of the active space, centred in the footer; hidden for one screen outside edit mode.
const props = defineProps<{
  count: number
  index: number
  editing: boolean
  disabled: boolean
  canAdd: boolean
  canRemove: boolean
  removeTitle: string
  themeId: string | null
  background: ScreenBackground | null
  screenKey: string
}>()
// With one screen, deletion removes the whole space after its confirmation.
const removeLabel = computed(() => (props.count > 1 ? 'Удалить экран' : 'Удалить пространство'))

// The list scrolls inside its capped column; the active dot is kept in view when it moves.
const list = useTemplateRef<HTMLElement>('listBox')
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
  theme: [id: string | null]
  background: [value: ScreenBackground | null]
}>()

const panelId = useId()
const panel = useTemplateRef<HTMLElement>('panelBox')
const open = ref(false)

function close() {
  if (panel.value?.matches(':popover-open')) panel.value.hidePopover()
  open.value = false
}

function positionPanel() {
  if (!panel.value?.matches(':popover-open')) return
  const box = panel.value
  const anchor = list.value?.querySelector('.dots__item--on')
  if (!box || !anchor) return
  const rect = anchor.getBoundingClientRect()
  const gap = 8, margin = 12
  box.style.maxHeight = `${Math.max(0, rect.top - gap - margin)}px`
  const size = box.getBoundingClientRect()
  box.style.left = `${Math.max(margin, Math.min(rect.left + rect.width / 2 - size.width / 2, window.innerWidth - size.width - margin))}px`
  box.style.top = `${Math.max(margin, rect.top - size.height - gap)}px`
}

function onToggle(event: ToggleEvent) {
  open.value = event.newState === 'open'
  if (!open.value) return
  positionPanel()
  panel.value?.querySelector('select')?.focus()
}

function remove() {
  close()
  list.value?.querySelector<HTMLElement>('.dots__settings')?.focus()
  emit('remove')
}

function onScroll(event: Event) {
  if (event.target !== panel.value) close()
}

let observer: ResizeObserver | null = null
watch(panel, box => {
  observer?.disconnect()
  if (box) observer?.observe(box)
}, { flush: 'post' })

watch(() => [props.index, props.count, props.editing, props.disabled], close, { flush: 'sync' })
onMounted(() => {
  observer = new ResizeObserver(positionPanel)
  if (panel.value) observer.observe(panel.value)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', onScroll, true)
})
onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <nav v-if="count > 1 || editing" class="dots" :class="{ 'dots--edit': editing }" aria-label="Экраны" @keydown="open && $event.stopPropagation()">
    <div ref="listBox" class="dots__list">
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
          class="dots__settings"
          :aria-label="`Настройки экрана ${position}`"
          title="Настройки экрана"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :popovertarget="panelId"
          :disabled="disabled"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="m9.5 3-.6 2.1-1.6.9-2.1-.5-2.5 4.3 1.5 1.6v1.8l-1.5 1.6 2.5 4.3 2.1-.5 1.6.9.6 2.1h5l.6-2.1 1.6-.9 2.1.5 2.5-4.3-1.5-1.6v-1.8l1.5-1.6-2.5-4.3-2.1.5-1.6-.9L14.5 3z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </span>
    </div>
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
    <section
      v-if="editing"
      :id="panelId"
      ref="panelBox"
      popover="auto"
      role="dialog"
      :aria-label="`Настройки экрана ${index + 1}`"
      class="dots__panel"
      @toggle="onToggle"
      @keydown.stop
    >
      <header class="dots__panel-header">
        <h3>Экран {{ index + 1 }}</h3>
        <button type="button" class="dots__close" aria-label="Закрыть настройки экрана" @click="close">×</button>
      </header>
      <label class="dots__theme">
        Тема экрана
        <select aria-label="Тема экрана" :value="themeId ?? ''" :disabled="disabled"
          @change="emit('theme', ($event.target as HTMLSelectElement).value || null)">
          <option value="">Наследовать тему пространства</option>
          <option v-if="themeId && !BUILTIN_THEMES.some(theme => theme.id === themeId)" :value="themeId" disabled>Тема недоступна — наследуется</option>
          <option v-for="theme in BUILTIN_THEMES" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
        </select>
      </label>
      <p class="dots__hint">Сохранится вместе с изменениями доски</p>
      <BackgroundEditor :key="screenKey" :background="background" :disabled="disabled" @change="emit('background', $event)" />
      <button type="button" class="dots__delete" :disabled="disabled || !canRemove"
        :title="canRemove ? undefined : removeTitle" @click="remove">{{ removeLabel }}</button>
      <p v-if="!canRemove" class="dots__hint">{{ removeTitle }}</p>
    </section>
  </nav>
</template>

<style scoped>
.dots {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  max-width: 22rem;
  padding: 0.25rem 0.375rem;
  border-radius: var(--ld-radius-pill);
  transition: opacity calc(var(--ld-duration-slow) * 1.5) var(--ld-ease-standard);
}

.dots:has(:popover-open) { transition: none; }

.dots--edit {
  max-width: 22rem;
}

.dots:hover {
  background: var(--ld-state-hover);
}

/* Padding keeps the focus rings and the gear inside the scroll box; scroll-padding keeps the active dot off the edges. */
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
.dots__add:focus-visible,
.dots__settings:focus-visible,
.dots__panel :focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

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

.dots__add:disabled,
.dots__dot:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Keep the gear beside the active bullet; the top-layer panel cannot be clipped by this list. */
.dots__settings {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0.25rem;
  border: 0;
  border-radius: 50%;
  background: var(--ld-state-hover);
  color: var(--ld-text-secondary);
  cursor: pointer;
}
.dots__settings svg { width: 100%; height: 100%; }
.dots__settings:hover, .dots__settings[aria-expanded='true'] { background: var(--ld-accent-subtle); color: var(--ld-accent-text); }
.dots__settings:disabled { opacity: 0.4; cursor: default; }
.dots__panel {
  position: fixed;
  inset: auto;
  margin: 0;
  width: 19rem;
  max-width: calc(100vw - 1.5rem);
  overflow-y: auto;
  padding: 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  box-shadow: var(--ld-shadow-raised);
  font: 0.8125rem var(--ld-font-ui);
}
.dots__panel-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.75rem; }
.dots__panel-header h3 { margin: 0; font-size: 0.9375rem; }
.dots__close { width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--ld-state-hover); color: var(--ld-text-secondary); font: inherit; cursor: pointer; }
.dots__theme { display: grid; gap: 0.5rem; color: var(--ld-text-muted); }
.dots__theme select { width: 100%; padding: 0.5rem; border: var(--ld-border-width) solid var(--ld-border-default); border-radius: var(--ld-radius-control); background: var(--ld-surface-3); color: var(--ld-text-primary); font: inherit; }
.dots__hint { margin: 0.5rem 0 0; color: var(--ld-text-muted); font-size: 0.75rem; }
.dots__delete { width: 100%; margin-top: 0.875rem; padding: 0.5rem; border: var(--ld-border-width) solid var(--ld-danger); border-radius: var(--ld-radius-control); background: var(--ld-danger-subtle); color: var(--ld-danger-text); font: inherit; cursor: pointer; }
.dots__delete:disabled { opacity: 0.4; cursor: default; }

@media (prefers-reduced-motion: reduce) {
  .dots__dot {
    transition: none;
  }
}
</style>
