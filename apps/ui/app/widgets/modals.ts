import { nextTick, reactive, shallowRef, type ShallowRef } from 'vue'
import { WidgetError } from '@lifedashboard/widget-sdk'
import { createModalHost, type ModalOwner, type ModalRecord } from '@lifedashboard/widget-sdk/host'
import { parseModalOpen } from '@lifedashboard/contracts/widget-modal'
import type { WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { API_TIMEOUT_MS } from '../api'
import { cancelSurfaceConfirmations } from '../confirmations'
import { showToast } from '../toasts'

type Caller = { owner: ModalOwner; context: () => WidgetContext; restart(): Promise<void> }
type Surface = { pause(): void; dispose(): void; focus(): void }

export function createDashboardModals() {
  const activeModal: ShallowRef<ModalRecord | null> = shallowRef(null)
  const visibilityDocument = typeof document === 'undefined' ? null : document
  const documentVisible = shallowRef(visibilityDocument?.visibilityState !== 'hidden')
  const updateVisibility = () => { documentVisible.value = visibilityDocument?.visibilityState !== 'hidden' }
  visibilityDocument?.addEventListener('visibilitychange', updateVisibility)
  const error = shallowRef<string | null>(null)
  const retryVersion = shallowRef(0)
  const callers = reactive(new Map<string, Caller>())
  const versions = reactive(new Map<string, number>())
  const surfaces = new Map<string, Surface>()
  let awaitingFocus: string | undefined
  const controller = createModalHost({
    drainTimeoutMs: API_TIMEOUT_MS,
    async mount() {},
    dispose(record) { surfaces.get(record.id)?.dispose() },
    async refresh(owner) {
      const caller = callers.get(owner.widgetId)
      if (!caller || caller.owner.runtimeId !== owner.runtimeId || caller.owner.hash !== owner.hash || caller.owner.packageId !== owner.packageId || caller.owner.version !== owner.version) return
      try {
        await caller.restart()
      } catch (error) {
        if (callers.get(owner.widgetId) !== caller) return
        throw error
      }
      // Removal/replacement while restart awaited must never resurrect the old owner.
      if (callers.get(owner.widgetId) !== caller) return
      versions.set(owner.widgetId, (versions.get(owner.widgetId) ?? 0) + 1)
      awaitingFocus = owner.runtimeId
    },
    notice(message) { showToast({ source: 'LifeDashboard', title: message, body: '' }) },
    onChange(record) {
      if (record?.state === 'closing') {
        for (const id of [record.id, record.owner.runtimeId]) {
          cancelSurfaceConfirmations(id)
          surfaces.get(id)?.pause()
        }
      }
      activeModal.value = record ? { ...record } : null
      if (!record) {
        error.value = null
        void nextTick(() => {
          if (!awaitingFocus) return
          const surface = surfaces.get(awaitingFocus)
          if (surface) surface.focus()
          else if (typeof document !== 'undefined') document.querySelector<HTMLElement>('[data-board-focus]')?.focus()
        })
      }
    },
  })

  return {
    activeModal, error, retryVersion,
    registerCaller(entry: Caller) {
      // Keep the caller object and its source pinned; reactive Maps otherwise proxy entries.
      const pinned = Object.freeze({ ...entry, owner: Object.freeze({ ...entry.owner }) })
      callers.set(entry.owner.widgetId, pinned)
      return () => {
        if (callers.get(entry.owner.widgetId) !== pinned) return
        callers.delete(entry.owner.widgetId)
        controller.removeCaller(entry.owner.widgetId)
      }
    },
    runtimeVersion(widgetId: string) { return versions.get(widgetId) ?? 0 },
    registerSurface(id: string, surface: Surface) {
      surfaces.set(id, surface)
      return () => { if (surfaces.get(id) === surface) surfaces.delete(id) }
    },
    ready(id: string) {
      if (id !== awaitingFocus || activeModal.value) return
      surfaces.get(id)?.focus()
      awaitingFocus = undefined
    },
    context(): WidgetContext | null {
      const owner = activeModal.value?.owner
      const entry = owner && callers.get(owner.widgetId)
      if (!entry || entry.owner.runtimeId !== owner.runtimeId) return null
      const effective = entry.context()
      return { ...effective, frame: 'frameless', visible: documentVisible.value }
    },
    async open(surfaceId: string, input: unknown) {
      const caller = [...callers.values()].find(entry => entry.owner.runtimeId === surfaceId)
      if (!caller) throw new WidgetError('UNAVAILABLE', 'Modal is unavailable')
      const parsed = parseModalOpen(input)
      if (!parsed.ok) throw new WidgetError('INVALID_INPUT', parsed.error)
      await controller.open(caller.owner, parsed.value)
    },
    close: controller.close,
    track: controller.track,
    fail(id: string, message: string) { if (activeModal.value?.id === id) { error.value = message; controller.fail(id, message) } },
    retry(id: string) { if (activeModal.value?.id === id && activeModal.value.state === 'error' && error.value !== null) { error.value = null; retryVersion.value++ } },
    cancelAll() { for (const id of callers.keys()) controller.removeCaller(id) },
    dispose() { controller.dispose(); callers.clear(); surfaces.clear(); visibilityDocument?.removeEventListener('visibilitychange', updateVisibility) },
  }
}

export const widgetModals = createDashboardModals()
