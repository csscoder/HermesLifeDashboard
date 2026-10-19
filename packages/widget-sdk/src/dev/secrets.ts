import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { secretsOf, secretValueError } from '@lifedashboard/contracts/widget-secrets'

export function readDevSecrets(
  dir: string,
  manifest: WidgetPackageManifest,
  log: (kind: 'secret', message: string) => void,
  seen: Map<string, string> = new Map(),
): Map<string, string> {
  let contents: string
  try {
    contents = readFileSync(join(dir, '.env.local'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    seen.clear()
    return new Map()
  }
  const env = parseEnv(contents)
  const values = new Map<string, string>()
  const problems = new Set<string>()
  for (const { key, bind } of secretsOf(manifest.settings)) {
    const value = env[`LD_SECRET_${key}`]
    if (value === undefined) continue
    const message = secretValueError(value, bind)
    if (message === null) {
      values.set(key, value)
    } else {
      problems.add(key)
      if (seen.get(key) !== message) {
        log('secret', `${key}: ${message}`)
        seen.set(key, message)
      }
    }
  }
  for (const key of seen.keys()) {
    if (!problems.has(key)) seen.delete(key)
  }
  return values
}
