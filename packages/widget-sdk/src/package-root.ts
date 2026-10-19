import { createRequire } from 'node:module'
import { dirname } from 'node:path'

export function packageRoot(): string {
  return dirname(createRequire(import.meta.url).resolve('@lifedashboard/widget-sdk/package.json'))
}
