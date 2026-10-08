import { estimatePercent } from '@shared/core/anchor'
import type { Book, Chapter, ChapterKind } from '@shared/types'

/** 阅读器的展示层纯函数：字数、百分比、封面、时间，全部可在 node 环境单测。 */

export const FONT_SIZE_MIN = 15
export const FONT_SIZE_MAX = 32
export const LINE_HEIGHTS: readonly number[] = [1.6, 1.9, 2.25]

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return 19
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)))
}

/** 整体进度：冗余展示值，不参与定位（TECH.md 6.2）。 */
export function percentOf(totalChars: number, chapterStart: number, charOffset: number): number {
  return estimatePercent(totalChars, chapterStart, charOffset)
}

export function formatPercent(percent: number): string {
  return percent.toFixed(1) + '%'
}

export function kindLabel(kind: ChapterKind): string {
  return kind === 'chapter' ? '章节' : '分段'
}

export function formatChars(chars: number): string {
  if (!Number.isFinite(chars) || chars <= 0) return '0 字'
  if (chars < 10000) return Math.round(chars) + ' 字'
  return (chars / 10000).toFixed(1) + ' 万字'
}

/** 备份包这类文件的体积：1024 进制，保留一位小数。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return Math.round(bytes) + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * 还剩多少字：percent 由「本章起始 + 章内偏移」推得，所以剩余量也按全书估算。
 * 只用于展示，不参与定位（TECH.md 6.2）。
 */
export function remainingChars(totalChars: number, percent: number): number {
  if (!Number.isFinite(totalChars) || totalChars <= 0) return 0
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  return Math.max(0, Math.round(totalChars * (1 - safe / 100)))
}

/** 阅读器底部那行字：已读百分比 + 剩余字数。 */
export function progressLabel(totalChars: number, percent: number): string {
  return '已读 ' + formatPercent(percent) + ' · 剩余 ' + formatChars(remainingChars(totalChars, percent))
}

export function describeBook(book: Book): string {
  // 「节」是中性说法：既涵盖识别出的章节，也涵盖定长兜底的分段
  return formatChars(book.charCount) + ' · ' + book.chapterCount + ' 节'
}

/** 书架上的相对时间，跨天后退回日期。 */
export function formatRelative(ts: number, now: number): string {
  const diff = now - ts
  if (!Number.isFinite(diff) || diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前'
  const date = new Date(ts)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

/** 封面配色由 coverSeed 推导，同一本书永远同色（不随机）。 */
export function coverGradient(seed: number): string {
  const hue = ((Math.abs(seed) % 360) + 360) % 360
  const hue2 = (hue + 26) % 360
  return 'linear-gradient(160deg, hsl(' + hue + ', 40%, 47%), hsl(' + hue2 + ', 38%, 31%))'
}

export function coverInitial(title: string): string {
  const trimmed = title.trim()
  return trimmed.length > 0 ? Array.from(trimmed)[0] : '书'
}

export function chapterLabel(chapter: Chapter | undefined, total: number): string {
  if (!chapter) return '还没有内容'
  const position = (chapter.index + 1) + '/' + total
  return kindLabel(chapter.kind) + ' ' + position + ' · ' + chapter.title
}

/**
 * 两侧切章箭头的悬停提示（0.2.1）：「上一章：xxx」/「下一章：xxx」。
 * 长章节刚打开还没读到下面时，靠两侧箭头切章而不用滚到底 —— 提示里带上章节名，
 * 让用户点之前就知道要切去哪儿。
 */
export function edgeChapterTip(dir: -1 | 1, title: string): string {
  return (dir < 0 ? '上一章：' : '下一章：') + title
}
