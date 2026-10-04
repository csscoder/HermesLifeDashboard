export interface Oklch {
  l: number
  c: number
  h: number
  alpha: number
}
/** Gamma-encoded sRGB channels 0–1 plus alpha. */
export interface Rgba {
  r: number
  g: number
  b: number
  alpha: number
}

const NUMBER = String.raw`(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)`
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*${NUMBER}\s+${NUMBER}\s+${NUMBER}(?:deg)?\s*(?:\/\s*${NUMBER}\s*)?\)$`,
  'i',
)

/** Parses an `oklch(L C H [/ A])` literal or `transparent`; anything else is null. */
export function parseColor(value: string): Oklch | null {
  const text = value.trim()
  if (text === 'transparent') return { l: 0, c: 0, h: 0, alpha: 0 }
  const m = OKLCH.exec(text)
  if (!m) return null
  const part = (index: number, percentOf: number) => {
    const n = Number(m[index])
    return m[index + 1] === '%' ? (n / 100) * percentOf : n
  }
  const l = part(1, 1)
  const c = part(3, 0.4)
  const alpha = m[7] === undefined ? 1 : part(7, 1)
  const h = Number(m[5])
  if (![l, c, h, alpha].every(Number.isFinite)) return null
  if (m[6] === '%' || l < 0 || l > 1 || c < 0 || c > 0.5 || alpha < 0 || alpha > 1) return null
  return { l, c, h, alpha }
}

function encode(x: number): number {
  // ponytail: per-channel clipping, not CSS Color 4 chroma-reduction gamut mapping; built-in themes stay near sRGB.
  const v = Math.min(1, Math.max(0, x))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

/** oklch → gamma-encoded sRGB (Björn Ottosson's OKLab matrices). */
export function toRgba({ l, c, h, alpha }: Oklch): Rgba {
  const rad = ((h % 360) * Math.PI) / 180 // the modulo keeps a huge finite hue from overflowing to NaN
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: encode(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: encode(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: encode(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
    alpha,
  }
}

/** Paints `top` over `bottom` the way browsers do: source-over in gamma-encoded sRGB. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha)
  if (alpha === 0) return { r: 0, g: 0, b: 0, alpha: 0 }
  const mix = (t: number, b: number) => (t * top.alpha + b * bottom.alpha * (1 - top.alpha)) / alpha
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), alpha }
}

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = ({ r, g, b }: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

/** WCAG 2 contrast ratio. Alpha is ignored: composite translucent colours first. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}
