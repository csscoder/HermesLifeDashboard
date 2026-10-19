#!/usr/bin/env node
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { buildWidget } from './build.ts'

const usage = 'Usage: ld-widget <build|check> [dir] [options]'
const commands: Record<string, (args: string[]) => Promise<number>> = {
  async build(args) {
    const unknown = args.find((arg) => arg.startsWith('--') && arg !== '--no-source')
    if (unknown !== undefined) {
      console.error(usage)
      return 2
    }
    const dir = args.find((arg) => !arg.startsWith('--')) ?? process.cwd()
    const target = await buildWidget(dir, { source: !args.includes('--no-source') })
    console.log(`Built ${target}`)
    if (!args.includes('--no-source')) {
      const source = join(target, 'source')
      const entries = await readdir(source, { recursive: true, withFileTypes: true })
      const files = entries.filter((entry) => entry.isFile())
        .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/')).sort()
      console.log(`source/: ${files.length} files`)
      for (const file of files) console.log(`  ${file}`)
    }
    return 0
  },
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === undefined || !Object.hasOwn(commands, command)) {
    console.error(usage)
    process.exitCode = 2
  } else {
    process.exitCode = await commands[command]!(args)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
