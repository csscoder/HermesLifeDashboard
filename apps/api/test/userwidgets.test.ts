import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanUserwidgets,
  listFiles,
  moveToOrphaned,
  resolveInside,
  stagingDir,
  versionDir,
  versionHash,
  writeV1Version,
} from '../src/userwidgets.ts'

let root: string
const NOW = new Date('2026-10-10T12:00:00.000Z')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ld-userwidgets-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function put(path: string, content: string) {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), content)
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('listFiles', () => {
  it('lists regular files recursively, sorted, with / separators', () => {
    put('v/widget.json', '{}')
    put('v/assets/b.png', 'b')
    put('v/assets/a/x.png', 'x')
    put('v/index.js', '')
    expect(listFiles(join(root, 'v'))).toEqual(['assets/a/x.png', 'assets/b.png', 'index.js', 'widget.json'])
  })
})

describe('versionHash', () => {
  it('hashes sorted path and content digests', async () => {
    put('v/index.js', 'a')
    put('v/assets/x.png', 'b')
    const expected = createHash('sha256').update(`assets/x.png\0${sha('b')}\nindex.js\0${sha('a')}\n`).digest('hex')
    expect(await versionHash(join(root, 'v'))).toBe(expected)
  })

  it('changes with content and with a path', async () => {
    put('v/index.js', 'a')
    const first = await versionHash(join(root, 'v'))
    writeFileSync(join(root, 'v/index.js'), 'b')
    expect(await versionHash(join(root, 'v'))).not.toBe(first)
  })
})

describe('moveToOrphaned', () => {
  it('moves a version folder under .orphaned with id, version and time', () => {
    put('dev.a.b/1.0.0/index.js', 'x')
    const target = moveToOrphaned(root, 'dev.a.b', '1.0.0', NOW)
    expect(target).toBe(join(root, '.orphaned', `dev.a.b-1.0.0-${NOW.getTime()}`))
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe('x')
    expect(existsSync(versionDir(root, 'dev.a.b', '1.0.0'))).toBe(false)
  })
})

describe('cleanUserwidgets', () => {
  it('deletes staging, moves orphan versions and keeps installed ones', () => {
    put(`.staging/u1/index.js`, 'x')
    put('dev.a.b/1.0.0/index.js', 'kept')
    put('dev.a.b/2.0.0/source/src/index.vue', 'orphan')
    put('dev.c.d/1.0.0/index.js', 'orphan')
    cleanUserwidgets(root, new Set(['dev.a.b/1.0.0']), NOW)
    expect(existsSync(stagingDir(root, 'u1'))).toBe(false)
    expect(readFileSync(join(root, 'dev.a.b/1.0.0/index.js'), 'utf8')).toBe('kept')
    expect(readdirSync(join(root, '.orphaned')).sort()).toEqual([`dev.a.b-2.0.0-${NOW.getTime()}`, `dev.c.d-1.0.0-${NOW.getTime()}`])
    expect(existsSync(join(root, 'dev.c.d'))).toBe(false)
  })

  it('does nothing when the root does not exist', () => {
    expect(() => cleanUserwidgets(join(root, 'missing'), new Set(), NOW)).not.toThrow()
  })
})

describe('writeV1Version', () => {
  it('writes the files and a format 2 widget.json and never overwrites', () => {
    const dir = join(root, 'dev.a.b/1.0.0')
    writeV1Version(dir, { id: 'dev.a.b' }, { 'index.js': 'export default {}' })
    expect(readFileSync(join(dir, 'index.js'), 'utf8')).toBe('export default {}')
    expect(JSON.parse(readFileSync(join(dir, 'widget.json'), 'utf8'))).toEqual({ format: 2, id: 'dev.a.b' })
    expect(() => writeV1Version(dir, { id: 'dev.a.b' }, { 'index.js': 'x' })).toThrow(/EEXIST/)
  })
})

describe('resolveInside', () => {
  it('resolves a path inside the folder and refuses one outside', () => {
    expect(resolveInside(join(root, 'v'), 'assets/a.png')).toBe(join(root, 'v', 'assets', 'a.png'))
    expect(resolveInside(join(root, 'v'), '../x')).toBeNull()
    expect(resolveInside(join(root, 'v'), '')).toBeNull()
  })
})
