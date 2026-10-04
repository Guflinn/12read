/**
 * schema v2（TECH.md 5.1）：书签与划线。
 * 两者都是「章号 + 章内字符偏移」，与 progress 用同一套定位语义。
 * 阅读统计表（reading_stat）也在这里一次建好：统计是 0.1.3 的第 8 项，
 * 先建表，省得为了一个纯新增表再迁一次版本。
 */
export const SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS bookmark (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  char_offset   INTEGER NOT NULL,
  excerpt       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS highlight (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  start_offset  INTEGER NOT NULL,
  end_offset    INTEGER NOT NULL,
  text          TEXT NOT NULL,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE
);

-- 阅读统计：一本书一天一行；0.1.3 第 8 项往里写，本版先建表
CREATE TABLE IF NOT EXISTS reading_stat (
  book_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  ms         INTEGER NOT NULL DEFAULT 0,
  chars      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, day),
  FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmark_book ON bookmark (book_id, chapter_index, char_offset);
CREATE INDEX IF NOT EXISTS idx_highlight_book ON highlight (book_id, chapter_index, start_offset);
CREATE INDEX IF NOT EXISTS idx_reading_stat_day ON reading_stat (day);
`

export const SCHEMA_VERSION_2 = 2
