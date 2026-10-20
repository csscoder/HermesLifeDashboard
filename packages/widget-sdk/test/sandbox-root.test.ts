import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('gives html, body and #app the full frame height before the widget loads', async () => {
  const element = () => ({ style: {} as Record<string, string> })
  const html = element()
  const body = element()
  const app = element()
  vi.stubGlobal('window', {})
  vi.stubGlobal('parent', { postMessage: vi.fn() })
  vi.stubGlobal('addEventListener', vi.fn())
  vi.stubGlobal('document', {
    documentElement: html, body, createElement: element,
    getElementById: (id: string) => (id === 'app' ? app : null),
  })
  await import('../src/sandbox.ts')
  expect([html.style.height, body.style.height, app.style.height]).toEqual(['100%', '100%', '100%'])
})
