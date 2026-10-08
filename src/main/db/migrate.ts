import type { SqlDatabase } from './driver'
import { SCHEMA_V1_SQL, SCHEMA_VERSION } from './schema-v1'
import { SCHEMA_V2_SQL, SCHEMA_VERSION_2 } from './schema-v2'
import { SCHEMA_V3_SQL, SCHEMA_VERSION_3 } from './schema-v3'
import { SCHEMA_V4_SQL, SCHEMA_VERSION_4 } from './schema-v4'
import { SCHEMA_V5_SQL, SCHEMA_VERSION_5 } from './schema-v5'

/**
 * 顺序迁移（TECH.md 5.1）：
 * 一个版本一个事务，迁移前由调用方先把 library.db 备份成 library.db.bak-<version>。
 */
export interface Migration {
  version: number
  name: string
  up(db: SqlDatabase): void
}

export const META_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'

export const MIGRATIONS: Migration[] = [
  {
    version: SCHEMA_VERSION,
    name: 'init',
    up: (db) => db.exec(SCHEMA_V1_SQL)
  },
  {
    version: SCHEMA_VERSION_2,
    name: 'annotations',
    // 书签、划线、阅读统计：纯加表，老数据一行都不用动
    up: (db) => db.exec(SCHEMA_V2_SQL)
  },
  {
    version: SCHEMA_VERSION_3,
    name: 'reading_span',
    // 阅读统计的去重水位线（0.1.4）：同样是纯加表
    up: (db) => db.exec(SCHEMA_V3_SQL)
  },
  {
    version: SCHEMA_VERSION_4,
    name: 'chapter_group',
    // 章节的分组（合集类 EPUB 的卷名，0.2.0）：纯加列
    up: (db) => db.exec(SCHEMA_V4_SQL)
  },
  {
    version: SCHEMA_VERSION_5,
    name: 'chapter_parent',
    // 章节的父级（三级目录「册/章/节」里的章，0.2.0）：纯加列
    up: (db) => db.exec(SCHEMA_V5_SQL)
  }
]

function checkMigrations(migrations: Migration[]): void {
  let expected = 1
  for (const m of migrations) {
    if (m.version !== expected) {
      throw new Error('迁移版本必须从 1 开始且连续，缺了 ' + expected)
    }
    expected += 1
  }
}

export function readSchemaVersion(db: SqlDatabase): number {
  db.exec(META_TABLE_SQL)
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
  if (row === undefined || row === null) return 0
  const value = (row as { value?: unknown }).value
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export function writeSchemaVersion(db: SqlDatabase, version: number): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    String(version)
  )
}

export interface MigrateResult {
  from: number
  to: number
  applied: number[]
}

export interface MigrateOptions {
  migrations?: Migration[]
  /** 有实际迁移动作前调用一次，用来备份数据库文件。 */
  onBeforeMigrate?: (fromVersion: number) => void
}

export function runMigrations(db: SqlDatabase, options: MigrateOptions = {}): MigrateResult {
  const migrations = options.migrations ?? MIGRATIONS
  checkMigrations(migrations)

  const from = readSchemaVersion(db)
  const pending = migrations.filter((m) => m.version > from)
  if (pending.length === 0) return { from, to: from, applied: [] }

  if (from > 0 && options.onBeforeMigrate) options.onBeforeMigrate(from)

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db)
      writeSchemaVersion(db, migration.version)
    })
    apply()
  }

  const to = pending[pending.length - 1].version
  return { from, to, applied: pending.map((m) => m.version) }
}
