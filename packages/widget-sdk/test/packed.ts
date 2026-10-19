import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'

export async function packedSdk(): Promise<{ work: string; extracted: string; cleanup: () => Promise<void> }> {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const work = await mkdtemp(join(tmpdir(), 'ld-widget-pack-'))
  const cleanup = () => rm(work, { recursive: true, force: true })
  try {
    const packed = spawnSync('pnpm', ['-C', root, 'pack', '--pack-destination', work], {
      encoding: 'utf8', timeout: 180_000,
    })
    expect(packed.error).toBeUndefined()
    expect(packed.status, packed.stdout + packed.stderr).toBe(0)
    const tarball = (await readdir(work)).find((file) => file.endsWith('.tgz'))!
    const unpack = join(work, 'x')
    await mkdir(unpack)
    const tar = spawnSync('tar', ['-xzf', join(work, tarball), '-C', unpack], { encoding: 'utf8' })
    expect(tar.error).toBeUndefined()
    expect(tar.status, tar.stderr).toBe(0)
    return { work, extracted: join(unpack, 'package'), cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
