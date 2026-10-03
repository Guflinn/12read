import Database from 'better-sqlite3'
import { applyConnectionPragmas, type SqlDatabase, type SqlStatement } from './driver'

/** 全项目唯一 import better-sqlite3 的文件，方便单测绕开原生模块。 */
export function openDatabase(filePath: string): SqlDatabase {
  const raw = new Database(filePath)
  const adapter: SqlDatabase = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => raw.prepare(sql) as unknown as SqlStatement,
    transaction: <T>(fn: () => T) => raw.transaction(fn) as unknown as () => T,
    pragma: (statement) => raw.pragma(statement) as unknown,
    close: () => raw.close()
  }
  applyConnectionPragmas(adapter)
  return adapter
}
