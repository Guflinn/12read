import { describe, expect, it } from 'vitest'
import {
  asChapterKind,
  asContentMode,
  asEncoding,
  coverSeedFromTitle,
  toBook,
  toChapter,
  toProgress
} from '@main/db/mappers'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('数据库行映射', () => {
  it('把完整行映射成 Book', () => {
    const book = toBook({
      id: BOOK_ID,
      title: '三体',
      author: '刘慈欣',
      format: 'epub',
      encoding: 'gb18030',
      byte_size: 1024,
      char_count: 512,
      chapter_count: 3,
      content_mode: 'sliced',
      cover_seed: 42,
      added_at: 1000,
      last_opened_at: 2000
    })
    expect(book).toEqual({
      id: BOOK_ID,
      title: '三体',
      author: '刘慈欣',
      format: 'txt',
      encoding: 'gb18030',
      byteSize: 1024,
      charCount: 512,
      chapterCount: 3,
      contentMode: 'sliced',
      coverSeed: 42,
      addedAt: 1000,
      lastOpenedAt: 2000
    })
  })

  it('脏数据一律往安全侧夹紧', () => {
    const book = toBook({ encoding: 'latin1', content_mode: 'weird', byte_size: 'x' })
    expect(book.title).toBe('未命名')
    expect(book.encoding).toBe('unknown')
    expect(book.contentMode).toBe('single')
    expect(book.byteSize).toBe(0)
    expect(book.lastOpenedAt).toBeNull()
  })

  it('bigint 形式的计数也能读', () => {
    expect(toBook({ char_count: 12n }).charCount).toBe(12)
  })

  it('章节行映射出偏移量', () => {
    const chapter = toChapter({
      book_id: BOOK_ID,
      idx: 2,
      title: '第二章 归途',
      start_offset: 120,
      char_length: 40,
      kind: 'segment'
    })
    expect(chapter).toEqual({
      bookId: BOOK_ID,
      index: 2,
      title: '第二章 归途',
      startOffset: 120,
      charLength: 40,
      kind: 'segment'
    })
  })

  it('进度行允许空引文与空设备号', () => {
    const progress = toProgress({
      book_id: BOOK_ID,
      chapter_index: 1,
      char_offset: 9,
      anchor_before: null,
      anchor_after: null,
      percent: 12.5,
      updated_at: 5,
      device_id: null
    })
    expect(progress.anchorBefore).toBeNull()
    expect(progress.anchorAfter).toBeNull()
    expect(progress.deviceId).toBeNull()
    expect(progress.percent).toBe(12.5)
  })

  it('枚举白名单之外的取值回落', () => {
    expect(asEncoding('utf-8-bom')).toBe('utf-8-bom')
    expect(asEncoding('shift-jis')).toBe('unknown')
    expect(asContentMode('sliced')).toBe('sliced')
    expect(asChapterKind('segment')).toBe('segment')
    expect(asChapterKind('chapter')).toBe('chapter')
    expect(asChapterKind('other')).toBe('chapter')
  })

  it('封面种子只由书名决定', () => {
    const a = coverSeedFromTitle('三体')
    expect(a).toBe(coverSeedFromTitle('三体'))
    expect(a).not.toBe(coverSeedFromTitle('三体 '))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(0xffffffff)
  })
})
