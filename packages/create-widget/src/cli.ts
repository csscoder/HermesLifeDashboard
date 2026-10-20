#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { createWidgetProject } from './create.ts'
import { packageManager } from './install.ts'
import { askTitle } from './prompt.ts'

const USAGE = 'Invalid arguments. Fix: use create-widget [title] [--slug <slug>] [--sdk <version|path|tarball>] [--no-install].'

function parseCliArgs() {
  try {
    const parsed = parseArgs({
      options: {
        slug: { type: 'string' },
        sdk: { type: 'string' },
        'no-install': { type: 'boolean' },
      },
      allowPositionals: true,
    })
    if (parsed.positionals.length > 1) throw new Error(USAGE)
    return parsed
  } catch {
    throw new Error(USAGE)
  }
}

try {
  const args = parseCliArgs()
  const title = args.positionals[0] ?? (process.stdin.isTTY
    ? await askTitle(process.stdin, process.stdout)
    : undefined)
  if (title === undefined) {
    throw new Error('Missing widget title. Fix: run create-widget "<title>" [--slug <slug>].')
  }
  const { dir, slug } = await createWidgetProject({
    title, slug: args.values.slug, parentDir: process.cwd(), sdk: args.values.sdk,
  })
  const folder = basename(dir)
  const manager = packageManager(process.env.npm_config_user_agent)
  const noInstall = args.values['no-install'] === true
  if (!noInstall) {
    const result = spawnSync(manager, ['install'], { cwd: dir, stdio: 'inherit' })
    if (result.error || result.status !== 0) {
      throw new Error(`Dependency install failed. Fix: run "cd ${folder} && ${manager} install".`)
    }
  }
  console.log([
    `Created ${folder}/`,
    `  title: ${title}`,
    `  id: dev.local.${slug}`,
    `  package: ${slug}`,
    `Next: open ${folder}/ in Claude Code or Codex; the agent starts from AGENTS.md.`,
    ...(noInstall ? [`Install dependencies first: cd ${folder} && ${manager} install`] : []),
  ].join('\n'))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
