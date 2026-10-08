#!/usr/bin/env node
import { buildWidget } from './build.ts'

const [command, dir = process.cwd()] = process.argv.slice(2)
if (command !== 'build') {
  console.error('Usage: ld-widget build [dir]')
  process.exit(2)
}
try {
  console.log(`Built ${await buildWidget(dir)}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
