import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '@main/db/better-sqlite3-driver'
import type { SqlDatabase } from '@main/db/driver'
import { LibraryRepository, type NewBookRecord } from '@main/db/library-repository'
import { runMigrations } from '@main/db/migrate'
import { ReadingStatRepository, type NewReadingStatRecord } from '@main/db/reading-repository'

/** 用真实 better-sqlite3：累加（ON CONFLICT）、去重（COUNT DISTINCT）、级联删除都只有真引擎说了算。 */

const tempDirs: string[] = []
const openDbs: SqlDatabase[] = []

afterEach(() => {
  // Windows 上文件被打开着就删不掉：先关连接再递归清理
  while (openDbs.length > 0) openDbs.pop()?.close()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function makeBook(id: string, title: string): NewBookRecord {
  return {
    id,
    title,
    author: null,
    encoding: 'utf-8',
    byteSize: 100,
    charCount: 500,
    contentMode: 'single',
    addedAt: 1000
  }
}

function makeRepo(): { library: LibraryRepository; stats: ReadingStatRepository } {
  const dir = mkdtempSync(join(tmpdir(), 'twelve-read-stat-'))
  tempDirs.push(dir)
  const db = openDatabase(join(dir, 'library.db'))
  openDbs.push(db)
  runMigrations(db)
  const library = new LibraryRepository(db)
  library.insertBook(makeBook('b1', '书一'), [])
  library.insertBook(makeBook('b2', '书二'), [])
  return { library, stats: new ReadingStatRepository(db) }
}

function record(patch: Partial<NewReadingStatRecord> = {}): NewReadingStatRecord {
  return { bookId: 'b1', day: '2026-10-05', ms: 60_000, chars: 500, updatedAt: 1, ...patch }
}

describe('ReadingStatRepository', () => {
  it('同一天再报是累加，不新增行', () => {
    const { stats } = makeRepo()
    stats.add(record())
    stats.add(record({ ms: 30_000, chars: 200, updatedAt: 2 }))
    expect(stats.dayTotals('2026-10-05')).toEqual({ ms: 90_000, chars: 700 })
    expect(stats.days()).toEqual(['2026-10-05'])
  })

  it('没有记录时读出来是全 0 而不是报错', () => {
    const { stats } = makeRepo()
    expect(stats.totals()).toEqual({ ms: 0, chars: 0, books: 0 })
    expect(stats.dayTotals('2026-10-05')).toEqual({ ms: 0, chars: 0 })
    expect(stats.since('2026-01-01')).toEqual([])
    expect(stats.days()).toEqual([])
    expect(stats.topBooks(5)).toEqual([])
  })

  it('totals 汇总所有书的天，books 是去重后的本数', () => {
    const { stats } = makeRepo()
    stats.add(record())
    stats.add(record({ bookId: 'b2', ms: 1_000, chars: 10 }))
    stats.add(record({ bookId: 'b2', day: '2026-10-04', ms: 2_000, chars: 20 }))
    expect(stats.totals()).toEqual({ ms: 63_000, chars: 530, books: 2 })
  })

  it('since 只给这段时间的并按日期升序，days 从新到旧', () => {
    const { stats } = makeRepo()
    stats.add(record({ day: '2026-10-01', ms: 1_000 }))
    stats.add(record({ day: '2026-10-03', ms: 3_000 }))
    stats.add(record({ day: '2026-10-05', ms: 5_000 }))
    expect(stats.since('2026-10-03').map((day) => day.day)).toEqual(['2026-10-03', '2026-10-05'])
    expect(stats.since('2026-10-03')[1]).toEqual({ day: '2026-10-05', ms: 5_000, chars: 500 })
    expect(stats.days()).toEqual(['2026-10-05', '2026-10-03', '2026-10-01'])
  })

  it('topBooks 按时长降序，同长按时 bookId 升序，limit 生效', () => {
    const { stats } = makeRepo()
    stats.add(record({ bookId: 'b1', ms: 5_000 }))
    stats.add(record({ bookId: 'b2', ms: 9_000 }))
    expect(stats.topBooks(5)).toEqual([
      { bookId: 'b2', title: '书二', ms: 9_000, chars: 500 },
      { bookId: 'b1', title: '书一', ms: 5_000, chars: 500 }
    ])
    expect(stats.topBooks(1)).toHaveLength(1)
    expect(stats.topBooks(1)[0]?.bookId).toBe('b2')
    expect(stats.topBooks(0)).toEqual([])
  })

  it('时长与字数夹成非负整数：负数、NaN 当 0，小数截断', () => {
    const { stats } = makeRepo()
    stats.add(record({ ms: -5, chars: -1 }))
    stats.add(record({ ms: Number.NaN, chars: 12.7, updatedAt: 2 }))
    expect(stats.dayTotals('2026-10-05')).toEqual({ ms: 0, chars: 12 })
  })

  it('删书时这本书的统计跟着级联删掉', () => {
    const { library, stats } = makeRepo()
    stats.add(record())
    stats.add(record({ bookId: 'b2', ms: 2_000 }))
    library.deleteBook('b1')
    expect(stats.days()).toEqual(['2026-10-05'])
    expect(stats.totals()).toEqual({ ms: 2_000, chars: 500, books: 1 })
    expect(stats.topBooks(5).map((book) => book.bookId)).toEqual(['b2'])
  })
})
