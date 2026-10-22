#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { buildWidget } from './build.ts'
import { checkWidget } from './check.ts'
import { startDevServer } from './dev/server.ts'
import { takeShots, type ShotOptions } from './shot.ts'

const usage = 'Usage: ld-widget <build|check|dev|shot> [dir] [options]'
const commands: Record<string, (args: string[]) => Promise<number>> = {
  async dev(args) {
    let dir: string | undefined
    let port: number | undefined
    let poll = false
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!
      if (arg === '--poll' && !poll) poll = true
      else if (arg === '--port' && port === undefined) {
        const value = args[++index]
        if (value === undefined || !/^\d+$/.test(value) || Number(value) > 65535) {
          console.error(usage)
          return 2
        }
        port = Number(value)
      } else if (!arg.startsWith('-') && dir === undefined) dir = arg
      else { console.error(usage); return 2 }
    }
    const root = resolve(dir ?? process.cwd())
    const server = await startDevServer(root, { port, poll })
    try {
      console.log(`Dev shell: ${server.url}`)
      console.log('Log: .ld-widget/dev.log')
      const manifest = JSON.parse(await readFile(join(root, 'widget.json'), 'utf8')) as { settings?: { properties?: Record<string, { type: string }> } }
      if (Object.values(manifest.settings?.properties ?? {}).some((setting) => setting.type === 'secret')) {
        console.log('Secrets: .env.local (LD_SECRET_<key>=…)')
      }
      await new Promise<void>((resolve) => { process.once('SIGINT', resolve) })
    } finally {
      await server.close()
    }
    return 0
  },
  async shot(args) {
    let dir: string | undefined
    const options: ShotOptions & Required<Pick<ShotOptions, 'sizes' | 'themes' | 'frames'>> = { sizes: [], themes: [], frames: [] }
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!
      const value = args[index + 1]
      const size = value === undefined ? null : /^(\d+)x(\d+)$/.exec(value)
      if (arg === '--size' && size) options.sizes.push({ w: Number(size[1]), h: Number(size[2]) })
      else if (arg === '--theme' && value !== undefined) options.themes.push(value)
      else if (arg === '--frame' && (value === 'framed' || value === 'frameless')) options.frames.push(value)
      else if (arg === '--wait' && value !== undefined && /^\d+$/.test(value)) options.wait = Number(value)
      else if (!arg.startsWith('-') && dir === undefined) { dir = arg; continue }
      else { console.error(usage); return 2 }
      index++
    }
    const results = await takeShots(dir ?? process.cwd(), {
      ...options,
      sizes: options.sizes.length ? options.sizes : undefined,
      themes: options.themes.length ? options.themes : undefined,
      frames: options.frames.length ? options.frames : undefined,
    })
    for (const { file, rendered } of results) console.log(rendered ? file : `${file} (the widget did not render in 15 s)`)
    return results.every((result) => result.rendered) ? 0 : 1
  },
  async check(args) {
    if (args.length > 1 || args.some((arg) => arg.startsWith('--'))) {
      console.error(usage)
      return 2
    }
    const { ok, problems } = await checkWidget(args[0] ?? process.cwd())
    for (const problem of problems) {
      const location = problem.file === undefined ? '' : `${problem.file}${problem.line === undefined ? '' : `:${problem.line}`} `
      console.log(`✗ [${problem.rule}] ${location}${problem.message}`)
    }
    console.log(ok ? 'check: OK' : `check: ${problems.length} problems`)
    return ok ? 0 : 1
  },
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
