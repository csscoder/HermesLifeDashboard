#!/usr/bin/env node
import { buildWidget } from './build.ts'

const [command, ...rest] = process.argv.slice(2)
const unknown = rest.find((arg) => arg.startsWith('--') && arg !== '--no-source')
if (command !== 'build' || unknown !== undefined) {
  console.error('Usage: ld-widget build [dir] [--no-source]')
  process.exit(2)
}
const dir = rest.find((arg) => !arg.startsWith('--')) ?? process.cwd()
try {
  console.log(`Built ${await buildWidget(dir, { source: !rest.includes('--no-source') })}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
