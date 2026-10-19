import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { rewriteDeclarations } from './rewrite-declarations.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
await rm(join(root, 'dist'), { recursive: true, force: true })

await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  build: { emptyOutDir: false },
})

await build({
  root,
  configFile: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: join(root, 'src/index.ts'), formats: ['es'], fileName: () => 'index.js' },
    rolldownOptions: { external: ['vue'] },
  },
})

await build({
  root,
  configFile: false,
  ssr: { noExternal: [/^@lifedashboard\/contracts(?:\/|$)/] },
  build: {
    ssr: join(root, 'src/cli.ts'),
    outDir: 'dist',
    emptyOutDir: false,
    rolldownOptions: {
      external: [/^node:/, /^(?:vite|@vitejs\/plugin-vue|typescript|vue)(?:\/|$)/],
      output: { entryFileNames: 'cli.js' },
    },
  },
})

execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
})
await rewriteDeclarations(join(root, 'dist/types'))
