import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeMedia } from '../app/background/import-media'

class Video extends EventTarget {
  videoWidth = 1920
  videoHeight = 1080
  src = ''
  muted = false
  playsInline = false
  preload = ''
  load = vi.fn()
  pause = vi.fn()
  removeAttribute() { this.src = '' }
}
let video: Video
let image: ReturnType<typeof createImage>
function createImage() {
  return { src: '', naturalWidth: 120, naturalHeight: 80, decode: vi.fn(async () => {}), removeAttribute() { this.src = '' }, addEventListener() {}, removeEventListener() {} }
}
const create = vi.fn(() => 'blob:test'), revoke = vi.fn()
beforeEach(() => {
  vi.useFakeTimers(); video = new Video(); image = createImage()
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'img' ? image : video })
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('local background media decode probe', () => {
  it('rejects unsupported files before allocating resources', async () => {
    await expect(probeMedia(new File(['x'], 'clip.avi', { type: 'video/x-msvideo' }), new AbortController().signal)).rejects.toThrow(/MP4/)
    expect(create).not.toHaveBeenCalled()
  })
  it('waits for a decoded first frame and releases the URL/video', async () => {
    const pending = probeMedia(new File(['x'], 'clip.mp4'), new AbortController().signal)
    let done = false; pending.then(() => { done = true }, () => {})
    video.dispatchEvent(new Event('loadedmetadata')); await Promise.resolve()
    expect(done).toBe(false)
    video.dispatchEvent(new Event('loadeddata')); await pending
    expect(video.muted).toBe(true); expect(video.playsInline).toBe(true)
    expect(video.pause).toHaveBeenCalled(); expect(video.src).toBe('')
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
  it('waits for native image decoding then releases its object URL', async () => {
    let finish!: () => void
    image.decode = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = probeMedia(new File(['x'], 'photo.webp'), new AbortController().signal)
    let done = false; pending.then(() => { done = true }, () => {})
    await Promise.resolve(); expect(done).toBe(false)
    finish(); await pending
    expect(image.src).toBe(''); expect(revoke).toHaveBeenCalledWith('blob:test')
  })
  it('supports native image load when decode is unavailable', async () => {
    const fallback = Object.assign(new EventTarget(), {
      src: '', naturalWidth: 120, naturalHeight: 80,
      removeAttribute() { this.src = '' },
    })
    vi.stubGlobal('document', { createElement: () => fallback })
    const pending = probeMedia(new File(['x'], 'photo.jpg'), new AbortController().signal)
    fallback.dispatchEvent(new Event('load')); await pending
    expect(fallback.src).toBe(''); expect(revoke).toHaveBeenCalledWith('blob:test')
  })
  it('rejects an already aborted image check without allocating an object URL', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(probeMedia(new File(['x'], 'photo.png'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(create).not.toHaveBeenCalled()
  })
  it('bounds failed, timed out and aborted image decoding and ignores late decode resolution', async () => {
    const file = new File(['x'], 'photo.avif')
    image.decode = vi.fn(async () => { throw new Error('decode') })
    await expect(probeMedia(file, new AbortController().signal)).rejects.toThrow(/изображение/)
    image = createImage(); image.naturalWidth = 0
    await expect(probeMedia(file, new AbortController().signal)).rejects.toThrow(/изображение/)
    let finish!: () => void
    image = createImage(); image.decode = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    let pending = probeMedia(file, new AbortController().signal)
    let rejected = expect(pending).rejects.toThrow(/время/)
    await vi.advanceTimersByTimeAsync(15000); await rejected
    const controller = new AbortController()
    pending = probeMedia(file, controller.signal)
    rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await rejected
    finish(); await Promise.resolve()
    expect(revoke).toHaveBeenCalledTimes(4)
  })
  it('rejects decode errors, zero dimension frames, timeout and cancellation and always frees resources', async () => {
    const file = new File(['x'], 'clip.webm')
    let pending = probeMedia(file, new AbortController().signal)
    let rejected = expect(pending).rejects.toThrow(/воспроизвести/)
    video.dispatchEvent(new Event('error')); await rejected
    video = new Video(); video.videoWidth = 0
    pending = probeMedia(file, new AbortController().signal)
    rejected = expect(pending).rejects.toThrow(/воспроизвести/)
    video.dispatchEvent(new Event('loadeddata')); await rejected
    video = new Video(); pending = probeMedia(file, new AbortController().signal)
    rejected = expect(pending).rejects.toThrow(/время/)
    await vi.advanceTimersByTimeAsync(15000); await rejected
    const controller = new AbortController(); pending = probeMedia(file, controller.signal)
    rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await rejected
    expect(revoke).toHaveBeenCalledTimes(4)
  })
})
