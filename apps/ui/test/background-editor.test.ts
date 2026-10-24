import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as board from '@lifedashboard/contracts/board'
import * as mediaApi from '../app/background/media-api'
import { probeMedia } from '../app/background/import-media'
import { compileSfc, mountComponent, unmountComponents } from './helpers/sfc-renderer'

const component = compileSfc(new URL('../app/background/BackgroundEditor.vue', import.meta.url), {
  '@lifedashboard/contracts/board': board,
  './media-api': mediaApi,
  './import-media': { probeMedia },
})
const old = { mediaId: 'old', kind: 'video', opacity: 0.8, dim: 0.35, pattern: { shape: 'circles', color: '#000000', opacity: 0.25, scale: 1 } }
class Video extends EventTarget {
  videoWidth = 320; videoHeight = 240; src = ''; muted = false; playsInline = false; preload = ''
  pause() {} removeAttribute() { this.src = '' } load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))) }
}
function image() {
  return { naturalWidth: 120, naturalHeight: 80, src: '', decode: async () => {}, removeAttribute() { this.src = '' }, addEventListener() {}, removeEventListener() {} }
}
const requests: { url: string; init: RequestInit }[] = []
let upload: (init: RequestInit) => Promise<Response>
let metadata: (id: string) => Promise<Response>
const response = (data: unknown) => new Response(JSON.stringify({ data }))
const media = (id: string, name = `${id}.mp4`, mime = 'video/mp4') => ({ id, name, size: 5, mime })
beforeEach(() => {
  requests.length = 0
  upload = async () => response(media('new'))
  metadata = async id => response(media(id))
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'img' ? image() : new Video() })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    if (url.includes('?')) return upload(init)
    if (url.endsWith('/metadata')) return metadata(url.split('/').at(-2)!)
    return response(null)
  })
})
afterEach(() => { unmountComponents(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const mount = (background: unknown = old) => mountComponent(component, { background, disabled: false }, ['change'])
const control = (ui: ReturnType<typeof mount>, label: string) => ui.nodes().find(el => el.props['aria-label'] === label)!
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); await nextTick() }
function choose(ui: ReturnType<typeof mount>, name = 'new.mp4') {
  return control(ui, 'Файл фона').props.onChange({ target: { files: [new File(['video'], name)], value: name } })
}

describe('screen background editor', () => {
  it('emits separate video/pattern opacity and dim settings preserving other background properties', async () => {
    const ui = mount(); await settle()
    control(ui, 'Прозрачность видео').props.onInput({ target: { value: '0' } })
    control(ui, 'Прозрачность сетки').props.onInput({ target: { value: '100' } })
    control(ui, 'Затемнение').props.onInput({ target: { value: '100' } })
    control(ui, 'Форма сетки').props.onChange({ target: { value: 'crosses' } })
    control(ui, 'Цвет сетки').props.onInput({ target: { value: '#ff0000' } })
    control(ui, 'Увеличение сетки').props.onInput({ target: { value: '4' } })
    expect(ui.events).toEqual([
      ['change', { ...old, opacity: 0 }],
      ['change', { ...old, pattern: { ...old.pattern, opacity: 1 } }],
      ['change', { ...old, dim: 1 }],
      ['change', { ...old, pattern: { ...old.pattern, shape: 'crosses' } }],
      ['change', { ...old, pattern: { ...old.pattern, color: '#ff0000' } }],
      ['change', { ...old, pattern: { ...old.pattern, scale: 4 } }],
    ])
  })
  it('stores integer grid magnification and displays the actual intrinsic cell dimensions', async () => {
    const ui = mount(); await settle()
    const size = control(ui, 'Увеличение сетки')
    expect(size.props).toMatchObject({ min: '1', max: '4', step: '1', value: 1 })
    expect(ui.text()).toContain('6×6 px')
    size.props.onInput({ target: { value: '3' } })
    expect(ui.events.at(-1)).toEqual(['change', { ...old, pattern: { ...old.pattern, scale: 3 } }])
  })
  it.each([
    ['diagonal', 1, 1, '2×2 px'], ['squares', 2, 2, '6×6 px'],
    ['crosses', 3, 3, '9×9 px'], ['circles', 4, 4, '24×24 px'],
    ['triangles', 1, 1, '3×3 px'], ['diamonds', 1.6, 2, '6×6 px'],
    ['diagonal', 0.25, 1, '2×2 px'],
  ])('shows the renderer cell size for %s at scale %s', async (shape, scale, effective, expected) => {
    const ui = mount({ ...old, pattern: { ...old.pattern, shape, scale } }); await settle()
    expect(ui.text()).toContain(expected)
    expect(control(ui, 'Увеличение сетки').props.value).toBe(effective)
  })
  it.each([['diagonal', 'Диагональ'], ['triangles', 'Треугольники']])('offers %s and preserves independent settings when selected', async (shape, label) => {
    const ui = mount(); await settle()
    expect(ui.nodes().some(node => node.tag === 'option' && node.props.value === shape && node.text === label)).toBe(true)
    control(ui, 'Форма сетки').props.onChange({ target: { value: shape } })
    expect(ui.events.at(-1)).toEqual(['change', { ...old, pattern: { ...old.pattern, shape } }])
  })
  it('toggles the micro grid and restores its shape without changing color, opacity, cell size or video settings', async () => {
    const background = { ...old, pattern: { shape: 'diamonds', color: '#446688', opacity: 0.45, scale: 2 } }
    const ui = mount(background); await settle()
    expect(control(ui, 'Сетка поверх фона').props.checked).toBe(true)
    control(ui, 'Сетка поверх фона').props.onChange({ target: { checked: false } })
    const off = { ...background, pattern: { ...background.pattern, shape: 'none' } }
    expect(ui.events.at(-1)).toEqual(['change', off])
    ui.props.background = off; await nextTick()
    for (const name of ['Форма сетки', 'Цвет сетки', 'Увеличение сетки', 'Прозрачность сетки'])
      expect(control(ui, name)).toBeUndefined()
    expect(control(ui, 'Сетка поверх фона').props.checked).toBe(false)
    expect(control(ui, 'Прозрачность видео')).toBeDefined()
    expect(control(ui, 'Затемнение')).toBeDefined()
    control(ui, 'Сетка поверх фона').props.onChange({ target: { checked: true } })
    expect(ui.events.at(-1)).toEqual(['change', background])
  })
  it('enables initially disabled grid with diagonal and blocks changes when the editor is disabled', async () => {
    const off = { ...old, pattern: { ...old.pattern, shape: 'none' } }
    const ui = mount(off); await settle()
    control(ui, 'Сетка поверх фона').props.onChange({ target: { checked: true } })
    expect(ui.events.at(-1)).toEqual(['change', { ...old, pattern: { ...old.pattern, shape: 'diagonal' } }])
    ui.props.disabled = true; await nextTick()
    expect(control(ui, 'Сетка поверх фона').props.disabled).toBe(true)
    control(ui, 'Сетка поверх фона').props.onChange({ target: { checked: true } })
    expect(ui.events).toHaveLength(1)
  })
  it('preserves old background during import and on upload failure with a visible error', async () => {
    upload = async () => new Response(JSON.stringify({ error: { code: 'INVALID', message: 'invalid bytes' } }), { status: 400 })
    const ui = mount(); await settle(); await choose(ui); await settle()
    expect(ui.events).toEqual([])
    expect(ui.text()).toContain('Не удалось импортировать фон')
    expect(ui.text()).toContain('old.mp4')
  })
  it('imports a playable replacement, shows filename, then removes only through a draft event', async () => {
    const ui = mount(); await settle(); await choose(ui); await settle()
    expect(ui.events).toEqual([['change', { mediaId: 'new', kind: 'video', opacity: 1, dim: 0.35, pattern: { shape: 'diagonal', color: '#000000', opacity: 0.25, scale: 1 } }]])
    expect(ui.text()).toContain('new.mp4')
    ui.button('Убрать фон').props.onClick()
    expect(ui.events.at(-1)).toEqual(['change', null])
    expect(requests.filter(r => r.init.method === 'PUT')).toEqual([])
  })
  it('imports a decoded image and emits its media kind with independent opacity', async () => {
    upload = async () => response(media('photo', 'photo.png', 'image/png'))
    const ui = mount(); await settle(); await choose(ui, 'photo.png'); await settle()
    expect(ui.events.at(-1)).toEqual(['change', { mediaId: 'photo', kind: 'image', opacity: 1, dim: 0.35, pattern: { shape: 'diagonal', color: '#000000', opacity: 0.25, scale: 1 } }])
    ui.props.background = ui.events.at(-1)![1]; await nextTick()
    expect(control(ui, 'Прозрачность видео')).toBeUndefined()
    control(ui, 'Прозрачность изображения').props.onInput({ target: { value: '40' } })
    expect(ui.events.at(-1)?.[1]).toMatchObject({ kind: 'image', opacity: 0.4, pattern: { opacity: 0.25 }, dim: 0.35 })
  })
  it('preserves the previous background when an image fails to decode', async () => {
    vi.stubGlobal('document', { createElement: () => ({ ...image(), decode: async () => { throw new Error('decode') } }) })
    const ui = mount(); await settle(); await choose(ui, 'broken.png'); await settle()
    expect(ui.events).toEqual([])
    expect(ui.text()).toContain('изображение')
    expect(ui.text()).toContain('old.mp4')
    expect(requests.some(request => request.init.method === 'POST')).toBe(false)
  })
  it('ignores a stale image decode after another file is selected', async () => {
    let finish!: () => void
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'img' ? { ...image(), decode: () => new Promise<void>(resolve => { finish = resolve }) } : new Video() })
    const ui = mount(); await settle()
    const first = choose(ui, 'photo.png'); await settle()
    const second = choose(ui); await second; await settle()
    finish(); await first; await settle()
    expect(ui.events).toHaveLength(1)
    expect(ui.events[0]?.[1]).toMatchObject({ mediaId: 'new', kind: 'video' })
    expect(requests.filter(request => request.init.method === 'POST')).toHaveLength(1)
  })
  it('rejects unsupported local files before uploading', async () => {
    const ui = mount(); await settle(); await choose(ui, 'clip.avi'); await settle()
    expect(ui.events).toEqual([])
    expect(ui.text()).toContain('MP4')
    expect(requests.some(r => r.init.method === 'POST')).toBe(false)
  })
  it.each(['unmount', 'disable', 'cancel'])('cancels %s and discards a late completed upload without changing its screen', async reason => {
    let finish!: (value: Response) => void
    upload = () => new Promise(resolve => { finish = resolve })
    const ui = mount(); await settle()
    const pending = choose(ui); await settle()
    const uploadRequest = requests.find(r => r.url.includes('?'))!
    expect(uploadRequest).toBeDefined()
    if (reason === 'unmount') unmountComponents()
    if (reason === 'disable') { ui.props.disabled = true; await nextTick() }
    if (reason === 'cancel') ui.button('Отменить импорт').props.onClick()
    expect(uploadRequest.init.signal?.aborted).toBe(true)
    // Complete the old request even though transport cancellation raced with a server success.
    finish(response(media('late'))); await settle(); await pending
    expect(ui.events).toEqual([])
    expect(requests.some(r => r.url.endsWith('/late') && r.init.method === 'DELETE')).toBe(true)
  })
  it('discards an older completed import and keeps the newer result', async () => {
    const completions: ((response: Response) => void)[] = []
    upload = () => new Promise(resolve => completions.push(resolve))
    const ui = mount(); await settle()
    const first = choose(ui); await settle()
    const second = choose(ui, 'newer.mp4'); await settle()
    expect(requests.find(r => r.url.includes('name=new.mp4'))!.init.signal?.aborted).toBe(true)
    completions[1]!(response(media('newer'))); await second; await settle()
    completions[0]!(response(media('stale'))); await first; await settle()
    expect(ui.events).toHaveLength(1)
    expect(ui.events[0]?.[1]).toMatchObject({ mediaId: 'newer', kind: 'video' })
    expect(ui.text()).toContain('newer.mp4')
    expect(requests.some(r => r.url.endsWith('/stale') && r.init.method === 'DELETE')).toBe(true)
  })
  it('keeps a newer filename when stale metadata resolves', async () => {
    let finish!: (value: Response) => void
    metadata = () => new Promise(resolve => { finish = resolve })
    const ui = mount(); await choose(ui); await settle()
    expect(ui.text()).toContain('new.mp4')
    finish(response(media('old', 'stale.mp4'))); await settle()
    expect(ui.text()).not.toContain('stale.mp4')
    expect(ui.text()).toContain('new.mp4')
  })
})
