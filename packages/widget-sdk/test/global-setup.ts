import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'
import type {} from './packed.ts'

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const work = await mkdtemp(join(tmpdir(), 'ld-widget-pack-'))
  const cleanup = () => rm(work, { recursive: true, force: true })
  try {
    const packed = spawnSync('pnpm', ['-C', root, 'pack', '--pack-destination', work], {
      encoding: 'utf8', timeout: 180_000,
    })
    assert.ifError(packed.error)
    assert.equal(packed.status, 0, packed.stdout + packed.stderr)
    const tarball = (await readdir(work)).find((file) => file.endsWith('.tgz'))
    assert.ok(tarball, 'pnpm pack did not produce a tarball')
    const unpack = join(work, 'x')
    await mkdir(unpack)
    const tar = spawnSync('tar', ['-xzf', join(work, tarball), '-C', unpack], { encoding: 'utf8' })
    assert.ifError(tar.error)
    assert.equal(tar.status, 0, tar.stderr)
    project.provide('packedSdk', join(unpack, 'package'))
    return cleanup
  } catch (error) {
    await cleanup()
    throw error
  }
}
