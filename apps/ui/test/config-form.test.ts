import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { ModuleKind, transpileModule } from 'typescript'
import * as settings from '@lifedashboard/contracts/widget-settings'
import * as secrets from '@lifedashboard/contracts/widget-secrets'
import * as configForm from '../app/board/config-form'
import { api } from '../app/api'
import { refreshSecretFlags } from '../app/widgets/secret-flags'
import type { PlainSetting, SecretSetting, SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiFailure } from '../app/api'
import { controlFor, parseFieldInput, plainConfig, secretStatusMessage } from '../app/board/config-form'

const text: PlainSetting = { type: 'string', title: 'Title', default: 'Hello', maxLength: 5 }
const choice: PlainSetting = { type: 'string', title: 'Mode', default: 'a', enum: ['a', 'b'] }
const integer: PlainSetting = { type: 'integer', title: 'Count', default: 1, minimum: 1, maximum: 5 }
const number: PlainSetting = { type: 'number', title: 'Scale', default: 1, minimum: 0, maximum: 2 }
const boolean: PlainSetting = { type: 'boolean', title: 'Enabled', default: false }
const secret: SecretSetting = { type: 'secret', title: 'Token', bind: { origin: 'https://example.com', header: 'Authorization' } }

describe('controlFor', () => {
  it.each([
    [text, 'text'], [choice, 'select'], [integer, 'number'],
    [number, 'number'], [boolean, 'checkbox'], [secret, 'secret'],
  ] as const)('maps %j to %s', (setting, control) => {
    expect(controlFor(setting)).toBe(control)
  })
})

describe('parseFieldInput', () => {
  it.each(['0', '1.5', '6', '', '  ', 'NaN', 'Infinity'])('rejects invalid integer input %j', (raw) => {
    expect(parseFieldInput(integer, raw)).toEqual({ ok: false })
  })

  it('parses a valid integer', () => {
    expect(parseFieldInput(integer, '3')).toEqual({ ok: true, value: 3 })
  })

  it('accepts fractional numbers within bounds', () => {
    expect(parseFieldInput(number, '1.5')).toEqual({ ok: true, value: 1.5 })
    expect(parseFieldInput(number, '2.1')).toEqual({ ok: false })
    expect(parseFieldInput(number, '-1')).toEqual({ ok: false })
    expect(parseFieldInput(number, true)).toEqual({ ok: false })
  })

  it('validates strings and enum membership without coercion', () => {
    expect(parseFieldInput(text, 'Hello')).toEqual({ ok: true, value: 'Hello' })
    expect(parseFieldInput(text, '')).toEqual({ ok: true, value: '' })
    expect(parseFieldInput(text, 'Too long')).toEqual({ ok: false })
    expect(parseFieldInput(text, true)).toEqual({ ok: false })
    expect(parseFieldInput(choice, 'b')).toEqual({ ok: true, value: 'b' })
    expect(parseFieldInput(choice, 'c')).toEqual({ ok: false })
  })

  it('accepts checkbox booleans without coercing strings', () => {
    expect(parseFieldInput(boolean, true)).toEqual({ ok: true, value: true })
    expect(parseFieldInput(boolean, false)).toEqual({ ok: true, value: false })
    expect(parseFieldInput(boolean, 'false')).toEqual({ ok: false })
  })
})

describe('plainConfig', () => {
  it('keeps only plain schema keys, dropping secret values and normalized flags without mutation', () => {
    const schema: SettingsSchema = { type: 'object', properties: { title: text, token: secret, otherToken: secret } }
    const config = { title: 'Hello', token: true, otherToken: 'private input', unknown: 42 }
    expect(plainConfig(schema, config)).toEqual({ title: 'Hello' })
    expect(config).toEqual({ title: 'Hello', token: true, otherToken: 'private input', unknown: 42 })
    expect(plainConfig(schema, {})).toEqual({})
  })
})

