interface StyleTarget {
  setProperty(name: string, value: string): void
  removeProperty(name: string): unknown
}

/**
 * Sets theme tokens on the frame root. Names the previous theme set but the new one lacks
 * (optional tokens such as --ld-glow) are removed, so a theme switch never leaves stale values.
 * Returns the names now applied.
 */
export function applyTokens(style: StyleTarget, previous: readonly string[], tokens: Record<string, string>): string[] {
  const names = Object.keys(tokens).filter((name) => name.startsWith('--'))
  for (const name of previous) if (!names.includes(name)) style.removeProperty(name)
  for (const name of names) style.setProperty(name, tokens[name]!)
  return names
}
