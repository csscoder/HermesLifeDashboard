import { Application, Graphics, ImageSource, Sprite, Texture, TilingSprite, VideoSource } from 'pixi.js'
import type { ScreenBackground } from '@lifedashboard/contracts/board'
import circles from './patterns/circles.png'
import squares from './patterns/squares.png'
import diamonds from './patterns/diamonds.png'
import crosses from './patterns/crosses.png'
import diagonal from './patterns/diagonal.png'
import triangles from './patterns/triangles.png'

function cleanup(actions: (() => void)[]) {
  for (const action of actions) {
    try { action() } catch (error) { console.error('Background renderer cleanup failed', error) }
  }
}

const patternUrls = { circles, squares, diamonds, crosses, diagonal, triangles }
type Media = {
  background: ScreenBackground
  video: HTMLVideoElement | null
  image: HTMLImageElement | null
  width: number
  height: number
  source: VideoSource | ImageSource | null
  texture: Texture | null
  cancelWait: () => void
  failed: () => void
  ready: boolean
  pending: Promise<void>
}

export async function createBackgroundRenderer(host: HTMLElement, onError: (message: string | null) => void) {
  const app = new Application()
  const textures: Partial<Record<keyof typeof patternUrls, Texture>> = {}
  try {
    await app.init({
      width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight),
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
      backgroundAlpha: 0, autoStart: false, sharedTicker: false,
    })
    const loaded = await Promise.allSettled(Object.entries(patternUrls).map(async ([shape, url]) => {
      const image = new Image()
      image.src = url
      await image.decode()
      textures[shape as keyof typeof patternUrls] = new Texture({ source: new ImageSource({ resource: image, scaleMode: 'nearest', autoGenerateMipmaps: false }) })
    }))
    const failure = loaded.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  } catch (error) {
    cleanup([
      ...Object.values(textures).map(texture => () => texture.destroy(true)),
      () => app.destroy({ removeView: true }, { children: true }),
    ])
    throw error
  }

  const sprite = new Sprite({ texture: Texture.EMPTY })
  const dim = new Graphics()
  const pattern = new TilingSprite({ texture: Texture.EMPTY })
  app.stage.addChild(sprite, dim, pattern)
  app.canvas.hidden = true
  host.appendChild(app.canvas)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let destroyed = false
  let current: Media | null = null
  let playbackIntent = 0
  let frameHandle: number | null = null
  let fallback: ReturnType<typeof setTimeout> | null = null

  function stopFrames(media: Media) {
    if (frameHandle !== null) media.video?.cancelVideoFrameCallback?.(frameHandle)
    frameHandle = null
    if (fallback !== null) clearTimeout(fallback)
    fallback = null
  }
  function disposeMedia() {
    playbackIntent++
    const media = current
    current = null
    app.canvas.hidden = true
    if (!media) return
    sprite.texture = Texture.EMPTY
    cleanup([
      () => stopFrames(media), media.cancelWait,
      () => (media.video ?? media.image)?.removeEventListener('error', media.failed),
      () => media.video?.pause(),
      () => media.texture ? media.texture.destroy(true) : media.source?.destroy(),
      () => (media.video ?? media.image)?.removeAttribute('src'),
      () => media.video?.load(),
    ])
  }
  function fail(media: Media) {
    if (destroyed || current !== media) return
    disposeMedia()
    onError(media.video
      ? 'Не удалось воспроизвести фоновое видео. Выберите другой файл или поддерживаемый кодек.'
      : 'Не удалось загрузить фоновое изображение. Выберите другой файл.')
  }
  function render() {
    if (!destroyed && current?.ready && !document.hidden) app.render()
  }
  function resize() {
    if (destroyed) return
    try {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      app.renderer.resize(width, height)
      pattern.width = width; pattern.height = height
      dim.clear().rect(0, 0, width, height).fill(0x000000)
      if (current?.ready) {
        const factor = Math.max(width / current.width, height / current.height)
        sprite.width = current.width * factor
        sprite.height = current.height * factor
        sprite.x = (width - sprite.width) / 2
        sprite.y = (height - sprite.height) / 2
      }
      render()
    } catch {
      if (current) fail(current)
    }
  }
  function apply(media: Media) {
    const value = media.background
    sprite.alpha = value.opacity
    dim.alpha = value.dim
    pattern.alpha = value.pattern.opacity
    pattern.visible = value.pattern.shape !== 'none'
    pattern.texture = value.pattern.shape === 'none' ? Texture.EMPTY : textures[value.pattern.shape]!
    pattern.tint = value.pattern.color
    pattern.tileScale.set(Math.max(1, Math.round(value.pattern.scale)))
    resize()
  }
  function playing(media: Media) {
    return !destroyed && current === media && media.ready && !document.hidden && !reducedMotion.matches && !!media.video && !media.video.paused
  }
  function scheduleFrame(media: Media) {
    if (!playing(media) || frameHandle !== null || fallback !== null) return
    const frame = () => {
      frameHandle = null; fallback = null
      if (!playing(media)) return
      try { media.source!.update(); render() } catch { fail(media); return }
      scheduleFrame(media)
    }
    if (media.video?.requestVideoFrameCallback) frameHandle = media.video.requestVideoFrameCallback(frame)
    else fallback = setTimeout(frame, 1000 / 30)
  }
  async function syncPlayback() {
    const media = current
    if (!media?.ready || destroyed) return
    if (!media.video) { render(); return }
    if (document.hidden || reducedMotion.matches) {
      playbackIntent++
      stopFrames(media)
      media.video.pause()
      render()
      return
    }
    const intent = media.video.paused ? ++playbackIntent : playbackIntent
    try {
      if (media.video.paused) await media.video.play()
      if (intent !== playbackIntent) return
      if (!playing(media)) { media.video.pause(); return }
      scheduleFrame(media)
    } catch {
      if (intent === playbackIntent) fail(media)
    }
  }
  const contextLost = () => { if (current) fail(current) }
  app.canvas.addEventListener('webglcontextlost', contextLost)
  const visibilityChanged = () => { void syncPlayback() }
  document.addEventListener('visibilitychange', visibilityChanged)
  reducedMotion.addEventListener('change', visibilityChanged)
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  async function initializeMedia(media: Media) {
    const { video, image } = media
    const ready = new Promise<boolean>(resolve => {
      const finish = (value: boolean) => {
        clearTimeout(timeout)
        video?.removeEventListener('loadeddata', loaded)
        media.cancelWait = () => {}
        resolve(value)
      }
      const loaded = () => finish(true)
      const timeout = setTimeout(() => fail(media), 15000)
      media.cancelWait = () => finish(false)
      const url = `/api/v1/background-media/${media.background.mediaId}`
      if (video) {
        video.addEventListener('loadeddata', loaded)
        video.src = url
        video.load()
      } else if (image) {
        image.src = url
        void image.decode().then(loaded, () => fail(media))
      }
    })
    if (!await ready || destroyed || current !== media) return
    try {
      media.width = video ? video.videoWidth : image!.naturalWidth
      media.height = video ? video.videoHeight : image!.naturalHeight
      if (!media.width || !media.height) throw new Error('Media dimensions unavailable')
      if (video) {
        const source = new VideoSource({ resource: video, autoLoad: false, autoPlay: false })
        source.autoUpdate = false
        source.resize(media.width, media.height)
        media.source = source
      } else media.source = new ImageSource({ resource: image! })
      media.texture = new Texture({ source: media.source })
      sprite.texture = media.texture
      media.ready = true
      media.source.update()
      app.canvas.hidden = false
      apply(media)
      if (current !== media) return
      onError(null)
      if (video) await syncPlayback()
    } catch { fail(media) }
  }

  return {
    async setBackground(background: ScreenBackground | null) {
      if (destroyed) return
      if (background && current?.background.mediaId === background.mediaId && current.background.kind === background.kind) {
        current.background = background
        if (current.ready) {
          try { apply(current) } catch { fail(current) }
        }
        return current?.pending
      }
      disposeMedia()
      onError(null)
      if (!background) return
      const video = background.kind === 'video' ? document.createElement('video') : null
      const image = background.kind === 'image' ? new Image() : null
      if (video) { video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto' }
      const media: Media = {
        background, video, image, width: 0, height: 0, source: null, texture: null, cancelWait: () => {},
        failed: () => fail(media), ready: false, pending: Promise.resolve(),
      }
      current = media
      ;(video ?? image)!.addEventListener('error', media.failed)
      media.pending = initializeMedia(media)
      return media.pending
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      observer.disconnect()
      app.canvas.removeEventListener('webglcontextlost', contextLost)
      document.removeEventListener('visibilitychange', visibilityChanged)
      reducedMotion.removeEventListener('change', visibilityChanged)
      disposeMedia()
      cleanup([
        ...Object.values(textures).map(texture => () => texture.destroy(true)),
        () => app.destroy({ removeView: true }, { children: true }),
      ])
    },
  }
}
