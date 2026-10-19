import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

export async function createWidgetProject(options: {
  name: string
  parentDir: string
  sdk?: string
}): Promise<string> {
  const { name, parentDir, sdk } = options
  if (!/^[a-z][a-z0-9-]{0,49}$/.test(name)) {
    throw new Error(`Invalid name "${name}". Fix: use lowercase letters, digits and dashes, starting with a letter.`)
  }
  const projectDir = resolve(parentDir, name)
  try {
    let entries: string[] = []
    try {
      entries = await readdir(projectDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (entries.length > 0) {
      throw new Error(`Folder ${name} already exists and is not empty. Fix: choose another name or remove the folder.`)
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
    for (const file of ['widget.json', 'package.json']) {
      const path = join(projectDir, file)
      const template = await readFile(path, 'utf8')
      const content = template.replaceAll('__NAME__', name)
        .replaceAll('__SDK__', () => JSON.stringify(specifier).slice(1, -1))
      await writeFile(path, content)
    }
    return projectDir
  } catch (error) {
    if (error instanceof Error && error.message.includes('Fix:')) throw error
    throw new Error(`Could not create ${name}: ${error instanceof Error ? error.message : String(error)}. Fix: choose a writable parent directory and an empty target folder.`)
  }
}

export function sdkSpecifier(sdk: string | undefined, ownVersion: string, cwd: string): string {
  if (sdk === undefined) return ownVersion
  const path = resolve(cwd, sdk)
  return sdk.endsWith('.tgz') || existsSync(path) ? `file:${path}` : sdk
}
