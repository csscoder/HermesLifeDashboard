export const SEED_ROOM_ID = '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b01'
export const SEED_SCREEN_ID = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

// Applied in order inside a transaction; migration n sets PRAGMA user_version = n.
// Never edit a released migration: add a new one.
export const MIGRATIONS: readonly string[] = [
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
]
