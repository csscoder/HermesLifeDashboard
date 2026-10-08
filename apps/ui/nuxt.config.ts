import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'

// The root .env is shared with the API; variables already set in the environment win.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

const apiOrigin = `http://127.0.0.1:${process.env.LIFEDASHBOARD_API_PORT || '3001'}`

export default defineNuxtConfig({
  compatibilityDate: '2026-10-04',
  modules: ['@unocss/nuxt'],
  // wind3 is the module default and would bring the palette back; uno.config.ts defines the presets.
  unocss: { wind3: false, components: false, configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)) },
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
      '/sandbox': { target: `${apiOrigin}/sandbox`, changeOrigin: true },
    },
  },
})
