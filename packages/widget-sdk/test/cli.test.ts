import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const counter = fileURLToPath(new URL('./fixtures/counter/', import.meta.url))
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it.each([false, true])('builds with --no-source=%s and lists sources only when included', async (noSource) => {
  const dir = await mkdtemp(join(tmpdir(), 'ld-widget-cli-test-'))
  dirs.push(dir)
  await cp(counter, dir, { recursive: true })
  const result = spawnSync(process.execPath, [cli, 'build', dir, ...(noSource ? ['--no-source'] : [])], {
    encoding: 'utf8',
    timeout: 30_000,
  })

  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  const lines = [`Built ${join(dir, 'dist', 'dev.test.counter-1.0.0')}`]
  if (!noSource) lines.push('source/: 3 files', '  src/index.vue', '  widget-env.d.ts', '  widget.json')
  expect(result.stdout).toBe(`${lines.join('\n')}\n`)
}, 30_000)

it.each([['unknown'], ['dev', '--port'], ['dev', '--port', 'no'], ['dev', '--port', '65536'], ['dev', '--unknown'], ['dev', 'one', 'two']])('prints usage for invalid arguments %j', (...args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe('Usage: ld-widget <build|check|dev> [dir] [options]\n')
})
