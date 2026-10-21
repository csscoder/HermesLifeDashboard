export function overflowReport(
  scroll: { w: number; h: number },
  inner: { w: number; h: number },
  last: string | null,
): string | null {
  // A frame without width or height is not laid out yet; the next resize measures it.
  if (inner.w === 0 || inner.h === 0) return null
  if (scroll.w <= inner.w + 1 && scroll.h <= inner.h + 1) return null
  const message = `content is ${scroll.w}×${scroll.h} px in a ${inner.w}×${inner.h} px frame`
  return message === last ? null : message
}

if (typeof window !== 'undefined') {
  const post = (kind: 'csp' | 'overflow' | 'rendered', message: string) => {
    window.parent.postMessage({ t: 'ld:dev', kind, message }, '*')
  }
  document.addEventListener('securitypolicyviolation', (event) => {
    post('csp', `${event.violatedDirective} blocked ${event.blockedURI}`)
  })
  let last: string | null = null
  let rendered = false
  const measure = () => {
    // `ld-widget shot` waits for this before it captures.
    if (!rendered && document.getElementById('app')?.hasChildNodes()) {
      rendered = true
      post('rendered', '')
    }
    const root = document.documentElement
    const message = overflowReport(
      { w: root.scrollWidth, h: root.scrollHeight },
      { w: window.innerWidth, h: window.innerHeight },
      last,
    )
    if (message !== null) {
      last = message
      post('overflow', message)
    }
  }
  new ResizeObserver(measure).observe(document.documentElement)
  setInterval(measure, 500)
}
