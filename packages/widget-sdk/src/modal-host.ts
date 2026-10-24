import { MODAL_LIMITS, type ModalOpenInput } from '@lifedashboard/contracts/widget-modal'
import { WidgetError } from './widget.ts'

export interface ModalOwner { runtimeId: string; widgetId: string; hash: string; packageId: string; version: string; title: string }
export interface ModalRecord { id: string; owner: ModalOwner; input: ModalOpenInput; state: 'open' | 'error' | 'closing' | 'refreshing' }

export function createModalHost(deps: { mount(record: ModalRecord): Promise<void>; dispose(record: ModalRecord): void; refresh(owner: ModalOwner): Promise<void>; notice(message: string): void; onChange(record: ModalRecord | null): void; drainTimeoutMs: number; now?: () => number }) {
 type Slot = { record: ModalRecord; accepted: boolean; disposed: boolean; close?: Promise<void>; cancel(): void; cancelled: Promise<void> }
 let current: Slot | null = null
 let sequence = 0
 let stopped = false
 const accepted = new Map<string, number[]>()
 const calls = new Map<Promise<unknown>, string>()
 const now = deps.now ?? Date.now
 const unavailable = () => new WidgetError('UNAVAILABLE', 'Modal is unavailable')
 function disposeSurface(slot: Slot) {
  if (slot.disposed) return
  slot.disposed = true
  deps.dispose(slot.record)
 }
 function cancel() {
  if (!current) return
  const slot = current
  current = null
  slot.cancel()
  disposeSurface(slot)
  deps.onChange(null)
 }
 return {
  async open(owner: ModalOwner, input: ModalOpenInput): Promise<void> {
   if (stopped || current) throw unavailable()
   const timestamps = (accepted.get(owner.widgetId) ?? []).filter(time => now() - time < MODAL_LIMITS.windowMs)
   if (timestamps.length >= MODAL_LIMITS.opens) throw new WidgetError('RATE_LIMITED', 'Too many modal opens')
   let cancel!: () => void
   const cancelled = new Promise<void>(resolve => { cancel = resolve })
   const slot: Slot = { record: { id: `modal-${++sequence}`, owner: { ...owner }, input, state: 'open' }, accepted: false, disposed: false, cancel, cancelled }
   current = slot
   deps.onChange(slot.record)
   try {
    await deps.mount(slot.record)
    if (current !== slot) throw unavailable()
    slot.accepted = true
    accepted.set(owner.widgetId, [...timestamps, now()])
   } catch {
    if (current === slot) { current = null; disposeSurface(slot); deps.onChange(null) }
    throw unavailable()
   }
  },
  fail(surfaceId: string, _message: string): void {
   if (current?.record.id === surfaceId && current.record.state === 'open') { current.record.state = 'error'; deps.onChange(current.record) }
  },
  close(surfaceId: string): Promise<void> {
   const slot = current
   if (!slot || slot.record.id !== surfaceId) return Promise.resolve()
   if (slot.close) return slot.close
   if (!slot.accepted) { cancel(); return Promise.resolve() }
   const record = slot.record
   record.state = 'closing'
   deps.onChange(record)
   slot.close = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = [...calls].filter(([, surface]) => surface === record.id || surface === record.owner.runtimeId).map(([call]) => call)
    try {
     const settled = await Promise.race([
      Promise.allSettled(pending), slot.cancelled,
      new Promise<void>(resolve => { timer = setTimeout(() => { deps.notice('Some widget calls may still be completing'); resolve() }, deps.drainTimeoutMs) }),
     ])
     clearTimeout(timer)
     if (current !== slot) return
     if (Array.isArray(settled) && settled.some(result => result.status === 'rejected' && result.reason?.code === 'UNAVAILABLE')) deps.notice('Some widget calls may still be completing')
     disposeSurface(slot)
     record.state = 'refreshing'
     deps.onChange(record)
     await deps.refresh(record.owner)
    } finally {
     clearTimeout(timer)
     if (current === slot) { current = null; deps.onChange(null) }
    }
   })()
   return slot.close
  },
  removeCaller(widgetId: string): void { if (current?.record.owner.widgetId === widgetId) cancel() },
  track<T>(surfaceId: string, run: () => Promise<T>): Promise<T> {
   const record = current?.record
   if (stopped || (record && [record.id, record.owner.runtimeId].includes(surfaceId) && ['closing', 'refreshing'].includes(record.state))) return Promise.reject(unavailable())
   const call = Promise.resolve().then(run)
   calls.set(call, surfaceId)
   void call.then(() => calls.delete(call), () => calls.delete(call))
   return call
  },
  dispose(): void { stopped = true; cancel(); calls.clear(); accepted.clear() },
 }
}
