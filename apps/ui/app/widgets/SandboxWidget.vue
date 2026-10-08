<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { BRIDGE_LIMITS, type WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { api } from '../api'
import { showToast } from '../toasts'
import { createBridge, createGatewayClient, listenForHello, type Bridge, type GatewayClient } from './broker'

const props = defineProps<{ widgetId: string; hash: string; title: string; context: WidgetContext }>()

const state = ref<'loading' | 'ready' | 'error'>('loading')
const showFrame = ref(false)
const iframe = useTemplateRef<HTMLIFrameElement>('frameBox')
let client: GatewayClient | null = null
let bridge: Bridge | null = null
let stopWaiting: (() => void) | null = null
let helloTimer: ReturnType<typeof setTimeout> | undefined
let loads = 0

// The context is JSON; a reactive proxy cannot be structured-cloned into the frame.
function snapshot(): WidgetContext {
  return JSON.parse(JSON.stringify(props.context)) as WidgetContext
}

// Spec «Sandbox host» step 4: close the port, end the session, remove the iframe.
function teardown() {
  clearTimeout(helloTimer)
  stopWaiting?.()
  stopWaiting = null
  bridge?.close()
  bridge = null
  void client?.close()
  client = null
  showFrame.value = false
}

function fail() {
  teardown()
  state.value = 'error'
}

async function start() {
  teardown()
  state.value = 'loading'
  loads = 0
  const current = createGatewayClient({
    api,
    widgetId: props.widgetId,
    onNotify: (message) => showToast({ source: props.title, ...message }),
    onSessionLost: () => {
      if (client === current) fail()
    },
  })
  client = current
  const started = await current.start()
  if (client !== current) {
    // Unmounted or restarted while the session was created.
    void current.close()
    return
  }
  if (!started) return fail()
  showFrame.value = true
  await nextTick()
  if (client !== current) return
  const frameWindow = iframe.value?.contentWindow
  if (!frameWindow) return fail()
  helloTimer = setTimeout(fail, BRIDGE_LIMITS.helloTimeoutMs)
  stopWaiting = listenForHello(frameWindow, () => connect(frameWindow, current))
}

function connect(frameWindow: Window, current: GatewayClient) {
  clearTimeout(helloTimer)
  stopWaiting = null
  const channel = new MessageChannel()
  frameWindow.postMessage({ t: 'ld:init', context: snapshot() }, '*', [channel.port2])
  bridge = createBridge(channel.port1, { call: current.call, onError: fail, onClose: fail })
  state.value = 'ready'
}

// The first load is the package document; another one means the frame navigated itself.
// ponytail: not audited; the API has no host-event route in this slice (spec «RPC bridge» step 6).
function onLoad() {
  loads += 1
  if (loads > 1) fail()
}

watch(
  () => JSON.stringify(props.context),
  (json) => bridge?.push(JSON.parse(json) as WidgetContext),
)

onMounted(start)
onUnmounted(teardown)
</script>

<template>
  <div class="sandbox">
    <!-- Same color-scheme as the frame document, or the browser paints an opaque backdrop. -->
    <iframe
      v-if="showFrame"
      ref="frameBox"
      class="sandbox__frame"
      :class="{ 'sandbox__frame--waiting': state !== 'ready' }"
      sandbox="allow-scripts"
      :src="`/sandbox/packages/${hash}/`"
      :title="title"
      :style="{ colorScheme: context.theme.scheme }"
      @load="onLoad"
    />
    <p v-if="state === 'loading'" class="sandbox__status">Загрузка…</p>
    <div v-else-if="state === 'error'" class="sandbox__status" role="alert">
      <p class="sandbox__text">Ошибка виджета</p>
      <button type="button" class="sandbox__retry" @click="start">Повторить</button>
    </div>
  </div>
</template>

<style scoped>
.sandbox {
  position: relative;
  height: 100%;
}

.sandbox__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}

.sandbox__frame--waiting {
  visibility: hidden;
}

.sandbox__status {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
  text-align: center;
}

.sandbox__text {
  margin: 0;
}

.sandbox__retry {
  height: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.sandbox__retry:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}
</style>
