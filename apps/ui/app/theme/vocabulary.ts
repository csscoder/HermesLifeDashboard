import { createGenerator } from 'unocss'
import config from '../../uno.config'

let generator: ReturnType<typeof createGenerator> | undefined

/**
 * Checks class names against the semantic vocabulary: blocked classes carry the blocklist message,
 * unknown classes generate no CSS. Used by tests now and by the Hermes SFC pipeline later (E6).
 */
export async function checkClasses(
  classes: readonly string[],
): Promise<{ unknown: string[]; blocked: { cls: string; message: string }[] }> {
  generator ??= createGenerator(config)
  const gen = await generator
  const { matched } = await gen.generate(classes.join(' '), { preflights: false })
  const unknown: string[] = []
  const blocked: { cls: string; message: string }[] = []
  for (const cls of new Set(classes)) {
    const hit = gen.getBlocked(cls)
    if (hit) {
      const message = hit[1]?.message
      blocked.push({ cls, message: typeof message === 'function' ? message(cls) : (message ?? 'Not allowed') })
    } else if (!matched.has(cls)) unknown.push(cls)
  }
  return { unknown, blocked }
}
