import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { WidgetSizing } from '@lifedashboard/contracts/grid'
import { DEV_PATHS, startDevServer, type DevInfo } from './dev/server.ts'

export type ShotFrame = 'framed' | 'frameless'
export interface ShotCombo { w: number; h: number; theme: string; frame: ShotFrame }
export interface ShotOptions {
  sizes?: { w: number; h: number }[]
  themes?: string[]
  frames?: ShotFrame[]
  /** Milliseconds to wait after the first render, for data and animations. */
  wait?: number
  browser?: string
}

const RENDER_TIMEOUT_MS = 15_000
const START_TIMEOUT_MS = 20_000

export function shotCombos(sizing: WidgetSizing, themeIds: readonly string[], options: Pick<ShotOptions, 'sizes' | 'themes' | 'frames'>): ShotCombo[] {
  const range = `${sizing.min.w}x${sizing.min.h}…${sizing.max.w}x${sizing.max.h}`
  const sizes = options.sizes ?? [sizing.min, sizing.default, sizing.max]
  for (const size of sizes) {
    if (size.w < sizing.min.w || size.h < sizing.min.h || size.w > sizing.max.w || size.h > sizing.max.h) {
      throw new Error(`Size ${size.w}x${size.h} is outside widget.json sizing ${range}.`)
    }
  }
  for (const theme of options.themes ?? []) {
    if (!themeIds.includes(theme)) throw new Error(`Unknown theme ${theme}. Fix: use one of ${themeIds.join(', ')}.`)
  }
  const unique = [...new Map(sizes.map((size) => [`${size.w}x${size.h}`, size])).values()]
  return unique.flatMap(({ w, h }) => (options.themes ?? themeIds).flatMap((theme) =>
    (options.frames ?? ['framed', 'frameless'] as const).map((frame) => ({ w, h, theme, frame }))))
}

export function shotFileName(combo: ShotCombo): string {
  return `${combo.w}x${combo.h}-${combo.theme.replace(/^builtin:/, '')}-${combo.frame}.png`
}

const BROWSERS: Record<string, string[]> = {
  darwin: ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'].map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`),
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .flatMap((name) => [`/usr/bin/${name}`, `/snap/bin/${name}`]),
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
}

export function findBrowser(
  platform: string = process.platform,
  exists: (path: string) => boolean = existsSync,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env.LD_BROWSER || (BROWSERS[platform] ?? []).find(exists)
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

// A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
async function connect(url: string) {
  const socket = new WebSocket(url)
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', () => fail(new Error('Cannot connect to the browser.')), { once: true })
  })
  let id = 0
  const pending = new Map<number, { done(value: unknown): void; fail(error: Error): void }>()
  const waiters: { method: string; done(): void }[] = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; method?: string; result?: unknown; error?: { message: string } }
    if (message.id !== undefined) {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call?.fail(new Error(message.error.message))
      else call?.done(message.result)
    } else {
      for (const waiter of waiters.splice(0)) {
        if (waiter.method === message.method) waiter.done()
        else waiters.push(waiter)
      }
    }
  })
  return {
    send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
      return new Promise((done, fail) => {
        pending.set(++id, { done: done as (value: unknown) => void, fail })
        socket.send(JSON.stringify({ id, method, params, sessionId }))
      })
    },
    next(method: string): Promise<void> {
      return new Promise((done) => { waiters.push({ method, done }) })
    },
    close() { socket.close() },
  }
}

async function launch(browser: string) {
  const profile = await mkdtemp(join(tmpdir(), 'ld-widget-shot-'))
  const child = spawn(browser, [
    '--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-mock-keychain',
    '--password-store=basic', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const close = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done))
      child.kill()
      await Promise.race([exited, sleep(5000)])
    }
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
  try {
    const url = await new Promise<string>((done, fail) => {
      let output = ''
      const timer = setTimeout(() => fail(new Error(`The browser did not start in ${START_TIMEOUT_MS / 1000} s.`)), START_TIMEOUT_MS)
      child.stderr.on('data', (chunk) => {
        output += String(chunk)
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(output)
        if (match) { clearTimeout(timer); done(match[1]!) }
      })
      child.once('error', (error) => { clearTimeout(timer); fail(error) })
      child.once('exit', (code) => {
        clearTimeout(timer)
        fail(new Error(`The browser exited at start (code ${code}). Fix: an agent sandbox is the usual cause; ask the user to run npx ld-widget shot outside the sandbox.`))
      })
    })
    return { url, close }
  } catch (error) {
    await close()
    throw error
  }
}

export async function takeShots(dir: string, options: ShotOptions = {}): Promise<{ file: string; rendered: boolean }[]> {
  const browser = options.browser ?? findBrowser()
  if (browser === undefined) {
    throw new Error('No Chromium-based browser found. Fix: set LD_BROWSER to its path, or rely on check and design.md and tell the user that the layout was not checked visually.')
  }
  const root = resolve(dir)
  const server = await startDevServer(root, { port: 0 })
  let chrome: Awaited<ReturnType<typeof launch>> | undefined
  try {
    const info = await (await fetch(new URL(DEV_PATHS.api.slice(1) + 'info', server.url))).json() as DevInfo
    const combos = shotCombos(info.manifest.sizing, info.themes.map((theme) => theme.id), options)
    const out = join(root, '.ld-widget', 'shots')
    await mkdir(out, { recursive: true })
    chrome = await launch(browser)
    const cdp = await connect(chrome.url)
    try {
      const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
      const send = <T>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId)
      const evaluate = async <T>(expression: string) =>
        (await send<{ result: { value: T } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
      await send('Page.enable')
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
      const results: { file: string; rendered: boolean }[] = []
      for (const combo of combos) {
        const loaded = cdp.next('Page.loadEventFired')
        await send('Page.navigate', { url: `${server.url}?w=${combo.w}&h=${combo.h}&theme=${encodeURIComponent(combo.theme)}&frame=${combo.frame}` })
        await loaded
        const started = Date.now()
        let rendered = false
        while (!(rendered = await evaluate<boolean>(`document.documentElement.dataset.ldRendered === 'true'`)) && Date.now() - started < RENDER_TIMEOUT_MS) await sleep(100)
        await evaluate('document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))')
        await sleep(options.wait ?? 1000)
        const clip = await evaluate<{ x: number; y: number; width: number; height: number }>(
          `(() => { const r = document.querySelector('.widget').getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } })()`)
        const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true })
        const file = join(out, shotFileName(combo))
        await writeFile(file, Buffer.from(data, 'base64'))
        results.push({ file, rendered })
      }
      return results
    } finally {
      cdp.close()
    }
  } finally {
    await chrome?.close()
    await server.close()
  }
}
