/**
 * SQLite 驱动的最小接口。
 * 真正的 better-sqlite3 适配器在 ./better-sqlite3-driver.ts，
 * 其余 db 代码只依赖这个接口，于是迁移与仓储逻辑能在单测里用假驱动跑。
 */
export interface SqlStatement {
  run(...params: unknown[]): { changes: number }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  transaction<T>(fn: () => T): () => T
  pragma(statement: string): unknown
  close(): void
}

/** WAL + 外键，每次开连接都要重新设一遍（TECH.md 5.1）。 */
export function applyConnectionPragmas(db: SqlDatabase): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
}
