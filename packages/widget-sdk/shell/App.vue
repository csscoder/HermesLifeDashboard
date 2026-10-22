<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { GRID_COLS } from '@lifedashboard/contracts/grid'
import { plainConfig } from '@lifedashboard/contracts/widget-settings'
import { createBridge, createHandshakes, type Bridge } from '../src/host.ts'
import { WidgetError } from '../src/widget.ts'
import {
  appendLogEntry, createFrameSession, describeShell, frameSizePx, parseShellState, secretsChanged,
  serializeShellState, shellContext, themeClass, type ShellState,
} from '../src/dev/shell-state.ts'
import type { DevInfo } from '../src/dev/server.ts'
import type { DevCallResult } from '../src/dev/gateway.ts'
import type { DevLogKind } from '../src/dev/log.ts'
import Toolbar from './Toolbar.vue'
import SettingsPanel from './SettingsPanel.vue'
import LogPanel from './LogPanel.vue'

const props = defineProps<{ paths: import('../src/dev/server.ts').DevPaths }>()
// Keep the API payload plain: theme tokens must be structured-cloneable over MessagePort.
const info = shallowRef<DevInfo>()
const state = ref<ShellState>()
const rawConfig = ref<Record<string, unknown>>({})
const frame = ref<HTMLIFrameElement>()
const preview = ref<HTMLElement>()
const frameSrc = ref<string>()
const frameVersion = ref(0)
const contentWidth = ref(0)
const env = ref({ locale: navigator.language, rootFontSize: 16 })
const failure = ref('')
const entries = ref<{ id: number; time: string; kind: string; message: string; shell: string }[]>([])
const toasts = ref<{ id: number; title: string }[]>([])
let sequence = 0
let bridge: Bridge | undefined
let pollTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined
let disposed = false
const toastTimers = new Set<ReturnType<typeof setTimeout>>()
const theme = computed(() => info.value?.themes.find((theme) => theme.id === state.value?.theme))
const context = computed(() => state.value && theme.value && info.value
  ? shellContext(state.value, theme.value, info.value.manifest.settings, rawConfig.value,
    new Set(Object.keys(info.value.secrets).filter((key) => info.value!.secrets[key])), env.value)
  : undefined)
const frameStyle = computed(() => {
  if (!state.value || !theme.value) return {}
  const gap = 0.5 * env.value.rootFontSize
  const cell = (contentWidth.value - (GRID_COLS - 1) * gap) / GRID_COLS
  const size = frameSizePx(state.value, cell, gap)
  return { ...theme.value.tokens, width: `${size.width}px`, height: `${size.height}px` }
})
const themeClassName = computed(() => themeClass(theme.value?.id ?? ''))

function append(kind: DevLogKind, message: string) {
  entries.value = appendLogEntry(entries.value, { id: ++sequence, time: new Date().toISOString(), kind, message, shell: state.value ? describeShell(state.value) : '' })
}

