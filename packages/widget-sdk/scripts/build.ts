import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { rewriteDeclarations } from './rewrite-declarations.ts'
import { extractCssBlock, extractThemeTokens, type DevTheme } from '../src/dev/themes.ts'

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

const devDir = join(root, 'dist/dev')
await mkdir(devDir, { recursive: true })
const uiRoot = join(root, '../../apps/ui')
const themeStyles = join(uiRoot, 'app/theme/styles')
const { BUILTIN_THEMES } = await import(pathToFileURL(join(uiRoot, 'app/theme/builtin.ts')).href) as {
  BUILTIN_THEMES: Omit<DevTheme, 'tokens'>[]
}
const themes: DevTheme[] = await Promise.all(BUILTIN_THEMES.map(async (theme) => ({
  ...theme,
  tokens: extractThemeTokens(await readFile(join(themeStyles, `themes/${theme.id.slice('builtin:'.length)}.css`), 'utf8')),
})))
await writeFile(join(devDir, 'themes.json'), JSON.stringify(themes, null, 2) + '\n')
await copyFile(require.resolve('vue/dist/vue.runtime.esm-browser.js'), join(devDir, 'vue.js'))

await build({
  root,
  configFile: false,
  build: {
    outDir: 'dist/dev',
    emptyOutDir: false,
    lib: { entry: join(root, 'src/dev/probe.ts'), formats: ['es'], fileName: () => 'probe.js' },
  },
})

const layers = await readFile(join(themeStyles, 'layers.css'), 'utf8')
const layerOrder = layers.match(/^@layer\s+[^;{]+;/m)?.[0]
const frameRules = [
  ...(layerOrder ? [layerOrder] : []),
  extractCssBlock(layers, '@layer ld.reset'),
  await readFile(join(themeStyles, 'frame.css'), 'utf8'),
]
for (const skin of ['bare', 'glass', 'paper', 'solid']) {
  frameRules.push(await readFile(join(themeStyles, `skins/${skin}.css`), 'utf8'))
}
const sandboxWidget = await readFile(join(uiRoot, 'app/widgets/SandboxWidget.vue'), 'utf8')
const sandboxStyle = sandboxWidget.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1]
if (sandboxStyle === undefined) {
  throw new Error('Missing SandboxWidget.vue scoped style. Fix: restore the production style block or update the dev asset extraction.')
}
frameRules.push(extractCssBlock(sandboxStyle, '.sandbox'), extractCssBlock(sandboxStyle, '.sandbox__frame'))
await writeFile(join(devDir, 'frame.css'), frameRules.join('\n\n') + '\n')
