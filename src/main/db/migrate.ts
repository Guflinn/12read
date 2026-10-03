import type { SqlDatabase } from './driver'
import { SCHEMA_V1_SQL, SCHEMA_VERSION } from './schema-v1'

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
