<script setup lang="ts">
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { ModalRecord } from '@lifedashboard/widget-sdk/host'

const props = defineProps<{ record: ModalRecord | null; error: string | null }>()
const emit = defineEmits<{ close: [id: string]; retry: [id: string] }>()
const dialog = useTemplateRef<HTMLDialogElement>('dialogBox')
const closeButton = useTemplateRef<HTMLButtonElement>('closeBox')
const loading = ref(true)
let requestedClose = false
let previousFocus: HTMLElement | null = null

function restoreFocus() {
  if (!previousFocus) return
  const target = previousFocus.isConnected ? previousFocus : document.querySelector<HTMLElement>('[data-board-focus]')
  target?.focus()
  previousFocus = null
}

watch(() => [props.record?.id, dialog.value] as const, ([id, box]) => {
  if (!box) return
  if (id === undefined) {
    if (box.open) box.close()
    restoreFocus()
    return
  }
  loading.value = true
  requestedClose = false
  if (!box.open) {
    previousFocus = document.activeElement as HTMLElement | null
    box.showModal()
  }
  closeButton.value?.focus()
}, { immediate: true, flush: 'post' })

function close() {
  if (!props.record || requestedClose) return
  requestedClose = true
  emit('close', props.record.id)
}
function retry() {
  if (!props.record || props.record.state === 'closing' || props.record.state === 'refreshing') return
  loading.value = true
  emit('retry', props.record.id)
}
function cancel(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  close()
}
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
  restoreFocus()
})
</script>

<template>
  <dialog ref="dialogBox" class="widget-modal" aria-labelledby="widget-modal-title" @cancel="cancel">
    <template v-if="record">
      <header class="widget-modal__header">
        <div>
          <p class="widget-modal__source">{{ record.owner.title }}</p>
          <h2 id="widget-modal-title">{{ record.input.title ?? record.owner.title }}</h2>
        </div>
        <button ref="closeBox" type="button" aria-label="Закрыть" @click="close">×</button>
      </header>
      <div class="widget-modal__body" :aria-busy="loading && !error">
        <div v-if="error" class="widget-modal__status" role="alert">
          <p>{{ error }}</p>
          <button type="button" :disabled="record.state === 'closing' || record.state === 'refreshing'" @click="retry">Повторить</button>
        </div>
        <p v-else-if="loading" class="widget-modal__status" role="status">Загрузка…</p>
        <slot :ready="() => loading = false" />
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.widget-modal {
  width: min(1120px, calc(100vw - 48px));
  height: min(780px, calc(100vh - 48px));
  max-width: none;
  max-height: none;
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}
.widget-modal[open] { display: flex; flex-direction: column; }
.widget-modal::backdrop { background: var(--ld-scrim); }
.widget-modal__header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-bottom: var(--ld-border-width) solid var(--ld-border-subtle);
  overflow-wrap: anywhere;
}
.widget-modal__source { margin: 0 0 0.25rem; color: var(--ld-text-secondary); }
.widget-modal h2 { margin: 0; font-size: 1.125rem; }
.widget-modal__body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.widget-modal__status {
  position: absolute;
  inset: 0;
  z-index: 1;
  margin: 0;
  padding: 1rem;
  background: var(--ld-surface-1-solid);
}
.widget-modal button {
  min-width: var(--ld-control-height);
  min-height: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}
.widget-modal button:focus-visible { outline: 0.125rem solid var(--ld-focus-ring); outline-offset: 0.125rem; }
</style>
