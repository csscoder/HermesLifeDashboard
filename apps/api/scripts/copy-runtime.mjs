// Copies the sandbox runtime files next to the bundle; sandbox.ts reads them via LIFEDASHBOARD_RUNTIME_DIR.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const out = new URL('../dist-bundle/runtime/', import.meta.url)
mkdirSync(out, { recursive: true })
copyFileSync(require.resolve('vue/dist/vue.runtime.esm-browser.prod.js'), new URL('vue.js', out))
copyFileSync(join(dirname(require.resolve('@lifedashboard/widget-sdk/package.json')), 'dist', 'sandbox.js'), new URL('sdk.js', out))
