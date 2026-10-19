<script setup lang="ts">
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import type { ShellState } from '../src/dev/shell-state.ts'
import type { DevTheme } from '../src/dev/themes.ts'

const props = defineProps<{ state: ShellState; manifest: WidgetPackageManifest; themes: DevTheme[] }>()
const emit = defineEmits<{ change: [state: ShellState]; reset: [] }>()

function update(key: keyof ShellState, event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('change', { ...props.state, [key]: key === 'w' || key === 'h' ? Number(value) : value })
}
</script>

<template>
  <form class="shell-toolbar" @submit.prevent>
    <label v-for="axis in (['w', 'h'] as const)" :key="axis">
      {{ axis }}
      <input :aria-label="axis" type="number" :value="state[axis]" :min="manifest.sizing.min[axis]"
        :max="manifest.sizing.max[axis]" step="1" required @change="update(axis, $event)">
    </label>
    <label>Theme
      <select :value="state.theme" @change="update('theme', $event)">
        <option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
      </select>
    </label>
    <label>Frame
      <select :value="state.frame" @change="update('frame', $event)">
        <option value="framed">framed</option>
        <option value="frameless">frameless</option>
      </select>
    </label>
    <label>Confirm
      <select :value="state.confirm" @change="update('confirm', $event)">
        <option value="allow">allow</option>
        <option value="decline">decline</option>
      </select>
    </label>
    <button type="button" @click="emit('reset')">Сбросить состояние</button>
  </form>
</template>
