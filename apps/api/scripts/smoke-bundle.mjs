// Starts the bundled API the way the desktop app does and probes it (spec 2026-10-11 «Testing»).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 3199
const ORIGIN = `http://127.0.0.1:${PORT}`
const READY = `LifeDashboard API listening on ${ORIGIN}`
const bundle = fileURLToPath(new URL('../dist-bundle/', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'ld-smoke-'))
const uiDir = join(temp, 'ui')
mkdirSync(uiDir)
writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>smoke</title>')

const child = spawn(process.execPath, [join(bundle, 'server.mjs')], {
  env: {
    ...process.env,
    LIFEDASHBOARD_API_PORT: String(PORT),
    LIFEDASHBOARD_DATA_DIR: join(temp, 'data'),
    LIFEDASHBOARD_UI_ORIGINS: ORIGIN,
    LIFEDASHBOARD_UI_DIR: uiDir,
    LIFEDASHBOARD_RUNTIME_DIR: join(bundle, 'runtime'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
const exited = new Promise((resolve) => child.once('exit', resolve))

function waitForReady() {
  return new Promise((resolve, reject) => {
    let buffered = ''
    const timer = setTimeout(() => reject(new Error('no ready line within 15 s')), 15_000)
    exited.then((code) => {
      clearTimeout(timer)
      reject(new Error(`API exited with ${code}`))
    })
    child.stdout.on('data', (chunk) => {
      buffered += chunk
      if (buffered.split('\n').some((line) => line.trim() === READY)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

let failed = false
try {
  await waitForReady()
  for (const path of ['/health', '/', '/sandbox/runtime/sdk.js']) {
    const response = await fetch(`${ORIGIN}${path}`)
    console.log(`${response.status} ${path}`)
    if (response.status !== 200) failed = true
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  failed = true
} finally {
  child.kill('SIGTERM')
  await exited
  rmSync(temp, { recursive: true, force: true })
}
console.log(failed ? 'smoke: FAIL' : 'smoke: OK')
process.exit(failed ? 1 : 0)
