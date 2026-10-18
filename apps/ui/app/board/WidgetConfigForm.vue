<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { normalizeConfig, type PlainSetting, type SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import { api } from '../api'
import { refreshSecretFlags } from '../widgets/secret-flags'
import { controlFor, parseFieldInput, plainConfig, secretStatusMessage } from './config-form'

const props = defineProps<{
  schema: SettingsSchema
  config: Record<string, unknown>
  widgetId: string | null
  secrets: ReadonlySet<string>
}>()
const emit = defineEmits<{ change: [config: Record<string, unknown>] }>()
const uid = useId()
const values = computed(() => normalizeConfig(props.schema, props.config, props.secrets))
// Setting keys may match Object.prototype names.
const passwords = ref<Record<string, string>>(Object.create(null))
const pending = ref<Record<string, boolean>>(Object.create(null))
const messages = ref<Record<string, string | null>>(Object.create(null))
const missing = ref(false)
let revision = 0

watch(() => props.widgetId, () => {
  revision++
  passwords.value = Object.create(null)
  pending.value = Object.create(null)
  messages.value = Object.create(null)
  missing.value = false
})

function changeField(key: string, setting: PlainSetting, event: Event) {
  const input = event.target as HTMLInputElement | HTMLSelectElement
  const raw = setting.type === 'boolean' ? (input as HTMLInputElement).checked : input.value
  const parsed = parseFieldInput(setting, raw)
  if (parsed.ok) emit('change', plainConfig(props.schema, { ...values.value, [key]: parsed.value }))
}

async function changeSecret(key: string, clear: boolean) {
  const id = props.widgetId
  if (!id || missing.value || pending.value[key]) return
  const current = revision
  pending.value[key] = true
  const result = clear
    ? await api.clearWidgetSecret(id, key)
    : await api.setWidgetSecret(id, key, passwords.value[key] ?? '')
  if (result.ok) refreshSecretFlags(id, result.data)
  if (current !== revision) return
  pending.value[key] = false
  messages.value[key] = secretStatusMessage(result)
  if (result.ok) passwords.value[key] = ''
  else if (result.kind === 'invalid' && result.code === 'NOT_FOUND') missing.value = true
}

function messageFor(key: string): string | null {
  return !props.widgetId || missing.value ? secretStatusMessage(null) : messages.value[key] ?? null
}
</script>

<template>
  <div class="settings__config">
    <div v-for="(setting, key) in schema.properties" :key="key" class="settings__field">
      <div class="settings__row">
        <label class="settings__label" :for="`${uid}-${key}`">{{ setting.title }}</label>
        <template v-if="setting.type === 'secret'">
          <input
            :id="`${uid}-${key}`"
            v-model="passwords[key]"
            class="settings__control"
            type="password"
            autocomplete="new-password"
            minlength="16"
            :disabled="!widgetId || missing || pending[key]"
            :aria-describedby="`${uid}-${key}-status${setting.description ? ` ${uid}-${key}-description` : ''}`"
          />
          <span :id="`${uid}-${key}-status`" class="settings__description">{{ secrets.has(key) ? 'задан' : 'не задан' }}</span>
          <div class="settings__actions">
            <button
              type="button"
              class="settings__reset"
              :disabled="!widgetId || missing || pending[key] || (passwords[key]?.length ?? 0) < 16"
              @click="changeSecret(key, false)"
            >Задать</button>
            <button
              type="button"
              class="settings__reset"
              :disabled="!widgetId || missing || pending[key] || !secrets.has(key)"
              @click="changeSecret(key, true)"
            >Очистить</button>
          </div>
          <p v-if="messageFor(key)" class="settings__message" role="status">{{ messageFor(key) }}</p>
        </template>
        <template v-else>
          <select
            v-if="controlFor(setting) === 'select'"
            :id="`${uid}-${key}`"
            class="settings__control"
            :value="values[key]"
            :aria-describedby="setting.description ? `${uid}-${key}-description` : undefined"
            @change="changeField(key, setting, $event)"
          >
            <option v-for="option in setting.enum" :key="option" :value="option">{{ option }}</option>
          </select>
          <input
            v-else
            :id="`${uid}-${key}`"
            class="settings__control"
            :type="controlFor(setting)"
            :value="values[key]"
            :checked="values[key] === true"
            :maxlength="setting.maxLength"
            :min="setting.minimum"
            :max="setting.maximum"
            :step="setting.type === 'integer' ? 1 : 'any'"
            :aria-describedby="setting.description ? `${uid}-${key}-description` : undefined"
            @change="changeField(key, setting, $event)"
          />
        </template>
      </div>
      <p v-if="setting.description" :id="`${uid}-${key}-description`" class="settings__description">{{ setting.description }}</p>
    </div>
  </div>
</template>

<style scoped>
.settings__config {
  display: grid;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: var(--ld-border-width) solid var(--ld-border-default);
}

.settings__row {
  display: grid;
  grid-template-columns: 9rem minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
}

.settings__label,
.settings__description {
  color: var(--ld-text-secondary);
}

.settings__control {
  min-width: 0;
}

.settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.settings__message,
.settings__actions {
  grid-column: 1 / -1;
}

.settings__message,
.settings__description {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
}

.settings__reset {
  padding: 0.25rem 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.settings__reset:disabled {
  opacity: 0.5;
  cursor: default;
}

.settings__control:focus-visible,
.settings__reset:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
