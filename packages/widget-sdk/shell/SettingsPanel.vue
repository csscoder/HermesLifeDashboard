<script setup lang="ts">
import { computed, ref } from 'vue'
import { controlFor, parseFieldInput, type PlainSetting, type SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import { secretsOf } from '@lifedashboard/contracts/widget-secrets'

const props = defineProps<{ schema?: SettingsSchema; config: Record<string, unknown>; secrets: Record<string, boolean>; problems: string[] }>()
const emit = defineEmits<{ change: [key: string, value: unknown] }>()
const invalid = ref<Record<string, boolean>>({})
const plain = computed(() => Object.entries(props.schema?.properties ?? {}).filter((entry): entry is [string, PlainSetting] => entry[1].type !== 'secret'))
const secrets = computed(() => secretsOf(props.schema))

function update(key: string, setting: PlainSetting, event: Event) {
  const input = event.target as HTMLInputElement
  const parsed = parseFieldInput(setting, setting.type === 'boolean' ? input.checked : input.value)
  invalid.value[key] = !parsed.ok
  if (parsed.ok) emit('change', key, parsed.value)
}
</script>

<template>
  <section class="shell-panel" aria-labelledby="settings-title">
    <h2 id="settings-title">Settings</h2>
    <p v-if="plain.length === 0 && secrets.length === 0">No settings declared.</p>
    <div v-for="[key, setting] in plain" :key="key" class="shell-setting">
      <label :for="`setting-${key}`">{{ setting.title }}</label>
      <select v-if="controlFor(setting) === 'select'" :id="`setting-${key}`" :value="config[key]" :aria-invalid="invalid[key] || false" @change="update(key, setting, $event)">
        <option v-for="value in setting.enum" :key="value" :value="value">{{ value }}</option>
      </select>
      <input v-else-if="controlFor(setting) === 'checkbox'" :id="`setting-${key}`" type="checkbox" :checked="Boolean(config[key])" @change="update(key, setting, $event)">
      <input v-else :id="`setting-${key}`" :type="controlFor(setting) === 'text' ? 'text' : 'number'"
        :value="config[key]" :min="setting.minimum" :max="setting.maximum" :maxlength="setting.maxLength"
        :step="setting.type === 'integer' ? 1 : 'any'" :aria-invalid="invalid[key] || false" @input="update(key, setting, $event)">
      <small v-if="setting.description">{{ setting.description }}</small>
      <small v-if="invalid[key]" role="alert">Invalid value. Fix: follow this setting's type and constraints.</small>
    </div>
    <div v-for="secret in secrets" :key="secret.key" class="shell-setting">
      <span>{{ secret.title }}: {{ props.secrets[secret.key] ? 'задан' : 'не задан' }}</span>
      <small>LD_SECRET_{{ secret.key }} в .env.local</small>
    </div>
    <p v-for="problem in problems" :key="problem" role="alert">{{ problem }}</p>
  </section>
</template>
