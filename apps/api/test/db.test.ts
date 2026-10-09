import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DB_FILE, openDatabase } from '../src/db.ts'
import { MIGRATIONS, SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ld-db-'))
  file = join(dir, DB_FILE)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function tables(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as unknown as { name: string }[]
  return rows.map((row) => row.name)
}

describe('openDatabase', () => {
  it('creates the schema and the seed room with one screen', async () => {
    const db = await openDatabase(':memory:')
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(tables(db)).toEqual([
      'rooms',
      'screens',
      'sessions',
      'widget_audit',
      'widget_grants',
      'widget_package_versions',
      'widget_packages',
      'widget_state',
      'widgets',
    ])
    expect(db.prepare('SELECT id, title, position, revision FROM rooms').all()).toEqual([
      { id: SEED_ROOM_ID, title: 'Главная', position: 0, revision: 1 },
    ])
    expect(db.prepare('SELECT id, room_id, position, rows FROM screens').all()).toEqual([
      { id: SEED_SCREEN_ID, room_id: SEED_ROOM_ID, position: 0, rows: 12 },
    ])
    db.close()
  })

  it('migrates a version 1 database with widgets and sessions to version 2', async () => {
    const v1 = await openDatabase(file, [MIGRATIONS[0]!])
    v1.exec(`
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('w1', '${SEED_SCREEN_ID}', 'builtin', 'placeholder', '{}', 1, 0, 0, 2, 2);
      INSERT INTO sessions (token_hash, created_at, expires_at) VALUES ('h', 'a', 'b');
    `)
    v1.close()

    const db = await openDatabase(file, MIGRATIONS.slice(0, 2))
    expect(userVersion(db)).toBe(2)
    expect(db.prepare('SELECT id, source_kind, source_version FROM widgets').all()).toEqual([
      { id: 'w1', source_kind: 'builtin', source_version: null },
    ])
    expect(db.prepare('SELECT token_hash FROM sessions').all()).toEqual([{ token_hash: 'h' }])
    db.close()

    const saved = new DatabaseSync(`${file}.bak-v1`)
    expect(userVersion(saved)).toBe(1)
    expect(tables(saved)).not.toContain('widget_packages')
    saved.close()

    const again = await openDatabase(file, MIGRATIONS.slice(0, 2))
    expect(userVersion(again)).toBe(2)
    expect(again.prepare('SELECT count(*) AS n FROM widgets').get()).toEqual({ n: 1 })
    again.close()
    expect(existsSync(`${file}.bak-v2`)).toBe(false)
  })

  it('migrates a version 2 database to version 3: rows 12, layouts reset, packages kept', async () => {
    const v2 = await openDatabase(file, MIGRATIONS.slice(0, 2))
    v2.exec(`
      INSERT INTO widget_packages (id, title, author, created_at) VALUES ('dev.test.hello', 'Hello', 'test', 'x');
      INSERT INTO widget_package_versions (package_id, version, hash, manifest, files, installed_at)
      VALUES ('dev.test.hello', '1.0.0', '${'a'.repeat(64)}', '{}', '{}', 'x');
      INSERT INTO widget_grants (package_id, permission, granted_at) VALUES ('dev.test.hello', 'state', 'x');
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('w1', '${SEED_SCREEN_ID}', 'builtin', 'placeholder', '{}', 1, 0, 0, 2, 2);
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('w1', '{}', 1, 'x');
      INSERT INTO rooms (id, title, position, revision, created_at, updated_at) VALUES ('r2', 'Пустая', 1, 5, 'x', 'x');
    `)
    v2.close()

    const db = await openDatabase(file, MIGRATIONS.slice(0, 3))
    expect(userVersion(db)).toBe(3)
    expect(db.prepare('SELECT id, rows FROM screens').all()).toEqual([{ id: SEED_SCREEN_ID, rows: 12 }])
    expect(db.prepare('SELECT count(*) AS n FROM widgets').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM widget_state').get()).toEqual({ n: 0 })
    // Only a room that lost widgets gets a new revision: a stale tab of it must reload.
    expect(db.prepare('SELECT id, revision FROM rooms ORDER BY position').all()).toEqual([
      { id: SEED_ROOM_ID, revision: 2 },
      { id: 'r2', revision: 5 },
    ])
    expect(db.prepare('SELECT count(*) AS n FROM widget_package_versions').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT count(*) AS n FROM widget_grants').get()).toEqual({ n: 1 })
    expect(() => db.exec(`UPDATE screens SET rows = 3`)).toThrow()
    expect(() => db.exec(`UPDATE screens SET rows = 101`)).toThrow()
    db.close()
  })

  it('gives grants of a version 3 database the mode allow', async () => {
    const v3 = await openDatabase(file, MIGRATIONS.slice(0, 3))
    v3.exec(`
      INSERT INTO widget_packages (id, title, author, created_at) VALUES ('dev.a.b', 'A', 'a', 'x');
      INSERT INTO widget_grants (package_id, permission, granted_at) VALUES ('dev.a.b', 'notifications', 'x');
    `)
    v3.close()

    const db = await openDatabase(file, MIGRATIONS.slice(0, 4))
    expect(userVersion(db)).toBe(4)
    expect(db.prepare('SELECT permission, mode FROM widget_grants').all()).toEqual([{ permission: 'notifications', mode: 'allow' }])
    db.close()
  })

  it('adds a nullable appearance column to widgets of a version 4 database', async () => {
    const v4 = await openDatabase(file, MIGRATIONS.slice(0, 4))
    v4.exec(`
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('w1', '${SEED_SCREEN_ID}', 'builtin', 'placeholder', '{}', 1, 0, 0, 2, 2);
    `)
    v4.close()

    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(5)
    expect(db.prepare('SELECT id, appearance FROM widgets').all()).toEqual([{ id: 'w1', appearance: null }])
    db.close()
    expect(existsSync(`${file}.bak-v4`)).toBe(true)
  })

  it('uses WAL, foreign keys and a busy timeout on a file database', async () => {
    const db = await openDatabase(file)
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
    db.close()
  })

  it('changes nothing when opened again', async () => {
    ;(await openDatabase(file)).close()
    const db = await openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT count(*) AS n FROM rooms').get()).toEqual({ n: 1 })
    expect(existsSync(`${file}.bak-v1`)).toBe(false)
    db.close()
  })

  it('refuses a database newer than the app and leaves it unchanged', async () => {
    const raw = new DatabaseSync(file)
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    raw.close()

    await expect(openDatabase(file)).rejects.toThrow(/newer than this LifeDashboard supports/)

    const check = new DatabaseSync(file)
    expect(userVersion(check)).toBe(MIGRATIONS.length + 1)
    expect(tables(check)).toEqual([])
    check.close()
  })

  it('backs up an existing database before applying a pending migration', async () => {
    ;(await openDatabase(file, [MIGRATIONS[0]!])).close()
    const db = await openDatabase(file, [MIGRATIONS[0]!, 'CREATE TABLE extra (id INTEGER);'])
    expect(userVersion(db)).toBe(2)
    db.close()

    const saved = new DatabaseSync(`${file}.bak-v1`)
    expect(userVersion(saved)).toBe(1)
    expect(tables(saved)).not.toContain('extra')
    saved.close()
  })

  it('rolls back a failing migration whole and keeps the previous version', async () => {
    ;(await openDatabase(file, [MIGRATIONS[0]!])).close()
    // The first two statements succeed; the third fails, so all three must be undone.
    const failing = `
      CREATE TABLE half (id INTEGER);
      UPDATE rooms SET title = 'changed';
      CREATE TABLE broken (;
    `
    await expect(openDatabase(file, [MIGRATIONS[0]!, failing])).rejects.toThrow()
    const check = new DatabaseSync(file)
    expect(userVersion(check)).toBe(1)
    expect(tables(check)).not.toContain('half')
    expect(check.prepare('SELECT title FROM rooms').all()).toEqual([{ title: 'Главная' }])
    check.close()
  })
})
