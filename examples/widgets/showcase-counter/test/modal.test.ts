import { afterEach, expect, it } from 'vitest'
import * as Vue from 'vue'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { ModuleKind, transpileModule } from 'typescript'
import { compileScript, parse } from 'vue/compiler-sfc'
import { WidgetError, type Widget } from '@lifedashboard/widget-sdk'
import * as counter from '../src/counter.ts'
// Keep the shipped example tests runnable without the dashboard checkout.
interface Node { tag: string; text: string; props: Record<string, any>; children: Node[]; parent: Node | null }
const node = (tag: string, text = ''): Node => ({ tag, text, props: {}, children: [], parent: null })
const renderer = Vue.createRenderer<Node, Node>({
  createElement: node, createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  patchProp: (el, key, _previous, value) => { el.props[key] = value },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    const at = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(at < 0 ? parent.children.length : at, 0, el); el.parent = parent
  },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null },
})
const apps: ReturnType<typeof renderer.createApp>[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })
function compileSfc(url: URL, modules: Record<string, unknown>): Vue.Component {
  const { descriptor } = parse(readFileSync(url, 'utf8'))
  const script = compileScript(descriptor, { id: 'counter-test', inlineTemplate: true }).content
  const code = transpileModule(script, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    if (!(id in modules)) throw new Error(`Unexpected import ${id}`)
    return modules[id]
  }, exports)
  return exports.default!
}
function mountComponent(component: Vue.Component, props: Record<string, unknown>) {
  const root = node('root'); const app = renderer.createApp(component, props)
  apps.push(app); app.mount(root)
  const descendants = (el: Node): Node[] => [el, ...el.children.flatMap(descendants)]
  const nodes = () => descendants(root)
  const content = (el: Node): string => [el.text, ...el.children.map(content)].join(' ').replace(/\s+/g, ' ').trim()
  return { nodes, text: () => content(root), button: (label: string) => nodes().find(el => el.tag === 'button' && (el.props['aria-label'] === label || content(el) === label))! }
}

const Workspace = compileSfc(new URL('../src/CounterWorkspace.vue', import.meta.url), {
  '@lifedashboard/widget-sdk': { useWidget: () => current, WidgetError },
  './counter.ts': counter,
})
let current: Pick<Widget, 'state' | 'modal' | 'context'>
const settle = async () => { for (let i = 0; i < 8; i++) await nextTick() }
function setup(data: unknown = { count: 8 }) {
  const saved = { data, revision: 2, writes: 0, closes: 0, timeout: false, hold: Promise.resolve() }
  const storage: Widget['state'] = {
    async get<T>() { return { data: structuredClone(saved.data) as T | null, revision: saved.revision } },
    async set(next, revision) {
      saved.writes++
      await saved.hold
      if (revision !== saved.revision) throw new WidgetError('CONFLICT')
      saved.data = structuredClone(next); saved.revision++
      if (saved.timeout) throw new WidgetError('TIMEOUT')
      return { revision: saved.revision }
    },
  }
  current = { state: storage, context: { config: { title: 'Focus sessions', goal: 12 } } as Widget['context'], modal: {
    async close() { saved.closes++ }, async open() {},
  } }
  const view = mountComponent(Workspace, {})
  const edit = async (value: number) => {
    const input = view.nodes().find(node => node.tag === 'input')!
    input.props.onInput({ target: { value: String(value) } }); await settle()
  }
  const save = () => view.button('Save progress').props.onClick()
  return { saved, storage, view, edit, save }
}
it('saves the edited count and the fresh counter reads it', async () => {
  const { saved, storage, view, edit, save } = setup()
  await settle(); expect(view.text()).toContain('12')
  await edit(9); await save(); await settle()
  expect([saved.data, saved.revision, saved.closes]).toEqual([{ count: 9 }, 3, 1])
  const fresh = counter.createCounter(storage); await fresh.load()
  expect(fresh.state.count).toBe(9)
})
it('refuses malformed persisted state', async () => {
  const { saved, view, edit, save } = setup({ count: '8' })
  await settle(); await edit(9); await save()
  expect([saved.writes, saved.closes, saved.data]).toEqual([0, 0, { count: '8' }])
  expect(view.text()).toContain('invalid')
})
it.each([-1, 1.5, 2 ** 53])('rejects invalid counts: %s', async (value) => {
  const { saved, view, edit, save } = setup()
  await settle(); await edit(value); await save(); await settle()
  expect([saved.writes, saved.closes]).toEqual([0, 0])
  expect(view.text()).toContain('nonnegative safe integer')
})
it('reloads on CONFLICT without overwriting', async () => {
  const { saved, view, edit, save } = setup()
  await settle(); await edit(9)
  saved.data = { count: 14 }; saved.revision = 3
  await save(); await settle()
  expect([saved.data, saved.revision, saved.writes, saved.closes]).toEqual([{ count: 14 }, 3, 1, 0])
  expect(view.nodes().find(node => node.tag === 'input')!.props.value).toBe('14')
  expect(view.text()).toContain('Review')
  await edit(15); await save()
  expect([saved.data, saved.revision, saved.closes]).toEqual([{ count: 15 }, 4, 1])
})
it('stays open and reports an unknown save outcome', async () => {
  const { saved, view, edit, save } = setup()
  await settle(); await edit(9); saved.timeout = true
  await save(); await settle()
  expect([saved.data, saved.closes]).toEqual([{ count: 9 }, 0])
  expect(view.text()).toContain('Save not confirmed')
  await save(); expect(saved.writes).toBe(1)
  await view.button('Reload progress').props.onClick(); await settle()
  expect(view.nodes().find(node => node.tag === 'input')!.props.value).toBe('9')
})
it('ignores repeated save clicks while saving', async () => {
  const { saved, edit, save } = setup()
  await settle(); await edit(9)
  let release!: () => void
  saved.hold = new Promise<void>(resolve => { release = resolve })
  const pending = save(); await save()
  expect(saved.writes).toBe(1)
  release(); await pending
  expect([saved.data, saved.closes]).toEqual([{ count: 9 }, 1])
})
it('does not close before the write completes', async () => {
  const { saved, edit, save } = setup()
  await settle(); await edit(9)
  let release!: () => void
  saved.hold = new Promise<void>(resolve => { release = resolve })
  const pending = save(); await settle()
  expect([saved.data, saved.closes]).toEqual([{ count: 8 }, 0])
  release(); await pending
  expect([saved.data, saved.closes]).toEqual([{ count: 9 }, 1])
})

it('opens the named workspace and reports a rejected open', async () => {
  const { saved } = setup()
  const calls: unknown[][] = []
  current.modal.open = async (...args) => { calls.push(args); throw new WidgetError('UNAVAILABLE') }
  const Compact = compileSfc(new URL('../src/index.vue', import.meta.url), {
    '@lifedashboard/widget-sdk': { useWidget: () => current },
    './counter.ts': counter,
    './CounterWorkspace.vue': { default: Workspace },
  })
  const view = mountComponent(Compact, {})
  await settle()
  expect(view.button('Edit progress')).toBeDefined()
  await view.button('Edit progress').props.onClick(); await settle()
  expect(calls).toEqual([['workspace', { title: 'Focus sessions' }]])
  expect(view.text()).toContain('Could not open workspace')
  expect(saved.writes).toBe(0)
})
