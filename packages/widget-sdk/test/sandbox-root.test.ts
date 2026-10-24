import { afterEach, expect, it, vi } from 'vitest'
import type { Component } from 'vue'

const state = vi.hoisted(() => ({ entry: {} as { default?: Component; modals?: Record<string, Component> }, text: '' }))
vi.mock('@lifedashboard/widget-entry', () => ({ get default() { return state.entry.default }, get modals() { return state.entry.modals } }))
// Keep Vue's component lifecycle, props and injection real; adapt only its DOM mount boundary.
vi.mock('vue', async (original) => {
  const vue = await original<typeof import('vue')>()
  type Node = { text: string; children: Node[]; parent?: Node }
  const node = (text = ''): Node => ({ text, children: [] })
  const renderer = vue.createRenderer<Node, Node>({
    createElement: () => node(), createText: node, createComment: node,
    setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text },
    patchProp() {}, parentNode: (el) => el.parent ?? null, nextSibling: () => null,
    insert(el, parent) { parent.children.push(el); el.parent = parent }, remove() {},
  })
  return { ...vue, createApp: (component: Component, props?: Record<string, unknown>) => {
    const app = renderer.createApp(component, props)
    const mount = app.mount
    app.mount = (() => {
      const root = node()
      const result = mount(root)
      const text = (el: Node): string => el.text + el.children.map(text).join('')
      state.text = text(root)
      return result
    }) as typeof app.mount
    return app
  } }
})
const ports: MessagePort[] = []
afterEach(() => {
  for (const port of ports.splice(0)) port.close()
  vi.unstubAllGlobals()
  vi.resetModules()
  state.text = ''
})

async function runtime(mount?: unknown, modals?: Record<string, Component>) {
  const { defineComponent, h } = await import('vue')
  state.entry = { default: defineComponent({ render: () => h('p', 'compact') }), ...(modals ? { modals } : {}) }
  const events = new EventTarget()
  const parent = { postMessage: vi.fn() }
  const style = () => ({ setProperty() {}, removeProperty() {} })
  const html = { style: style() }
  const body = { style: style() }
  const app = { style: style() }
  vi.stubGlobal('window', {})
  vi.stubGlobal('parent', parent)
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('document', { documentElement: html, body, createElement: () => ({}), getElementById: () => app })
  await import('../src/sandbox.ts')
  const { port1, port2 } = new MessageChannel()
  ports.push(port1, port2)
  const messages: any[] = []
  port1.onmessage = (event: MessageEvent) => messages.push(event.data)
  events.dispatchEvent(Object.assign(new Event('message'), {
    source: parent, ports: [port2],
    data: { t: 'ld:init', context: {
      size: { w: 2, h: 2 }, sizeClass: 'm', frame: 'framed', theme: { id: 'test', scheme: 'dark', tokens: {} },
      rootFontSize: 16, config: {}, locale: 'en', visible: true,
    }, ...(mount === undefined ? {} : { mount }) },
  }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { events, messages, html, body, app }
}
async function workspace() {
  const { defineComponent, h } = await import('vue')
  return defineComponent({ props: ['label'], setup: (props) => () => h('p', `modal:${props.label}`) })
}
it('gives html, body and #app the full frame height before the widget loads', async () => {
  const { html, body, app } = await runtime()
  expect([html.style, body.style, app.style].map(style => (style as any).height)).toEqual(['100%', '100%', '100%'])
  expect((body.style as any).margin).toBe('0')
})
it('mounts the selected modal view with its props', async () => {
  await runtime({ view: 'workspace', props: { label: 'Editor' } }, { workspace: await workspace() })
  expect(state.text).toBe('modal:Editor')
})
it('does not mount the default component in a modal', async () => {
  await runtime({ view: 'workspace', props: {} }, { workspace: await workspace() })
  expect(state.text).not.toContain('compact')
})
it('reports a missing registry or view and mounts nothing', async () => {
  for (const registry of [undefined, {}]) {
    vi.resetModules()
    const { messages } = await runtime({ view: 'workspace', props: {} }, registry)
    await vi.waitFor(() => expect(messages).toEqual([expect.objectContaining({ t: 'error' })]))
    expect(state.text).toBe('')
  }
})
it('ignores inherited registry keys', async () => {
  for (const view of ['toString', '__proto__', 'workspace']) {
    vi.resetModules()
    const registry = Object.create({ workspace: await workspace() })
    const { messages } = await runtime({ view, props: {} }, registry)
    await vi.waitFor(() => expect(messages).toEqual([expect.objectContaining({ t: 'error' })]))
    expect(state.text).toBe('')
  }
})
it('forwards unconsumed Escape only', async () => {
  const { events, messages } = await runtime({ view: 'workspace', props: {} }, { workspace: await workspace() })
  const key = (composing = false) => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: composing })
  const element = new EventTarget()
  element.addEventListener('keydown', (event) => event.preventDefault())
  element.addEventListener('keydown', (event) => events.dispatchEvent(event))
  element.dispatchEvent(key())
  events.dispatchEvent(key(true))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(messages).toEqual([])
  events.dispatchEvent(key())
  await vi.waitFor(() => expect(messages).toEqual([{ t: 'modal-close', reason: 'escape' }]))
  vi.resetModules()
  const compact = await runtime()
  compact.events.dispatchEvent(key())
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(compact.messages).toEqual([])
})
