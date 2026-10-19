import { createApp } from 'vue'
import App from './App.vue'

// Injected from the server's DEV_PATHS by scripts/build.ts; no Node server code enters the page.
declare const DEV_PATHS: typeof import('../src/dev/server.ts').DEV_PATHS

const frameStyles = document.createElement('link')
frameStyles.rel = 'stylesheet'
frameStyles.href = '/@ld/shell/frame.css'
document.head.append(frameStyles)

createApp(App, { paths: DEV_PATHS }).mount('#app')
