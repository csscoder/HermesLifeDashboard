import { readFileSync } from 'node:fs'
import { ModuleKind, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { afterEach, expect, it, vi } from 'vitest'
import * as gateway from '@lifedashboard/contracts/widget-gateway'
import { useWidgetContext } from '../app/widgets/context'

interface HostNode {
  tag: string
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  contentWindow: { postMessage: ReturnType<typeof vi.fn> }
}
const node = (tag: string, text = ''): HostNode => ({ tag, text, props: {}, children: [], parent: null, contentWindow: { postMessage: vi.fn() } })
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
    '../api': { api: {} }, '../confirmations': { cancelConfirmations() {}, requestConfirmation() {} }, '../toasts': { showToast() {} },
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
