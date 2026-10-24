import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createModalHost, type ModalRecord, type ModalOwner } from '../src/modal-host.ts'
const owner = (widgetId = 'w1', runtimeId = 'compact'): ModalOwner => ({ widgetId, runtimeId, hash: 'hash', packageId: 'pkg', version: '1', title: 'Package' })
const input = { view: 'details', props: {} }
function deferred<T = void>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup() {
 let record: ModalRecord | null = null
 const deps = { mount: vi.fn(async (_record: ModalRecord) => {}), dispose: vi.fn((_record: ModalRecord) => {}), refresh: vi.fn(async (_owner: ModalOwner) => {}), notice: vi.fn(), onChange: vi.fn((value: ModalRecord | null) => { record = value }), drainTimeoutMs: 5000 }
 const host = createModalHost(deps)
 return { host, deps, current: () => record! }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => vi.useRealTimers())
it('finalizes a close exactly once', async () => {
 const { host, deps, current } = setup(); await host.open(owner(), input)
 await Promise.all([host.close(current().id), host.close(current().id)])
 expect(deps.dispose).toHaveBeenCalledTimes(1); expect(deps.refresh).toHaveBeenCalledTimes(1); expect(deps.onChange).toHaveBeenLastCalledWith(null)
})
it('refreshes only after a tracked write settles', async () => {
 const { host, deps, current } = setup(); const gate = deferred(); const storage = { count: 0 }; await host.open(owner(), input)
 const write = host.track('compact', async () => { await gate.promise; storage.count = 9 })
 deps.refresh.mockImplementation(async () => { expect(storage.count).toBe(9) })
 const close = host.close(current().id); expect(deps.refresh).not.toHaveBeenCalled(); gate.resolve(); await write; await close; expect(deps.refresh).toHaveBeenCalledTimes(1)
})
it('rejects a busy or nested open with UNAVAILABLE', async () => {
 const { host, current } = setup(); await host.open(owner(), input)
 await expect(host.open(owner('w2'), input)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
 await expect(host.open({ ...owner(), runtimeId: current().id }, input)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
})
it('releases the slot and the quota when mount rejects', async () => {
 const { host, deps } = setup(); deps.mount.mockRejectedValueOnce(new Error('mount'))
 await expect(host.open(owner(), input)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(deps.refresh).not.toHaveBeenCalled()
 await host.open(owner(), input)
})
it('closes an errored modal and refreshes the caller', async () => {
 const { host, deps, current } = setup(); await host.open(owner(), input); host.fail(current().id, 'x'); expect(current().state).toBe('error'); await host.close(current().id); expect(deps.refresh).toHaveBeenCalledTimes(1)
})
it('allows 10 accepted opens per widget per minute across remounts', async () => {
 const { host, deps, current } = setup(); deps.mount.mockRejectedValueOnce(new Error('failed'))
 await expect(host.open(owner(), input)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
 for (let i = 0; i < 10; i++) { await host.open(owner('w1', `compact-${i}`), input); await host.close(current().id) }
 await expect(host.open(owner(), input)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
 await host.open(owner('w2'), input); await host.close(current().id); await vi.advanceTimersByTimeAsync(60000); await host.open(owner(), input)
})
it('rejects new tracked calls from both surfaces while closing', async () => {
 const { host, current } = setup(); const gate = deferred(); await host.open(owner(), input); const id = current().id
 const write = host.track(id, () => gate.promise); const close = host.close(id); const run = vi.fn(async () => {})
 for (const surface of [id, 'compact']) await expect(host.track(surface, run)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
 expect(run).not.toHaveBeenCalled(); gate.resolve(); await write; await close
})
it('refreshes after a rejected write', async () => {
 const { host, deps, current } = setup(); const gate = deferred(); await host.open(owner(), input)
 const write = host.track(current().id, () => gate.promise); const rejected = expect(write).rejects.toThrow('write'); const close = host.close(current().id); gate.reject(new Error('write')); await rejected; await close; expect(deps.refresh).toHaveBeenCalledTimes(1)
})
it('notices and refreshes once after the drain deadline', async () => {
 const { host, deps, current } = setup(); const gate = deferred(); await host.open(owner(), input)
 const write = host.track('compact', () => gate.promise); const close = host.close(current().id)
 await vi.advanceTimersByTimeAsync(4999); expect(deps.refresh).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); await close
 expect(deps.notice).toHaveBeenCalledTimes(1); expect(deps.refresh).toHaveBeenCalledTimes(1); gate.resolve(); await write; expect(deps.refresh).toHaveBeenCalledTimes(1)
})
it('removeCaller during mount cancels the open without refresh', async () => {
 const { host, deps, current } = setup(); const gate = deferred(); deps.mount.mockImplementationOnce(() => gate.promise)
 const open = host.open(owner(), input); const rejected = expect(open).rejects.toMatchObject({ code: 'UNAVAILABLE' }); const old = current(); host.removeCaller('w1')
 await host.open(owner('w2'), input); const replacement = current(); gate.resolve(); await rejected
 expect(current()).toBe(replacement); expect(deps.refresh).not.toHaveBeenCalled(); expect(deps.dispose).toHaveBeenCalledWith(old)
})
it('removeCaller during refreshing cancels the restart', async () => {
 const { host, deps, current } = setup(); const gate = deferred(); deps.refresh.mockImplementationOnce(() => gate.promise); await host.open(owner(), input)
 const close = host.close(current().id); await vi.advanceTimersByTimeAsync(0); expect(current().state).toBe('refreshing'); host.removeCaller('w1'); await host.open(owner('w2'), input); const replacement = current(); gate.resolve(); await close; expect(current()).toBe(replacement)
})
it('ignores a close from an earlier generation', async () => {
 const { host, deps, current } = setup(); await host.open(owner(), input); const old = current().id; await host.close(old); await host.open(owner(), input); const next = current(); await host.close(old); expect(current()).toBe(next); expect(deps.refresh).toHaveBeenCalledTimes(1)
})
it('keeps two instances of one package independent', async () => {
 const { host, deps, current } = setup(); await host.open(owner(), input); host.removeCaller('w2'); await host.close(current().id); expect(deps.refresh).toHaveBeenCalledExactlyOnceWith(owner())
 await host.open(owner('w2'), input); await host.close(current().id); expect(deps.refresh).toHaveBeenLastCalledWith(owner('w2'))
})
it('dispose cancels pending and mounted modals without refresh', async () => {
 const pending = setup(); const gate = deferred(); pending.deps.mount.mockImplementationOnce(() => gate.promise); const open = pending.host.open(owner(), input); const rejected = expect(open).rejects.toMatchObject({ code: 'UNAVAILABLE' }); pending.host.dispose(); gate.resolve(); await rejected
 expect(pending.deps.refresh).not.toHaveBeenCalled(); await expect(pending.host.open(owner(), input)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
 const mounted = setup(); await mounted.host.open(owner(), input); mounted.host.dispose(); mounted.host.dispose(); expect(mounted.deps.dispose).toHaveBeenCalledTimes(1); expect(mounted.deps.refresh).not.toHaveBeenCalled(); expect(mounted.deps.onChange).toHaveBeenLastCalledWith(null)
})
