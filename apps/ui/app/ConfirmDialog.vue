<script setup lang="ts">
import { computed, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { GatewayOp, NotificationInput } from '@lifedashboard/contracts/widget-gateway'
import { confirmations } from './confirmations'

// «Виджет «…» хочет …»; a Record so a new op cannot reach the dialog without its text.
const ACTIONS: Record<GatewayOp, string> = {
  'state.get': 'прочитать свои данные',
  'state.set': 'сохранить свои данные',
  'notifications.send': 'показать уведомление',
}
// A double click on the previous entry must not approve the next one.
const ARM_MS = 500

// Template ref keys differ from setup bindings (see WidgetBoard.vue).
const dialog = useTemplateRef<HTMLDialogElement>('dialogBox')
const declineButton = useTemplateRef<HTMLButtonElement>('declineBox')
const current = computed(() => confirmations.value[0] ?? null)
const notification = computed(() => (current.value?.op === 'notifications.send' ? (current.value.input as NotificationInput) : null))
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | undefined

// The modal lives in the main document: the frame can neither see nor click it.
watch(
  () => current.value?.id,
  (id) => {
    clearTimeout(armTimer)
    armed.value = false
    const box = dialog.value
    if (!box) return
    if (id === undefined) {
      if (box.open) box.close()
      return
    }
    if (!box.open) box.showModal()
    declineButton.value?.focus()
    armTimer = setTimeout(() => (armed.value = true), ARM_MS)
  },
  { flush: 'post' },
)

// Esc closes the dialog and declines the shown entry. The close event is queued, so a dialog that
// was reopened for a new entry before it fired is still open and its entry stays.
function onClose() {
  if (!dialog.value?.open) current.value?.answer('declined')
}

onUnmounted(() => clearTimeout(armTimer))
</script>

<template>
  <dialog ref="dialogBox" class="confirm" aria-labelledby="confirm-title" @close="onClose">
    <template v-if="current">
      <h2 id="confirm-title" class="confirm__title">Виджет «{{ current.title }}» хочет {{ ACTIONS[current.op] }}</h2>
      <div v-if="notification" class="confirm__preview">
        <p class="confirm__preview-title">{{ notification.title }}</p>
        <p v-if="notification.body">{{ notification.body }}</p>
      </div>
      <div class="confirm__actions">
        <button type="button" class="confirm__button" :disabled="!armed" @click="current.answer('approved')">Разрешить один раз</button>
        <button ref="declineBox" type="button" class="confirm__button" @click="current.answer('declined')">Отклонить</button>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.confirm {
  width: 28rem;
  max-width: calc(100vw - 2rem);
  padding: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.confirm::backdrop {
  background: var(--ld-scrim);
}

.confirm__title {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}

.confirm__preview {
  padding: 0.75rem 1rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-control);
  overflow-wrap: anywhere;
}

.confirm__preview p {
  margin: 0;
}

.confirm__preview-title {
  font-weight: var(--ld-weight-strong);
}

.confirm__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.confirm__button {
  height: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.confirm__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.confirm__button:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
