<script setup lang="ts">
import { ref } from 'vue'
import { api } from './api'

const emit = defineEmits<{ paired: [] }>()

const code = ref('')
const message = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  busy.value = true
  const result = await api.pair(code.value.trim())
  busy.value = false
  if (result.ok) {
    emit('paired')
    return
  }
  message.value =
    result.kind === 'unauthorized'
      ? 'Неверный или истёкший код'
      : result.kind === 'unavailable'
        ? 'API: недоступен'
        : 'Не удалось войти'
}

async function requestCode() {
  const result = await api.pairCode()
  message.value = result.ok
    ? 'Новый код выведен в терминал API'
    : result.kind === 'rate-limited'
      ? 'Подождите несколько секунд'
      : 'API: недоступен'
}
</script>

<template>
  <form class="pairing" @submit.prevent="submit">
    <h2 class="pairing__title">Подключение к API</h2>
    <label class="pairing__label">
      Код из терминала API
      <input
        v-model="code"
        class="pairing__input"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="12"
        required
        autofocus
      />
    </label>
    <div class="pairing__actions">
      <button type="submit" class="app__button" :disabled="busy">Войти</button>
      <button type="button" class="app__button" @click="requestCode">Новый код</button>
    </div>
    <p class="pairing__message" role="status">{{ message }}</p>
  </form>
</template>

<style scoped>
.pairing {
  display: grid;
  gap: 1rem;
  width: 22rem;
  margin: 4rem auto 0;
  padding: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-2);
  color: var(--ld-text-primary);
}

.pairing__title {
  margin: 0;
  font-size: 1.125rem;
}

.pairing__label {
  display: grid;
  gap: 0.5rem;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}

.pairing__input {
  height: var(--ld-control-height);
  padding: 0 0.75rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  font-size: 1.25rem;
  letter-spacing: 0.2em;
}

.pairing__input:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.pairing__actions {
  display: flex;
  gap: 0.75rem;
}

.pairing__message {
  min-height: 1.25rem;
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}
</style>
