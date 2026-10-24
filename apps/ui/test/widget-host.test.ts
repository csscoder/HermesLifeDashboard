import { readFileSync } from 'node:fs'
import { ModuleKind, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { afterEach, expect, it, vi } from 'vitest'
import * as gateway from '@lifedashboard/contracts/widget-gateway'
import { compileSfc } from './helpers/sfc-renderer'
import { useWidgetContext } from '../app/widgets/context'

interface HostNode {
  tag: string
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  open: boolean
  showModal(): void
  close(): void
  focus: ReturnType<typeof vi.fn>
  contentWindow: { postMessage: ReturnType<typeof vi.fn> }
}
const node = (tag: string, text = ''): HostNode => ({ tag, text, props: {}, children: [], parent: null, open: false, showModal() { this.open = true }, close() { this.open = false }, focus: vi.fn(), contentWindow: { postMessage: vi.fn() } })
const renderer = Vue.createRenderer<HostNode, HostNode>({
  createElement: node, createText: (text) => node('#text', text), createComment: (text) => node('#comment', text),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  parentNode: (el) => el.parent, nextSibling: (el) => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el)
    el.parent = parent
  },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null },
})
const apps: ReturnType<typeof renderer.createApp>[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function mount(component: Vue.Component) {
  const root = node('root')
  const app = renderer.createApp(component)
  apps.push(app)
  app.mount(root)
  const nodes = (el = root): HostNode[] => [el, ...el.children.flatMap((child) => nodes(child))]
  return { app, nodes, text: () => nodes().map((el) => el.text).join('\n') }
}

it('pauses an offscreen widget and a hidden tab, resumes only when both are visible, and disconnects on unmount', async () => {
  const document = { visibilityState: 'visible', documentElement: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px', getPropertyValue: () => '' }))
  let report!: (entries: Partial<IntersectionObserverEntry>[]) => void
  const observe = vi.fn(), disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof report) { report = callback }
    observe = observe
    unobserve = vi.fn()
    disconnect = disconnect
  })
  const frame = {} as Element
  let context!: gateway.WidgetContext
  const mounted = mount({ setup() {
    context = useWidgetContext({ size: () => ({ w: 3, h: 3 }), themeId: () => 'builtin:paper', foreign: () => false,
      config: () => ({}), frame: () => frame, frameMode: () => 'framed' })
    return () => Vue.h('div')
  } })
  await Vue.nextTick()
  expect(context.visible).toBe(false)
  expect(observe).toHaveBeenCalledWith(frame)
  report([{ target: frame, isIntersecting: true, intersectionRatio: 0 }])
  expect(context.visible).toBe(true)
  report([{ target: frame, isIntersecting: true, intersectionRatio: 1 }])
  expect(context.visible).toBe(true)
  const onVisibility = document.addEventListener.mock.calls.find(([event]) => event === 'visibilitychange')![1]
  document.visibilityState = 'hidden'; onVisibility()
  expect(context.visible).toBe(false)
  report([{ target: frame, isIntersecting: false, intersectionRatio: 0 }])
  document.visibilityState = 'visible'; onVisibility()
  expect(context.visible).toBe(false)
  report([{ target: frame, isIntersecting: true, intersectionRatio: 0.5 }])
  expect(context.visible).toBe(true)
  mounted.app.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('renders and copies an installed widget exception with its exact package version as text', async () => {
  let hello!: () => void
  let onError!: (message: string) => void
  const sources: unknown[] = []
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
  vi.stubGlobal('navigator', { clipboard })
  const { descriptor } = parse(readFileSync(new URL('../app/widgets/SandboxWidget.vue', import.meta.url), 'utf8'))
  const code = transpileModule(compileScript(descriptor, { id: 'sandbox-host-test', inlineTemplate: true }).content,
    { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  const modules: Record<string, unknown> = {
    vue: Vue, '@lifedashboard/contracts/widget-gateway': gateway,
    '../api': { api: {} }, '../confirmations': { cancelSurfaceConfirmations() {}, requestConfirmation() {} }, '../toasts': { showToast() {} },
    './modals': { widgetModals: { track: (_id: string, run: () => Promise<unknown>) => run(), registerSurface: () => () => {}, ready() {}, fail() {} } },
    './broker': {
      createGatewayClient: (deps: { source?: unknown }) => { sources.push(deps.source); return { start: async () => true, close: async () => {}, call: async () => null } },
      listenForHello: (_frame: unknown, callback: () => void) => { hello = callback; return () => {} },
      createBridge: (_port: unknown, deps: { onError(message: string): void }) => { onError = deps.onError; return { close() {}, push() {} } },
    },
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', code)((id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected import ${id}`)
    return modules[id]
  }, exports)
  const context: gateway.WidgetContext = { size: { w: 3, h: 3 }, sizeClass: 's', frame: 'framed', rootFontSize: 16,
    theme: { id: 'builtin:paper', scheme: 'light', tokens: {} }, config: {}, locale: 'en', visible: true }
  const host = mount({ render: () => Vue.h(exports.default!, { widgetId: 'widget', hash: 'hash', title: 'Probe', packageId: 'dev.test.probe', version: '1.2.3', context }) })
  await Vue.nextTick(); await Vue.nextTick(); hello()
  expect(sources).toEqual([{ kind: 'package', packageId: 'dev.test.probe', version: '1.2.3' }])
  onError('Error: <script>API schema changed</script>')
  await Vue.nextTick()
  expect(host.text()).toContain('dev.test.probe@1.2.3')
  expect(host.text()).toContain('Error: <script>API schema changed</script>')
  expect(host.nodes().every((el) => el.props.innerHTML === undefined)).toBe(true)
  const copy = host.nodes().find((el) => el.tag === 'button' && el.text === 'Копировать ошибку')!
  await copy.props.onClick()
  expect(clipboard.writeText).toHaveBeenCalledWith('dev.test.probe@1.2.3\nError: <script>API schema changed</script>')
  const retry = host.nodes().find((el) => el.tag === 'button' && el.text === 'Повторить')!
  await retry.props.onClick(); await Vue.nextTick()
  expect(host.text()).not.toContain('API schema changed')
})

// Compile the real host; replace only HTTP and the browser window handshake registration.
async function surfaceFixture(hosts = false, options: { holdModalStart?: boolean; dialog?: boolean } = {}) {
  const broker = await import('../app/widgets/broker')
  const { createDashboardModals } = await import('../app/widgets/modals')
  const controller = createDashboardModals()
  const sessions: string[] = [], ended: string[] = [], requests: { op: string; token: string }[] = []
  let releaseModalStart!: () => void
  const modalStart = new Promise<void>(resolve => { releaseModalStart = resolve })
  let heldGateway: Promise<any> | null = null
  let evict: string | undefined
  const api = {
    createWidgetSession: async () => { const token = `host-secret-${sessions.length}`; sessions.push(token); if (options.holdModalStart && token === 'host-secret-1') await modalStart; return { ok: true as const, data: { widgetSession: token, grants: ['state'] } } },
    endWidgetSession: async (token: string) => { ended.push(token); return { ok: true as const, data: {} } },
    gateway: async (op: string, token: string) => {
      requests.push({ op, token })
      if (heldGateway) { const pending = heldGateway; heldGateway = null; return pending }
      if (token === evict) { evict = undefined; return { ok: false as const, kind: 'session-expired' as const } }
      return { ok: true as const, data: { data: null, revision: 0 } }
    },
    declineConfirmation: async () => ({ ok: true as const, data: {} }),
  }
  const hellos: (() => void)[] = []
  const { descriptor } = parse(readFileSync(new URL('../app/widgets/SandboxWidget.vue', import.meta.url), 'utf8'))
  const code = transpileModule(compileScript(descriptor, { id: 'surface-test', inlineTemplate: true }).content, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  const modules: Record<string, unknown> = {
    vue: Vue, '@lifedashboard/contracts/widget-gateway': gateway,
    '@lifedashboard/contracts/widget-modal': await import('@lifedashboard/contracts/widget-modal'),
    '../api': { api }, '../confirmations': await import('../app/confirmations'), '../toasts': { showToast() {} },
    './modals': { widgetModals: controller },
    './broker': { ...broker, listenForHello: (_frame: unknown, callback: () => void) => { hellos.push(callback); return () => {} } },
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', code)((id: string) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id] }, exports)
  const context = Vue.reactive<gateway.WidgetContext>({ size: { w: 3, h: 3 }, sizeClass: 's', frame: 'framed', rootFontSize: 16, theme: { id: 'builtin:paper', scheme: 'light', tokens: {} }, config: {}, locale: 'en', visible: false })
  if (!hosts) controller.registerCaller({ owner: { widgetId: 'widget', runtimeId: 'widget', hash: 'hash', title: 'Probe', packageId: 'dev.test', version: '1' }, context: () => context, restart: async () => {} })
  let Host: Vue.Component | undefined
  if (hosts) {
    vi.stubGlobal('document', { visibilityState: 'visible', documentElement: {}, addEventListener() {}, removeEventListener() {}, querySelector: vi.fn(() => fallback) })
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px', getPropertyValue: () => '' }))
    const { descriptor } = parse(readFileSync(new URL('../app/widgets/WidgetHost.vue', import.meta.url), 'utf8'))
    const hostCode = transpileModule(compileScript(descriptor, { id: 'real-widget-host', inlineTemplate: true }).content, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
    const hostExports: { default?: Vue.Component } = {}
    const hostModules = { ...modules,
      '@lifedashboard/contracts/widget-settings': await import('@lifedashboard/contracts/widget-settings'),
      '@lifedashboard/widget-sdk': await import('@lifedashboard/widget-sdk'),
      './catalog': { describeSource: () => ({ title: 'Probe', hash: 'hash' }) },
      './context': { useWidgetContext }, './registry': { builtinWidgetRenderers: new Map() },
      './secret-flags': { useSecretFlags: () => Vue.ref(new Set()) },
      './SandboxWidget.vue': { ...exports, __esModule: true },
      './WidgetFrame.vue': { __esModule: true, default: Vue.defineComponent({ setup(_props, { slots }) { return () => Vue.h('section', slots.default?.()) } }) },
    } as Record<string, unknown>
    new Function('require', 'exports', hostCode)((id: string) => { if (!(id in hostModules)) throw new Error(`Unexpected import ${id}`); return hostModules[id] }, hostExports)
    Host = hostExports.default
  }
  if (!hosts) await controller.open('widget', { view: 'workspace' })
  const modalVisible = Vue.ref(true)
  const fallback = node('fallback')
  if (options.dialog) vi.stubGlobal('document', { activeElement: null, querySelector: () => fallback })
  const Dialog = options.dialog ? compileSfc(new URL('../app/widgets/WidgetModal.vue', import.meta.url), {}) : null
  const modalContent = () => modalVisible.value && controller.activeModal.value ? Vue.h(exports.default!, { key: controller.retryVersion.value, widgetId: 'widget', surface: 'modal', surfaceId: 'modal-1', mount: { view: 'workspace', props: { n: 1 } }, hash: 'hash', title: 'Probe', packageId: 'dev.test', version: '1', context: controller.context()! }) : null
  const hostProps = { source: { kind: 'package', packageId: 'dev.test', version: '1' }, size: { w: 3, h: 3 }, themeId: 'builtin:paper' }
  const mounted = mount({ render: () => Vue.h('main', hosts ? [Vue.h(Host!, { ...hostProps, widgetId: 'widget' }), Vue.h(Host!, { ...hostProps, widgetId: 'sibling' })] : [
    Vue.h(exports.default!, { widgetId: 'widget', surfaceId: 'widget', hash: 'hash', title: 'Probe', packageId: 'dev.test', version: '1', context }),
    Dialog ? Vue.h(Dialog, { record: controller.activeModal.value, error: controller.error.value, onClose: controller.close, onRetry: controller.retry }, { default: modalContent }) : modalContent(),
  ]) })
  await Vue.nextTick(); await Vue.nextTick()
  await vi.waitFor(() => expect(mounted.nodes().filter(el => el.tag === 'iframe'), mounted.text()).toHaveLength(options.holdModalStart ? 1 : 2))
  const firstHellos = hellos.splice(0)
  firstHellos.forEach(hello => hello())
  const frames = mounted.nodes().filter(el => el.tag === 'iframe')
  const messages: unknown[][] = [[], []]
  const ports = frames.map((frame, index) => {
    const init = frame.contentWindow.postMessage.mock.calls[0]!
    const port = init[2][0] as MessagePort
    port.onmessage = event => messages[index]!.push(event.data)
    return port
  })
  let id = 0
  async function call(index: number, op: string, input: unknown = {}) {
    const requestId = ++id
    ports[index]!.postMessage({ t: 'req', id: requestId, op, input })
    await vi.waitFor(() => expect(messages[index]!.some((message: any) => message.t === 'res' && message.id === requestId)).toBe(true))
    return messages[index]!.find((message: any) => message.t === 'res' && message.id === requestId) as any
  }
  return { controller, context, sessions, ended, requests, messages, frames, mounted, modalVisible, call, hellos, fallback, ports, firstHellos, releaseModalStart, holdGateway() { let release!: (result: any) => void; heldGateway = new Promise(resolve => { release = resolve }); return release }, evict(token: string) { evict = token }, cleanup() { mounted.app.unmount(); ports.forEach(port => port.close()); controller.dispose() } }
}

it('gives the modal surface its own session and keeps tokens host-only', async () => {
 const f = await surfaceFixture()
 try {
 expect(f.sessions).toHaveLength(2)
 expect(f.frames[1]!.contentWindow.postMessage.mock.calls[0]![0]).toMatchObject({ mount: { view: 'workspace', props: { n: 1 } } })
 for (const frame of f.frames) for (const token of f.sessions) expect(JSON.stringify(frame.contentWindow.postMessage.mock.calls)).not.toContain(token)
 await f.call(0, 'state.get'); await f.call(1, 'state.get')
 expect(f.requests.map(request => request.token)).toEqual(['host-secret-0', 'host-secret-1'])
 for (const token of f.sessions) expect(JSON.stringify(f.messages)).not.toContain(token)
 } finally { f.cleanup() }
})
it('unmounting the modal ends only the modal session', async () => {
 const f = await surfaceFixture()
 try { f.modalVisible.value = false; await Vue.nextTick(); expect(f.ended).toEqual(['host-secret-1']); expect((await f.call(0, 'state.get')).ok).toBe(true) } finally { f.cleanup() }
})
it('recovers an evicted session on one surface without touching the other', async () => {
 const f = await surfaceFixture()
 try {
 f.evict('host-secret-1'); expect((await f.call(1, 'state.get')).ok).toBe(true); await f.call(0, 'state.get')
 expect(f.sessions).toHaveLength(3); expect(f.requests.map(request => request.token)).toEqual(['host-secret-1', 'host-secret-2', 'host-secret-0'])
 } finally { f.cleanup() }
})
it('routes modal.open locally and never to the gateway', async () => {
 const f = await surfaceFixture()
 try {
 const request = f.call(0, 'modal.open')
 // A malformed request still uses local validation, not UNKNOWN_OP from the gateway.
 expect((await request).error.code).toBe('INVALID_INPUT'); expect(f.requests).toEqual([])
 } finally { f.cleanup() }
})
it('remounts only the caller SandboxWidget on restart', async () => {
 const f = await surfaceFixture(true)
 try {
 const board = f.mounted.nodes().find(el => el.tag === 'main')
 expect((await f.call(0, 'modal.open', { view: 'workspace' })).ok).toBe(true)
 const id = f.controller.activeModal.value!.id
 await f.controller.close(id)
 await vi.waitFor(() => { expect(f.sessions).toHaveLength(3); expect(f.mounted.nodes().filter(el => el.tag === 'iframe')).toHaveLength(2); expect(f.hellos).toHaveLength(1) })
 expect(f.mounted.nodes().find(el => el.tag === 'main')).toBe(board)
 const frames = f.mounted.nodes().filter(el => el.tag === 'iframe')
 expect(frames[0]).not.toBe(f.frames[0]); expect(frames[1]).toBe(f.frames[1])
 // Runtime remount retained its WidgetHost registration and can open another modal.
 f.hellos.splice(0).forEach(hello => hello())
 const init = frames[0]!.contentWindow.postMessage.mock.calls[0]!
 const port = init[2][0] as MessagePort
 const replies: any[] = []; port.onmessage = event => replies.push(event.data)
 port.postMessage({ t: 'req', id: 90, op: 'modal.open', input: { view: 'workspace' } })
 await vi.waitFor(() => expect(replies.find(message => message.id === 90)?.ok).toBe(true)); port.close()
 } finally { f.cleanup() }
})
it('returns focus to the new caller iframe, else the board fallback', async () => {
 const f = await surfaceFixture(true)
 try {
 await f.call(0, 'modal.open', { view: 'workspace' }); await f.controller.close(f.controller.activeModal.value!.id)
 await vi.waitFor(() => { expect(f.sessions).toHaveLength(3); expect(f.mounted.nodes().filter(el => el.tag === 'iframe')).toHaveLength(2); expect(f.hellos).toHaveLength(1) })
 expect(f.fallback.focus).toHaveBeenCalled()
 f.hellos.splice(0).forEach(hello => hello())
 const frame = f.mounted.nodes().filter(el => el.tag === 'iframe')[0]!
 expect(frame.focus).toHaveBeenCalledOnce()
 } finally { f.cleanup() }
})
it('keeps dispatched writes alive until drain completes and refuses confirmations arriving during close', async () => {
 const { confirmations } = await import('../app/confirmations')
 for (const result of [{ ok: true, data: { revision: 1 } }, { ok: false, kind: 'confirmation-required', confirmationId: 'late' }]) {
 const f = await surfaceFixture()
 try {
 const release = f.holdGateway()
 f.ports[1]!.postMessage({ t: 'req', id: 77, op: 'state.set', input: { data: {}, expectedRevision: 0 } })
 await vi.waitFor(() => expect(f.requests).toHaveLength(1))
 const closed = f.controller.close('modal-1')
 await new Promise(resolve => setTimeout(resolve, 0))
 expect(f.ended).toEqual([])
 release(result)
 await vi.waitFor(() => { expect(confirmations.value).toEqual([]); expect(f.ended).toEqual(['host-secret-1']) })
 await closed
 } finally { f.cleanup() }
 }
})
it('pushes effective modal context changes over its own MessageChannel', async () => {
 const f = await surfaceFixture()
 try {
 expect(f.frames[1]!.contentWindow.postMessage.mock.calls[0]![0].context).toMatchObject({ frame: 'frameless', visible: true, rootFontSize: 16 })
 f.context.rootFontSize = 23; f.context.locale = 'ru'; f.context.config = { key: { configured: true } }; f.context.theme.tokens = { '--ld-text-primary': '#123456' }
 await vi.waitFor(() => expect(f.messages[1]).toContainEqual({ t: 'context', patch: expect.objectContaining({ frame: 'frameless', visible: true, rootFontSize: 23, locale: 'ru', config: { key: { configured: true } }, theme: expect.objectContaining({ tokens: { '--ld-text-primary': '#123456' } }) }) }))
 } finally { f.cleanup() }
})
it('stops surface documents while draining and ignores an already queued stale handshake', async () => {
 const f = await surfaceFixture()
 try {
 const release = f.holdGateway()
 f.ports[1]!.postMessage({ t: 'req', id: 78, op: 'state.set', input: { data: {}, expectedRevision: 0 } })
 await vi.waitFor(() => expect(f.requests).toHaveLength(1))
 const closed = f.controller.close('modal-1')
 await Vue.nextTick()
 expect(f.mounted.nodes().filter(el => el.tag === 'iframe')).toEqual([])
 f.firstHellos.forEach(hello => hello())
 expect(f.frames.map(frame => frame.contentWindow.postMessage.mock.calls.length)).toEqual([1, 1])
 release({ ok: true, data: { revision: 1 } }); await closed
 } finally { f.cleanup() }
})
it('ends a late-created session after SandboxWidget unmount without attaching a frame', async () => {
 const broker = await import('../app/widgets/broker')
 const { createDashboardModals } = await import('../app/widgets/modals')
 const controller = createDashboardModals()
 let resolveSession!: (value: unknown) => void
 const ended: string[] = []
 const listenForHello = vi.fn()
 const api = {
  createWidgetSession: () => new Promise(resolve => { resolveSession = resolve }),
  endWidgetSession: async (token: string) => { ended.push(token); return { ok: true, data: {} } },
  gateway: async () => ({ ok: true, data: null }), declineConfirmation: async () => ({ ok: true, data: {} }),
 }
 const { descriptor } = parse(readFileSync(new URL('../app/widgets/SandboxWidget.vue', import.meta.url), 'utf8'))
 const code = transpileModule(compileScript(descriptor, { id: 'late-session-test', inlineTemplate: true }).content, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
 const modules: Record<string, unknown> = { vue: Vue, '@lifedashboard/contracts/widget-gateway': gateway, '../api': { api },
 '../confirmations': await import('../app/confirmations'), '../toasts': { showToast() {} }, './modals': { widgetModals: controller }, './broker': { ...broker, listenForHello } }
 const exports: { default?: Vue.Component } = {}
 new Function('require', 'exports', code)((id: string) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id] }, exports)
 const context: gateway.WidgetContext = { size: { w: 3, h: 3 }, sizeClass: 's', frame: 'framed', rootFontSize: 16, theme: { id: 'builtin:paper', scheme: 'light', tokens: {} }, config: {}, locale: 'en', visible: true }
 const mounted = mount({ render: () => Vue.h(exports.default!, { widgetId: 'late', hash: 'hash', title: 'Probe', packageId: 'dev.test', version: '1', context }) })
 mounted.app.unmount(); resolveSession({ ok: true, data: { widgetSession: 'late-secret', grants: [] } })
 await vi.waitFor(() => expect(ended).toEqual(['late-secret']))
 expect(listenForHello).not.toHaveBeenCalled(); expect(mounted.nodes().filter(el => el.tag === 'iframe')).toEqual([]); controller.dispose()
})
it('closes through the SDK modal-close event and ends only the modal session', async () => {
 const f = await surfaceFixture()
 try {
 f.ports[1]!.postMessage({ t: 'modal-close', reason: 'sdk' })
 await vi.waitFor(() => { expect(f.controller.activeModal.value).toBeNull(); expect(f.ended).toEqual(['host-secret-1']) })
 expect(f.sessions).toHaveLength(2)
 } finally { f.cleanup() }
})
it('keeps pending modal startup paused until caller work drains without ending its session early', async () => {
 const f = await surfaceFixture(false, { holdModalStart: true })
 let complete: ((result: unknown) => void) | undefined
 try {
 complete = f.holdGateway()
 f.ports[0]!.postMessage({ t: 'req', id: 81, op: 'state.set', input: { data: {}, expectedRevision: 0 } })
 await vi.waitFor(() => expect(f.requests).toHaveLength(1))
 const closing = f.controller.close('modal-1')
 f.releaseModalStart()
 await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick()
 expect(f.mounted.nodes().filter(el => el.tag === 'iframe')).toEqual([])
 expect(f.hellos).toEqual([])
 expect(f.frames[0]!.contentWindow.postMessage).toHaveBeenCalledOnce()
 expect(f.ended).toEqual([])
 complete({ ok: true, data: { revision: 1 } }); await closing
 expect(f.ended).toEqual(['host-secret-1'])
 } finally { complete?.({ ok: true, data: { revision: 1 } }); f.cleanup() }
})
it('keeps error retry inert through the real dialog and adapter while a modal call drains', async () => {
 const f = await surfaceFixture(false, { dialog: true })
 let complete: ((result: unknown) => void) | undefined
 try {
 complete = f.holdGateway()
 f.ports[1]!.postMessage({ t: 'req', id: 82, op: 'state.set', input: { data: {}, expectedRevision: 0 } })
 await vi.waitFor(() => expect(f.requests).toHaveLength(1))
 f.ports[1]!.postMessage({ t: 'error', message: 'Modal failed' })
 await vi.waitFor(() => expect(f.controller.activeModal.value?.state).toBe('error'))
 const retry = f.mounted.nodes().find(el => el.tag === 'button' && el.text === 'Повторить')!
 const close = f.mounted.nodes().find(el => el.tag === 'button' && el.props['aria-label'] === 'Закрыть')!
 const version = f.controller.retryVersion.value
 close.props.onClick(); await Vue.nextTick()
 // A handler already queued before disabling the control must also be harmless.
 retry.props.onClick(); f.controller.retry('modal-1')
 await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick()
 expect(f.controller.retryVersion.value).toBe(version)
 expect(f.sessions).toHaveLength(2); expect(f.ended).toEqual([])
 expect(f.mounted.nodes().filter(el => el.tag === 'iframe')).toEqual([])
 const remaining = f.mounted.nodes().filter(el => el.tag === 'button' && el.text === 'Повторить')
 expect(remaining.every(el => el.props.disabled === true)).toBe(true)
 complete({ ok: true, data: { revision: 1 } })
 await vi.waitFor(() => { expect(f.controller.activeModal.value).toBeNull(); expect(f.ended).toEqual(['host-secret-1']) })
 } finally { complete?.({ ok: true, data: { revision: 1 } }); f.cleanup() }
})
