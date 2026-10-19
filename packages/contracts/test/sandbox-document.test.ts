import { describe, expect, it } from 'vitest'
import { sandboxDocument } from '../src/sandbox-document.ts'

const urls = {
  runtime: 'http://h/sandbox/runtime/',
  packageDir: 'http://h/sandbox/packages/abc/',
  entry: 'http://h/sandbox/packages/abc/index.js',
} as const

// Captured from the API builder before extracting it into contracts.
const html = `<!doctype html>
<html>
<head>
  <base href="http://h/sandbox/packages/abc/">
  <meta charset="utf-8">
  <script type="importmap">{"imports":{"vue":"http://h/sandbox/runtime/vue.js","@lifedashboard/widget-sdk":"http://h/sandbox/runtime/sdk.js","@lifedashboard/widget-entry":"http://h/sandbox/packages/abc/index.js"}}</script>
  <link rel="stylesheet" href="http://h/sandbox/packages/abc/style.css">
  <script type="module" src="http://h/sandbox/runtime/sdk.js"></script>
</head>
<body><div id="app"></div></body>
</html>
`
const csp = "default-src 'none'; script-src http://h/sandbox/runtime/ http://h/sandbox/packages/abc/ 'sha256-ice1cs9G942k8TUfj+6l7CDSYNfW9HyhqDzofADgZIM=' 'wasm-unsafe-eval'; style-src http://h/sandbox/packages/abc/ 'unsafe-inline'; img-src http://h/sandbox/packages/abc/ data: blob:; media-src http://h/sandbox/packages/abc/ blob:; font-src http://h/sandbox/packages/abc/ data:; connect-src http://h/sandbox/packages/abc/ data: blob:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri http://h/sandbox/packages/abc/; form-action 'none'"

describe('sandboxDocument', () => {
  it('preserves the production HTML and CSP byte for byte', async () => {
    expect(await sandboxDocument(urls, ['style.css'])).toEqual({ html, csp })
  })

  it('inserts extra modules after styles and before the runtime, and appends connect sources', async () => {
    const document = await sandboxDocument(urls, ['style.css'], {
      scripts: ['http://h/x.js'],
      connectSrc: ['ws://h'],
    })

    expect(document.html).toBe(html.replace(
      '  <script type="module" src="http://h/sandbox/runtime/sdk.js"></script>',
      '  <script type="module" src="http://h/x.js"></script>\n' +
        '  <script type="module" src="http://h/sandbox/runtime/sdk.js"></script>',
    ))
    expect(document.csp).toBe(csp.replace(
      'connect-src http://h/sandbox/packages/abc/ data: blob:',
      'connect-src http://h/sandbox/packages/abc/ data: blob: ws://h',
    ))
  })
})
