import type { ReadingBookStat } from '@shared/types'
import type { SqlDatabase } from './driver'
import type { SqlRow } from './mappers'

export interface NewReadingStatRecord {
  bookId: string
  day: string
  ms: number
  chars: number
  updatedAt: number
}

export interface DayTotals {
  day: string
  ms: number
  chars: number
}

export interface ReadingTotals {
  ms: number
  chars: number
  books: number
}

export interface ReadingSpanRecord {
  bookId: string
  day: string
  chapterIndex: number
  maxOffset: number
  updatedAt: number
}

/** 夹成非负整数：库里的 ms / chars 只该往前涨，坏值一律当 0。 */
function amount(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : 0
}

function readDay(row: SqlRow): DayTotals {
  return {
    day: String(row['day']),
    ms: amount(row['ms']),
    chars: amount(row['chars'])
  }
}

/**
 * 阅读统计仓储（0.1.3 第 8 项）：只碰数据库，日期由服务算好再传进来。
 * 一行 = 一本书的一天，同一天再报就累加（PRIMARY KEY (book_id, day)）。
 */
export class ReadingStatRepository {
  constructor(private readonly db: SqlDatabase) {}

  add(record: NewReadingStatRecord): void {
    this.db
      .prepare(
        `INSERT INTO reading_stat (book_id, day, ms, chars, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(book_id, day) DO UPDATE SET
           ms = ms + excluded.ms,
           chars = chars + excluded.chars,
           updated_at = excluded.updated_at`
      )
      .run(record.bookId, record.day, amount(record.ms), amount(record.chars), record.updatedAt)
  }

  /** 全库累计：总时长、总字数、读过几本书。 */
  totals(): ReadingTotals {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(ms), 0) AS ms, COALESCE(SUM(chars), 0) AS chars,
                COUNT(DISTINCT book_id) AS books
         FROM reading_stat`
      )
      .get() as SqlRow | undefined
    return {
      ms: amount(row?.['ms']),
      chars: amount(row?.['chars']),
      books: amount(row?.['books'])
    }
  }

  dayTotals(day: string): { ms: number; chars: number } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(ms), 0) AS ms, COALESCE(SUM(chars), 0) AS chars
         FROM reading_stat WHERE day = ?`
      )
      .get(day) as SqlRow | undefined
    return { ms: amount(row?.['ms']), chars: amount(row?.['chars']) }
  }

  /** 从 startDay（含）起的每日合计，按日期升序；没记录的日子不会出现（外面填 0）。 */
  since(startDay: string): DayTotals[] {
    const rows = this.db
      .prepare(
        `SELECT day, COALESCE(SUM(ms), 0) AS ms, COALESCE(SUM(chars), 0) AS chars
         FROM reading_stat WHERE day >= ? GROUP BY day ORDER BY day ASC`
      )
      .all(startDay)
    return rows.map((row) => readDay(row as SqlRow))
  }

  /** 闭区间 [fromDay, toDay] 里每天的合计，按日期升序；没有记录的日子不会出现（外面填 0）。 */
  between(fromDay: string, toDay: string): DayTotals[] {
    const rows = this.db
      .prepare(
        `SELECT day, COALESCE(SUM(ms), 0) AS ms, COALESCE(SUM(chars), 0) AS chars
         FROM reading_stat WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day ASC`
      )
      .all(fromDay, toDay)
    return rows.map((row) => readDay(row as SqlRow))
  }

  /** 有记录的所有日期，从新到旧；算连续阅读天数用。 */
  days(): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT day FROM reading_stat ORDER BY day DESC`).all()
    return rows.map((row) => String((row as SqlRow)['day']))
  }

  /** 读得最久的几本书，带书名（书删了统计跟着级联删，所以不用兜底）。 */
  topBooks(limit: number): ReadingBookStat[] {    const rows = this.db
      .prepare(
        `SELECT rs.book_id AS book_id, b.title AS title,
                COALESCE(SUM(rs.ms), 0) AS ms, COALESCE(SUM(rs.chars), 0) AS chars
         FROM reading_stat rs JOIN book b ON b.id = rs.book_id
         GROUP BY rs.book_id, b.title
         ORDER BY ms DESC, rs.book_id ASC
         LIMIT ?`
      )
      .all(Math.max(0, Math.trunc(limit)))
    return rows.map((row) => {
      const line = row as SqlRow
      return {
        bookId: String(line['book_id']),
        title: String(line['title']),
        ms: amount(line['ms']),
        chars: amount(line['chars'])
      }
    })
  }

  /**
   * 这一天在这一章读到过的最远偏移（高水位线）；没有记录返回 null。
   * 0.1.4 起用它去重：没超过水位线就不算新读的字数。
   */
  spanMark(bookId: string, day: string, chapterIndex: number): number | null {
    const row = this.db
      .prepare(
        `SELECT max_offset FROM reading_span
         WHERE book_id = ? AND day = ? AND chapter_index = ?`
      )
      .get(bookId, day, chapterIndex)
    if (row === undefined || row === null) return null
    const value = Number((row as SqlRow)['max_offset'])
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
  }

  /** 水位线只往前推：同一天同一章反复报也不会退回去（MAX 兜底）。 */
  upsertSpan(record: ReadingSpanRecord): void {
    this.db
      .prepare(
        `INSERT INTO reading_span (book_id, day, chapter_index, max_offset, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(book_id, day, chapter_index) DO UPDATE SET
           max_offset = MAX(max_offset, excluded.max_offset),
           updated_at = excluded.updated_at`
      )
      .run(
        record.bookId,
        record.day,
        Math.max(0, Math.trunc(record.chapterIndex)),
        amount(record.maxOffset),
        record.updatedAt
      )
  }
}
