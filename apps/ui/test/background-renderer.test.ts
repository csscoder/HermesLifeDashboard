import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenBackground } from '@lifedashboard/contracts/board'

// GPU and decoder are unavailable in Vitest's Node environment; exercise our real lifecycle at those boundaries.
const pixi = vi.hoisted(() => {
  class Point { x = 0; y = 0; set(x: number, y = x) { this.x = x; this.y = y } }
  class Texture {
    static EMPTY = new Texture({})
    destroyed = false
    constructor(public options: any) {}
    get width() { return this.options.source?.options?.resource.width ?? 1 }
    get height() { return this.options.source?.options?.resource.height ?? 1 }
    destroy(source: boolean) { this.destroyed = true; if (source) this.options.source?.destroy() }
  }
  class Sprite {
    width = 0; height = 0; x = 0; y = 0; alpha = 1; visible = true; tint: any = 0xffffff
    anchor = new Point(); scale = new Point(); tileScale = new Point()
    texture: Texture
    constructor(options: any) { this.texture = options.texture }
    destroy() {}
  }
  class Graphics extends Sprite {
    constructor() { super({ texture: Texture.EMPTY }) }
    clear() { return this }
    rect(_x: number, _y: number, width: number, height: number) { this.width = width; this.height = height; return this }
    fill() { return this }
  }
  class VideoSource {
    static all: VideoSource[] = []
    autoUpdate = true; updates = 0; destroyed = false
    resource: any
    constructor(options: any) { this.resource = options.resource; VideoSource.all.push(this) }
    resize() {}
    update() { this.updates++ }
    destroy() { this.destroyed = true }
  }
  class ImageSource { constructor(public options: any) {} update() {} destroy() {} }
  class Application {
    static all: Application[] = []
    static initWait: Promise<void> | null = null
    canvas = Object.assign(new EventTarget(), { hidden: false, style: {}, remove: vi.fn() })
    stage = { children: [] as any[], addChild: (...items: any[]) => this.stage.children.push(...items) }
    renderer = { resize: (width: number, height: number) => { this.width = width; this.height = height } }
    width = 0; height = 0; renders = 0; destroyed = false; options: any
    constructor() { Application.all.push(this) }
    async init(options: any) { this.options = options; this.width = options.width; this.height = options.height; await Application.initWait }
    render() { this.renders++ }
    destroy() { this.destroyed = true; this.canvas.remove() }
  }
  return { Application, Graphics, Sprite, TilingSprite: Sprite, Texture, ImageSource, VideoSource }
})
vi.mock('pixi.js', () => pixi)
import { createBackgroundRenderer } from '../app/background/renderer'

