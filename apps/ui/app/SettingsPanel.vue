<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { GRID_COLS } from '@lifedashboard/contracts/grid'
import { BUILTIN_THEMES } from './theme/builtin'
import type { PickerEntry } from './widgets/catalog'

const props = defineProps<{
  entries: readonly PickerEntry[]
  loaded: boolean
  viewing: boolean
  spaceTitle: string
  spaceIcon: string
  screenIndex: number
  screenCount: number
  rows: number | null
  themeId: string
  apiLabel: string
  apiDown: boolean
}>()
const emit = defineEmits<{ pick: [key: string]; edit: []; library: []; theme: [id: string] }>()
const panel = useTemplateRef<HTMLElement>('panel')
const open = ref(false)

function close() {
  panel.value?.hidePopover()
}

function pick(event: Event) {
  const select = event.target as HTMLSelectElement
  const key = select.value
  select.value = ''
  if (!props.loaded || !props.viewing || !props.entries.some((entry) => entry.key === key)) return
  close()
  emit('pick', key)
}
</script>

<template>
  <!-- Keep board shortcuts out while native popover keyboard handling remains active. -->
  <div class="settings" @keydown="open && $event.stopPropagation()">
    <button
      type="button"
      class="settings__trigger"
      aria-label="Настройки доски"
      aria-controls="dashboard-settings"
      :aria-expanded="open"
      popovertarget="dashboard-settings"
      title="Настройки доски"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true">
        <path d="m9.5 3-.6 2.1-1.6.9-2.1-.5-2.5 4.3 1.5 1.6v1.8l-1.5 1.6 2.5 4.3 2.1-.5 1.6.9.6 2.1h5l.6-2.1 1.6-.9 2.1.5 2.5-4.3-1.5-1.6v-1.8l1.5-1.6-2.5-4.3-2.1.5-1.6-.9L14.5 3z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span v-if="apiDown" class="settings__alert" aria-hidden="true" />
    </button>
    <section
      id="dashboard-settings"
      ref="panel"
      class="settings__panel"
      popover="auto"
      aria-labelledby="settings-title"
      @toggle="open = $event.newState === 'open'"
    >
      <header class="settings__header">
        <h2 id="settings-title"><span class="settings__brand-dot" /> LifeDashboard</h2>
        <button type="button" class="settings__close" aria-label="Закрыть настройки" popovertarget="dashboard-settings" popovertargetaction="hide">×</button>
      </header>

      <div class="settings__section">
        <p class="settings__caption">Текущее пространство</p>
        <div class="settings__space">
          <span class="settings__space-icon" aria-hidden="true">{{ spaceIcon }}</span>
          <div class="settings__space-info">
            <p class="settings__space-title" :title="spaceTitle">{{ spaceTitle || 'Пространство не выбрано' }}</p>
            <p class="settings__hint">{{ screenCount ? `Экран ${screenIndex + 1} из ${screenCount}` : 'Доска загружается…' }}</p>
          </div>
        </div>
      </div>

      <div class="settings__actions">
        <select class="settings__picker" aria-label="Добавить виджет" :disabled="!loaded || !viewing" @change="pick">
          <option value="" selected>＋ Добавить виджет…</option>
          <option v-for="entry in entries" :key="entry.key" :value="entry.key">{{ entry.title }}</option>
        </select>
        <button type="button" class="settings__action" :disabled="!loaded || !viewing" @click="close(); emit('edit')">
          <span aria-hidden="true">✎</span> Изменить доску <span class="settings__action-end" aria-hidden="true">↗</span>
        </button>
        <button type="button" class="settings__action" :disabled="!viewing" @click="close(); emit('library')">
          <span aria-hidden="true">▦</span> Библиотека виджетов <span class="settings__action-end" aria-hidden="true">↗</span>
        </button>
      </div>

      <fieldset class="settings__themes">
        <legend>Тема дашборда по умолчанию</legend>
        <div class="settings__theme-list">
          <button
            v-for="theme in BUILTIN_THEMES"
            :key="theme.id"
            type="button"
            class="settings__theme"
            :aria-label="theme.name"
            :aria-pressed="themeId === theme.id"
            @click="emit('theme', theme.id)"
          >
            <span class="settings__swatch" :class="[theme.id.replace('builtin:', 'space--theme-'), `settings__swatch--${theme.skin}`]" aria-hidden="true" />
            {{ theme.name }}
          </button>
        </div>
      </fieldset>
      <footer class="settings__footer">
        <span class="settings__status" :class="{ 'settings__status--down': apiDown }"><span />{{ apiLabel }}</span>
        <span v-if="loaded && rows !== null" class="settings__grid">{{ GRID_COLS }} × {{ rows }}</span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.settings__trigger {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 10;
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  padding: 0.6rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: 0.9rem;
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-secondary);
  box-shadow: var(--ld-shadow-raised);
  cursor: pointer;
  transition:
    opacity calc(var(--ld-duration-slow) * 1.5) var(--ld-ease-standard),
    color var(--ld-duration-fast), border-color var(--ld-duration-fast);
}
.settings__trigger svg { width: 100%; height: 100%; }
.settings__trigger:hover, .settings__trigger[aria-expanded='true'] { color: var(--ld-info); border-color: var(--ld-info); }
.settings__alert { position: absolute; top: 0.45rem; right: 0.45rem; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--ld-danger); }
.settings__panel {
  position: fixed;
  inset: auto 1rem 4.55rem auto;
  width: 21rem;
  max-width: calc(100vw - 2rem);
  max-height: calc(100dvh - 5.55rem);
  overflow-y: auto;
  margin: 0;
  transform: scale(0.7);
  transform-origin: bottom right;
  padding: 1.125rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: 1.5rem;
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font: 0.8125rem var(--ld-font-ui);
  box-shadow: var(--ld-shadow-widget), inset 0 0 0 0.0625rem var(--ld-state-hover);
}
.settings__header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-bottom: 0.75rem; border-bottom: var(--ld-border-width) solid var(--ld-border-subtle); }
.settings__header h2 { display: flex; align-items: center; gap: 0.5rem; margin: 0; font-size: 0.8125rem; font-weight: var(--ld-weight-strong); letter-spacing: 0.06em; text-transform: uppercase; }
.settings__brand-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--ld-info); }
.settings__close { width: 1.5rem; height: 1.5rem; padding: 0; border-radius: 50%; background: transparent; color: var(--ld-text-muted); font: inherit; font-size: 1.25rem; cursor: pointer; }
.settings__close:hover { background: var(--ld-state-hover); }
.settings__section { padding: 0.875rem 0; }
.settings__caption, .settings__hint { margin: 0; color: var(--ld-text-muted); }
.settings__caption { margin-bottom: 0.5rem; font-size: 0.75rem; }
.settings__space { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border: var(--ld-border-width) solid var(--ld-border-subtle); border-radius: 1rem; background: var(--ld-state-hover); }
.settings__space-icon { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 0.625rem; background: var(--ld-accent-subtle); font-size: 1.125rem; }
.settings__space-info { min-width: 0; }
.settings__space-title { overflow: hidden; margin: 0 0 0.125rem; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--ld-weight-medium); }
.settings__hint { font-size: 0.6875rem; }
.settings__actions { display: grid; gap: 0.5rem; }
.settings__picker, .settings__action { width: 100%; min-height: 2.75rem; padding: 0.625rem 0.875rem; border: var(--ld-border-width) solid var(--ld-border-subtle); border-radius: 0.9375rem; background: var(--ld-state-hover); color: var(--ld-text-primary); font: inherit; cursor: pointer; }
.settings__picker { margin-bottom: 0.375rem; border-color: var(--ld-info); background: var(--ld-info-subtle); color: var(--ld-info-text); }
.settings__picker option { background: var(--ld-surface-1-solid); color: var(--ld-text-primary); }
.settings__action { display: flex; align-items: center; gap: 0.625rem; text-align: left; }
.settings__action-end { margin-left: auto; color: var(--ld-text-muted); }
.settings__action:hover:not(:disabled) { background: var(--ld-state-selected); }
.settings__themes { min-width: 0; margin: 0.875rem 0 0; padding: 0.875rem 0; border: 0; border-top: var(--ld-border-width) solid var(--ld-border-subtle); }
.settings__themes legend { float: left; width: 100%; margin-bottom: 0.625rem; padding: 0; color: var(--ld-text-muted); font-size: 0.75rem; }
.settings__theme-list { display: flex; clear: both; gap: 0.375rem; }
.settings__theme { display: grid; justify-items: center; gap: 0.375rem; flex: 1; min-width: 0; padding: 0.625rem 0.25rem; border: var(--ld-border-width) solid var(--ld-border-subtle); border-radius: 0.875rem; background: var(--ld-state-hover); color: var(--ld-text-secondary); font: inherit; font-size: 0.75rem; cursor: pointer; }
.settings__theme[aria-pressed='true'] { border-color: var(--ld-info); background: var(--ld-info-subtle); color: var(--ld-info-text); }
.settings__swatch { width: 0.875rem; height: 0.875rem; border: var(--ld-border-width) solid var(--ld-border-strong); border-radius: 50%; }
.settings__swatch--glass { background: var(--ld-info); box-shadow: 0 0 0.625rem var(--ld-info); }
.settings__swatch--solid, .settings__swatch--paper { background: var(--ld-bg); }
.settings__footer { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; padding-top: 0.75rem; border-top: var(--ld-border-width) solid var(--ld-border-subtle); color: var(--ld-text-muted); font-size: 0.6875rem; }
.settings__status { display: flex; align-items: center; gap: 0.375rem; }
.settings__status > span { width: 0.375rem; height: 0.375rem; border-radius: 50%; background: var(--ld-success); }
.settings__status--down > span { background: var(--ld-danger); }
.settings__grid { font-family: var(--ld-font-mono); }
.settings :focus-visible { outline: 0.125rem solid var(--ld-focus-ring); outline-offset: 0.125rem; }
.settings :disabled { opacity: 0.5; cursor: default; }
@media (prefers-reduced-motion: reduce) { .settings__trigger { transition: none; } }
</style>
