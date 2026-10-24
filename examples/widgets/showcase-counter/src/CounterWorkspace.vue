<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWidget, WidgetError } from '@lifedashboard/widget-sdk'
import { isCount } from './counter.ts'

const widget = useWidget()
const count = ref('')
const ready = ref(false)
const busy = ref(false)
const error = ref('')
let revision = 0

async function read() {
  ready.value = false
  const saved = await widget.state.get<unknown>()
  if (saved.data !== null && (typeof saved.data !== 'object' || Array.isArray(saved.data)
    || !('count' in saved.data) || !isCount(saved.data.count))) {
    error.value = 'Saved progress is invalid. It has not been changed.'
    return
  }
  count.value = String(saved.data === null ? 0 : (saved.data as { count: number }).count)
  revision = saved.revision
  ready.value = true
}
async function load() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await read() } catch { error.value = 'Could not load progress. Please try again.' }
  finally { busy.value = false }
}
async function save() {
  if (busy.value || !ready.value) return
  const next = Number(count.value)
  if (!count.value.trim() || !isCount(next)) {
    error.value = 'Enter a nonnegative safe integer.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const saved = await widget.state.set({ count: next }, revision)
    revision = saved.revision
    await widget.modal.close()
  } catch (cause) {
    if (cause instanceof WidgetError && cause.code === 'CONFLICT') {
      try {
        await read()
        if (ready.value) error.value = 'Progress changed elsewhere. Review the reloaded count before saving.'
      } catch { error.value = 'Could not reload progress. Please try again.' }
    } else {
      ready.value = false
      error.value = 'Save not confirmed. Reload progress before trying again.'
    }
  } finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <main class="workspace">
    <section :aria-busy="busy" aria-label="Edit progress">
      <h1>Focus sessions</h1>
      <p>Review your progress. Goal: {{ widget.context.config.goal }}</p>
      <label for="count">Completed sessions</label>
      <input id="count" :value="count" @input="count = ($event.target as HTMLInputElement).value" type="number" min="0" step="1" :max="Number.MAX_SAFE_INTEGER" :disabled="busy || !ready" required>
      <p v-if="error" role="alert">{{ error }}</p>
      <button v-if="!ready" type="button" :disabled="busy" @click="load">Reload progress</button>
      <button type="button" aria-label="Save progress" :disabled="busy || !ready" @click="save">{{ busy ? 'Saving…' : 'Save progress' }}</button>
    </section>
  </main>
</template>

<style scoped>
.workspace { box-sizing: border-box; min-height: 100%; padding: var(--ld-widget-padding); color: var(--ld-text-primary); background: var(--ld-surface-1); font-family: var(--ld-font-ui); container-type: inline-size; }
section { display: grid; gap: var(--ld-gap); max-width: 36rem; margin-inline: auto; }
h1, p { margin: 0; }
h1 { font-family: var(--ld-font-display); font-size: 1.5rem; }
p { color: var(--ld-text-secondary); }
[role="alert"] { color: var(--ld-danger-text); }
input, button { box-sizing: border-box; min-width: 0; min-height: var(--ld-control-height); border: var(--ld-border-width) solid var(--ld-border-default); border-radius: var(--ld-radius-control); padding: 0.625rem; font: inherit; }
input { width: 100%; color: var(--ld-text-primary); background: var(--ld-surface-2); }
button { color: var(--ld-on-accent); background: var(--ld-accent); cursor: pointer; }
:disabled { opacity: 0.6; cursor: default; }
:focus-visible { outline: 2px solid var(--ld-focus-ring); outline-offset: 2px; }
@container (max-width: 22rem) { h1 { font-size: 1.25rem; } }
</style>
