import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
await rm(join(root, 'dist'), { recursive: true, force: true })

await build({
  root,
  configFile: false,
  ssr: { noExternal: [/^@lifedashboard\/contracts(?:\/|$)/] },
  build: {
    ssr: join(root, 'src/cli.ts'),
    outDir: 'dist',
    emptyOutDir: false,
    rolldownOptions: {
      external: [/^node:/],
      output: { entryFileNames: 'cli.js' },
    },
  },
})
