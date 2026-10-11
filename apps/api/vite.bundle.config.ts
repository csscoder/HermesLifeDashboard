import { defineConfig } from 'vite'

// One self-contained file for the desktop app's Node sidecar (spec 2026-10-11 «Bundle»).
// @lifedashboard/contracts exports .ts sources, which Node refuses to strip under node_modules.
export default defineConfig({
  logLevel: 'warn',
  build: {
    ssr: 'src/server.ts',
    outDir: 'dist-bundle',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    rolldownOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
  ssr: { noExternal: true, target: 'node' },
})
