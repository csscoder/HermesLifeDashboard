import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build, type Plugin } from 'vite'
import { ASSET_TYPES, fileExtension, parseWidgetFolder } from '@lifedashboard/contracts/widget-package'

const AUDIO_VIDEO = new Set(['mp4', 'webm', 'mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'flac'])
const MEDIA_INLINE_LIMIT = 102_400

/** Whether a project path (relative, platform separators) goes into `source/`. */
export function keepInSource(path: string): boolean {
  if (path === '') return true
  const segments = path.split(sep)
  const name = segments.at(-1)!
  if (segments.length === 1 && (name === 'dist' || name === 'assets')) return false
  return name !== 'node_modules' && name !== '.git' && name !== '.DS_Store' && !name.startsWith('.env')
}

// Vite library mode inlines imported assets as data: URLs; media-src does not allow data:.
function mediaImportGuard(): Plugin {
  return {
    name: 'ld-widget-media-guard',
    enforce: 'pre',
    async load(id) {
      const path = id.split('?')[0]!
      const extension = fileExtension(path)
      if (!Object.hasOwn(ASSET_TYPES, extension) || extension === 'json') return null
      if (AUDIO_VIDEO.has(extension) || (await stat(path)).size > MEDIA_INLINE_LIMIT) {
        this.error(`reference media by URL: assets/${basename(path)}`)
      }
      return null
    },
  }
}

// Rolldown's `//#region <path>` markers embed the build directory, which would make the same sources build to different
// code. Stripped in renderChunk, before chunk hashes are computed, so file names and imports stay path-independent too.
function stripRegionMarkers(): Plugin {
  return {
    name: 'ld-widget-strip-region-markers',
    renderChunk: (code) => ({ code: code.replace(/^\/\/#(?:end)?region\b.*\n/gm, ''), map: null }),
  }
}

// The upload API accepts regular files only, and `cp` would rewrite relative link targets to absolute ones.
function copyFilter(root: string, keep: (path: string) => boolean = () => true): (from: string) => Promise<boolean> {
  return async (from) => {
    const path = relative(root, from)
    if (!keep(path)) return false
    if ((await lstat(from)).isSymbolicLink()) throw new Error(`Invalid widget project: symlinks are not allowed: ${path.split(sep).join('/')}`)
    return true
  }
}

async function listFolder(dir: string): Promise<{ path: string; size: number }[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const full = join(entry.parentPath, entry.name)
        return { path: relative(dir, full).split(sep).join('/'), size: (await stat(full)).size }
      }),
  )
}

/**
 * Builds `<dir>/src/index.vue` with `<dir>/widget.json` into the folder `<dir>/dist/<id>-<version>/`
 * (code, `assets/`, `source/` unless `source: false`) and returns its path.
 */
export async function buildWidget(dir: string, { source = true }: { source?: boolean } = {}): Promise<string> {
  const root = resolve(dir)
  const raw = JSON.parse(await readFile(join(root, 'widget.json'), 'utf8')) as Record<string, unknown>
  const { format: _format, ...fields } = raw
  const manifest: Record<string, unknown> = { format: 2, ...fields }
  const entry = typeof manifest.entry === 'string' ? manifest.entry : 'index.js'
  const work = await mkdtemp(join(tmpdir(), 'ld-widget-'))
  const stage = join(work, 'package')
  // plugin-vue embeds absolute `__file` paths unless Vite runs with NODE_ENV=production (vitest sets `test`).
  const nodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      plugins: [mediaImportGuard(), vue(), stripRegionMarkers()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: stage,
        emptyOutDir: true,
        lib: { entry: join(root, 'src', 'index.vue'), formats: ['es'], fileName: () => entry, cssFileName: 'style' },
        // Both resolve through the sandbox import map: one Vue, one SDK instance.
        rolldownOptions: { external: ['vue', '@lifedashboard/widget-sdk'], output: { chunkFileNames: 'chunk-[hash].js' } },
      },
    })
    if (existsSync(join(root, 'assets'))) await cp(join(root, 'assets'), join(stage, 'assets'), { recursive: true, filter: copyFilter(root) })
    // Copied from outside the project: fs.cp refuses a destination inside its source.
    if (source) await cp(root, join(stage, 'source'), { recursive: true, filter: copyFilter(root, keepInSource) })
    await writeFile(join(stage, 'widget.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const result = parseWidgetFolder(manifest, await listFolder(stage))
    if (!result.ok) throw new Error(`Invalid widget package: ${result.error}`)
    const target = join(root, 'dist', `${result.value.manifest.id}-${result.value.manifest.version}`)
    await rm(target, { recursive: true, force: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    await cp(stage, target, { recursive: true })
    return target
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
    await rm(work, { recursive: true, force: true })
  }
}