describe('secretStatusMessage', () => {
  const hint = 'Сохраните доску, чтобы задать секрет'

  it('asks to save for an unsaved instance or a 404', () => {
    expect(secretStatusMessage(null)).toBe(hint)
    expect(secretStatusMessage({ ok: false, kind: 'invalid', code: 'NOT_FOUND', message: 'Not found' })).toBe(hint)
  })

  it('shows the API message for validation and other invalid failures', () => {
    expect(secretStatusMessage({ ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'At least 16 characters' })).toBe('At least 16 characters')
    expect(secretStatusMessage({ ok: false, kind: 'invalid', code: 'FORBIDDEN', message: 'Denied' })).toBe('Denied')
  })

  it.each<ApiFailure>([
    { kind: 'unauthorized' }, { kind: 'session-expired' }, { kind: 'conflict' },
    { kind: 'rate-limited' }, { kind: 'confirmation-required', confirmationId: 'id' },
    { kind: 'upstream', message: 'Unavailable upstream' }, { kind: 'unavailable' },
  ])('shows the generic failure message for $kind', (failure) => {
    expect(secretStatusMessage({ ok: false, ...failure })).toBe('Не удалось сохранить секрет')
  })

  it('has no error message on success', () => {
    expect(secretStatusMessage({ ok: true, data: {} })).toBeNull()
  })
})

describe('required settings', () => {
  it('checks schema.required for plain and secret fields, including absent and empty lists', () => {
    const schema: SettingsSchema = { type: 'object', properties: { title: text, token: secret }, required: ['title', 'token'] }
    expect(configForm.isRequiredSetting(schema, 'title')).toBe(true)
    expect(configForm.isRequiredSetting(schema, 'token')).toBe(true)
    expect(configForm.isRequiredSetting(schema, 'unknown')).toBe(false)
    expect(configForm.isRequiredSetting({ ...schema, required: [] }, 'title')).toBe(false)
    expect(configForm.isRequiredSetting({ type: 'object', properties: schema.properties }, 'token')).toBe(false)
  })
})

describe('mergeConfigField', () => {
  it('keeps two consecutive edits before props update, without mutating the old config or retaining secrets', () => {
    const schema: SettingsSchema = { type: 'object', properties: { title: text, count: integer, token: secret } }
    const original = { title: 'Hello', count: 1, token: true, unknown: 42 }
    const first = configForm.mergeConfigField(schema, original, 'title', 'Hi')
    const second = configForm.mergeConfigField(schema, first, 'count', 3)
    expect(first).toEqual({ title: 'Hi', count: 1 })
    expect(second).toEqual({ title: 'Hi', count: 3 })
    expect(original).toEqual({ title: 'Hello', count: 1, token: true, unknown: 42 })
  })
})

