import type { SqlDatabase, SqlStatement } from '@main/db/driver'

/**
 * 内存假驱动：只实现迁移逻辑真正用到的那几个语句形状。
 * 目的是让迁移单测不依赖 better-sqlite3 原生模块（它需要 electron ABI 重建）。
 */
export class FakeSqlDatabase implements SqlDatabase {
  readonly executed: string[] = []
  readonly runs: { sql: string; params: unknown[] }[] = []
  readonly meta = new Map<string, string>()
  readonly tables = new Set<string>()
  private readonly rows = new Map<string, unknown[]>()

  exec(sql: string): void {
    this.executed.push(sql)
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)) {
      this.tables.add(match[1])
    }
  }

  /** 预置 SELECT 结果，用于 readSchemaVersion 之类的读路径。 */
  seedSelect(sqlFragment: string, rows: unknown[]): void {
    this.rows.set(sqlFragment, rows)
  }

  prepare(sql: string): SqlStatement {
    const statement: SqlStatement = {
      run: (...params: unknown[]) => {
        this.runs.push({ sql, params })
        if (/INSERT OR REPLACE INTO meta/i.test(sql)) {
          this.meta.set(String(params[0]), String(params[1]))
        }
        return { changes: 1 }
      },
      get: (...params: unknown[]) => {
        if (/FROM meta WHERE key/i.test(sql)) {
          const value = this.meta.get(String(params[0]))
          return value === undefined ? undefined : { value }
        }
        for (const [fragment, rows] of this.rows) {
          if (sql.includes(fragment)) return rows[0]
        }
        return undefined
      },
      all: () => []
    }
    return statement
  }

  transaction<T>(fn: () => T): () => T {
    return () => fn()
  }

  pragma(): undefined {
    return undefined
  }

  close(): void {
    /* 内存实现无需释放 */
  }
}
