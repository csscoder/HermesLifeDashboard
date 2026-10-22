<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'
import { pendingDelete, type PendingDelete } from './confirm-delete'

// Template ref keys differ from setup bindings (see WidgetBoard.vue).
const dialog = useTemplateRef<HTMLDialogElement>('dialogBox')
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelBox')
// The request this dialog was opened for; a close event answers only that request.
let shown: PendingDelete | null = null

watch(
  pendingDelete,
  (entry) => {
    const box = dialog.value
    if (!box) return
    if (!entry) {
      if (box.open) box.close()
      return
    }
    shown = entry
    if (!box.open) box.showModal()
    cancelButton.value?.focus()
  },
  { flush: 'post' },
)

// Esc closes the dialog and declines. A close the app caused is queued, so a dialog reopened for a new
// request before that event fires is still open and must not decline it.
function onClose() {
  if (dialog.value?.open) return
  shown?.answer(false)
  shown = null
}
</script>

<template>
  <dialog ref="dialogBox" class="confirm" aria-labelledby="confirm-delete-title" @close="onClose">
    <template v-if="pendingDelete">
      <p id="confirm-delete-title" class="confirm__message">{{ pendingDelete.message }}</p>
      <div class="confirm__actions">
        <button ref="cancelBox" type="button" class="confirm__button" @click="pendingDelete.answer(false)">Отмена</button>
        <button type="button" class="confirm__button confirm__button--danger" @click="pendingDelete.answer(true)">Удалить</button>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.confirm {
  width: 22rem;
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

.confirm__message {
  margin: 0 0 1rem;
  font-size: 1rem;
}

.confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
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

.confirm__button--danger {
  border-color: var(--ld-danger);
  background: var(--ld-danger);
  color: var(--ld-on-danger);
}

.confirm__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
