<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'
import { createCounter } from './counter.ts'

const widget = useWidget()
const { state, load, change } = createCounter(widget.state)
const title = computed(() => widget.context.config.title.trim() || 'Focus sessions')
const goal = computed(() => widget.context.config.goal)
const progress = computed(() => state.ready ? Math.min(state.count / goal.value, 1) * 100 : 0)
const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const displayCount = computed(() => state.ready ? number.format(state.count) : '—')
const summary = computed(() => {
  if (state.busy) return state.ready ? 'Saving…' : 'Loading…'
  if (!state.ready) return 'Progress unavailable'
  return state.count >= goal.value ? 'Goal reached' : `${goal.value - state.count} to go`
})

onMounted(load)
</script>

<template>
  <div class="counter" :data-size="widget.context.sizeClass">
    <section class="counter__card" :aria-label="title" :aria-busy="state.busy">
      <header class="counter__header">
        <div class="counter__heading">
          <p class="counter__eyebrow">Your momentum</p>
          <h2 :title="title">{{ title }}</h2>
        </div>
        <svg class="counter__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M11 5H7a2 2 0 0 0-2 2v4m16-6h4a2 2 0 0 1 2 2v4M5 21v4a2 2 0 0 0 2 2h4m10 0h4a2 2 0 0 0 2-2v-4" />
          <circle cx="16" cy="16" r="5" />
        </svg>
      </header>

      <div class="counter__progress">
        <div class="counter__meter">
          <svg class="counter__ring" viewBox="0 0 180 180" preserveAspectRatio="xMidYMid meet" fill="none" aria-hidden="true">
            <circle class="counter__track" cx="90" cy="90" r="77" />
            <circle
              class="counter__fill"
              cx="90" cy="90" r="77" pathLength="100"
              :stroke-dasharray="`${progress} 100`"
              :stroke-opacity="progress > 0 ? 1 : 0"
            />
          </svg>
          <div class="counter__reading">
            <p class="counter__count" :title="String(state.count)" aria-live="polite" aria-atomic="true">
              <span :aria-label="state.ready ? `${state.count} sessions completed` : 'Progress unavailable'">{{ displayCount }}</span>
            </p>
            <p class="counter__unit">sessions</p>
          </div>
        </div>
      </div>

      <footer class="counter__footer">
        <div class="counter__summary">
          <p :class="{ 'counter__reached': state.ready && state.count >= goal }" role="status">{{ summary }}</p>
          <p class="counter__goal">Goal <span>{{ goal }}</span></p>
        </div>
        <div class="counter__actions">
          <button
            class="counter__remove" type="button" aria-label="Remove one session"
            :disabled="state.busy || !state.ready || state.count === 0"
            @click="change(-1)"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10h10" /></svg>
          </button>
          <button
            class="counter__add" type="button" aria-label="Add one session"
            :disabled="state.busy || !state.ready || state.count === Number.MAX_SAFE_INTEGER"
            @click="change(1)"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
            <span>Add session</span>
          </button>
        </div>
        <div v-if="state.error" class="counter__error">
          <p role="alert">{{ state.error }}</p>
          <button v-if="!state.ready" type="button" :disabled="state.busy" @click="load">Reload progress</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.counter {
  width: 100%;
  height: 100%;
  container-type: size;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
  font-weight: var(--ld-weight-regular);
  line-height: var(--ld-leading);
  letter-spacing: var(--ld-tracking);
}

.counter__card {
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--ld-gap);
  height: 100%;
  padding: var(--ld-widget-padding);
}

p, h2 { margin: 0; }

.counter__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ld-gap);
}

.counter__heading { min-width: 0; }

.counter__eyebrow {
  color: var(--ld-text-muted);
  font-size: 0.625rem;
  font-weight: var(--ld-weight-medium);
  text-transform: uppercase;
}

h2 {
  overflow: hidden;
  color: var(--ld-text-primary);
  font-family: var(--ld-font-display);
  font-size: clamp(0.9375rem, 5cqw, 1.25rem);
  font-weight: var(--ld-weight-strong);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.counter__mark {
  flex: none;
  width: 1.625rem;
  height: 1.625rem;
  stroke: var(--ld-accent-text);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.counter__progress {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.counter__meter {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.counter__ring { display: block; width: 100%; height: 100%; }
.counter__track { stroke: var(--ld-border-subtle); stroke-width: 5; }
.counter__fill {
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  stroke: var(--ld-accent);
  stroke-width: 7;
  stroke-linecap: round;
  transition: stroke-dasharray var(--ld-duration-base) var(--ld-ease-standard);
}

.counter__reading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.counter__count {
  font-family: var(--ld-font-display);
  font-size: clamp(1.75rem, 16cqh, 4.5rem);
  font-weight: var(--ld-weight-medium);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.counter__unit {
  margin-top: calc(var(--ld-gap) / 3);
  color: var(--ld-text-muted);
  font-size: clamp(0.625rem, 3.5cqw, 0.8125rem);
}

.counter__footer { display: grid; gap: calc(var(--ld-gap) * 0.75); }
.counter__summary { display: flex; align-items: center; justify-content: space-between; gap: var(--ld-gap); font-size: 0.75rem; }
.counter__summary > :first-child { color: var(--ld-text-secondary); }
.counter__summary > .counter__reached { color: var(--ld-success-text); }
.counter__goal { color: var(--ld-text-muted); white-space: nowrap; }
.counter__goal span { color: var(--ld-text-secondary); font-weight: var(--ld-weight-medium); }
.counter__actions { display: flex; gap: calc(var(--ld-gap) * 0.75); }

.counter__actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: calc(var(--ld-gap) * 0.5);
  min-height: var(--ld-control-height);
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: var(--ld-weight-medium);
  cursor: pointer;
  transition: background var(--ld-duration-fast) var(--ld-ease-standard);
}

.counter__actions svg { width: 1.125rem; height: 1.125rem; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; }
.counter__remove { flex: none; width: var(--ld-control-height); color: var(--ld-text-secondary); background: var(--ld-surface-2); }
.counter__remove:hover:not(:disabled) { background: var(--ld-state-hover); }
.counter__add { flex: 1; color: var(--ld-on-accent); background: var(--ld-accent); border-color: var(--ld-accent); }
.counter__add:hover:not(:disabled) { background: var(--ld-accent-hover); }
.counter__add:active:not(:disabled) { background: var(--ld-accent-active); }
button:focus-visible { outline: 2px solid var(--ld-focus-ring); outline-offset: 2px; }
.counter__actions button:disabled { color: var(--ld-text-disabled); background: var(--ld-surface-2); border-color: var(--ld-border-subtle); cursor: default; }
.counter__error { display: grid; justify-items: start; gap: calc(var(--ld-gap) / 3); color: var(--ld-danger-text); font-size: 0.6875rem; }
.counter__error button { padding: 0; border: 0; background: none; color: var(--ld-accent-text); font: inherit; text-decoration: underline; cursor: pointer; }
.counter__error button:disabled { color: var(--ld-text-disabled); cursor: default; }

@container (max-height: 15rem) {
  .counter__card { gap: calc(var(--ld-gap) * 0.5); }
  .counter__eyebrow { display: none; }
  .counter__count { font-size: clamp(1.5rem, 14cqh, 2.75rem); }
  .counter__unit { font-size: 0.625rem; }
}

@media (prefers-reduced-motion: reduce) {
  .counter__fill, .counter__actions button { transition: none; }
}
</style>
