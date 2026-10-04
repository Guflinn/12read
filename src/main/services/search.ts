import {
  SEARCH_MAX_HITS,
  SEARCH_MAX_HITS_PER_CHAPTER,
  chapterMatches,
  normalizeQuery
} from '@shared/core/search'
import type { ChapterHitCount, SearchHit, SearchResult, SearchScope } from '@shared/types'
import type { LibraryRepository } from '../db/library-repository'
import type { FileContentReader } from './content-reader'

export interface BookSearchRequest {
  bookId: string
  query: string
  scope: SearchScope
  /** scope === 'chapter' 时只扫这一章。 */
  chapterIndex: number
}

/** 每扫完一章让出一次事件循环：851 万字的书不能把主进程焊住（0.1.3 第 10 项）。 */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/**
 * 章节内 / 全书搜索（0.1.3 第 7 项）：
 * 逐章读正文（FileContentReader 有 64MB LRU，同一本书的重复搜索基本全命中缓存）再扫字符串。
 * 不建任何索引，理由写在 @shared/core/search.ts 与 TECH.md 7。
 */
export class BookSearchService {
  constructor(
    private readonly content: FileContentReader,
    private readonly repo: LibraryRepository
  ) {}

  async search({ bookId, query, scope, chapterIndex }: BookSearchRequest): Promise<SearchResult> {
    const needle = normalizeQuery(query)
    const empty: SearchResult = {
      query: needle,
      scope,
      total: 0,
      counts: [],
      hits: [],
      truncated: false
    }
    if (needle.length === 0) return empty

    const chapters = this.repo.listChapters(bookId)
    const targets =
      scope === 'chapter' ? chapters.filter((chapter) => chapter.index === chapterIndex) : chapters
    if (targets.length === 0) return empty

    const hits: SearchHit[] = []
    const counts: ChapterHitCount[] = []
    // total 与 counts 都是「每章最多数到 SEARCH_MAX_HITS_PER_CHAPTER」的下界，够面板显示用了。
    let total = 0
    let truncated = false

    for (const chapter of targets) {
      const text = await this.content.readChapter(bookId, chapter.index)
      const matched = chapterMatches(chapter, text, needle, SEARCH_MAX_HITS_PER_CHAPTER)

      if (matched.count > 0) {
        counts.push({ chapterIndex: chapter.index, count: matched.count })
        total += matched.count
      }
      if (matched.capped) truncated = true

      const room = SEARCH_MAX_HITS - hits.length
      if (matched.hits.length > room) {
        if (room > 0) hits.push(...matched.hits.slice(0, room))
        // 列表塞满了：后面的章不再扫，直接在结果上标 truncated。
        truncated = true
        break
      }
      hits.push(...matched.hits)
      if (hits.length >= SEARCH_MAX_HITS) break

      await yieldToLoop()
    }

    return { query: needle, scope, total, counts, hits, truncated }
  }
}
