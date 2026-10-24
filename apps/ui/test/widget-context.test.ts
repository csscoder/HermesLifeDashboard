import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { normalizeConfig, type SettingsSchema } from '@lifedashboard/contracts/widget-settings'
import type { InstalledPackage } from '@lifedashboard/contracts/widget-package'
import { describeSource } from '../app/widgets/catalog'
import { useWidgetContext } from '../app/widgets/context'

// Vitest runs in Node: the frame's computed style is a stub whose surface-1 follows `surface`.
// onMounted is a no-op outside a component, so only the watch path runs here.
let surface = 'translucent'
const scopes: ReturnType<typeof effectScope>[] = []

beforeEach(() => {
  surface = 'translucent'
  vi.stubGlobal('document', { visibilityState: 'visible', documentElement: {}, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('getComputedStyle', () => ({
    fontSize: '16px',
    getPropertyValue: (name: string) => (name === '--ld-surface-1' ? surface : ''),
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup(foreign: boolean, config: () => Record<string, unknown> = () => ({})) {
  const flag = ref(foreign)
  const frameMode = ref<'framed' | 'frameless'>('frameless')
  const scope = effectScope()
  scopes.push(scope)
  const context = scope.run(() =>
    useWidgetContext({
      size: () => ({ w: 2, h: 2 }),
      themeId: () => 'builtin:glass',
      foreign: () => flag.value,
      config,
      frame: () => ({}) as Element,
      frameMode: () => frameMode.value,
    }),
  )!
  return { flag, frameMode, context }
}

describe('useWidgetContext', () => {
  it('reports the frame mode and follows source changes in both directions', async () => {
    const { frameMode, context } = setup(false)
    expect(context.frame).toBe('frameless')
    frameMode.value = 'framed'
    await nextTick()
    expect(context.frame).toBe('framed')
    frameMode.value = 'frameless'
    await nextTick()
    expect(context.frame).toBe('frameless')
  })

  it('re-reads tokens when foreign flips while the theme id stays, in both directions', async () => {
    const { flag, context } = setup(false)

    surface = 'solid'
    flag.value = true
    await vi.waitFor(() => expect(context.theme.tokens['--ld-surface-1']).toBe('solid'))

    surface = 'translucent'
    flag.value = false
    await vi.waitFor(() => expect(context.theme.tokens['--ld-surface-1']).toBe('translucent'))
    expect(context.theme.id).toBe('builtin:glass')
  })
})

describe('normalized widget config', () => {
  const settings: SettingsSchema = {
    type: 'object',
    properties: {
      label: { type: 'string', title: 'Label', default: 'Default' },
      count: { type: 'integer', title: 'Count', default: 3, minimum: 1 },
      apiKey: { type: 'secret', title: 'API key', bind: { origin: 'https://example.com', header: 'x-api-key' } },
    },
  }

  it('exposes the settings of the exact installed source version', () => {
    const manifest = {
      id: 'dev.test.config', version: '1.0.0', title: 'Config', author: 'test', sdk: 2 as const,
      entry: 'index.js', styles: [], permissions: [], network: ['https://example.com'],
      sizing: { default: { w: 2, h: 2 }, min: { w: 1, h: 1 }, max: { w: 4, h: 4 } },
    }
    const packages: InstalledPackage[] = [{
      id: manifest.id, title: manifest.title, author: manifest.author, grants: [], origins: [],
      versions: [
        { version: '2.0.0', hash: 'new', manifest: { ...manifest, version: '2.0.0' }, paths: { source: null, assets: null } },
        { version: '1.0.0', hash: 'old', manifest: { ...manifest, settings }, paths: { source: null, assets: null } },
      ],
    }]
    const info = describeSource({ kind: 'package', packageId: manifest.id, version: '1.0.0' }, packages)
    expect(info?.settings).toEqual(settings)
  })

  it('updates normalized config when saved values or secret flags change', async () => {
    const raw = ref<Record<string, unknown>>({ label: 'Saved', count: -1, apiKey: 'never expose', unknown: true })
    const flags = ref<ReadonlySet<string>>(new Set())
    const { context } = setup(false, () => normalizeConfig(settings, raw.value, flags.value))
    expect(context.config).toEqual({ label: 'Saved', count: 3, apiKey: false })

    flags.value = new Set(['apiKey'])
    await nextTick()
    expect(context.config).toEqual({ label: 'Saved', count: 3, apiKey: true })

    raw.value = { label: 'Changed', count: 5 }
    await nextTick()
    expect(context.config).toEqual({ label: 'Changed', count: 5, apiKey: true })
  })
})

it('copies theme, config, locale, secret flags and root font size to the modal and follows updates', async () => {
 const { createDashboardModals } = await import('../app/widgets/modals')
 const { reactive } = await import('vue')
 const c = reactive({ size: { w: 3, h: 4 }, sizeClass: 's', frame: 'framed', rootFontSize: 17,
 theme: { id: 'builtin:paper', scheme: 'light', tokens: { '--ld-text-primary': '#123456' } }, config: { apiKey: { configured: true } }, locale: 'ru', visible: false })
 const m = createDashboardModals()
 m.registerCaller({ owner: { widgetId: 'w1', runtimeId: 'w1', packageId: 'dev.test', version: '1', hash: 'hash', title: 'Test' }, context: () => c as any, restart: async () => {} })
 await m.open('w1', { view: 'workspace' })
 expect(m.context()).toMatchObject({ size: { w: 3, h: 4 }, frame: 'frameless', rootFontSize: 17, locale: 'ru', config: { apiKey: { configured: true } }, theme: { tokens: { '--ld-text-primary': '#123456' } } })
 c.rootFontSize = 22; c.locale = 'en'; c.config.apiKey.configured = false; c.theme.tokens['--ld-text-primary'] = '#abcdef'
 expect(m.context()).toMatchObject({ rootFontSize: 22, locale: 'en', config: { apiKey: { configured: false } }, theme: { tokens: { '--ld-text-primary': '#abcdef' } } }); m.dispose()
})
it('keeps modal visible while the caller is offscreen', async () => {
 const { createDashboardModals } = await import('../app/widgets/modals')
 const m = createDashboardModals()
 m.registerCaller({ owner: { widgetId: 'w1', runtimeId: 'w1', packageId: 'dev.test', version: '1', hash: 'hash', title: 'Test' }, context: () => ({ visible: false } as any), restart: async () => {} })
 await m.open('w1', { view: 'workspace' }); expect(m.context()?.visible).toBe(true); m.dispose()
})
it('updates modal document visibility independently of caller intersection', async () => {
 const { createDashboardModals } = await import('../app/widgets/modals')
 const { computed } = await import('vue')
 let visibility!: () => void
 const document = { visibilityState: 'visible', addEventListener: (_event: string, callback: () => void) => { visibility = callback }, removeEventListener() {} }
 vi.stubGlobal('document', document)
 const m = createDashboardModals()
 try {
 m.registerCaller({ owner: { widgetId: 'w1', runtimeId: 'w1', hash: 'hash', packageId: 'dev.test', version: '1', title: 'Test' }, context: () => ({ visible: false } as any), restart: async () => {} })
 await m.open('w1', { view: 'workspace' }); const effective = computed(() => m.context())
 expect(effective.value?.visible).toBe(true)
 expect(visibility).toBeTypeOf('function')
 document.visibilityState = 'hidden'; visibility(); expect(effective.value?.visible).toBe(false)
 document.visibilityState = 'visible'; visibility(); expect(effective.value?.visible).toBe(true)
 } finally { m.dispose() }
})
