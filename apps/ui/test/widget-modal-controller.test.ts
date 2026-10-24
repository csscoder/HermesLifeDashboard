import { afterEach, expect, it, vi } from 'vitest'
import { confirmations } from '../app/confirmations'
afterEach(() => { for (const confirmation of confirmations.value) confirmation.answer('declined') })
import { createDashboardModals } from '../app/widgets/modals'
import type { ModalOwner } from '@lifedashboard/widget-sdk/host'
import type { WidgetContext } from '@lifedashboard/contracts/widget-gateway'
const owner = (id: string): ModalOwner => ({ widgetId: id, runtimeId: id, hash: 'hash', packageId: 'dev.test', version: '1', title: 'Test' })
const context = { visible: false, frame: 'framed', size: { w: 3, h: 3 }, sizeClass: 's', rootFontSize: 16, theme: { id: 'paper', scheme: 'light', tokens: {} }, config: {}, locale: 'en' } as WidgetContext
it('opens from a registered caller and exposes activeModal', async () => {
 const m = createDashboardModals(); m.registerCaller({ owner: owner('w1'), context: () => context, restart: async () => {} })
 await m.open('w1', { view: 'workspace' }); expect(m.activeModal.value?.owner.widgetId).toBe('w1'); m.dispose()
})
it('restarts only the caller on close', async () => {
 const m = createDashboardModals(), a = vi.fn(async () => {}), b = vi.fn(async () => {})
 m.registerCaller({ owner: owner('w1'), context: () => context, restart: a }); m.registerCaller({ owner: owner('w2'), context: () => context, restart: b })
 await m.open('w1', { view: 'workspace' }); await m.close(m.activeModal.value!.id)
 expect(a).toHaveBeenCalledOnce(); expect(b).not.toHaveBeenCalled(); expect(m.runtimeVersion('w1')).toBe(1); expect(m.runtimeVersion('w2')).toBe(0)
})
it('does not restart a caller whose source changed', async () => {
 const m = createDashboardModals(); let resume!: () => void
 const restart = vi.fn(() => new Promise<void>(resolve => { resume = resolve }))
 const remove = m.registerCaller({ owner: owner('w1'), context: () => context, restart })
 await m.open('w1', { view: 'workspace' }); const closed = m.close(m.activeModal.value!.id); await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce()); remove()
 m.registerCaller({ owner: { ...owner('w1'), hash: 'replacement' }, context: () => context, restart: async () => {} }); resume(); await closed
 expect(m.runtimeVersion('w1')).toBe(0); m.dispose()
})
it('does not call removeCaller on a runtimeVersion remount', async () => {
 const m = createDashboardModals(); m.registerCaller({ owner: owner('w1'), context: () => context, restart: async () => {} })
 await m.open('w1', { view: 'workspace' }); await m.close(m.activeModal.value!.id)
 await m.open('w1', { view: 'workspace' }); expect(m.activeModal.value?.owner.widgetId).toBe('w1'); m.dispose()
})
it('cancels on logout and app unmount', async () => {
 for (const action of ['cancelAll', 'dispose'] as const) {
 const m = createDashboardModals(), restart = vi.fn(async () => {})
 m.registerCaller({ owner: owner('w1'), context: () => context, restart }); await m.open('w1', { view: 'workspace' }); m[action]()
 expect(m.activeModal.value).toBeNull(); expect(restart).not.toHaveBeenCalled()
 }
})
it('cancels queued confirmations and drains dispatched work before disposal and caller restart', async () => {
 const m = createDashboardModals(), events: string[] = []
 m.registerCaller({ owner: owner('w1'), context: () => context, restart: async () => { events.push('restart') } })
 await m.open('w1', { view: 'workspace' }); const id = m.activeModal.value!.id
 m.registerSurface(id, { pause() { events.push('pause') }, dispose() { events.push('dispose') }, focus() {} })
 let complete!: () => void
 const write = m.track(id, () => new Promise<void>(resolve => { complete = resolve }))
 await Promise.resolve()
 const { requestConfirmation, confirmations, cancelSurfaceConfirmations } = await import('../app/confirmations')
 const callerAnswer = requestConfirmation({ widgetId: 'w1', ownerId: 'w1', title: 'Caller', op: 'state.set', input: {} })
 const modalAnswer = requestConfirmation({ widgetId: 'w1', ownerId: id, title: 'Modal', op: 'state.set', input: {} })
 const siblingAnswer = requestConfirmation({ widgetId: 'w2', ownerId: 'w2', title: 'Sibling', op: 'state.set', input: {} })
 const closed = m.close(id)
 expect(confirmations.value.map(entry => entry.ownerId)).toEqual(['w2'])
 await expect(callerAnswer).resolves.toBe('declined'); await expect(modalAnswer).resolves.toBe('declined')
 cancelSurfaceConfirmations('w2'); await siblingAnswer
 expect(events).toEqual(['pause']); await expect(m.track(id, async () => {})).rejects.toMatchObject({ code: 'UNAVAILABLE' })
 complete(); await write; await closed
 expect(events).toEqual(['pause', 'dispose', 'restart']); m.dispose()
})
it('does not restart a replacement source even when the content hash is unchanged', async () => {
 const m = createDashboardModals(), replacement = vi.fn(async () => {})
 try {
 m.registerCaller({ owner: owner('w1'), context: () => context, restart: async () => {} })
 await m.open('w1', { view: 'workspace' })
 m.registerCaller({ owner: { ...owner('w1'), version: '2' }, context: () => context, restart: replacement })
 await m.close(m.activeModal.value!.id)
 expect(replacement).not.toHaveBeenCalled(); expect(m.runtimeVersion('w1')).toBe(0)
 } finally { m.dispose() }
})
it('does not refresh a caller removed while dispatched work drains', async () => {
 const m = createDashboardModals(), restart = vi.fn(async () => {})
 const remove = m.registerCaller({ owner: owner('w1'), context: () => context, restart })
 await m.open('w1', { view: 'workspace' }); const id = m.activeModal.value!.id
 let finish!: () => void
 const write = m.track(id, () => new Promise<void>(resolve => { finish = resolve }))
 await Promise.resolve(); const closed = m.close(id); remove(); finish(); await write; await closed
 expect(restart).not.toHaveBeenCalled(); expect(m.activeModal.value).toBeNull(); m.dispose()
})
it('ignores only restart failures belonging to a caller removed during the async boundary', async () => {
 const m = createDashboardModals()
 let reject!: (reason: Error) => void
 const remove = m.registerCaller({ owner: owner('w1'), context: () => context, restart: () => new Promise((_resolve, rejectRestart) => { reject = rejectRestart }) })
 await m.open('w1', { view: 'workspace' }); const closed = m.close(m.activeModal.value!.id)
 await vi.waitFor(() => expect(reject).toBeTypeOf('function')); remove(); reject(new Error('Caller source changed'))
 await expect(closed).resolves.toBeUndefined(); expect(m.runtimeVersion('w1')).toBe(0); m.dispose()
})
it('allows retry only for an error record and freezes its key when closing', async () => {
 const m = createDashboardModals()
 m.registerCaller({ owner: owner('w1'), context: () => context, restart: async () => {} })
 await m.open('w1', { view: 'workspace' }); const id = m.activeModal.value!.id
 m.retry(id); expect(m.retryVersion.value).toBe(0)
 m.fail(id, 'Failed'); m.retry(id); expect(m.retryVersion.value).toBe(1)
 let finish!: () => void
 const pending = m.track(id, () => new Promise<void>(resolve => { finish = resolve }))
 await Promise.resolve(); const closing = m.close(id)
 m.retry(id); expect(m.retryVersion.value).toBe(1)
 finish(); await pending; await closing; m.dispose()
})
