<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { ModalRecord } from '../src/host.ts'
const props = defineProps<{ record: ModalRecord | null; error: string }>()
const emit = defineEmits<{ close: [id: string]; retry: [id: string] }>()
const dialog = ref<HTMLDialogElement>()
const closeButton = ref<HTMLButtonElement>()
let previousFocus: HTMLElement | null = null
function restoreFocus() { if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null }
watch(() => [props.record?.id, dialog.value], () => {
  if (!dialog.value) return
  if (!props.record) { dialog.value.close(); restoreFocus(); return }
  if (!dialog.value.open) { previousFocus = document.activeElement as HTMLElement | null; dialog.value.showModal(); closeButton.value?.focus() }
}, { flush: 'post', immediate: true })
function close() { if (props.record) emit('close', props.record.id) }
function retry() { if (props.record?.state === 'error') emit('retry', props.record.id) }
onBeforeUnmount(() => { dialog.value?.close(); restoreFocus() })
</script>
<template>
 <dialog ref="dialog" class="dev-modal" aria-labelledby="dev-modal-title" @cancel.prevent="close">
  <template v-if="record">
   <header><div><small>{{ record.owner.title }}</small><h2 id="dev-modal-title">{{ record.input.title ?? record.owner.title }}</h2></div><button ref="closeButton" aria-label="Close modal" @click="close">×</button></header>
   <div class="dev-modal__body"><p v-if="error" role="alert">{{ error }} <button :disabled="record.state !== 'error'" @click="retry">Retry</button></p><slot /></div>
  </template>
 </dialog>
</template>
<style scoped>
.dev-modal { width: min(1120px, calc(100vw - 48px)); height: min(780px, calc(100vh - 48px)); max-width: none; max-height: none; padding: 0; border: 1px solid #c9ced8; border-radius: 0.5rem; background: white; }
.dev-modal[open] { display: flex; flex-direction: column; }
.dev-modal::backdrop { background: #0008; }
.dev-modal header { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; padding: 1rem; }
.dev-modal h2 { margin: 0; }
.dev-modal__body { flex: 1; min-height: 0; position: relative; }
.dev-modal__body :deep(iframe) { width: 100%; height: 100%; border: 0; display: block; }
</style>
