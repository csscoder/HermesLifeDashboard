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
  'fetch(`http://localhost:${port}/api`)', 'fetch(`https://api-${env}.example.com`)',
  "document.createElementNS('http://www.w3.org/2000/svg', 'svg')",
  "const XLINK = 'http://www.w3.org/1999/xlink'",
])('does not flag %s', (code) => expect(scan(code)).toEqual([]))

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

it('checks URL origins against network', () => {
  expect(scan('fetch(`https://api.example.com/v1/${id}`)', ['https://api.example.com'])).toEqual([])
  expect(scan('fetch("http://localhost:8787/x")')[0]).toMatchObject({ rule: 'network', line: 1,
    message: 'URL origin http://localhost:8787 is not in widget.json "network". Fix: add "http://localhost:8787" to network or call another origin.' })
  expect(scan('fetch(`https://api.example.com/v1`)')).toHaveLength(1)
  expect(scan("const namespace = 'https://www.w3.org/2000/svg'")).toEqual([
    expect.objectContaining({ rule: 'network', message: expect.stringContaining('URL origin https://www.w3.org is not in') }),
  ])
})

it.each(['/', '?', '#'])('checks a template origin once %s terminates the authority', (delimiter) => {
  const code = 'fetch(`https://api.example.com' + delimiter + '${id}`)'
  expect(scan(code)).toEqual([
    expect.objectContaining({ rule: 'network', message: expect.stringContaining('URL origin https://api.example.com is not in') }),
  ])
  expect(scan(code, ['https://api.example.com'])).toEqual([])
})

it('reports project-relative files and 1-based lines', () => {
  expect(scan('\n\nlocalStorage.getItem("a")')[0]).toMatchObject({ rule: 'sandbox-api', file: 'src/main.ts', line: 3 })
})
