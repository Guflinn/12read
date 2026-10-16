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
  /**
   * 连接还开着吗？
   *
   * 有这个判断是因为**连接可能比进程先结束**：还原备份（0.4.0）会先把连接关掉再换库文件，
   * 之后到 `app.exit()` 之间还有一小段窗口期（窗口急着关、渲染层还在收尾），
   * 这期间任何一句 `prepare()` 都会抛 `The database connection is not open` ——
   * 那个异常发生在 Electron 的事件回调里，会弹「A JavaScript error occurred in the main process」，
   * 而且会把退出流程卡住（用户看到的就是「一直弹这个」）。
   * 所以关窗这类**收尾动作**先问一句 isOpen，别拿已关的连接去写东西。
   */
  isOpen(): boolean
}

/** WAL + 外键，每次开连接都要重新设一遍（TECH.md 5.1）。 */
export function applyConnectionPragmas(db: SqlDatabase): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
}
