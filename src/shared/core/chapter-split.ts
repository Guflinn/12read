import type { ChapterKind } from '../types'

/**
 * 章节切分（MVP.md 3.2 / TECH.md 7）。
 * 纯函数，不读磁盘；输出偏移是「解码后文本的 UTF-16 code unit 偏移」。
 */

/** 命中行的长度上限，超了就认为那是正文里的一句引用，不是标题。 */
export const CHAPTER_LINE_MAX_CHARS = 40

/** 整行匹配的章节标记。 */
export const CHAPTER_MARKER_RE =
  /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷部篇集]|(?:序章|楔子|序言|前言|引子|后记|尾声|终章|番外)(?=\s|$|[:：.。、\-—]))/

export const FALLBACK_TARGET_CHARS = 4000
export const FALLBACK_MIN_CHARS = 3000
export const FALLBACK_MAX_CHARS = 5000

export interface SplitChapter {
  title: string
  /** 全文解码文本里的起始偏移。 */
  startOffset: number
  charLength: number
  kind: ChapterKind
}

export interface SplitResult {
  chapters: SplitChapter[]
  /** true 表示这本没识别到章节，走的是定长分段。 */
  usedFallback: boolean
  /** 正文之前那段无法归入任何章节的文字，会单独成为「开篇」。 */
  markerHits: number
}

export interface SplitOptions {
  targetChars?: number
  minChars?: number
}

interface MarkerHit {
  offset: number
  title: string
}

/** 逐行扫描；三条防误伤规则：整行匹配、命中行 <= 40 字、起点单调递增。 */
export function findChapterMarkers(text: string): MarkerHit[] {
  const hits: MarkerHit[] = []
  let lineStart = 0
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart)
    if (lineEnd === -1) lineEnd = text.length

    const trimmed = text.slice(lineStart, lineEnd).replace(/\r$/, '').trim()
    if (
      trimmed.length > 0 &&
      trimmed.length <= CHAPTER_LINE_MAX_CHARS &&
      CHAPTER_MARKER_RE.test(trimmed)
    ) {
      const last = hits[hits.length - 1]
      if (!last || last.offset < lineStart) hits.push({ offset: lineStart, title: trimmed })
    }

    if (lineEnd === text.length) break
    lineStart = lineEnd + 1
  }
  return hits
}

/** 从 to 往 from 方向找最近的段落边界（换行之后）。 */
function findParagraphBoundary(text: string, from: number, to: number): number {
  for (let i = to; i > from; i -= 1) {
    if (text[i - 1] === '\n') return i
  }
  return to
}

/** 兜底：定长分段，尽量落在段落边界上。 */
export function splitByLength(text: string, options: SplitOptions = {}): SplitChapter[] {
  const target = options.targetChars ?? FALLBACK_TARGET_CHARS
  const min = options.minChars ?? FALLBACK_MIN_CHARS
  const chapters: SplitChapter[] = []
  let start = 0
  let index = 1

  while (start < text.length) {
    let end = Math.min(start + target, text.length)
    if (end < text.length) {
      const boundary = findParagraphBoundary(text, start + min, end)
      if (boundary > start) end = boundary
    }
    chapters.push({
      title: '分段 ' + index,
      startOffset: start,
      charLength: end - start,
      kind: 'segment'
    })
    index += 1
    start = end
  }

  if (chapters.length === 0) {
    chapters.push({ title: '分段 1', startOffset: 0, charLength: 0, kind: 'segment' })
  }
  return chapters
}

/**
 * 切分入口：正文命中 >= 2 个标记按章节切，否则整本定长分段。
 * 首个标记之前若有正文，单独成为 kind=segment 的「开篇」，保证文本不丢。
 */
export function splitChapters(text: string, options: SplitOptions = {}): SplitResult {
  const hits = findChapterMarkers(text)

  if (hits.length < 2) {
    return { chapters: splitByLength(text, options), usedFallback: true, markerHits: hits.length }
  }

  const chapters: SplitChapter[] = []
  const prefaceEnd = hits[0].offset
  if (text.slice(0, prefaceEnd).trim().length > 0) {
    chapters.push({ title: '开篇', startOffset: 0, charLength: prefaceEnd, kind: 'segment' })
  }

  for (let i = 0; i < hits.length; i += 1) {
    const start = hits[i].offset
    const end = i + 1 < hits.length ? hits[i + 1].offset : text.length
    chapters.push({ title: hits[i].title, startOffset: start, charLength: end - start, kind: 'chapter' })
  }

  return { chapters, usedFallback: false, markerHits: hits.length }
}
