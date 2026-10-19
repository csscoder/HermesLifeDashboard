export interface DevTheme {
  id: string
  name: string
  mode: 'light' | 'dark'
  skin: string
  tokens: Record<string, string>
}

export function extractThemeTokens(css: string): Record<string, string> {
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries([...declarations.matchAll(/(--ld-[\w-]+)\s*:\s*([^;{}]+)(?:;|(?=\}))/g)]
    .map((match) => [match[1]!, match[2]!.trim()]))
}

/** Extract a top-level rule without changing its production CSS. */
export function extractCssBlock(css: string, selectorOrAtRule: string): string {
  let start = -1
  let depth = 0
  let header = ''
  let quote = ''
  for (let i = 0; i < css.length; i++) {
    const char = css[i]!
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) break
      i = end + 1
      continue
    }
    if (start === -1) {
      if (/\s/.test(char)) continue
      start = i
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '{') {
      if (depth === 0) header = css.slice(start, i).trim()
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        if (header === selectorOrAtRule) return css.slice(start, i + 1)
        start = -1
      }
    } else if (char === ';' && depth === 0) start = -1
  }
  throw new Error(`Missing CSS block "${selectorOrAtRule}". Fix: restore the production rule or update the dev asset selector.`)
}
