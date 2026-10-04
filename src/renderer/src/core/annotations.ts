import type { Bookmark, CharOffset, Chapter, Highlight } from '@shared/types'

/** 正文里切出来的一段：要么属于某条划线，要么是普通文字。 */
export interface Segment {
  text: string
  highlightId: string | null
}

/** 参与切分只需要这两个字段（章内起止偏移）。 */
export interface HighlightRange {
  id: string
  startOffset: CharOffset
  endOffset: CharOffset
}

/**
 * 把一段正文按划线切成若干段。
 * base 是这段文字在章内的起始偏移 —— 段落是从章文本里切出来的，
 * 而划线记的是章内偏移，所以必须先做这一次换算。
 * 越界的划线夹进本段；互相重叠的部分归先到的那条，后面那条只画多出来的部分。
 */
export function splitHighlighted(
  text: string,
  base: CharOffset,
  ranges: readonly HighlightRange[]
): Segment[] {
  if (text.length === 0) return []
  const limit = base + text.length
  const clipped = ranges
    .map((range) => ({
      id: range.id,
      start: Math.max(base, Math.min(range.startOffset, limit)),
      end: Math.max(base, Math.min(range.endOffset, limit))
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const segments: Segment[] = []
  let cursor = base
  for (const range of clipped) {
    // 与前一条重叠的部分归先到的那条，自己只画多出来的尾巴 —— 一个字都不少画
    const start = Math.max(range.start, cursor)
    if (range.end <= start) continue
    if (start > cursor) {
      segments.push({ text: text.slice(cursor - base, start - base), highlightId: null })
    }
    segments.push({
      text: text.slice(start - base, range.end - base),
      highlightId: range.id
    })
    cursor = range.end
  }
  if (cursor < limit) segments.push({ text: text.slice(cursor - base), highlightId: null })
  return segments
}

/** 章内某一处附近的原文：书签列表里当摘要（折叠掉换行与多余空白）。 */
export function excerptAt(text: string, offset: CharOffset, length = 24): string {
  if (text.length === 0) return ''
  const start = Math.max(0, Math.min(Math.trunc(offset), text.length - 1))
  return text
    .slice(start, start + Math.max(1, length))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 选区换算成章内偏移：从后往前拖（反着选）也照样能用；
 * 空选区、非数字、逆向且长度为零一律返回 null。
 */
export function normalizeSelection(
  startOffset: number,
  endOffset: number
): { startOffset: CharOffset; endOffset: CharOffset } | null {
  const start = Math.trunc(Math.min(startOffset, endOffset))
  const end = Math.trunc(Math.max(startOffset, endOffset))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { startOffset: start, endOffset: end }
}

/** 本书某一章里的全部划线（阅读器每次滚到新章用它切分正文）。 */
export function rangesOfChapter(
  highlights: readonly Highlight[],
  chapterIndex: number
): HighlightRange[] {
  return highlights
    .filter((item) => item.chapterIndex === chapterIndex)
    .map((item) => ({ id: item.id, startOffset: item.startOffset, endOffset: item.endOffset }))
}

/** 列表里显示「第几章 标题」，章节表对不上时也不至于显示空白。 */
export function spotLabel(chapters: readonly Chapter[], chapterIndex: number): string {
  const chapter = chapters[chapterIndex]
  return chapter ? chapterIndex + 1 + '. ' + chapter.title : chapterIndex + 1 + '. （章节已不在）'
}

/** 书签按正文顺序排。 */
export function orderBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return [...bookmarks].sort(
    (a, b) => a.chapterIndex - b.chapterIndex || a.charOffset - b.charOffset
  )
}

/** 划线按正文顺序排。 */
export function orderHighlights(highlights: readonly Highlight[]): Highlight[] {
  return [...highlights].sort(
    (a, b) => a.chapterIndex - b.chapterIndex || a.startOffset - b.startOffset
  )
}
