#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createWidgetProject } from './create.ts'

try {
  const args = (() => {
    try {
      const parsed = parseArgs({ options: { sdk: { type: 'string' } }, allowPositionals: true })
      if (parsed.positionals.length !== 1) throw new Error('Expected one project name')
      return parsed
    } catch {
      throw new Error('Invalid arguments. Fix: use create-widget <name> [--sdk <version|path|tarball>].')
    }
  })()
  const name = args.positionals[0]!
  await createWidgetProject({ title: name, slug: name, parentDir: process.cwd(), sdk: args.values.sdk })
  console.log(`Created ${name}/\nNext:\n  cd ${name}\n  npm install\n  npx ld-widget check\nRead AGENTS.md before writing code.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
