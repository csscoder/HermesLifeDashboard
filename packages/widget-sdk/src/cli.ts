#!/usr/bin/env node
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { buildWidget } from './build.ts'

const [command, ...rest] = process.argv.slice(2)
const unknown = rest.find((arg) => arg.startsWith('--') && arg !== '--no-source')
if (command !== 'build' || unknown !== undefined) {
  console.error('Usage: ld-widget build [dir] [--no-source]')
  process.exit(2)
}
const dir = rest.find((arg) => !arg.startsWith('--')) ?? process.cwd()
try {
  const target = await buildWidget(dir, { source: !rest.includes('--no-source') })
  console.log(`Built ${target}`)
  if (!rest.includes('--no-source')) {
    const source = join(target, 'source')
    const entries = await readdir(source, { recursive: true, withFileTypes: true })
    const files = entries.filter((entry) => entry.isFile())
      .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/')).sort()
    console.log(`source/: ${files.length} files`)
    for (const file of files) console.log(`  ${file}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
