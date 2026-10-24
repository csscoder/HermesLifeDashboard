import { createApp, reactive, watchEffect } from 'vue'
import { SDK_VERSION, type InitMessage, type WidgetContext } from '@lifedashboard/contracts/widget-gateway'
import { parseModalMount } from '@lifedashboard/contracts/widget-modal'
import { createWidgetModal } from './modal.ts'
import { createPortClient } from './port-client.ts'
import { applyTokens } from './theme.ts'
import { createWidget, WIDGET_KEY } from './widget.ts'

// Widget code imports '@lifedashboard/widget-sdk', which the import map resolves to this module.
export * from './index.ts'

function report(port: MessagePort, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  port.postMessage({ t: 'error', message: message.slice(0, 1000) })
}

// Theme and scale come from the host: the frame inherits nothing from the dashboard (spec «Theme and size»).
function followContext(context: WidgetContext): void {
  const root = document.documentElement
  root.style.background = 'transparent'
  let applied: string[] = []
  watchEffect(() => {
    applied = applyTokens(root.style, applied, context.theme.tokens)
    root.style.colorScheme = context.theme.scheme
    root.style.fontSize = `${context.rootFontSize}px`
  })
}

async function boot(port: MessagePort, initial: WidgetContext, mount?: unknown): Promise<void> {
  const context = reactive(initial) as WidgetContext
  const call = createPortClient(port, (patch) => Object.assign(context, patch))
  addEventListener('error', (event) => report(port, event.error ?? event.message))
  addEventListener('unhandledrejection', (event) => report(port, event.reason))
  followContext(context)
  try {
    const entry = await import('@lifedashboard/widget-entry')
    let component = entry.default
    let props = {}
    if (mount !== undefined) {
      const parsed = parseModalMount(mount)
      if (!parsed.ok) throw new Error(parsed.error)
      if (!entry.modals || !Object.hasOwn(entry.modals, parsed.value.view)) throw new Error('Unknown modal view')
      component = entry.modals[parsed.value.view]!
      props = parsed.value.props
    }
    let closed = false
    const sendClose = (reason: 'sdk' | 'escape') => {
      if (closed) return
      closed = true
      port.postMessage({ t: 'modal-close', reason })
    }
    const modal = createWidgetModal(call, { views: Object.keys(entry.modals ?? {}), surface: mount === undefined ? 'widget' : 'modal', sendClose })
    if (mount !== undefined) addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) sendClose('escape')
    })
    const app = createApp(component, props)
    app.config.errorHandler = (error) => report(port, error)
    app.provide(WIDGET_KEY, createWidget(call, context, modal))
    app.mount('#app')
  } catch (error) {
    report(port, error)
  }
}

function start(): void {
  if (parent === window) return
  // The widget root fills the frame, so `height: 100%` in widget CSS resolves to the widget rectangle.
  for (const element of [document.documentElement, document.body, document.getElementById('app')]) {
    if (element) element.style.height = '100%'
  }
  document.body.style.margin = '0'
  addEventListener('message', function onInit(event: MessageEvent) {
    const data = event.data as Partial<InitMessage> | null
    const port = event.ports[0]
    if (event.source !== parent || data?.t !== 'ld:init' || !data.context || !port) return
    removeEventListener('message', onInit)
    void boot(port, data.context, data.mount)
  })
  parent.postMessage({ t: 'ld:hello', sdk: SDK_VERSION }, '*')
}

start()
