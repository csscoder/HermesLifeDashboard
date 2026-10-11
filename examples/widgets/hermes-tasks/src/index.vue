<script setup lang="ts">
import { computed } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'
import DetailPanel from './DetailPanel.vue'
import Rail from './Rail.vue'
import TaskList from './TaskList.vue'
import ViewTabs from './ViewTabs.vue'
import { layoutFor } from './layout.ts'
import { useTasks } from './use-tasks.ts'

const widget = useWidget()
const tasks = useTasks(widget)
const layout = computed(() => layoutFor(widget.context.size))
</script>

<template>
  <div class="tasks" :class="`tasks--${layout}`" :data-size="widget.context.sizeClass">
    <Rail v-if="layout === 'rail'" :tasks="tasks" />
    <DetailPanel v-if="layout === 'rail' && tasks.openTaskId" :key="tasks.openTaskId" :tasks="tasks" layout="rail" />
    <main v-else class="tasks__main">
      <ViewTabs v-if="layout === 'stacked'" :tasks="tasks" />
      <p v-if="tasks.unavailable" class="tasks__banner" role="alert">
        Hermes Tasks недоступен
        <button type="button" class="tasks__retry" @click="tasks.retry()">Повторить</button>
      </p>
      <TaskList :tasks="tasks" />
    </main>
    <template v-if="layout === 'stacked' && tasks.openTaskId">
      <div class="tasks__scrim" @click="tasks.closeTask()" />
      <DetailPanel :key="tasks.openTaskId" :tasks="tasks" layout="stacked" />
    </template>
    <TransitionGroup tag="div" name="toast" class="tasks__toasts" aria-live="polite">
      <div v-for="item in tasks.toasts" :key="item.id" class="toast">
        <span>{{ item.text }}</span>
        <button
          v-if="item.action"
          type="button"
          class="toast__action"
          @click="
            item.action.run();
            tasks.dismiss(item.id)
          "
        >
          {{ item.action.label }}
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style>
/* Shared by every component of this widget; the frame isolates it from the board. */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  background: transparent;
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: default;
}

:focus-visible {
  outline: 2px solid var(--ld-focus-ring);
  outline-offset: 2px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.65rem;
  border: 0;
  border-radius: var(--ld-radius-pill);
  background: var(--ld-surface-2);
  color: var(--ld-text-secondary);
  font-size: 0.75rem;
  white-space: nowrap;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), color var(--ld-duration-fast) var(--ld-ease-standard);
}

.chip:hover {
  background: var(--ld-surface-3);
}

.chip--on {
  background: var(--ld-accent-subtle);
  color: var(--ld-accent-text);
}

.chip__count {
  color: var(--ld-text-muted);
}

.chip__x {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  line-height: 1;
}

.segment-group {
  display: flex;
  gap: 0.15rem;
  padding: 0.2rem;
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-2);
}

.segment {
  flex: 1;
  padding: 0.3rem 0.2rem;
  border: 0;
  border-radius: calc(var(--ld-radius-control) - 0.15rem);
  background: none;
  color: var(--ld-text-secondary);
  font-size: 0.78rem;
  white-space: nowrap;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard), color var(--ld-duration-fast) var(--ld-ease-standard);
}

.segment--on {
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
}
</style>

<style scoped>
.tasks {
  position: relative;
  display: flex;
  gap: var(--ld-gap);
  height: 100vh;
  padding: var(--ld-widget-padding);
  overflow: hidden;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
  font-size: calc(0.875rem * var(--ld-font-scale));
  line-height: var(--ld-leading);
  letter-spacing: var(--ld-tracking);
}

.tasks__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--ld-gap);
  min-width: 0;
}

.tasks__banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  padding: 0.4rem 0.6rem;
  border-radius: var(--ld-radius-control);
  background: var(--ld-danger-subtle);
  color: var(--ld-danger-text);
  font-size: 0.8rem;
}

.tasks__retry {
  border: 0;
  background: none;
  color: inherit;
  font-weight: var(--ld-weight-medium);
  text-decoration: underline;
}

.tasks__scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--ld-scrim);
}

.tasks__toasts {
  position: absolute;
  bottom: calc(var(--ld-widget-padding) + var(--ld-control-height) + 0.5rem);
  left: 50%;
  z-index: 3;
  display: grid;
  gap: 0.4rem;
  translate: -50% 0;
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0.85rem;
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-3);
  box-shadow: var(--ld-shadow-raised, none);
  font-size: 0.8rem;
  white-space: nowrap;
}

.toast__action {
  border: 0;
  background: none;
  color: var(--ld-accent-text);
  font-weight: var(--ld-weight-medium);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--ld-duration-base) var(--ld-ease-standard), translate var(--ld-duration-base) var(--ld-ease-emphasized);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  translate: 0 0.5rem;
}
</style>
