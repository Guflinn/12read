/** schema v1（TECH.md 5.1）。比 MVP 多两样：chapter.kind 与 progress 的前后引文锚点。 */
export const SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  author         TEXT,
  format         TEXT NOT NULL DEFAULT 'txt',
  encoding       TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  char_count     INTEGER NOT NULL,
  chapter_count  INTEGER NOT NULL,
  content_mode   TEXT NOT NULL,
  cover_seed     INTEGER NOT NULL,
  added_at       INTEGER NOT NULL,
  last_opened_at INTEGER
);

CREATE TABLE IF NOT EXISTS chapter (
  book_id      TEXT NOT NULL,
  idx          INTEGER NOT NULL,
  title        TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  char_length  INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  PRIMARY KEY (book_id, idx),
  FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS progress (
  book_id       TEXT PRIMARY KEY,
  chapter_index INTEGER NOT NULL,
  char_offset   INTEGER NOT NULL,
  anchor_before TEXT,
  anchor_after  TEXT,
  percent       REAL NOT NULL,
  updated_at    INTEGER NOT NULL,
  device_id     TEXT,
  FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_recent ON book (last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_chapter_book ON chapter (book_id, idx);
`;

export const SCHEMA_VERSION = 1
