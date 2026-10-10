import { DatabaseSync, backup } from 'node:sqlite'
import { MIGRATIONS, type Migration, type MigrationContext } from './migrations.ts'

export const DB_FILE = 'lifedashboard.db'

/**
 * Opens the database and applies pending migrations; the caller owns the returned connection.
 * Only this process opens the file (base design ARCH-02). ':memory:' opens a test database.
 */
export async function openDatabase(file: string, context: MigrationContext, migrations: readonly Migration[] = MIGRATIONS): Promise<DatabaseSync> {
  const db = new DatabaseSync(file)
  try {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    // Checked before any write: a newer database stays exactly as it is (§12.2).
    if (version > migrations.length) {
      throw new Error(
        `Database schema version ${version} is newer than this LifeDashboard supports (${migrations.length}). ` +
          'Start a newer version of the app.',
      )
    }
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
    if (version > 0 && version < migrations.length && file !== ':memory:') {
      await backup(db, `${file}.bak-v${version}`)
    }
    for (const [index, migration] of migrations.entries()) {
      if (index < version) continue
      db.exec('BEGIN')
      try {
        if (typeof migration === 'string') db.exec(migration)
        else migration(db, context)
        db.exec(`PRAGMA user_version = ${index + 1}`)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  } catch (error) {
    db.close()
    throw error
  }
  return db
}
