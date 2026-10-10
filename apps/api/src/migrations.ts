import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { moveToOrphaned, userwidgetsDir, versionDir, writeV1Version } from './userwidgets.ts'

export interface MigrationContext {
  dataDir: string
}

// A function migration runs inside the same transaction as SQL ones; its file writes are not rolled back.
export type Migration = string | ((db: DatabaseSync, context: MigrationContext) => void)

export const SEED_ROOM_ID = '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b01'
export const SEED_SCREEN_ID = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

// Applied in order inside a transaction; migration n sets PRAGMA user_version = n.
// Never edit a released migration: add a new one.
function movePackageFilesToDisk(db: DatabaseSync, { dataDir }: MigrationContext): void {
  const root = userwidgetsDir(dataDir)
  const now = new Date()
  const rows = db.prepare('SELECT package_id, version, manifest, files FROM widget_package_versions').all() as unknown as {
    package_id: string
    version: string
    manifest: string
    files: string
  }[]
  for (const row of rows) {
    try {
      // A folder already there (a v2 install before an older database came back, or a failed attempt) is kept aside.
      if (existsSync(versionDir(root, row.package_id, row.version))) moveToOrphaned(root, row.package_id, row.version, now)
      writeV1Version(versionDir(root, row.package_id, row.version), JSON.parse(row.manifest) as object, JSON.parse(row.files) as Record<string, string>)
    } catch (error) {
      throw new Error(`Cannot move widget package ${row.package_id}@${row.version} to disk: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  db.exec(`
CREATE TABLE widget_package_versions_new (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version)
);
INSERT INTO widget_package_versions_new (package_id, version, hash, manifest, installed_at)
SELECT package_id, version, hash, manifest, installed_at FROM widget_package_versions;
DROP TABLE widget_package_versions;
ALTER TABLE widget_package_versions_new RENAME TO widget_package_versions;
`)
}

export const MIGRATIONS: readonly Migration[] = [
  `
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE screens (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  UNIQUE (room_id, position)
);

CREATE TABLE widgets (
  id TEXT PRIMARY KEY,
  screen_id TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  config TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL
);

CREATE INDEX widgets_screen_id ON widgets(screen_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

INSERT INTO rooms (id, title, position, revision, created_at, updated_at)
VALUES ('${SEED_ROOM_ID}', 'Главная', 0, 1, ${NOW}, ${NOW});

INSERT INTO screens (id, room_id, position) VALUES ('${SEED_SCREEN_ID}', '${SEED_ROOM_ID}', 0);
`,
  `
CREATE TABLE widget_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE widget_package_versions (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL,
  files TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version)
);

CREATE TABLE widget_grants (
  package_id TEXT NOT NULL REFERENCES widget_packages(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (package_id, permission)
);

ALTER TABLE widgets ADD COLUMN source_version TEXT;

-- No foreign key: a board save re-inserts widget rows; the save deletes orphaned state itself.
CREATE TABLE widget_state (
  widget_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE widget_audit (
  at TEXT NOT NULL,
  widget_id TEXT NOT NULL,
  package_id TEXT,
  op TEXT NOT NULL,
  outcome TEXT NOT NULL
);
`,
  `
ALTER TABLE screens ADD COLUMN rows INTEGER NOT NULL DEFAULT 12 CHECK (rows BETWEEN 4 AND 100);

-- The 24-column grid does not carry 12-column layouts over (spec 2026-10-09-fluid-board-grid).
-- A room that loses widgets gets a new revision, so a tab opened before the migration reloads.
UPDATE rooms SET revision = revision + 1
WHERE id IN (SELECT s.room_id FROM screens s JOIN widgets w ON w.screen_id = s.id);
DELETE FROM widget_state;
DELETE FROM widgets;
  `,
  `
-- Spec 2026-10-09: grants approved before confirmation keep working without a dialog.
ALTER TABLE widget_grants ADD COLUMN mode TEXT NOT NULL DEFAULT 'allow';
`,
  `
-- Spec 2026-10-09-widget-appearance: per-widget theme and shadow as JSON; NULL means none.
ALTER TABLE widgets ADD COLUMN appearance TEXT;
`,
  // Spec 2026-10-10-widget-package-v2 «Migration v1 → v2».
  movePackageFilesToDisk,
]
