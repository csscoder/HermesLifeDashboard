import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
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

function setup(foreign: boolean) {
  const flag = ref(foreign)
  const scope = effectScope()
  scopes.push(scope)
  const context = scope.run(() =>
    useWidgetContext({
      size: () => ({ w: 2, h: 2 }),
      themeId: () => 'builtin:glass',
      foreign: () => flag.value,
      config: () => ({}),
      frame: () => ({}) as Element,
    }),
  )!
  return { flag, context }
}

describe('useWidgetContext', () => {
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