// Compile the real SFC and render with Vue's in-memory host: no DOM or browser dependency.
interface FormNode {
  tag: string
  text: string
  value: string
  props: Record<string, unknown>
  children: FormNode[]
  parent: FormNode | null
  addEventListener(event: string, listener: (event: unknown) => void): void
}
const node = (tag: string, text = ''): FormNode => ({
  tag, text, value: '', props: {}, children: [], parent: null,
  addEventListener(event, listener) { this.props[`on${event[0]!.toUpperCase()}${event.slice(1)}`] = listener },
})
const renderer = Vue.createRenderer<FormNode, FormNode>({
  createElement: node,
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (target, text) => { target.text = text },
  setElementText: (target, text) => { target.text = text; target.children = [] },
  parentNode: (target) => target.parent,
  nextSibling: (target) => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
  patchProp: (target, key, _previous, value) => {
    target.props[key] = value
    if (key === 'value') target.value = String(value)
  },
  insert: (target, parent, anchor) => {
    const old = target.parent?.children
    if (old) old.splice(old.indexOf(target), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
    target.parent = parent
  },
  remove: (target) => {
    const children = target.parent?.children
    if (children) children.splice(children.indexOf(target), 1)
    target.parent = null
  },
})
const { descriptor } = parse(readFileSync(new URL('../app/board/WidgetConfigForm.vue', import.meta.url), 'utf8'))
const compiled = transpileModule(compileScript(descriptor, { id: 'config-form-test', inlineTemplate: true }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText
const componentExports: { default?: Vue.Component } = {}
const modules: Record<string, unknown> = {
  vue: Vue,
  '@lifedashboard/contracts/widget-settings': settings,
  '@lifedashboard/contracts/widget-secrets': secrets,
  '../api': { api }, '../widgets/secret-flags': { refreshSecretFlags }, './config-form': configForm,
}
new Function('require', 'exports', compiled)((id: string) => {
  if (!(id in modules)) throw new Error(`Unexpected SFC import: ${id}`)
  return modules[id]
}, componentExports)
const mounted: ReturnType<typeof renderer.createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

function mountForm(schema: SettingsSchema, config: Record<string, unknown> = {}) {
  const props = Vue.reactive({ schema, config, widgetId: 'saved-widget', secrets: new Set<string>() })
  const change = vi.fn()
  const root = node('root')
  const app = renderer.createApp({ render: () => Vue.h(componentExports.default!, { ...props, onChange: change }) })
  mounted.push(app)
  app.mount(root)
  const nodes = (current = root): FormNode[] => [current, ...current.children.flatMap((child) => nodes(child))]
  const field = (key: string) => nodes().find((item) => item.props.id && String(item.props.id).endsWith(`-${key}`))!
  const edit = (key: string, value: string) => {
    const input = field(key)
    input.value = value
    ;(input.props.onChange as (event: unknown) => void)({ target: input })
    return input
  }
  return { props, change, nodes, field, edit }
}

describe('WidgetConfigForm', () => {
  it('renders required markers and aria-required on every control, warning only for an unset required secret', async () => {
    const form = mountForm({ type: 'object', properties: { title: text, choice, count: integer, token: secret, optional: secret }, required: ['title', 'choice', 'count', 'token'] })
    for (const key of ['title', 'choice', 'count', 'token']) expect(form.field(key).props['aria-required']).toBe('true')
    expect(form.field('optional').props['aria-required']).toBeUndefined()
    const labels = form.nodes().filter((item) => item.tag === 'label')
    for (const label of labels.slice(0, 4)) {
      const contents = [label, ...label.children].map((item) => item.text).join('')
      expect(contents).toContain('*')
      expect(contents).toContain('обязательно')
    }
    const status = () => form.nodes().find((item) => String(item.props.id).endsWith('-token-status'))!
    expect(status().text).toBe('не задан')
    expect(status().props.class).toContain('settings__warning')
    const optional = form.nodes().find((item) => String(item.props.id).endsWith('-optional-status'))!
    expect(optional.props.class).not.toContain('settings__warning')
    form.props.secrets.add('token')
    await Vue.nextTick()
    expect(status().text).toBe('задан')
    expect(status().props.class).not.toContain('settings__warning')
  })

  it('explains the secret minimum only while a nonempty password is too short', async () => {
    const form = mountForm({ type: 'object', properties: { token: secret } })
    const hint = `Минимум ${secrets.SECRET_MIN_LENGTH} символов`
    const shown = () => form.nodes().some((item) => item.text === hint)
    const button = () => form.nodes().find((item) => item.tag === 'button' && item.text === 'Задать')!
    expect(shown()).toBe(false)
    expect(button().props.disabled).toBe(true)
    expect(Number(form.field('token').props.minlength)).toBe(secrets.SECRET_MIN_LENGTH)
    for (const length of [1, secrets.SECRET_MIN_LENGTH - 1, secrets.SECRET_MIN_LENGTH, 0]) {
      const input = form.field('token')
      input.value = 'x'.repeat(length)
      ;(input.props.onInput as (event: unknown) => void)({ target: input })
      await Vue.nextTick()
      expect(shown()).toBe(length > 0 && length < secrets.SECRET_MIN_LENGTH)
      expect(button().props.disabled).toBe(length < secrets.SECRET_MIN_LENGTH)
    }
  })

  it('restores rejected numeric and text input to the stored value and applies the default string limit', () => {
    const form = mountForm({ type: 'object', properties: { count: integer, title: { type: 'string', title: 'Title', default: 'Saved' }, short: text } }, { count: 2 })
    expect(form.edit('count', '0').value).toBe('2')
    expect(form.edit('title', 'x'.repeat(settings.SETTINGS_LIMITS.maxLength + 1)).value).toBe('Saved')
    expect(form.change).not.toHaveBeenCalled()
    expect(form.field('title').props.maxlength).toBe(settings.SETTINGS_LIMITS.maxLength)
    expect(form.field('short').props.maxlength).toBe(text.maxLength)
  })

  it('keeps same-tick edits and resets its draft when config props change', async () => {
    const form = mountForm({ type: 'object', properties: { title: text, count: integer } })
    form.edit('title', 'Hi')
    form.edit('count', '3')
    expect(form.change.mock.calls).toEqual([[{ title: 'Hi', count: 1 }], [{ title: 'Hi', count: 3 }]])
    expect(form.edit('count', '0').value).toBe('3')
    form.props.config = { title: 'Other', count: 2 }
    await Vue.nextTick()
    expect(form.field('title').value).toBe('Other')
    form.edit('count', '4')
    expect(form.change).toHaveBeenLastCalledWith({ title: 'Other', count: 4 })
  })
})
