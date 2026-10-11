// Copies the running Node as the Tauri sidecar; Tauri requires the target-triple suffix (spec 2026-10-11 «Build»).
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

if (process.versions.node.split('.')[0] !== '24' || process.arch !== 'arm64') {
  console.error(`prepare-node: Node 24 on arm64 is required, got ${process.version} on ${process.arch}`)
  process.exit(1)
}
const dir = new URL('../src-tauri/binaries/', import.meta.url)
mkdirSync(dir, { recursive: true })
const target = fileURLToPath(new URL('node-aarch64-apple-darwin', dir))
copyFileSync(process.execPath, target)
chmodSync(target, 0o755)
console.log(`prepare-node: ${process.execPath} (${process.version}) -> ${target}`)
