import type { SqlDatabase } from './driver'

/** meta 表上的键值存取（当前用于 schema_version 与阅读设置）。 */
export class MetaRepository {
  constructor(private readonly db: SqlDatabase) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
    if (row === undefined || row === null) return null
    const value = (row as { value?: unknown }).value
    return typeof value === 'string' ? value : null
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
  }
}
