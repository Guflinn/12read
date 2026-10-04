import { dayKey, fillDays, shiftDay, streakFromDays } from '@shared/core/stats'
import { READING_STAT_TOP_BOOKS, type ReadingStats } from '@shared/types'
import type { ReadingStatRepository } from '../db/reading-repository'

export interface ReadingStatInput {
  bookId: string
  ms: number
  chars: number
}

/**
 * 阅读统计（0.1.3 第 8 项）：渲染层报上来的是一段一段的增量，
 * 这里按本地日期累加；书架上的「统计」面板再做汇总（今天 / 累计 / 连续 / 近 14 天）。
 */
export class ReadingStatsService {
  constructor(
    private readonly repo: ReadingStatRepository,
    /** 注入时间，单测里好把「今天」钉死。 */
    private readonly now: () => number = Date.now
  ) {}

  add(input: ReadingStatInput): void {
    const stamp = this.now()
    this.repo.add({
      bookId: input.bookId,
      day: dayKey(new Date(stamp)),
      ms: input.ms,
      chars: input.chars,
      updatedAt: stamp
    })
  }

  summary(days: number): ReadingStats {
    const today = dayKey(new Date(this.now()))
    const span = Math.max(1, Math.trunc(days))
    const todayTotals = this.repo.dayTotals(today)
    const totals = this.repo.totals()
    return {
      todayMs: todayTotals.ms,
      todayChars: todayTotals.chars,
      totalMs: totals.ms,
      totalChars: totals.chars,
      streakDays: streakFromDays(this.repo.days(), today),
      days: fillDays(this.repo.since(shiftDay(today, -(span - 1))), today, span),
      topBooks: this.repo.topBooks(READING_STAT_TOP_BOOKS)
    }
  }
}
