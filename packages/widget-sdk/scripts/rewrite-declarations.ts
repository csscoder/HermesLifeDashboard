import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

export async function rewriteDeclarations(typesDir: string): Promise<void> {
  const entries = await readdir(typesDir, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue
    const path = join(entry.parentPath, entry.name)
    const source = await readFile(path, 'utf8')
    const rewritten = source.replace(/(['"])(@lifedashboard\/contracts\/[^'"]+|\.{1,2}\/[^'"]+\.ts)\1/g, (_match, quote: string, specifier: string) => {
      if (specifier.startsWith('@lifedashboard/contracts/')) {
        const name = specifier.slice('@lifedashboard/contracts/'.length)
        const target = relative(dirname(path), join(typesDir, 'contracts/src', `${name}.js`)).split(sep).join('/')
        return `${quote}${target.startsWith('.') ? target : `./${target}`}${quote}`
      }
      return `${quote}${specifier.replace(/\.ts$/, '.js')}${quote}`
    })
    await writeFile(path, rewritten)
  }
}
