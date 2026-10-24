import { existsSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { nextTick } from 'vue'
import * as host from '../src/host.ts'
import * as widget from '../src/widget.ts'
import * as shell from '../src/dev/shell-state.ts'
import * as grid from '@lifedashboard/contracts/grid'
import * as settings from '@lifedashboard/contracts/widget-settings'
import * as secrets from '@lifedashboard/contracts/widget-secrets'
import * as modal from '@lifedashboard/contracts/widget-modal'
import { SDK_VERSION } from '@lifedashboard/contracts/widget-gateway'
import { API_TIMEOUT_MS } from '../../../apps/ui/app/api.ts'
import { createDevGateway } from '../src/dev/gateway.ts'
import type { DevInfo } from '../src/dev/server.ts'
import { DEV_PATHS } from '../src/dev/server.ts'


import { compileSfc, mountComponent, unmountComponents, type HostNode } from '../../../apps/ui/test/helpers/sfc-renderer.ts'

const component = (name: string) => compileSfc(new URL(`../shell/${name}.vue`, import.meta.url), { '@lifedashboard/contracts/widget-settings': settings, '@lifedashboard/contracts/widget-secrets': secrets })
const modalUrl = new URL('../shell/ModalHost.vue', import.meta.url)
function app(schedule: typeof nextTick = nextTick) {
 return compileSfc(new URL('../shell/App.vue', import.meta.url), {
  '@lifedashboard/contracts/grid': grid, '@lifedashboard/contracts/widget-settings': settings,
  '@lifedashboard/contracts/widget-modal': modal, '../src/host.ts': host, '../src/widget.ts': widget,
  '../src/dev/shell-state.ts': shell,
  './Toolbar.vue': { __esModule: true, default: component('Toolbar') }, './SettingsPanel.vue': { __esModule: true, default: component('SettingsPanel') },
  './LogPanel.vue': { __esModule: true, default: component('LogPanel') },
  './ModalHost.vue': { __esModule: true, default: existsSync(modalUrl) ? compileSfc(modalUrl, {}) : {} },
 }, { ...Vue, nextTick: schedule })
}
const settle = async () => { for (let i = 0; i < 15; i++) { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() } }
const ports: MessagePort[] = []
afterEach(() => { unmountComponents(); for (const port of ports.splice(0)) port.close(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function setup() {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
 const info: DevInfo = { revision: 1, manifest: { id: 'dev.test.modal', version: '1.0.0', title: 'Modal test', author: 'Test', sdk: 4, entry: 'index.js', styles: [], permissions: ['state'], sizing: { default: { w: 4, h: 3 }, min: { w: 1, h: 1 }, max: { w: 8, h: 8 } } }, themes: [{ id: 'builtin:paper', name: 'Paper', mode: 'light', skin: 'paper', tokens: {} }], secrets: {}, settingsProblems: [] }
 const gateway = createDevGateway({ manifest: () => info.manifest, secrets: () => new Map(), log() {} })
 const win = new EventTarget()
 const doc = Object.assign(new EventTarget(), { documentElement: { dataset: {} }, activeElement: null, visibilityState: 'visible' })
 vi.stubGlobal('window', win); vi.stubGlobal('document', doc)
 vi.stubGlobal('navigator', { language: 'en-US' }); vi.stubGlobal('location', { search: '', hash: '' })
 vi.stubGlobal('history', { replaceState() {} }); vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
 vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' })); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
 const routes: string[] = []
 let callGate: Promise<void> | undefined
 let atReset = () => {}
 const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  const route = url.slice(DEV_PATHS.api.length); routes.push(route)
  if (route === 'info') return { ok: true, json: async () => structuredClone(info) }
  if (route === 'call') { await callGate; const body = JSON.parse(init!.body as string); return { ok: true, json: async () => gateway.call(body.op, body.input, body.confirm, body.shell) } }
  if (route === 'reset') { atReset(); gateway.reset() }
  return { ok: true }
 })
 vi.stubGlobal('fetch', fetcher)
 let nextBoundary: Promise<void> | undefined
 const schedule = (() => { const boundary = nextBoundary; nextBoundary = undefined; return nextTick().then(() => boundary) }) as typeof nextTick
 const ui = mountComponent(app(schedule), { paths: DEV_PATHS }, [])
 await settle()
 const frames = () => ui.nodes().filter(node => node.tag === 'iframe')
 const message = (source: unknown, data: unknown) => { const event = new Event('message'); Object.assign(event, { source, data }); win.dispatchEvent(event) }
 function connect(frame: HostNode) {
  const received: any[] = []; let port!: MessagePort
  const source = { postMessage: (data: unknown, _origin: string, transferred: MessagePort[]) => { received.push(data); port = transferred[0]!; ports.push(port); port.onmessage = event => received.push(event.data); port.start() } }
  Object.assign(frame, { contentWindow: source })
  message(source, { t: 'ld:hello', sdk: SDK_VERSION })
  return { source, received, get port() { return port }, async call(op: string, input: unknown = {}) {
   const id = received.length + 1; port.postMessage({ t: 'req', id, op, input }); await settle()
   return received.find(data => data.t === 'res' && data.id === id)
  } }
 }
 const compact = connect(frames()[0]!); await settle()
 return { ui, frames, compact, connect, message, routes, gateway, info, fetcher, doc, holdNextBoundary() { let release!: () => void; nextBoundary = new Promise<void>(resolve => { release = resolve }); return release }, blockCalls() { let release!: () => void; callGate = new Promise<void>(resolve => { release = resolve }); return () => { callGate = undefined; release() } }, onReset(callback: () => void) { atReset = callback } }
}
it('keeps shared dev state across modal save, close and compact remount', async () => {
 const t = await setup()
 expect((await t.compact.call('state.get')).value).toEqual({ data: null, revision: 0 })
 expect(await t.compact.call('modal.open', { view: 'editor', props: { initial: 1 } })).toMatchObject({ ok: true })
 expect(t.frames()).toHaveLength(2)
 const expanded = t.connect(t.frames()[1]!); await settle()
 expect(expanded.received[0]).toMatchObject({ mount: { view: 'editor', props: { initial: 1 } }, context: { frame: 'frameless', locale: 'en-US' } })
 expect(await expanded.call('state.set', { data: { count: 9 }, expectedRevision: 0 })).toMatchObject({ ok: true, value: { revision: 1 } })
 const old = t.frames()[0]!
 expanded.port.postMessage({ t: 'modal-close', reason: 'sdk' }); await settle()
 expect(t.frames()).toHaveLength(1); expect(t.frames()[0]).not.toBe(old)
 const renewed = t.connect(t.frames()[0]!); await settle()
 expect((await renewed.call('state.get')).value).toEqual({ data: { count: 9 }, revision: 1 })
 expect(t.routes).not.toContain('reset')
})
it('pins DEV_MODAL_DRAIN_MS to API_TIMEOUT_MS', () => {
 expect((shell as unknown as { DEV_MODAL_DRAIN_MS: number }).DEV_MODAL_DRAIN_MS).toBe(API_TIMEOUT_MS)
})

async function open(t: Awaited<ReturnType<typeof setup>>) {
 expect(await t.compact.call('modal.open', { view: 'editor' })).toMatchObject({ ok: true })
 const expanded = t.connect(t.frames()[1]!); await settle(); return expanded
}
it('disposes the modal and its port on HMR or full reload', async () => {
 for (const mode of ['revision', 'hello'] as const) {
  const t = await setup(); const expanded = await open(t)
  if (mode === 'revision') { t.info.revision++; await vi.advanceTimersByTimeAsync(2000) }
  else t.message(t.compact.source, { t: 'ld:hello', sdk: SDK_VERSION })
  await settle()
  expect(t.frames()).toHaveLength(1)
  expect(expanded.received).toContainEqual({ t: 'close' })
  unmountComponents()
 }
})
it('ignores unknown and stale frame messages', async () => {
 const t = await setup(); const expanded = await open(t)
 // Unknown source rejection characterizes the existing compact source check.
 t.message({}, { t: 'ld:dev', kind: 'error', message: 'forged' }); await settle()
 expect(t.ui.text()).not.toContain('forged')
 t.info.revision++; await vi.advanceTimersByTimeAsync(2000); await settle()
 t.message(expanded.source, { t: 'ld:dev', kind: 'error', message: 'stale modal report' })
 t.message(expanded.source, { t: 'ld:hello', sdk: SDK_VERSION }); await settle()
 expect(t.ui.text()).not.toContain('stale modal report'); expect(t.frames()).toHaveLength(1)
})
it('invalidates the modal before dev reset clears gateway state', async () => {
 const t = await setup(); const expanded = await open(t)
 await expanded.call('state.set', { data: { count: 9 }, expectedRevision: 0 })
 let modalAtReset = true
 t.onReset(() => { modalAtReset = t.frames().some(frame => frame.props.title === 'Widget modal') })
 t.ui.button('Сбросить состояние').props.onClick(); await settle()
 expect(modalAtReset).toBe(false)
 expect(expanded.received).toContainEqual({ t: 'close' })
 expect(t.frames()).toHaveLength(1)
 const compact = t.connect(t.frames()[0]!); await settle()
 expect((await compact.call('state.get')).value).toEqual({ data: null, revision: 0 })
})
it('retains opening quotas across compact refresh', async () => {
 // Characterization: quotas belong to the existing shared controller, not a frame session.
 const t = await setup(); let compact = t.compact
 for (let index = 0; index < 10; index++) {
  expect(await compact.call('modal.open', { view: 'editor' })).toMatchObject({ ok: true })
  const expanded = t.connect(t.frames()[1]!); await settle()
  expanded.port.postMessage({ t: 'modal-close', reason: 'sdk' }); await settle()
  compact = t.connect(t.frames()[0]!); await settle()
 }
 expect(await compact.call('modal.open', { view: 'editor' })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
})
it('cleans up on shell unmount', async () => {
 // Characterization of controller disposal already required for the initial implementation.
 const t = await setup(); const expanded = await open(t)
 const calls = t.routes.length
 unmountComponents(); await settle()
 expect(expanded.received).toContainEqual({ t: 'close' })
 expect(t.compact.received).toContainEqual({ t: 'close' })
 await vi.advanceTimersByTimeAsync(10000)
 t.message(expanded.source, { t: 'ld:hello', sdk: SDK_VERSION }); await settle()
 expect(t.routes).toHaveLength(calls)
})
it('pauses both documents during drain and prevents retry or hello from attaching', async () => {
 const t = await setup(); const expanded = await open(t)
 const release = t.blockCalls()
 expanded.port.postMessage({ t: 'req', id: 90, op: 'state.set', input: { data: { count: 9 }, expectedRevision: 0 } }); await settle()
 expanded.port.postMessage({ t: 'error', message: 'View failed' }); await settle()
 const retry = t.ui.button('Retry')
 expect(retry).toBeDefined()
 t.ui.button('Close modal').props.onClick(); await settle()
 expect(t.frames()).toHaveLength(0)
 expect(expanded.received).toContainEqual({ t: 'close' }); expect(t.compact.received).toContainEqual({ t: 'close' })
 retry.props.onClick()
 t.message(expanded.source, { t: 'ld:hello', sdk: SDK_VERSION }); await settle()
 expect(t.frames()).toHaveLength(0)
 release(); await settle()
 expect(t.frames()).toHaveLength(1)
 const compact = t.connect(t.frames()[0]!); await settle()
 expect((await compact.call('state.get')).value).toEqual({ data: { count: 9 }, revision: 1 })
})
it('bounds drain at 5000ms and explicitly reports uncertain completion', async () => {
 const t = await setup(); const expanded = await open(t); const release = t.blockCalls()
 expanded.port.postMessage({ t: 'req', id: 90, op: 'state.get', input: {} }); await settle()
 t.ui.button('Close modal').props.onClick(); await settle()
 await vi.advanceTimersByTimeAsync(4999); await settle()
 expect(t.frames()).toHaveLength(0)
 await vi.advanceTimersByTimeAsync(1); await settle()
 expect(t.frames()).toHaveLength(1); expect(t.ui.text()).toContain('Some widget calls may still be completing')
 release(); await settle()
})
it('propagates context and visibility to the modal independently of the compact frame', async () => {
 const t = await setup(); const expanded = await open(t)
 const width = t.ui.nodes().find(node => node.tag === 'input' && node.props['aria-label'] === 'w')!
 width.props.onChange({ target: { value: '5' } }); await settle()
 expect(expanded.received).toContainEqual(expect.objectContaining({ t: 'context', patch: expect.objectContaining({ frame: 'frameless', size: { w: 5, h: 3 } }) }))
 t.doc.visibilityState = 'hidden'; t.doc.dispatchEvent(new Event('visibilitychange')); await settle()
 expect(expanded.received).toContainEqual(expect.objectContaining({ t: 'context', patch: expect.objectContaining({ visible: false }) }))
 expect(t.compact.received[0].context.frame).toBe('framed')
})
it('does not resurrect a caller removed during asynchronous refresh', async () => {
 const t = await setup(); const expanded = await open(t)
 expanded.port.postMessage({ t: 'modal-close', reason: 'sdk' })
 // Queue invalidation in the same turn as the controller refresh continuation.
 t.info.revision++; await vi.advanceTimersByTimeAsync(2000)
 unmountComponents(); await settle()
 expect(t.frames()).toHaveLength(0)
 expect(expanded.received).toContainEqual({ t: 'close' })
})

it('does not remount a replaced caller when an old refresh continuation resumes', async () => {
 const t = await setup(); const oldModal = await open(t)
 const resume = t.holdNextBoundary()
 oldModal.port.postMessage({ t: 'modal-close', reason: 'sdk' }); await settle()
 expect(t.frames()).toHaveLength(0)
 t.info.revision++; await vi.advanceTimersByTimeAsync(2000); await settle()
 const replacement = t.frames()[0]!
 const compact = t.connect(replacement); await settle()
 expect(await compact.call('modal.open', { view: 'editor', props: { fresh: true } })).toMatchObject({ ok: true })
 const currentModal = t.frames()[1]!
 resume(); await settle()
 expect(t.frames()[0]).toBe(replacement)
 expect(t.frames()[1]).toBe(currentModal)
})
it('revokes the failed modal source immediately when retry replaces its frame', async () => {
 const t = await setup(); const expanded = await open(t)
 expanded.port.postMessage({ t: 'error', message: 'View failed' }); await settle()
 t.ui.button('Retry').props.onClick()
 t.message(expanded.source, { t: 'ld:hello', sdk: SDK_VERSION })
 await settle()
 expect(expanded.received.filter(data => data.t === 'ld:init')).toHaveLength(1)
 expect(expanded.received).toContainEqual({ t: 'close' })
 const replacement = t.connect(t.frames()[1]!); await settle()
 expect(replacement.received[0].mount.view).toBe('editor')
})
it('does not attach a pending retry after closing begins', async () => {
 const t = await setup(); const expanded = await open(t)
 expanded.port.postMessage({ t: 'error', message: 'View failed' }); await settle()
 const resume = t.holdNextBoundary()
 t.ui.button('Retry').props.onClick(); await settle()
 const releaseCall = t.blockCalls()
 t.compact.port.postMessage({ t: 'req', id: 90, op: 'state.get', input: {} }); await settle()
 t.ui.button('Close modal').props.onClick(); await settle()
 resume(); await settle()
 expect(t.frames()).toHaveLength(0)
 releaseCall(); await settle()
 expect(t.frames()).toHaveLength(1)
})
it('keeps late dispatched-call completion from creating effects after unmount', async () => {
 const t = await setup()
 t.info.manifest.permissions.push('notifications')
 const release = t.blockCalls()
 t.compact.port.postMessage({ t: 'req', id: 90, op: 'notifications.send', input: { title: 'Late notification', body: '' } }); await settle()
 unmountComponents(); await settle()
 expect(vi.getTimerCount()).toBe(0)
 release(); await settle()
 expect(vi.getTimerCount()).toBe(0)
})
it('rejects a removed modal source before Vue detaches the old iframe', async () => {
 const t = await setup(); const expanded = await open(t)
 t.ui.button('Сбросить состояние').props.onClick()
 t.message(expanded.source, { t: 'ld:hello', sdk: SDK_VERSION })
 await settle()
 expect(t.compact.received.filter(data => data.t === 'ld:init')).toHaveLength(1)
 expect(expanded.received.filter(data => data.t === 'ld:init')).toHaveLength(1)
})

it('restores a fresh compact preview after a rejected reset without restoring its modal or clearing state', async () => {
 const t = await setup(); const expanded = await open(t)
 await expanded.call('state.set', { data: { count: 9 }, expectedRevision: 0 })
 const old = t.frames()[0]!
 t.onReset(() => { throw new Error('Reset offline') })
 t.ui.button('Сбросить состояние').props.onClick(); await settle()
 expect(t.ui.text()).toContain('Reset offline')
 expect(t.frames()).toHaveLength(1)
 expect(t.frames()[0] === old).toBe(false)
 expect(expanded.received).toContainEqual({ t: 'close' })
 const fresh = t.connect(t.frames()[0]!); await settle()
 expect((await fresh.call('state.get')).value).toEqual({ data: { count: 9 }, revision: 1 })
 await vi.advanceTimersByTimeAsync(2000); await settle()
 expect(t.ui.text()).not.toContain('Reset offline')
 expect(t.frames()).toHaveLength(1)
 expect(t.routes.filter(route => route === 'reset')).toHaveLength(1)
})