async function api(route: string, body?: unknown) {
  const response = await fetch(props.paths.api + route, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Dev API ${route} returned ${response.status}. Fix: check the ld-widget dev terminal and restart it if needed.`)
  return response
}

function report(kind: DevLogKind, message: string) {
  append(kind, message)
  void api('log', { kind, message, shell: state.value ? describeShell(state.value) : undefined })
    .catch((error: Error) => { failure.value = error.message })
}

function showToast(title: string) {
  const id = ++sequence
  toasts.value.push({ id, title })
  const timer = setTimeout(() => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
    toastTimers.delete(timer)
  }, 5000)
  toastTimers.add(timer)
}

const sessions = createFrameSession(() => {
  const target = frame.value?.contentWindow
  if (!target || !context.value) throw new Error('Missing sandbox frame context. Fix: reload the dev shell.')
  const channel = new MessageChannel()
  const current = createBridge(channel.port1, {
    async call(op, input) {
      let result: DevCallResult
      try {
        result = await (await api('call', { op, input, confirm: state.value!.confirm, shell: describeShell(state.value!) })).json() as DevCallResult
      } catch (error) {
        report('error', (error as Error).message)
        throw new WidgetError('UNAVAILABLE', (error as Error).message)
      }
      append('gateway', result.ok ? `${op} ok: ${JSON.stringify(result.value)}` : `${op} ${result.code}: ${result.message}`)
      if (!result.ok) throw new WidgetError(result.code, result.message)
      if (op === 'notifications.send') showToast((input as { title: string }).title)
      return result.value
    },
    onError: (message) => report('error', message),
    onClose: () => report('error', 'bridge closed'),
  })
  bridge = current
  target.postMessage({ t: 'ld:init', context: context.value }, '*', [channel.port2])
  return { close() { current.close(); if (bridge === current) bridge = undefined } }
})
const handshakes = createHandshakes()

function onMessage(event: MessageEvent) {
  if (!frame.value?.contentWindow || event.source !== frame.value.contentWindow) return
  const data = event.data
  if (typeof data !== 'object' || data === null) return
  if (data.t === 'ld:dev' && data.kind === 'rendered') {
    document.documentElement.dataset.ldRendered = 'true'
  } else if (data.t === 'ld:hello') {
    handshakes.register(event.source, () => sessions.hello())
    handshakes.handle(event)
  } else if (data.t === 'ld:dev' && typeof data.message === 'string'
    && ['gateway', 'error', 'csp', 'overflow', 'manifest', 'secret'].includes(data.kind)) {
    report(data.kind, data.message)
  }
}

function updateState(next: ShellState) {
  if (!info.value) return
  state.value = parseShellState(serializeShellState(next), info.value.manifest, info.value.themes.map((theme) => theme.id))
}

function loadConfig(current: DevInfo) {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`ld-dev-config:${current.manifest.id}`) ?? '{}')
    const raw = typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? saved as Record<string, unknown> : {}
    rawConfig.value = current.manifest.settings ? plainConfig(current.manifest.settings, raw) : {}
  } catch {
    rawConfig.value = {}
    report('error', 'Cannot read saved settings. Fix: clear this shell origin\'s ld-dev-config entry and allow localStorage.')
  }
}

function updateConfig(key: string, value: unknown) {
  rawConfig.value = { ...rawConfig.value, [key]: value }
  try {
    localStorage.setItem(`ld-dev-config:${info.value!.manifest.id}`, JSON.stringify(rawConfig.value))
  } catch {
    report('error', 'Cannot save settings. Fix: allow localStorage and free space for this shell origin.')
  }
}

function measure() {
  env.value = { locale: navigator.language, rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 }
  contentWidth.value = preview.value?.clientWidth ?? 0
}

async function reset() {
  try {
    await api('reset', {})
    sessions.dispose()
    frameVersion.value++
  } catch (error) { failure.value = (error as Error).message }
}

async function poll() {
  try {
    const next = await (await api('info')).json() as DevInfo
    if (disposed) return
    if (next.themes.length === 0) throw new Error('No dev themes found. Fix: rebuild packages/widget-sdk and restart ld-widget dev.')
    const previous = info.value
    if (!previous || previous.revision !== next.revision) {
      sessions.dispose()
      info.value = next
      state.value = parseShellState(state.value ? serializeShellState(state.value) : location.search, next.manifest, next.themes.map((theme) => theme.id))
      loadConfig(next)
      await nextTick()
      if (disposed) return
      measure()
      if (preview.value) observer?.observe(preview.value)
      frameSrc.value = props.paths.sandbox
    } else if (secretsChanged(previous.secrets, next.secrets)) {
      info.value = next
    }
    failure.value = ''
  } catch (error) { failure.value = (error as Error).message }
  finally { if (!disposed) pollTimer = setTimeout(poll, 2000) }
}

watch([state, context], () => {
  if (state.value) history.replaceState(null, '', serializeShellState(state.value) + location.hash)
  if (context.value) bridge?.push(context.value)
}, { deep: true, flush: 'post' })

onMounted(() => {
  window.addEventListener('message', onMessage)
  window.addEventListener('resize', measure)
  observer = new ResizeObserver(measure)
  void poll()
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(pollTimer)
  for (const timer of toastTimers) clearTimeout(timer)
  observer?.disconnect()
  sessions.dispose()
  window.removeEventListener('message', onMessage)
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <main class="shell">
    <h1>{{ info?.manifest.title ?? 'LifeDashboard widget dev shell' }}</h1>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <template v-if="info && state && theme && context">
      <Toolbar :state="state" :manifest="info.manifest" :themes="info.themes" @change="updateState" @reset="reset" />
      <div ref="preview" class="shell-preview">
        <div :class="['widget', `widget--theme-${themeClassName}`, `widget--skin-${state.frame === 'frameless' ? 'bare' : theme.skin}`]" :style="frameStyle">
          <div class="widget__wrapper">
            <div class="widget__box">
              <div class="widget__body">
                <div class="sandbox">
                  <iframe :key="`${info.revision}:${frameVersion}`" ref="frame" class="sandbox__frame" sandbox="allow-scripts" :src="frameSrc" title="Widget preview" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="shell-panels">
        <SettingsPanel :key="info.revision" :schema="info.manifest.settings" :config="context.config" :secrets="info.secrets" :problems="info.settingsProblems" @change="updateConfig" />
        <LogPanel :entries="entries" />
      </div>
    </template>
    <div class="shell-toasts" aria-live="polite">
      <div v-for="toast in toasts" :key="toast.id" class="shell-toast" role="status">{{ toast.title }}</div>
    </div>
  </main>
</template>

<style>
body { margin: 0; background: #edf0f4; color: #20242c; font-family: system-ui, sans-serif; }
.shell { padding: 1rem; }
.shell h1 { font-size: 1.25rem; margin: 0 0 1rem; }
.shell h2 { font-size: 1rem; margin: 0 0 0.75rem; }
.shell-toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; margin-bottom: 1rem; }
.shell-toolbar label, .shell-setting { display: flex; flex-direction: column; gap: 0.25rem; }
.shell input, .shell select, .shell button { font: inherit; }
.shell-toolbar input { width: 5rem; }
.shell-preview { width: 100%; overflow: auto; min-height: 1px; }
.shell-panels { display: grid; grid-template-columns: minmax(15rem, 1fr) minmax(0, 2fr); gap: 1rem; margin-top: 1rem; }
.shell-panel { padding: 1rem; border: 1px solid #c9ced8; border-radius: 0.5rem; background: white; min-width: 0; }
.shell-setting { margin-bottom: 0.75rem; }
.shell-setting input[type="checkbox"] { align-self: start; }
.shell small { display: block; }
.shell [aria-invalid="true"] { outline: 2px solid #b32222; }
.shell-log { list-style: none; padding: 0; margin: 0; max-height: 24rem; overflow: auto; }
.shell-log li { padding: 0.4rem 0; overflow-wrap: anywhere; border-bottom: 1px solid #edf0f4; }
.shell-log code { white-space: pre-wrap; }
.shell-toasts { position: fixed; right: 1rem; bottom: 1rem; display: grid; gap: 0.5rem; z-index: 10; }
.shell-toast { padding: 0.75rem 1rem; background: #20242c; color: white; border-radius: 0.5rem; }
@media (max-width: 640px) { .shell-panels { grid-template-columns: minmax(0, 1fr); } }
</style>
