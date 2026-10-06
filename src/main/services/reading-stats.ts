import { charsReadStep, dayKey, fillDays, shiftDay, streakFromDays } from '@shared/core/stats'
import { READING_STAT_TOP_BOOKS, type ReadingStats } from '@shared/types'
import type { ReadingStatRepository } from '../db/reading-repository'

export interface ReadingStatInput {
  bookId: string
  ms: number
  chars: number
}

/** 「在这儿停下读过」的上报（0.1.4）：字数由主进程按当天水位线算，渲染层只报位置。 */
export interface ReadSpanInput {
  bookId: string
  chapterIndex: number
  charOffset: number
  /**
   * 进入这一章时的章内偏移。当天第一次在这一章读书时，水位线从这里起算 ——
   * 从目录跳进章的中间时，前半个章不该被算成「读过」。
   */
  enteredAt: number
}

/**
 * 阅读统计（0.1.3 第 8 项，0.1.4 改字数口径）：
 * 时长由渲染层按 15 秒节拍报增量；**字数改由这里算** —— 渲染层只在
 * 「停下来读过一会儿」时报位置，是否算新字、算多少，由 `reading_span`
 * 里当天的水位线决定（同一段当天只算一次，拖过去的整段不算）。
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

  /**
   * 上报「在这个位置停下读过」。只有超出当天水位线的部分才记字数，返回这次记了多少。
   * 没有超出（往回翻、来回刷、跳转）时返回 0，且水位线不动 —— 所以重复上报是安全的。
   */
  readAt(input: ReadSpanInput): number {
    const stamp = this.now()
    const day = dayKey(new Date(stamp))
    const chapterIndex = Math.max(0, Math.trunc(input.chapterIndex))
    const offset = Math.max(0, Math.trunc(input.charOffset))
    const enteredAt = Math.max(0, Math.trunc(input.enteredAt))

    const mark = this.repo.spanMark(input.bookId, day, chapterIndex)
    // 当天第一次碰这一章：水位线从「进入这一章的位置」起算
    const base = mark === null ? enteredAt : mark
    const step = charsReadStep(base, offset)

    if (mark === null) {
      // 即使这一步不算新字，也把行建出来：之后的前进才有基准
      this.repo.upsertSpan({
        bookId: input.bookId,
        day,
        chapterIndex,
        maxOffset: step > 0 ? offset : base,
        updatedAt: stamp
      })
    } else if (step > 0) {
      this.repo.upsertSpan({
        bookId: input.bookId,
        day,
        chapterIndex,
        maxOffset: offset,
        updatedAt: stamp
      })
    }

    if (step <= 0) return 0
    this.repo.add({
      bookId: input.bookId,
      day,
      ms: 0,
      chars: step,
      updatedAt: stamp
    })
    return step
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
