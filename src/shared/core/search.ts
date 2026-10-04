import type { Chapter, CharOffset, SearchHit } from '../types'

/**
 * 章节内 / 全书搜索的纯函数（0.1.3 第 7 项）。
 *
 * 为什么不用 SQLite FTS5（TECH.md 7 有完整理由）：
 *   - unicode61 分词器对中文不切词，整句查询基本命中不了；
 *   - trigram 分词器只支持 3 字以上的查询，而 851 万字的书要建两千万级三元组，
 *     索引体积与导入耗时都不划算；
 *   - 正文本来就在 FileContentReader 的 64MB LRU 里，一遍 indexOf 是百毫秒级，
 *     且零迁移、零额外体积。所以这里是「读正文 + 扫字符串」，不依赖任何索引。
 *
 * 偏移语义与全书一致：CharOffset 是 UTF-16 code unit 偏移，章内偏移相对章首。
 */

/** 一次搜索最多返回多少条命中。 */
export const SEARCH_MAX_HITS = 200

/** 每章最多返回多少条命中：免得某一章的高频词把别的章挤光。 */
export const SEARCH_MAX_HITS_PER_CHAPTER = 30

/** 关键词长度上限（shared/schema.ts 的 searchArgsSchema 用的是同一个值）。 */
export const SEARCH_MAX_QUERY_CHARS = 80

/** 每条命中前后各取多少字做上下文。 */
export const SEARCH_CONTEXT_CHARS = 24

/** 关键词去首尾空白并夹到长度上限；返回空串表示不搜。 */
export function normalizeQuery(raw: string): string {
  return raw.trim().slice(0, SEARCH_MAX_QUERY_CHARS)
}

/** 把换行与连续空白折成单个空格：上下文要放在一行里显示。 */
export function foldWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * 大小写不敏感扫描：只有 toLowerCase 不改变长度时才用它。
 * 少数语言（如 İ、ß）转小写会变长或变短，那样偏移就错位了，此时退回原串按大小写敏感扫。
 */
function lowerFor(text: string, query: string): { hay: string; needle: string } | null {
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  if (hay.length === text.length && needle.length === query.length) return { hay, needle }
  return null
}

/**
 * 从左到右找不重叠的命中位置，最多 limit 条（limit <= 0 或空关键词返回空数组）。
 * from 用来在超大章里分批推进，单测会盯住。
 */
export function findMatches(
  text: string,
  query: string,
  limit = SEARCH_MAX_HITS,
  from = 0
): CharOffset[] {
  const needle = normalizeQuery(query)
  const offsets: CharOffset[] = []
  if (needle.length === 0 || text.length === 0 || limit <= 0) return offsets

  const lower = lowerFor(text, needle)
  const hay = lower ? lower.hay : text
  const target = lower ? lower.needle : needle

  let at = Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0
  while (offsets.length < limit && at <= hay.length - target.length) {
    const found = hay.indexOf(target, at)
    if (found < 0) break
    offsets.push(found)
    at = found + target.length
  }
  return offsets
}

/** 命中次数，最多数到 max（高频词不必数完几十万次）。 */
export function countMatches(text: string, query: string, max = SEARCH_MAX_HITS_PER_CHAPTER): number {
  return findMatches(text, query, max).length
}

/** 命中处的上下文：前后各取 width 字，换行与连续空白折成空格。 */
export function contextAround(
  text: string,
  offset: CharOffset,
  length: number,
  width = SEARCH_CONTEXT_CHARS
): { before: string; match: string; after: string } {
  const start = Math.max(0, Math.min(text.length, Math.trunc(offset)))
  const end = Math.max(start, Math.min(text.length, start + Math.max(0, Math.trunc(length))))
  return {
    before: foldWhitespace(text.slice(Math.max(0, start - width), start)),
    match: foldWhitespace(text.slice(start, end)),
    after: foldWhitespace(text.slice(end, Math.min(text.length, end + width)))
  }
}

/** 一章的命中结果：count 是命中数；capped 表示这一章还有没列出来的命中。 */
export interface ChapterMatches {
  hits: SearchHit[]
  count: number
  capped: boolean
}

/**
 * 扫一章：多找一条来判断有没有被每章上限截断（capped），
 * 这样 UI 可以写「本章 30+ 处」，而不是假装只有 30 处。
 */
export function chapterMatches(
  chapter: Pick<Chapter, 'index' | 'title'>,
  text: string,
  query: string,
  limit = SEARCH_MAX_HITS_PER_CHAPTER
): ChapterMatches {
  const needle = normalizeQuery(query)
  if (needle.length === 0 || limit <= 0) return { hits: [], count: 0, capped: false }

  const offsets = findMatches(text, needle, limit + 1)
  const capped = offsets.length > limit
  const shown = capped ? offsets.slice(0, limit) : offsets
  return {
    count: shown.length,
    capped,
    hits: shown.map((offset) => ({
      chapterIndex: chapter.index,
      chapterTitle: chapter.title,
      charOffset: offset,
      ...contextAround(text, offset, needle.length)
    }))
  }
}
