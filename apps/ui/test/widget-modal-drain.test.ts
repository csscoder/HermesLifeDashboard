import { afterEach, expect, it, vi } from 'vitest'
import { createModalHost, type ModalRecord } from '../../../packages/widget-sdk/src/modal-host'
import { apiRequest } from '../app/api'
import { createGatewayClient } from '../app/widgets/broker'

afterEach(() => vi.unstubAllGlobals())
it.each(['timeout', 'conflict', 'declined'] as const)('drains a real gateway %s with exactly one refresh and uncertainty only for timeout', async (outcome) => {
 let started!: () => void
 const dispatched = new Promise<void>(resolve => { started = resolve })
 vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => ({
  ok: false, status: outcome === 'conflict' ? 409 : 428,
  json: () => {
   started()
   if (outcome !== 'timeout') return Promise.resolve({ error: { code: 'CONFIRMATION_REQUIRED', confirmationId: 'confirmation' } })
   return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))
  },
 }))
 const client = createGatewayClient({ widgetId: 'w1', api: {
  createWidgetSession: async () => ({ ok: true, data: { widgetSession: 'session' } }),
  endWidgetSession: async () => ({ ok: true, data: null }),
  declineConfirmation: async () => ({ ok: true, data: null }),
  gateway: (op, _token, input) => apiRequest('POST', `/widget-gateway/${op}`, input, 30),
 }, confirm: async () => 'declined', onNotify() {}, onSessionLost() {} })
 let record: ModalRecord | null = null
 const events: string[] = []
 const host = createModalHost({ mount: async () => {}, dispose() { events.push('dispose') }, refresh: async () => { events.push('refresh') }, notice() { events.push('notice') }, onChange(value) { record = value }, drainTimeoutMs: 150 })
 await host.open({ widgetId: 'w1', runtimeId: 'compact', hash: 'hash', packageId: 'pkg', version: '1', title: 'Package' }, { view: 'editor' })
 const call = host.track(record!.id, () => client.call('state.set', { data: { count: 9 }, expectedRevision: 0 }))
 const rejected = expect(call).rejects.toMatchObject({ code: outcome === 'timeout' ? 'UNAVAILABLE' : outcome === 'conflict' ? 'CONFLICT' : 'DECLINED' })
 await dispatched
 const close = host.close(record!.id)
 await Promise.all([close, host.close(record!.id), rejected])
 expect(events).toEqual(outcome === 'timeout' ? ['notice', 'dispose', 'refresh'] : ['dispose', 'refresh'])
 expect(record).toBeNull()
 host.dispose()
})
