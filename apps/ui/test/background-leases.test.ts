import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundLeases } from '../app/background/use-media-leases'
import { mountComponent, unmountComponents } from './helpers/sfc-renderer'

interface Call { body: any; method: string; url: string; resolve: (response: Response) => void }
let calls: Call[]
beforeEach(() => {
  calls = []; vi.useFakeTimers()
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => new Promise<Response>(resolve => calls.push({ url, method: init.method!, body: init.body && JSON.parse(String(init.body)), resolve })))
})
afterEach(async () => { unmountComponents(); for (const call of calls) call.resolve(new Response(JSON.stringify({ data: null }))); await settle(); vi.useRealTimers(); vi.unstubAllGlobals() })
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); await nextTick() }
function mounted(initial: string[]) {
  const ids = ref(initial), notices: (string | null)[] = []
  mountComponent(defineComponent({ setup() { useBackgroundLeases(() => ids.value, message => notices.push(message)); return () => h('div') } }), {}, [])
  return { ids, notices }
}
const complete = async (index: number, status = 200) => {
  calls[index]!.resolve(new Response(JSON.stringify(status === 200 ? { data: null } : { error: { code: 'ERROR' } }), { status }))
  await settle()
}
describe('background media leases', () => {
  it('skips never-acquired empty sets and deduplicates/sorts IDs with one stable lease UUID', async () => {
    const ui = mounted([]); await settle(); expect(calls).toEqual([])
    ui.ids.value = ['b', 'a', 'b']; await settle()
    expect(calls[0]!.body.videoIds).toEqual(['a', 'b'])
    expect(calls[0]!.body.leaseId).toMatch(/^[0-9a-f-]{36}$/)
    const leaseId = calls[0]!.body.leaseId
    await complete(0)
    ui.ids.value = ['b', 'a']; await settle(); expect(calls).toHaveLength(1)
    ui.ids.value = ['c']; await settle(); expect(calls[1]!.body).toEqual({ leaseId, videoIds: ['c'] })
  })
  it('serializes updates and skips obsolete intermediate ID sets behind a slow request', async () => {
    const ui = mounted(['a']); await settle()
    ui.ids.value = ['b']; await nextTick(); ui.ids.value = ['c']; await settle()
    expect(calls).toHaveLength(1)
    await complete(0)
    expect(calls).toHaveLength(2); expect(calls[1]!.body.videoIds).toEqual(['c'])
    await complete(1)
    ui.ids.value = []; await settle()
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: `/api/v1/background-media/leases/${calls[0]!.body.leaseId}` })
  })
  it('renews every minute and retries failed acquire before clearing only its lease notice on success', async () => {
    const ui = mounted(['a']); await settle(); await complete(0, 500)
    expect(ui.notices.at(-1)).toMatch(/защитить/)
    await vi.advanceTimersByTimeAsync(60000); await settle()
    expect(calls).toHaveLength(2)
    await complete(1)
    expect(ui.notices.at(-1)).toBe(null)
    await vi.advanceTimersByTimeAsync(60000); await settle(); expect(calls).toHaveLength(3)
    expect(calls[2]!.body).toEqual(calls[1]!.body)
  })
  it('releases after in-flight renewal finishes on unmount without notices or late reacquire', async () => {
    const ui = mounted(['a']); await settle()
    unmountComponents(); ui.ids.value = ['b']; await settle()
    expect(calls).toHaveLength(1)
    await complete(0)
    expect(calls).toHaveLength(2); expect(calls[1]!.method).toBe('DELETE')
    await complete(1); await vi.advanceTimersByTimeAsync(120000); await settle()
    expect(calls).toHaveLength(2); expect(ui.notices).toEqual([])
  })
  it('releases a possibly committed failed acquire when the component unmounts', async () => {
    const ui = mounted(['a']); await settle(); await complete(0, 500)
    expect(ui.notices).toHaveLength(1)
    unmountComponents(); await settle()
    expect(calls).toHaveLength(2); expect(calls[1]!.method).toBe('DELETE')
    await complete(1, 500)
    await vi.advanceTimersByTimeAsync(60000); await settle()
    expect(calls).toHaveLength(2); expect(ui.notices).toHaveLength(1)
  })
  it('cleans an uncertain failed acquire on unmount and retries a failed empty-set release', async () => {
    const ui = mounted(['a']); await settle(); await complete(0, 500)
    ui.ids.value = []; await settle(); expect(calls[1]!.method).toBe('DELETE')
    await complete(1, 500)
    await vi.advanceTimersByTimeAsync(60000); await settle(); expect(calls[2]!.method).toBe('DELETE')
    await complete(2)
    await vi.advanceTimersByTimeAsync(60000); await settle(); expect(calls).toHaveLength(3)
  })
})
