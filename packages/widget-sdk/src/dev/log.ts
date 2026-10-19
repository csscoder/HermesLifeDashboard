import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

export type DevLogKind = 'gateway' | 'error' | 'csp' | 'overflow' | 'manifest' | 'secret'
export interface DevLog {
  write(kind: DevLogKind, message: string, shell?: string): void
}

const oneLine = (value: string) => stripVTControlCharacters(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n')

export function createDevLog(dir: string): DevLog {
  const directory = join(dir, '.ld-widget')
  mkdirSync(directory, { recursive: true })
  return {
    write(kind, message, shell) {
      const text = `[${kind}] ${oneLine(message)}`
      console.log(`[ld-widget] ${text}`)
      appendFileSync(join(directory, 'dev.log'), `${new Date().toISOString()} ${text}${shell === undefined ? '' : ` (${oneLine(shell)})`}\n`)
    },
  }
}
