import { describe, expect, it } from 'vitest'
import { MIGRATIONS, readSchemaVersion, runMigrations, writeSchemaVersion, type Migration } from '@main/db/migrate'
import { SCHEMA_V1_SQL } from '@main/db/schema-v1'
import { SCHEMA_V2_SQL, SCHEMA_VERSION_2 } from '@main/db/schema-v2'
import { SCHEMA_V3_SQL, SCHEMA_VERSION_3 } from '@main/db/schema-v3'
import { SCHEMA_V4_SQL, SCHEMA_VERSION_4 } from '@main/db/schema-v4'
import { FakeSqlDatabase } from '../helpers/fake-db'

const custom: Migration[] = [
  { version: 1, name: 'init', up: (db) => db.exec('CREATE TABLE IF NOT EXISTS a (id TEXT)') },
  { version: 2, name: 'second', up: (db) => db.exec('CREATE TABLE IF NOT EXISTS b (id TEXT)') }
]

describe('迁移', () => {
  it('首次运行建 meta 表并一路迁到最新版', () => {
    const db = new FakeSqlDatabase()
    expect(readSchemaVersion(db)).toBe(0)
    expect(db.tables.has('meta')).toBe(true)

    const result = runMigrations(db)
    expect(result).toEqual({ from: 0, to: 4, applied: [1, 2, 3, 4] })
    expect(db.meta.get('schema_version')).toBe('4')
    expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS book'))).toBe(true)
    expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS bookmark'))).toBe(true)
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
    expect(result).toEqual({ from: 4, to: 4, applied: [] })
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

  it('v1 的库会依次跑 annotations 与 reading_span 两条迁移', () => {
    const db = new FakeSqlDatabase()
    db.meta.set('schema_version', '1')
    // 先用第 2 条之前的版本把库停在 v1，模拟 0.1.2 及更早装出来的数据目录
    const calls: number[] = []
    const result = runMigrations(db, { onBeforeMigrate: (from) => calls.push(from) })
    expect(calls).toEqual([1])
    expect(result).toEqual({ from: 1, to: 4, applied: [2, 3, 4] })
    expect(db.meta.get('schema_version')).toBe('4')
    expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS highlight'))).toBe(true)
    expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS reading_span'))).toBe(
      true
    )
  })

  it('v2 的库升到 v3 时会跑 reading_span 这条迁移（0.1.4 字数去重）', () => {
    const db = new FakeSqlDatabase()
    db.meta.set('schema_version', '2')
    const calls: number[] = []
    const result = runMigrations(db, { onBeforeMigrate: (from) => calls.push(from) })
    expect(calls).toEqual([2])
    // 现在会一路迁到最新（v4）：v3 建水位线表，v4 加分组列
    expect(result).toEqual({ from: 2, to: 4, applied: [3, 4] })
    expect(db.meta.get('schema_version')).toBe('4')
    expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS reading_span'))).toBe(
      true
    )
  })

  it('v3 的库升到 v4 时会跑 chapter_group 这条迁移（0.2.0 合集分组）', () => {
    const db = new FakeSqlDatabase()
    db.meta.set('schema_version', '3')
    const calls: number[] = []
    const result = runMigrations(db, { onBeforeMigrate: (from) => calls.push(from) })
    expect(calls).toEqual([3])
    expect(result).toEqual({ from: 3, to: 4, applied: [4] })
    expect(db.executed.some((sql) => sql.includes('ADD COLUMN group_title'))).toBe(true)
  })

  it('内置迁移是 v1 + v2 + v3 + v4，SQL 覆盖关键约束', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4])
    expect(MIGRATIONS.map((m) => m.name)).toEqual([
      'init',
      'annotations',
      'reading_span',
      'chapter_group'
    ])
    expect(MIGRATIONS[1]?.version).toBe(SCHEMA_VERSION_2)
    expect(MIGRATIONS[2]?.version).toBe(SCHEMA_VERSION_3)
    expect(MIGRATIONS[3]?.version).toBe(SCHEMA_VERSION_4)
    expect(SCHEMA_V4_SQL).toContain('ADD COLUMN group_title')
    // 水位线表：主键 (书, 天, 章) —— 一天一章只有一行，书删了跟着走
    expect(SCHEMA_V3_SQL).toContain('CREATE TABLE IF NOT EXISTS reading_span')
    expect(SCHEMA_V3_SQL).toContain('PRIMARY KEY (book_id, day, chapter_index)')
    expect(SCHEMA_V3_SQL).toContain('ON DELETE CASCADE')
    expect(SCHEMA_V1_SQL).toContain('PRIMARY KEY (book_id, idx)')
    expect(SCHEMA_V1_SQL).toContain('ON DELETE CASCADE')
    expect(SCHEMA_V1_SQL).toContain("DEFAULT 'txt'")
    expect(SCHEMA_V1_SQL).toContain('idx_book_recent')
    expect(SCHEMA_V1_SQL).toContain('idx_chapter_book')
    expect(SCHEMA_V1_SQL).toContain('anchor_before')
    expect(SCHEMA_V1_SQL).toContain('device_id')
    // 书签、划线、阅读统计三张表都在 v2 里，附带 ON DELETE CASCADE 与按书查询的索引
    expect(SCHEMA_V2_SQL).toContain('CREATE TABLE IF NOT EXISTS bookmark')
    expect(SCHEMA_V2_SQL).toContain('CREATE TABLE IF NOT EXISTS highlight')
    expect(SCHEMA_V2_SQL).toContain('CREATE TABLE IF NOT EXISTS reading_stat')
    expect(SCHEMA_V2_SQL).toContain('idx_bookmark_book')
    expect(SCHEMA_V2_SQL).toContain('idx_highlight_book')
    expect(SCHEMA_V2_SQL).toContain('idx_reading_stat_day')
    expect(SCHEMA_V2_SQL).toContain('ON DELETE CASCADE')
    expect(SCHEMA_V2_SQL).toMatch(/note\s+TEXT/)
  })
})
