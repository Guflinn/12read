import { describe, expect, it } from 'vitest'
import { MIGRATIONS, readSchemaVersion, runMigrations, writeSchemaVersion, type Migration } from '@main/db/migrate'
import { SCHEMA_V1_SQL } from '@main/db/schema-v1'
import { FakeSqlDatabase } from '../helpers/fake-db'

const custom: Migration[] = [
  { version: 1, name: 'init', up: (db) => db.exec('CREATE TABLE IF NOT EXISTS a (id TEXT)') },
  { version: 2, name: 'second', up: (db) => db.exec('CREATE TABLE IF NOT EXISTS b (id TEXT)') }
]

describe('迁移', () => {
  it('首次运行建 meta 表并从 0 迁到 1', () => {
    const db = new FakeSqlDatabase()
    expect(readSchemaVersion(db)).toBe(0)
    expect(db.tables.has('meta')).toBe(true)

    const result = runMigrations(db)
    expect(result).toEqual({ from: 0, to: 1, applied: [1] })
    expect(db.meta.get('schema_version')).toBe('1')
    expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS book'))).toBe(true)
  })

  it('版本号非法时按 0 处理', () => {
    const db = new FakeSqlDatabase()
    db.meta.set('schema_version', 'abc')
    expect(readSchemaVersion(db)).toBe(0)
    writeSchemaVersion(db, 3)
    expect(db.meta.get('schema_version')).toBe('3')
  })

  it('已是最新版本时不做任何事，也不备份', () => {
    const db = new FakeSqlDatabase()
    runMigrations(db)
    const before = db.executed.length
    const calls: number[] = []
    const result = runMigrations(db, { onBeforeMigrate: (from) => calls.push(from) })
    expect(result).toEqual({ from: 1, to: 1, applied: [] })
    expect(calls).toEqual([])
    // 读版本号时会再执行一次 meta 建表（幂等），因此只断言没有新增迁移 SQL
    const appended = db.executed.slice(before)
    expect(appended.every((sql) => sql.includes('CREATE TABLE IF NOT EXISTS meta'))).toBe(true)
  })

  it('有跨版本迁移时先备份再逐个升级', () => {
    const db = new FakeSqlDatabase()
    db.meta.set('schema_version', '1')
    const calls: number[] = []
    const result = runMigrations(db, { migrations: custom, onBeforeMigrate: (from) => calls.push(from) })
    expect(calls).toEqual([1])
    expect(result).toEqual({ from: 1, to: 2, applied: [2] })
    expect(db.meta.get('schema_version')).toBe('2')
    expect(db.executed).toContain('CREATE TABLE IF NOT EXISTS b (id TEXT)')
  })

  it('从 0 开始时不需要备份（没有旧数据可备份）', () => {
    const db = new FakeSqlDatabase()
    const calls: number[] = []
    runMigrations(db, { migrations: custom, onBeforeMigrate: (from) => calls.push(from) })
    expect(calls).toEqual([])
    expect(db.meta.get('schema_version')).toBe('2')
  })

  it('版本必须从 1 开始且连续', () => {
    const db = new FakeSqlDatabase()
    expect(() => runMigrations(db, { migrations: [custom[1]] })).toThrowError(
      '迁移版本必须从 1 开始且连续，缺了 1'
    )
  })

  it('内置迁移只有 v1 且 SQL 覆盖关键约束', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1])
    expect(SCHEMA_V1_SQL).toContain('PRIMARY KEY (book_id, idx)')
    expect(SCHEMA_V1_SQL).toContain('ON DELETE CASCADE')
    expect(SCHEMA_V1_SQL).toContain("DEFAULT 'txt'")
    expect(SCHEMA_V1_SQL).toContain('idx_book_recent')
    expect(SCHEMA_V1_SQL).toContain('idx_chapter_book')
    expect(SCHEMA_V1_SQL).toContain('anchor_before')
    expect(SCHEMA_V1_SQL).toContain('device_id')
  })
})
