import { defineConfig } from 'vite'

// The sandbox runtime served at /sandbox/runtime/sdk.js: bootstrap + RPC client + useWidget in one
// ES module. Contracts are bundled; vue and the widget entry come from the document's import map.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: { entry: 'src/sandbox.ts', formats: ['es'], fileName: () => 'sandbox.js' },
    rolldownOptions: { external: ['vue', '@lifedashboard/widget-entry'] },
  },
})
