import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { parseWidgetPackage } from '@lifedashboard/contracts/widget-package'

/**
 * Builds `<dir>/src/index.vue` with the manifest `<dir>/widget.json` into
 * `<dir>/dist/<id>-<version>.ldwidget.json` and returns that path.
 */
export async function buildWidget(dir: string): Promise<string> {
  const root = resolve(dir)
  const manifest = JSON.parse(await readFile(join(root, 'widget.json'), 'utf8')) as { entry?: unknown }
  const out = await mkdtemp(join(tmpdir(), 'ld-widget-'))
  try {
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      plugins: [vue()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: out,
        emptyOutDir: true,
        lib: { entry: join(root, 'src', 'index.vue'), formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
        // Both resolve through the sandbox import map: one Vue, one SDK instance.
        rolldownOptions: { external: ['vue', '@lifedashboard/widget-sdk'] },
      },
    })
    const entry = typeof manifest.entry === 'string' ? manifest.entry : 'index.js'
    const files: Record<string, string> = { [entry]: await readFile(join(out, 'index.js'), 'utf8') }
    if (existsSync(join(out, 'style.css'))) files['style.css'] = await readFile(join(out, 'style.css'), 'utf8')
    const result = parseWidgetPackage({ format: 1, manifest, files })
    if (!result.ok) throw new Error(`Invalid widget package: ${result.error}`)
    const { id, version } = result.value.manifest
    await mkdir(join(root, 'dist'), { recursive: true })
    const target = join(root, 'dist', `${id}-${version}.ldwidget.json`)
    await writeFile(target, `${JSON.stringify(result.value)}\n`)
    return target
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}
