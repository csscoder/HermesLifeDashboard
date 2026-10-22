import * as ts from 'typescript'
import { expect, it } from 'vitest'
import { scanSource } from '../src/source-scan.ts'

const scan = (code: string, network: readonly string[] = []) => scanSource('src/main.ts', code, network, ts)

it.each([
  'window.localStorage.getItem("a")', 'localStorage.setItem("a", "b")', 'globalThis.sessionStorage', 'indexedDB.open("x")',
  'document.cookie = "a=1"', 'new Notification("hi")', 'requestIdleCallback(() => {})', 'scheduler.postTask(() => {})',
  'navigator.gpu.requestAdapter()', 'self.localStorage',
])('flags %s', (code) => expect(scan(code)).toHaveLength(1))

it.each([
  '// localStorage and https://evil.example in a comment', '/* document.cookie */', 'const s = "localStorage"',
  'const t = `see ${a} localStorage docs`', 'const o = { localStorage: 1 }', 'foo.localStorage', 'foo.cookie',
  "if ('gpu' in navigator) { navigator.gpu.requestAdapter() }", 'navigator.gpu?.requestAdapter()',
  'if (navigator.gpu) start()', 'const ok = navigator.gpu && 1', 'const g = navigator.gpu ?? null', 'fetch("assets/bg.webm")', 'fetch("/relative")',
  'if (navigator.gpu) { navigator.gpu.requestAdapter() }', "const a = 'gpu' in navigator ? navigator.gpu.requestAdapter() : null",
  "'gpu' in navigator && navigator.gpu.requestAdapter()",
  'const localStorage = 1', 'function Notification() {}', 'const { localStorage: storage } = foo',
  'interface X { localStorage: string }; type T = typeof Notification', 'foo.Notification', 'foo.requestIdleCallback',
  'type Storage = typeof window.localStorage',
  'if (!!(navigator.gpu)) start()', 'const ok = navigator.gpu || null',
  "if (ready && ('gpu' in navigator)) { navigator.gpu.requestAdapter() }",
  "ready && ('gpu' in navigator) && navigator.gpu.requestAdapter()",
  "document.createElementNS('http://www.w3.org/2000/svg', 'svg')",
  "const XLINK = 'http://www.w3.org/1999/xlink'",
  'const label = "https://example.com/help"; document.body.textContent = label',
  'widget.http.get("https://api.example.com/data")',
  'widget.http.send({ url: "https://api.example.com/data", method: "POST" })',
])('does not flag %s', (code) => expect(scan(code, ['https://api.example.com'])).toEqual([]))

it.each([
  "if ('gpu' in navigator) {}\nnavigator.gpu.requestAdapter()",
  "if (!('gpu' in navigator)) { navigator.gpu.requestAdapter() }",
  'if (navigator.gpu.requestAdapter()) {}', 'navigator.gpu.requestAdapter() && start()',
  "if ('gpu' in navigator) {} else { navigator.gpu.requestAdapter() }",
  "'gpu' in navigator || navigator.gpu.requestAdapter()",
  "const x = 'gpu' in navigator ? null : navigator.gpu.requestAdapter()",
])('flags an unguarded navigator.gpu next to an unrelated test: %s', (code) => expect(scan(code)).toHaveLength(1))

it('gives the notify fix with the real signature', () =>
  expect(scan('new Notification("hi")')[0]!.message).toBe('Web Notifications do not work in the widget sandbox. Fix: use widget.notify({ title, body }).'))

it('checks gateway request origins without treating displayed URLs as requests', () => {
  expect(scan('widget.http.get("http://localhost:8787/x")')[0]).toMatchObject({ rule: 'network', line: 1,
    message: expect.stringContaining('URL origin http://localhost:8787 is not in widget.json') })
  expect(scan('widget.http.send({ url: "https://api.example.com/v1", method: "POST" })')).toHaveLength(1)
  expect(scan("const namespace = 'https://www.w3.org/2000/svg'")).toEqual([])
})

it.each(['/', '?', '#'])('checks a template origin once %s terminates the authority', (delimiter) => {
  const code = 'widget.http.get(`https://api.example.com' + delimiter + '${id}`)'
  expect(scan(code)).toEqual([
    expect.objectContaining({ rule: 'network', message: expect.stringContaining('URL origin https://api.example.com is not in') }),
  ])
  expect(scan(code, ['https://api.example.com'])).toEqual([])
})

it.each([
  'fetch("https://api.example.com/data")',
  'window.fetch(`https://api.example.com/data/${id}`)',
  'globalThis.fetch("//api.example.com/data")',
  'fetch(`http://localhost:${port}/api`)',
  'fetch(`https://api-${env}.example.com`)',
  'const endpoint = "https://api.example.com/data"; fetch(endpoint)',
  'const xhr = new XMLHttpRequest(); xhr.open("GET", "https://api.example.com/data")',
  'new window.XMLHttpRequest().open("GET", "https://api.example.com/data")',
  'new WebSocket("wss://api.example.com/events")',
  'new self.WebSocket(`ws://localhost:${port}/events`)',
])('rejects direct external transport even with an approved origin: %s', (code) => {
  const problems = scan(code, ['https://api.example.com'])
  expect(problems).toEqual([expect.objectContaining({
    rule: 'network', file: 'src/main.ts', line: 1,
    message: expect.stringMatching(/sandbox.*widget\.http\.get\/send/),
  })])
})

it.each([
  'fetch("./assets/model.glb")', 'fetch("data:application/json,{}")', 'fetch("blob:local")',
  'const endpoint = "assets/model.glb"; fetch(endpoint)',
  'client.open("GET", "https://api.example.com/data")',
  'const endpoint = "https://api.example.com/data"; function load(endpoint: string) { fetch(endpoint) }',
])('keeps local or statically unknown transports out of diagnostics: %s', (code) => expect(scan(code)).toEqual([]))

it('reports project-relative files and 1-based lines', () => {
  expect(scan('\n\nlocalStorage.getItem("a")')[0]).toMatchObject({ rule: 'sandbox-api', file: 'src/main.ts', line: 3 })
})
