import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'

// The root .env is shared with the API; variables already set in the environment win.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

const apiOrigin = `http://127.0.0.1:${process.env.LIFEDASHBOARD_API_PORT || '3001'}`

export default defineNuxtConfig({
  compatibilityDate: '2026-10-04',
  ssr: false,
  imports: { autoImport: false },
  components: false,
  css: ['~/theme/styles/layers.css'],
  telemetry: false,
  devServer: { host: '127.0.0.1', port: 3000 },
  typescript: { strict: true },
  nitro: {
    devProxy: {
      '/api': { target: `${apiOrigin}/api`, changeOrigin: true },
      '/health': { target: `${apiOrigin}/health`, changeOrigin: true },
    },
  },
})
