/** Verify decoding before copying a potentially large file into application storage. */
export async function probeMedia(file: File, signal: AbortSignal): Promise<void> {
  if (!/\.(mp4|m4v|mov|webm|png|jpe?g|webp|avif)$/i.test(file.name) || file.size === 0)
    throw new Error('Выберите непустой файл: MP4, M4V, MOV, WebM, PNG, JPEG, WebP или AVIF.')
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (/\.(png|jpe?g|webp|avif)$/i.test(file.name)) return probeImage(file, signal)
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => finish(new Error('Браузер не может воспроизвести это видео. Выберите другой файл или кодек.'))
      const loaded = () => video.videoWidth > 0 && video.videoHeight > 0 ? finish() : fail()
      const abort = () => finish(new DOMException('Aborted', 'AbortError'))
      const timer = setTimeout(() => finish(new Error('Истекло время проверки видео. Попробуйте другой файл.')), 15000)
      function finish(error?: Error) {
        clearTimeout(timer)
        video.removeEventListener('loadeddata', loaded)
        video.removeEventListener('error', fail)
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve()
      }
      video.addEventListener('loadeddata', loaded)
      video.addEventListener('error', fail)
      signal.addEventListener('abort', abort, { once: true })
      video.src = url
      video.load()
    })
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

async function probeImage(file: File, signal: AbortSignal): Promise<void> {
  const url = URL.createObjectURL(file)
  const image = document.createElement('img')
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false
      const fail = () => finish(new Error('Браузер не может открыть это изображение. Выберите другой файл.'))
      const loaded = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? finish() : fail()
      const abort = () => finish(new DOMException('Aborted', 'AbortError'))
      const timer = setTimeout(() => finish(new Error('Истекло время проверки изображения. Попробуйте другой файл.')), 15000)
      function finish(error?: Error) {
        if (finished) return
        finished = true
        clearTimeout(timer)
        image.removeEventListener('load', loaded)
        image.removeEventListener('error', fail)
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve()
      }
      image.addEventListener('error', fail)
      signal.addEventListener('abort', abort, { once: true })
      if (typeof image.decode !== 'function') image.addEventListener('load', loaded)
      image.src = url
      if (typeof image.decode === 'function') void image.decode().then(loaded, fail)
    })
  } finally {
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}
