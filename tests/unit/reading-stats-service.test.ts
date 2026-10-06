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

/**
 * readAt（0.1.4）：字数不再按「进度位移」累加，而是按「这一天在这一章读到过的最远偏移」
 * 去重后算。这一组用例把用户报的那个夸大场景钉死：来回刷不能重复计。
 */
describe('ReadingStatsService.readAt（字数去重）', () => {
  it('往前读：只记超出去的那一段，并推进水位线', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)

    expect(service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 300, enteredAt: 0 })).toBe(300)
    expect(service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 500, enteredAt: 0 })).toBe(200)
    expect(repo.dayTotals('2026-10-05').chars).toBe(500)
  })

  it('来回刷同一段：只算第一次（用户报的「刷一下就几万字」）', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)

    expect(service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 800, enteredAt: 0 })).toBe(800)
    // 往回翻
    expect(service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 100, enteredAt: 0 })).toBe(0)
    // 再前进到刚读过的地方：不算新字（旧逻辑这里会再加 700）
    expect(service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 800, enteredAt: 0 })).toBe(0)
    // 来回刷十遍也一样
    for (let i = 0; i < 10; i += 1) {
      service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 100, enteredAt: 0 })
      service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 800, enteredAt: 0 })
    }
    expect(repo.dayTotals('2026-10-05').chars).toBe(800)
  })

  it('一步跨太远（拖滚动条）不算读，水位线也不动，之后真读还算得到', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)

    expect(service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 9_000, enteredAt: 0 })).toBe(0)
    expect(repo.dayTotals('2026-10-05').chars).toBe(0)
    // 水位线还在 0：现在真的读 1000 字，照样记得上
    expect(service.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 1_000, enteredAt: 0 })).toBe(1_000)
  })

  it('进章点决定水位线起点：从目录跳进章中间，前半个章不算读过', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)

    expect(
      service.readAt({ bookId: 'b1', chapterIndex: 5, charOffset: 3_500, enteredAt: 3_000 })
    ).toBe(500)
    expect(
      service.readAt({ bookId: 'b1', chapterIndex: 5, charOffset: 4_000, enteredAt: 3_000 })
    ).toBe(500)
    expect(repo.dayTotals('2026-10-05').chars).toBe(1_000)
  })

  it('按天分开：昨天读过的，今天接着读照样算', () => {
    const repo = makeRepo()
    new ReadingStatsService(repo, () => YESTERDAY).readAt({
      bookId: 'b1',
      chapterIndex: 0,
      charOffset: 600,
      enteredAt: 0
    })
    const today = new ReadingStatsService(repo, () => TODAY)
    expect(today.readAt({ bookId: 'b1', chapterIndex: 0, charOffset: 200, enteredAt: 0 })).toBe(200)

    expect(repo.dayTotals('2026-10-04').chars).toBe(600)
    expect(repo.dayTotals('2026-10-05').chars).toBe(200)
  })

  it('不同章各算各的；负数与 0 不会写坏数据', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)

    expect(service.readAt({ bookId: 'b1', chapterIndex: -3, charOffset: 100, enteredAt: 0 })).toBe(100)
    expect(service.readAt({ bookId: 'b1', chapterIndex: 1, charOffset: -50, enteredAt: 0 })).toBe(0)
    expect(service.readAt({ bookId: 'b1', chapterIndex: 1, charOffset: 0, enteredAt: 0 })).toBe(0)
    expect(repo.dayTotals('2026-10-05').chars).toBe(100)
  })
})

describe('ReadingStatsService.calendar（0.1.4 日历视图）', () => {
  it('整月每天一行、没读的补 0，并给出当月峰值', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)
    service.add({ bookId: 'b1', ms: 20 * 60_000, chars: 100 }) // 2026-10-05
    new ReadingStatsService(repo, () => YESTERDAY).add({ bookId: 'b2', ms: 40 * 60_000, chars: 200 })

    const calendar = service.calendar('2026-10')
    expect(calendar.month).toBe('2026-10')
    expect(calendar.days).toHaveLength(31)
    expect(calendar.days[0]).toEqual({ day: '2026-10-01', ms: 0, chars: 0 })
    expect(calendar.days[4]).toEqual({ day: '2026-10-05', ms: 20 * 60_000, chars: 100 })
    expect(calendar.days[30]?.day).toBe('2026-10-31')
    // 峰值取当月最长的一天（10-04 的 40 分钟）
    expect(calendar.maxMs).toBe(40 * 60_000)
    // 跨月的记录不会漏进来
    expect(calendar.days.filter((day) => day.ms > 0)).toHaveLength(2)
  })

  it('整月都没读：全是 0，峰值为 0（界面不上色）', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)
    const calendar = service.calendar('2026-07')
    expect(calendar.days).toHaveLength(31)
    expect(calendar.days.every((day) => day.ms === 0)).toBe(true)
    expect(calendar.maxMs).toBe(0)
  })

  it('二月按实际天数，月份格式不对给空数组', () => {
    const repo = makeRepo()
    const service = new ReadingStatsService(repo, () => TODAY)
    expect(service.calendar('2028-02').days).toHaveLength(29)
    expect(service.calendar('2026-13')).toEqual({ month: '2026-13', days: [], maxMs: 0 })
  })
})
