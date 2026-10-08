import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = mkdtempSync(join(tmpdir(), 'ld-sdk-'))

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('sandbox build', () => {
  it('bundles the bootstrap and leaves vue and the widget entry to the import map', async () => {
    await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir } })
    const code = readFileSync(join(outDir, 'sandbox.js'), 'utf8')
    expect(code).toMatch(/from\s*["']vue["']/)
    expect(code).toMatch(/import\(\s*["']@lifedashboard\/widget-entry["']\s*\)/)
    expect(code).not.toMatch(/@lifedashboard\/contracts/)
    expect(code).toContain('ld:hello')
    expect(code).toMatch(/export\s*\{[^}]*useWidget/)
  }, 30_000)
})
