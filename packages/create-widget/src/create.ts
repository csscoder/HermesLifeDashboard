import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { isPlainText } from '@lifedashboard/contracts/parse'
import { SLUG_PATTERN, slugFromTitle } from './slug.ts'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

export async function createWidgetProject(options: {
  title: string
  slug?: string
  parentDir: string
  sdk?: string
}): Promise<{ dir: string; slug: string }> {
  const { title, parentDir, sdk } = options
  if (!isPlainText(title)) {
    throw new Error(`Invalid title "${title}". Fix: use 1–60 characters without control characters.`)
  }
  const slug = options.slug ?? slugFromTitle(title)
  if (slug === null) {
    throw new Error(`Cannot derive a Latin name from "${title}". Fix: give one with --slug, for example --slug my-clock.`)
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid slug "${slug}". Fix: use lowercase letters, digits and dashes, starting with a letter.`)
  }
  const folder = `lifedashboard-${slug}`
  const projectDir = resolve(parentDir, folder)
  try {
    let entries: string[] = []
    try {
      entries = await readdir(projectDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (entries.length > 0) {
      throw new Error(`Folder ${folder} already exists and is not empty. Fix: choose another title or --slug, or remove the folder.`)
    }
    const specifier = sdkSpecifier(sdk, version, parentDir)
    await mkdir(projectDir, { recursive: true })
    const templateDir = new URL('../template/', import.meta.url)
    for (const entry of await readdir(templateDir)) {
      await cp(new URL(entry, templateDir), join(projectDir, entry), {
        recursive: true, force: false, errorOnExist: true,
      })
    }
    await rename(join(projectDir, 'gitignore'), join(projectDir, '.gitignore'))
    // Regular-file copies, one per agent: Claude Code and Codex each read their own skill folder.
    const skillDir = new URL('../skill/lifedashboard-widget/', import.meta.url)
    for (const target of ['.claude/skills/lifedashboard-widget', '.agents/skills/lifedashboard-widget']) {
      await cp(skillDir, join(projectDir, target), { recursive: true, force: false, errorOnExist: true })
    }
    // One pass: a value that contains a marker is never substituted again.
    const escaped: Record<'TITLE' | 'SLUG' | 'SDK', string> = {
      TITLE: jsonString(title), SLUG: jsonString(slug), SDK: jsonString(specifier),
    }
    for (const file of ['widget.json', 'package.json']) {
      const path = join(projectDir, file)
      const template = await readFile(path, 'utf8')
      await writeFile(path, template.replace(/__(TITLE|SLUG|SDK)__/g, (_, key: keyof typeof escaped) => escaped[key]))
    }
    return { dir: projectDir, slug }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Fix:')) throw error
    throw new Error(`Could not create ${folder}: ${error instanceof Error ? error.message : String(error)}. Fix: choose a writable parent directory and an empty target folder.`)
  }
}

function jsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

export function sdkSpecifier(sdk: string | undefined, ownVersion: string, cwd: string): string {
  if (sdk === undefined) return ownVersion
  const path = resolve(cwd, sdk)
  return sdk.endsWith('.tgz') || existsSync(path) ? `file:${path}` : sdk
}