class Video extends EventTarget {
  static all: Video[] = []
  src = ''; muted = false; loop = false; playsInline = false; preload = ''; paused = true
  readyState = 0; videoWidth = 1920; videoHeight = 1080; currentTime = 0
  callbacks = new Map<number, VideoFrameRequestCallback>(); nextId = 1
  rejectPlay = false
  constructor() { super(); Video.all.push(this) }
  load() {}
  pause() { this.paused = true }
  play() { if (this.rejectPlay) return Promise.reject(new Error('blocked')); this.paused = false; return Promise.resolve() }
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) { const id = this.nextId++; this.callbacks.set(id, callback); return id }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id) }
  ready() { this.readyState = 2; this.dispatchEvent(new Event('loadeddata')) }
  frame() { const callbacks = [...this.callbacks.values()]; this.callbacks.clear(); callbacks.forEach(cb => cb(0, {} as VideoFrameCallbackMetadata)) }
}
class ImageResource extends EventTarget {
  static all: ImageResource[] = []
  src = ''; width = 128; height = 128; naturalWidth = 128; naturalHeight = 128
  decodeResult: Promise<void> = Promise.resolve()
  constructor() { super(); ImageResource.all.push(this) }
  decode() {
    const sizes: Record<string, number> = { 'diagonal.png': 2, 'crosses.png': 3, 'squares.png': 3, 'circles.png': 6, 'triangles.png': 3, 'diamonds.png': 3 }
    const size = sizes[this.src.split('/').at(-1)!]
    if (size) { this.width = this.naturalWidth = size; this.height = this.naturalHeight = size }
    return this.decodeResult
  }
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
}
const background = (id = '00000000-0000-4000-8000-000000000001'): ScreenBackground => ({
  mediaId: id, kind: 'video', opacity: .6, dim: .35, pattern: { shape: 'circles', color: '#445566', opacity: .25, scale: 2 },
})
let doc: EventTarget & { hidden: boolean; createElement: (tag: string) => Video }
let motion: EventTarget & { matches: boolean }
let resize: () => void
let host: HTMLElement
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
beforeEach(() => {
  vi.useFakeTimers()
  ImageResource.all = []; Video.all = []; pixi.Application.all = []; pixi.VideoSource.all = []; pixi.Application.initWait = null
  doc = Object.assign(new EventTarget(), { hidden: false, createElement: () => new Video() })
  motion = Object.assign(new EventTarget(), { matches: false })
  host = { clientWidth: 800, clientHeight: 800, appendChild: vi.fn() } as unknown as HTMLElement
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', { devicePixelRatio: 3, matchMedia: () => motion })
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  vi.stubGlobal('Image', ImageResource)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function mount() {
  const errors: (string | null)[] = []
  const renderer = await createBackgroundRenderer(host, error => errors.push(error))
  return { renderer, errors, app: pixi.Application.all[0]! }
}
async function load(renderer: Awaited<ReturnType<typeof createBackgroundRenderer>>, value = background()) {
  const pending = renderer.setBackground(value)
  await flush(); Video.all.at(-1)!.ready(); await pending; await flush()
}

describe('screen media renderer', () => {
  it('covers without stretching, tints the pattern, and applies three independent opacities', async () => {
    const { renderer, app } = await mount()
    await load(renderer)
    const [video, dim, pattern] = app.stage.children
    expect(video.width).toBeCloseTo(1422.222, 2)
    expect(video.height).toBe(800)
    expect(video.x).toBeCloseTo(-311.111, 2)
    expect(video.y).toBe(0)
    expect([video.alpha, dim.alpha, pattern.alpha]).toEqual([.6, .35, .25])
    expect(pattern.tint).toBe('#445566')
    expect(pattern.tileScale.x * pattern.texture.width).toBe(12)
    expect(app.options.resolution).toBe(2)
    expect(app.options.autoStart).toBe(false)
    expect(pixi.VideoSource.all[0]!.autoUpdate).toBe(false)
    expect(Video.all[0]!.src).toBe('/api/v1/background-media/00000000-0000-4000-8000-000000000001')
    expect([Video.all[0]!.muted, Video.all[0]!.loop, Video.all[0]!.playsInline]).toEqual([true, true, true])
    renderer.destroy()
  })

  it.each([
    { shape: 'diagonal', scale: 1, period: 2 },
    { shape: 'crosses', scale: 1, period: 3 },
    { shape: 'squares', scale: 1, period: 3 },
    { shape: 'triangles', scale: 1, period: 3 },
    { shape: 'diamonds', scale: 1, period: 3 },
    { shape: 'circles', scale: 1, period: 6 },
    { shape: 'diagonal', scale: .25, period: 2 },
    { shape: 'circles', scale: 1.49, period: 6 },
    { shape: 'diagonal', scale: 1.5, period: 4 },
    { shape: 'crosses', scale: 4, period: 12 },
  ] as const)('keeps intrinsic pixel cells with integer nearest-neighbor scaling: %o', async ({ shape, scale, period }) => {
    const { renderer, app } = await mount()
    await load(renderer, { ...background(), pattern: { ...background().pattern, shape, scale } })
    const pattern = app.stage.children[2]
    expect(pattern.tileScale.x * pattern.texture.width).toBe(period)
    expect(pattern.tileScale.y * pattern.texture.height).toBe(period)
    expect(pattern.texture.options.source.options.scaleMode).toBe('nearest')
    expect(pattern.texture.options.source.options.autoGenerateMipmaps).toBe(false)
    expect(app.stage.children[0].alpha).toBe(.6)
    expect(pattern.alpha).toBe(.25)
    renderer.destroy()
  })

  it.each([
    ['diagonal', ['10', '01']],
    ['crosses', ['010', '111', '010']],
    ['squares', ['110', '110', '000']],
    ['circles', ['001100', '011110', '111111', '111111', '011110', '001100']],
    ['triangles', ['100', '110', '111']],
    ['diamonds', ['010', '111', '010']],
  ])('ships exact binary white-alpha %s PNG cells without antialiasing', (shape, rows) => {
    const bytes = readFileSync(new URL(`../app/background/patterns/${shape}.png`, import.meta.url))
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes[24], bytes[25]]).toEqual([rows[0]!.length, rows.length, 8, 6])
    const chunks: Buffer[] = []
    for (let offset = 8; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset)
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size))
      offset += size + 12
    }
    const pixels = inflateSync(Buffer.concat(chunks))
    const stride = rows[0]!.length * 4 + 1
    rows.forEach((row, y) => {
      expect(pixels[y * stride]).toBe(0)
      ;[...row].forEach((bit, x) => expect([...pixels.subarray(y * stride + 1 + x * 4, y * stride + 5 + x * 4)])
        .toEqual(bit === '1' ? [255, 255, 255, 255] : [255, 255, 255, 0]))
    })
  })

  it('renders a decoded image once with cover fit and the same independent layers', async () => {
    const { renderer, app } = await mount()
    const value: ScreenBackground = { ...background(), kind: 'image' }
    const pending = renderer.setBackground(value)
    expect(Video.all).toHaveLength(0)
    const image = ImageResource.all.at(-1)!
    image.naturalWidth = image.width = 1920; image.naturalHeight = image.height = 1080
    await pending
    const [sprite, dim, pattern] = app.stage.children
    expect(image.src).toBe('/api/v1/background-media/00000000-0000-4000-8000-000000000001')
    expect(Video.all).toHaveLength(0)
    expect(pixi.VideoSource.all).toHaveLength(0)
    expect(sprite.texture.options.source.options.scaleMode).toBeUndefined()
    expect(sprite.width).toBeCloseTo(1422.222, 2)
    expect(sprite.height).toBe(800)
    expect([sprite.alpha, dim.alpha, pattern.alpha]).toEqual([.6, .35, .25])
    expect(pattern.tileScale.x * pattern.texture.width).toBe(12)
    const initial = app.renders
    await vi.advanceTimersByTimeAsync(10000)
    expect(app.renders).toBe(initial)
    await renderer.setBackground({ ...value, opacity: .1, pattern: { ...value.pattern, opacity: .8 } })
    expect(app.stage.children[0].alpha).toBe(.1)
    expect(app.stage.children[2].alpha).toBe(.8)
    expect(ImageResource.all).toHaveLength(7)
    const changed = app.renders; resize(); expect(app.renders).toBe(changed + 1)
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'))
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); await flush()
    expect(app.renders).toBe(changed + 2)
    const texture = sprite.texture
    renderer.destroy()
    expect(image.src).toBe('')
    expect(texture.destroyed).toBe(true)
  })

  it('switches image to video and back without duplicate canvases or active resources', async () => {
    const { renderer, app } = await mount()
    await renderer.setBackground({ ...background(), kind: 'image' })
    const image = ImageResource.all.at(-1)!, imageTexture = app.stage.children[0].texture
    await load(renderer, background())
    expect(image.src).toBe(''); expect(imageTexture.destroyed).toBe(true)
    const video = Video.all[0]!
    await renderer.setBackground({ ...background(), kind: 'image' })
    expect(video.src).toBe(''); expect(video.callbacks.size).toBe(0)
    expect(video.paused).toBe(true)
    expect(pixi.Application.all).toHaveLength(1)
    expect(app.canvas.hidden).toBe(false)
    renderer.destroy()
  })

  it('applies the newest image settings after an in-flight decode without allocating another resource', async () => {
    const { renderer, app } = await mount()
    let decode!: () => void
    const decoding = new Promise<void>(resolve => { decode = resolve })
    vi.stubGlobal('Image', class extends ImageResource { constructor() { super(); this.decodeResult = decoding } })
    const value: ScreenBackground = { ...background(), kind: 'image' }
    const old = renderer.setBackground(value)
    const latest = renderer.setBackground({ ...value, opacity: .15, pattern: { ...value.pattern, opacity: .45 } })
    decode(); await Promise.all([old, latest])
    expect(ImageResource.all).toHaveLength(7)
    expect(app.stage.children[0].alpha).toBe(.15)
    expect(app.stage.children[2].alpha).toBe(.45)
    expect(Video.all).toHaveLength(0)
    renderer.destroy()
  })

  it.each(['replace', 'destroy'])('ignores a late image decode after %s and immediately settles its pending update', async action => {
    const { renderer, app, errors } = await mount()
    let decode!: () => void
    const decoding = new Promise<void>(resolve => { decode = resolve })
    vi.stubGlobal('Image', class extends ImageResource { constructor() { super(); this.decodeResult = decoding } })
    const old = renderer.setBackground({ ...background(), kind: 'image' })
    const image = ImageResource.all.at(-1)!
    if (action === 'replace') await load(renderer, background('00000000-0000-4000-8000-000000000002'))
    else renderer.destroy()
    await old
    const lastError = errors.at(-1), renders = app.renders, texture = app.stage.children[0].texture
    decode(); await flush()
    expect(image.src).toBe('')
    expect(app.renders).toBe(renders)
    expect(app.stage.children[0].texture).toBe(texture)
    expect(errors.at(-1)).toBe(lastError)
    renderer.destroy()
  })

  it.each(['decode', 'timeout'])('falls back to theme on image %s failure and can recover', async failure => {
    const { renderer, app, errors } = await mount()
    vi.stubGlobal('Image', class extends ImageResource {
      constructor() { super(); this.decodeResult = failure === 'decode' ? Promise.reject(new Error('unsupported image')) : new Promise(() => {}) }
    })
    const pending = renderer.setBackground({ ...background(), kind: 'image' })
    const image = ImageResource.all.at(-1)!
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(20000)
    await pending; await flush()
    expect(app.canvas.hidden).toBe(true); expect(image.src).toBe('')
    expect(errors.at(-1)).toEqual(expect.any(String))
    vi.stubGlobal('Image', ImageResource)
    await renderer.setBackground({ ...background(), kind: 'image' })
    expect(app.canvas.hidden).toBe(false); expect(errors.at(-1)).toBeNull()
    expect(Video.all).toHaveLength(0)
    renderer.destroy()
  })

  it('renders on decoded frames and resizing without a constant render loop', async () => {
    const { renderer, app } = await mount(); await load(renderer)
    const video = Video.all[0]!, before = app.renders
    await vi.advanceTimersByTimeAsync(3000)
    expect(app.renders).toBe(before)
    video.frame()
    expect(app.renders).toBe(before + 1)
    Object.assign(host, { clientWidth: 1200, clientHeight: 600 }); resize()
    expect(app.width).toBe(1200)
    expect(app.stage.children[0].width).toBe(1200)
    expect(app.stage.children[0].height).toBe(675)
    renderer.destroy()
  })

  it('changes layers without restarting or duplicating the video or canvas', async () => {
    const { renderer, app } = await mount(); await load(renderer)
    await renderer.setBackground({ ...background(), opacity: 0, dim: 1, pattern: { ...background().pattern, shape: 'none', opacity: 0 } })
    expect(Video.all).toHaveLength(1)
    expect(pixi.Application.all).toHaveLength(1)
    expect(app.stage.children.map(item => item.alpha)).toEqual([0, 1, 0])
    expect(app.stage.children[2].visible).toBe(false)
    renderer.destroy()
  })

  it('pauses while hidden and reduced motion keeps a still frame', async () => {
    const { renderer, app } = await mount(); await load(renderer)
    const video = Video.all[0]!
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'))
    expect(video.paused).toBe(true); expect(video.callbacks.size).toBe(0)
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); await flush()
    expect(video.paused).toBe(false); expect(video.callbacks.size).toBe(1)
    motion.matches = true; motion.dispatchEvent(new Event('change')); await flush()
    expect(video.paused).toBe(true); expect(video.callbacks.size).toBe(0)
    const before = app.renders; await vi.advanceTimersByTimeAsync(2000)
    expect(app.renders).toBe(before)
    motion.matches = false; motion.dispatchEvent(new Event('change')); await flush()
    expect(video.paused).toBe(false)
    renderer.destroy()
  })

  it.each([
    { pause: 'hidden', rapidResume: false },
    { pause: 'hidden', rapidResume: true },
    { pause: 'reduced-motion', rapidResume: false },
    { pause: 'reduced-motion', rapidResume: true },
  ])('ignores an intentionally interrupted play attempt: %o', async ({ pause, rapidResume }) => {
    const { renderer, app, errors } = await mount()
    const pending = renderer.setBackground(background()); await flush()
    const video = Video.all[0]!
    let rejectFirst!: (reason: unknown) => void
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
    const play = vi.spyOn(video, 'play').mockImplementationOnce(() => { video.paused = false; return first })
    video.ready(); await flush()
    const setPaused = (value: boolean) => {
      if (pause === 'hidden') { doc.hidden = value; doc.dispatchEvent(new Event('visibilitychange')) }
      else { motion.matches = value; motion.dispatchEvent(new Event('change')) }
    }
    setPaused(true)
    expect(video.paused).toBe(true)
    if (rapidResume) { setPaused(false); await flush() }
    rejectFirst(new DOMException('play() interrupted by pause()', 'AbortError'))
    await pending; await flush()
    expect(app.canvas.hidden).toBe(false)
    expect(video.src).not.toBe('')
    expect(errors.every(error => error === null)).toBe(true)
    if (!rapidResume) { setPaused(false); await flush() }
    expect(video.paused).toBe(false)
    expect(video.callbacks.size).toBe(1)
    expect(play).toHaveBeenCalledTimes(2)
    renderer.destroy()
  })

  it('ignores stale play success without pausing a later playback intent', async () => {
    const { renderer, app } = await mount()
    const pending = renderer.setBackground(background()); await flush()
    const video = Video.all[0]!
    let resolveFirst!: () => void
    const first = new Promise<void>(resolve => { resolveFirst = resolve })
    vi.spyOn(video, 'play').mockImplementationOnce(() => { video.paused = false; return first })
    const pause = vi.spyOn(video, 'pause')
    video.ready(); await flush()
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'))
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); await flush()
    const pauses = pause.mock.calls.length
    resolveFirst(); await pending; await flush()
    expect(pause).toHaveBeenCalledTimes(pauses)
    expect(video.paused).toBe(false)
    expect(video.callbacks.size).toBe(1)
    expect(app.canvas.hidden).toBe(false)
    renderer.destroy()
  })

  it('keeps genuine failure handling for the current deferred play intent', async () => {
    const { renderer, app, errors } = await mount()
    const pending = renderer.setBackground(background()); await flush()
    const video = Video.all[0]!
    let rejectPlay!: (reason: unknown) => void
    vi.spyOn(video, 'play').mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectPlay = reject }))
    video.ready(); await flush()
    rejectPlay(new DOMException('autoplay denied', 'NotAllowedError'))
    await pending; await flush()
    expect(app.canvas.hidden).toBe(true)
    expect(video.src).toBe('')
    expect(errors.at(-1)).toEqual(expect.any(String))
    renderer.destroy()
  })

  it('uses a bounded playback-only fallback when decoded-frame callbacks are unavailable', async () => {
    const { renderer, app } = await mount()
    const pending = renderer.setBackground(background()); await flush()
    const video = Video.all[0]!
    Object.assign(video, { requestVideoFrameCallback: undefined, cancelVideoFrameCallback: undefined })
    video.ready(); await pending
    const before = app.renders; await vi.advanceTimersByTimeAsync(1000)
    expect(app.renders - before).toBeGreaterThanOrEqual(25)
    expect(app.renders - before).toBeLessThanOrEqual(31)
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'))
    const hidden = app.renders; await vi.advanceTimersByTimeAsync(1000)
    expect(app.renders).toBe(hidden)
    renderer.destroy()
  })

  it('cancels stale loading before a different screen can become visible', async () => {
    const { renderer, app, errors } = await mount()
    const old = renderer.setBackground(background()); await flush(); const first = Video.all[0]!
    const next = renderer.setBackground(background('00000000-0000-4000-8000-000000000002')); await flush()
    expect(first.paused).toBe(true); expect(first.src).toBe('')
    first.ready(); Video.all[1]!.ready(); await Promise.all([old, next])
    expect(pixi.VideoSource.all.at(-1)!.resource).toBe(Video.all[1])
    expect(app.canvas.hidden).toBe(false)
    expect(errors.at(-1)).toBeNull()
    renderer.destroy()
  })

  it.each(['error', 'timeout', 'autoplay'])('restores theme fallback on %s and can recover with a new background', async (failure) => {
    const { renderer, app, errors } = await mount()
    const pending = renderer.setBackground(background()); await flush(); const video = Video.all[0]!
    if (failure === 'error') video.dispatchEvent(new Event('error'))
    else if (failure === 'timeout') await vi.advanceTimersByTimeAsync(20000)
    else { video.rejectPlay = true; video.ready() }
    await pending; await flush()
    expect(app.canvas.hidden).toBe(true)
    expect(video.paused).toBe(true)
    expect(errors.at(-1)).toEqual(expect.any(String))
    await load(renderer, background('00000000-0000-4000-8000-000000000002'))
    expect(app.canvas.hidden).toBe(false); expect(errors.at(-1)).toBeNull()
    renderer.destroy()
  })

  it('falls back to the theme if a GPU render fails after successful playback', async () => {
    const { renderer, app, errors } = await mount(); await load(renderer)
    app.render = () => { throw new Error('GPU lost') }
    Video.all[0]!.frame()
    expect(app.canvas.hidden).toBe(true)
    expect(Video.all[0]!.paused).toBe(true)
    expect(errors.at(-1)).toEqual(expect.any(String))
    renderer.destroy()
  })

  it.each(['resize', 'contextloss'])('restores the theme on a renderer %s failure', async failure => {
    const { renderer, app, errors } = await mount(); await load(renderer)
    if (failure === 'resize') {
      app.renderer.resize = () => { throw new Error('GPU lost') }
      expect(() => resize()).not.toThrow()
    } else app.canvas.dispatchEvent(new Event('webglcontextlost'))
    expect(app.canvas.hidden).toBe(true)
    expect(Video.all[0]!.paused).toBe(true)
    expect(errors.at(-1)).toEqual(expect.any(String))
    renderer.destroy()
  })

  it('still stops video and destroys the application if releasing a texture fails', async () => {
    const { renderer, app } = await mount(); await load(renderer)
    const video = Video.all[0]!
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    pixi.VideoSource.all[0]!.destroy = () => { throw new Error('cleanup failed') }
    expect(() => renderer.destroy()).not.toThrow()
    expect(video.src).toBe('')
    expect(video.callbacks.size).toBe(0)
    expect(app.destroyed).toBe(true)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('clear and destroy stop pending work, detach resources and ignore late events', async () => {
    const { renderer, app, errors } = await mount(); await load(renderer)
    const first = Video.all[0]!, source = pixi.VideoSource.all[0]!
    await renderer.setBackground(null)
    expect(first.paused).toBe(true); expect(first.src).toBe('')
    expect(first.callbacks.size).toBe(0); expect(source.destroyed).toBe(true); expect(app.canvas.hidden).toBe(true)
    const pending = renderer.setBackground(background()); await flush(); const second = Video.all[1]!
    renderer.destroy(); second.ready(); second.dispatchEvent(new Event('error')); await pending
    expect(app.destroyed).toBe(true); expect(second.src).toBe('')
    const count = errors.length
    doc.dispatchEvent(new Event('visibilitychange')); motion.dispatchEvent(new Event('change'))
    await vi.advanceTimersByTimeAsync(20000)
    expect(errors).toHaveLength(count)
    renderer.destroy()
  })
})
