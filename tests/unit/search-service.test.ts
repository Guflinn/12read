import { describe, expect, it, vi } from 'vitest'
import type { Chapter, SearchResult } from '@shared/types'
import { SEARCH_MAX_HITS, SEARCH_MAX_HITS_PER_CHAPTER } from '@shared/core/search'
import { BookSearchService } from '@main/services/search'
import type { FileContentReader } from '@main/services/content-reader'
import type { LibraryRepository } from '@main/db/library-repository'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function makeChapters(count: number): Chapter[] {
  return Array.from({ length: count }, (_, index) => ({
    bookId: BOOK_ID,
    index,
    title: '第' + (index + 1) + '章',
    startOffset: index * 100,
    charLength: 100,
    kind: 'chapter' as const
  }))
}

interface Fake {
  service: BookSearchService
  readChapter: ReturnType<typeof vi.fn>
}

/** 假正文读取器 + 假书库：搜索服务只用到这两个依赖。 */
function makeService(texts: string[], chapters: Chapter[] = makeChapters(texts.length)): Fake {
  const readChapter = vi.fn(async (_bookId: string, index: number): Promise<string> => texts[index] ?? '')
  const content = { readChapter } as unknown as FileContentReader
  const repo = { listChapters: () => chapters } as unknown as LibraryRepository
  return { service: new BookSearchService(content, repo), readChapter }
}

function search(
  fake: Fake,
  query: string,
  scope: 'chapter' | 'book' = 'book',
  chapterIndex = 0
): Promise<SearchResult> {
  return fake.service.search({ bookId: BOOK_ID, query, scope, chapterIndex })
}

describe('搜索服务：范围', () => {
  it('本章范围只读那一章', async () => {
    const fake = makeService(['山川湖海', '星辰风雨'])
    const result = await search(fake, '风雨', 'chapter', 1)
    expect(fake.readChapter.mock.calls).toEqual([[BOOK_ID, 1]])
    expect(result.scope).toBe('chapter')
    expect(result.total).toBe(1)
    expect(result.counts).toEqual([{ chapterIndex: 1, count: 1 }])
    expect(result.hits[0]).toMatchObject({ chapterIndex: 1, chapterTitle: '第2章', charOffset: 2 })
  })

  it('全书范围逐章扫，命中数与章号都对得上', async () => {
    const texts = ['山川山川', '没有命中', '山川', '山川山川山川']
    const fake = makeService(texts)
    const result = await search(fake, '山川')
    expect(fake.readChapter.mock.calls).toEqual([
      [BOOK_ID, 0],
      [BOOK_ID, 1],
      [BOOK_ID, 2],
      [BOOK_ID, 3]
    ])
    expect(result.total).toBe(6)
    expect(result.counts).toEqual([
      { chapterIndex: 0, count: 2 },
      { chapterIndex: 2, count: 1 },
      { chapterIndex: 3, count: 3 }
    ])
    expect(result.hits.map((hit) => hit.chapterIndex)).toEqual([0, 0, 2, 3, 3, 3])
    expect(result.truncated).toBe(false)
  })

  it('章节不存在时给空结果，也不读正文', async () => {
    const fake = makeService(['山川湖海'])
    const result = await search(fake, '山川', 'chapter', 9)
    expect(result.total).toBe(0)
    expect(result.counts).toEqual([])
    expect(result.hits).toEqual([])
    expect(fake.readChapter).not.toHaveBeenCalled()
  })

  it('这本书一章都没有时给空结果', async () => {
    const fake = makeService([], [])
    const result = await search(fake, '山川')
    expect(result).toMatchObject({ total: 0, counts: [], hits: [], truncated: false })
    expect(fake.readChapter).not.toHaveBeenCalled()
  })
})

describe('搜索服务：空关键词', () => {
  it('空串与纯空白都不进正文', async () => {
    const fake = makeService(['山川湖海'])
    const empty = await search(fake, '   ')
    expect(empty).toEqual({
      query: '',
      scope: 'book',
      total: 0,
      counts: [],
      hits: [],
      truncated: false
    })
    expect(fake.readChapter).not.toHaveBeenCalled()
  })
})

describe('搜索服务：截断', () => {
  it('一章超过每章上限时记下 truncated，其余章还是继续扫', async () => {
    const dense = '山川'.repeat(SEARCH_MAX_HITS_PER_CHAPTER + 10)
    const fake = makeService([dense, '山川'])
    const result = await search(fake, '山川')
    expect(result.truncated).toBe(true)
    expect(result.counts[0]).toEqual({ chapterIndex: 0, count: SEARCH_MAX_HITS_PER_CHAPTER })
    expect(result.counts[1]).toEqual({ chapterIndex: 1, count: 1 })
    expect(result.total).toBe(SEARCH_MAX_HITS_PER_CHAPTER + 1)
  })

  it('全书命中超过总上限时只留前 N 条并停下', async () => {
    // 每章 30 处、都不到每章上限：前 6 章满额 180，第 7 章只剩 20 个位置
    const texts = Array.from({ length: 10 }, () => '山川'.repeat(SEARCH_MAX_HITS_PER_CHAPTER))
    const fake = makeService(texts)
    const result = await search(fake, '山川')
    expect(result.hits).toHaveLength(SEARCH_MAX_HITS)
    expect(result.truncated).toBe(true)
    // total 是各章命中数之和（每章最多算 30 处），所以可能比列出来的条数多
    expect(result.total).toBe(6 * SEARCH_MAX_HITS_PER_CHAPTER + SEARCH_MAX_HITS_PER_CHAPTER)
    expect(result.hits.filter((hit) => hit.chapterIndex === 6)).toHaveLength(20)
    // 攒够 200 就 break，不会把 10 章都读完
    expect(fake.readChapter).toHaveBeenCalledTimes(7)
    expect(result.counts).toHaveLength(7)
  })

  it('命中刚好铺满总上限时不算被截断', async () => {
    const texts = Array.from({ length: 6 }, () => '山川'.repeat(SEARCH_MAX_HITS_PER_CHAPTER))
    const last = '山川'.repeat(SEARCH_MAX_HITS - 6 * SEARCH_MAX_HITS_PER_CHAPTER)
    const fake = makeService([...texts, last])
    const result = await search(fake, '山川')
    expect(result.hits).toHaveLength(SEARCH_MAX_HITS)
    expect(result.total).toBe(SEARCH_MAX_HITS)
    expect(result.truncated).toBe(false)
  })
})
