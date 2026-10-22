import { createApp } from 'vue'
import App from './App.vue'

// Injected from the server's DEV_PATHS by scripts/build.ts; no Node server code enters the page.
declare const DEV_PATHS: typeof import('../src/dev/server.ts').DEV_PATHS
const prefix = location.pathname.replace(/\/$/, '')
const paths = Object.fromEntries(Object.entries(DEV_PATHS).map(([key, path]) => [key, prefix + path])) as import('../src/dev/server.ts').DevPaths

const frameStyles = document.createElement('link')
frameStyles.rel = 'stylesheet'
frameStyles.href = paths.shell + 'frame.css'
document.head.append(frameStyles)

createApp(App, { paths }).mount('#app')
