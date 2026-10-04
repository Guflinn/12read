import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '@main/db/better-sqlite3-driver'
import type { SqlDatabase } from '@main/db/driver'
import { LibraryRepository, type NewBookRecord } from '@main/db/library-repository'
import { runMigrations } from '@main/db/migrate'
import { ReadingStatRepository } from '@main/db/reading-repository'
import { ReadingStatsService } from '@main/services/reading-stats'
import { READING_STAT_TOP_BOOKS } from '@shared/types'

const tempDirs: string[] = []
const openDbs: SqlDatabase[] = []

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/** 2026-10-05 本地上午 10 点：把「今天」钉死，免得测试跟着日历走。 */
const TODAY = new Date(2026, 9, 5, 10, 0, 0).getTime()
const YESTERDAY = new Date(2026, 9, 4, 10, 0, 0).getTime()

function makeBook(id: string): NewBookRecord {
  return {
    id,
    title: '书 ' + id,
    author: null,
    encoding: 'utf-8',
    byteSize: 100,
    charCount: 500,
    contentMode: 'single',
    addedAt: 1000
  }
}

function makeRepo(ids: string[] = ['b1', 'b2']): ReadingStatRepository {
  const dir = mkdtempSync(join(tmpdir(), 'twelve-read-service-'))
  tempDirs.push(dir)
  const db = openDatabase(join(dir, 'library.db'))
  openDbs.push(db)
  runMigrations(db)
  const library = new LibraryRepository(db)
  for (const id of ids) library.insertBook(makeBook(id), [])
  return new ReadingStatRepository(db)
}

describe('ReadingStatsService', () => {
  it('add 按注入的时间记到今天，隔天再报就是两行', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)
    service.add({ bookId: 'b1', ms: 60_000, chars: 300 })
    new ReadingStatsService(repo, () => YESTERDAY).add({ bookId: 'b1', ms: 30_000, chars: 100 })
    expect(repo.days()).toEqual(['2026-10-05', '2026-10-04'])
  })

  it('summary 给今天 / 累计 / 近 14 天，缺的日子补 0', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)
    service.add({ bookId: 'b1', ms: 60_000, chars: 300 })
    const stats = service.summary(14)
    expect(stats.todayMs).toBe(60_000)
    expect(stats.todayChars).toBe(300)
    expect(stats.totalMs).toBe(60_000)
    expect(stats.totalChars).toBe(300)
    expect(stats.days).toHaveLength(14)
    expect(stats.days[13]).toEqual({ day: '2026-10-05', ms: 60_000, chars: 300 })
    expect(stats.days[0]).toEqual({ day: '2026-09-22', ms: 0, chars: 0 })
    expect(stats.topBooks).toEqual([{ bookId: 'b1', title: '书 b1', ms: 60_000, chars: 300 }])
  })

  it('连续天数：今天读了从今天数，今天没读从昨天数', () => {
    const repo = makeRepo()
    new ReadingStatsService(repo, () => TODAY).add({ bookId: 'b1', ms: 1_000, chars: 1 })
    new ReadingStatsService(repo, () => YESTERDAY).add({ bookId: 'b1', ms: 1_000, chars: 1 })
    expect(new ReadingStatsService(repo, () => TODAY).summary(14).streakDays).toBe(2)

    const onlyYesterday = makeRepo()
    new ReadingStatsService(onlyYesterday, () => YESTERDAY).add({ bookId: 'b1', ms: 1_000, chars: 1 })
    const stats = new ReadingStatsService(onlyYesterday, () => TODAY).summary(14)
    expect(stats.streakDays).toBe(1)
    expect(stats.todayMs).toBe(0)

    const stale = makeRepo()
    new ReadingStatsService(stale, () => new Date(2026, 9, 1, 9).getTime()).add({
      bookId: 'b1',
      ms: 1_000,
      chars: 1
    })
    expect(new ReadingStatsService(stale, () => TODAY).summary(14).streakDays).toBe(0)
  })

  it('天数会被夹到合理范围：0 当 1 天，非整数截断', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)
    expect(service.summary(0).days).toEqual([{ day: '2026-10-05', ms: 0, chars: 0 }])
    expect(service.summary(2.7).days.map((day) => day.day)).toEqual(['2026-10-04', '2026-10-05'])
    expect(service.summary(90).days).toHaveLength(90)
    expect(service.summary(90).days[0]?.day).toBe('2026-07-08')
  })

  it('topBooks 取时长最长的前几本', () => {
    const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']
    const repo = makeRepo(ids)
    const service = new ReadingStatsService(repo, () => TODAY)
    ids.forEach((id, index) => {
      service.add({ bookId: id, ms: (index + 1) * 1_000, chars: index + 1 })
    })
    const top = service.summary(14).topBooks
    expect(top).toHaveLength(READING_STAT_TOP_BOOKS)
    expect(top.map((book) => book.bookId)).toEqual(['b6', 'b5', 'b4', 'b3', 'b2'])
  })
})
