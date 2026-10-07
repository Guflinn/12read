import { describe, expect, it } from 'vitest'
import {
  asChapterKind,
  asContentMode,
  asEncoding,
  coverSeedFromTitle,
  toBook,
  toBookmark,
  toChapter,
  toHighlight,
  toProgress,
  toShelfBook
} from '@main/db/mappers'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('数据库行映射', () => {
  it('format 必须读列，不能写死：epub 就是 epub，坏值才退 txt（回归：曾被写死成 txt）', () => {
    const row = {
      id: BOOK_ID,
      title: '书',
      author: null,
      encoding: 'utf-8',
      byte_size: 1,
      char_count: 1,
      chapter_count: 1,
      content_mode: 'single',
      cover_seed: 1,
      added_at: 1,
      last_opened_at: null
    }
    expect(toBook({ ...row, format: 'epub' }).format).toBe('epub')
    expect(toShelfBook({ ...row, format: 'epub', percent: 0 }).format).toBe('epub')
    expect(toBook({ ...row, format: 'mobi' }).format).toBe('mobi')
    // 库里是 TEXT：认不出来的一律当 txt，而不是抛错
    expect(toBook({ ...row, format: '啥东西' }).format).toBe('txt')
    expect(toBook(row).format).toBe('txt')
  })

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
      // 这里以前写的是 'txt'：那是 toBook 把 format 写死成 txt 的 bug，不是预期形状
      format: 'epub',
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

  it('书架行额外带出进度，越界与脏值都夹到 0..100', () => {
    const shelf = toShelfBook({ id: BOOK_ID, title: '三体', percent: 12.5 })
    expect(shelf).toMatchObject({ id: BOOK_ID, title: '三体', percent: 12.5 })
    expect(shelf.encoding).toBe('unknown')
    expect(toShelfBook({ percent: 300 }).percent).toBe(100)
    expect(toShelfBook({ percent: -5 }).percent).toBe(0)
    expect(toShelfBook({}).percent).toBe(0)
  })

  it('章节行映射出偏移量与分组（group_title 没写就是 null）', () => {
    const base = {
      book_id: BOOK_ID,
      idx: 2,
      title: '第二章 归途',
      start_offset: 120,
      char_length: 40,
      kind: 'segment'
    }
    expect(toChapter(base)).toEqual({
      bookId: BOOK_ID,
      index: 2,
      title: '第二章 归途',
      groupTitle: null,
      startOffset: 120,
      charLength: 40,
      kind: 'segment'
    })
    // 合集类 EPUB：卷名跟着章一起读回来
    expect(toChapter({ ...base, group_title: '红高粱家族' }).groupTitle).toBe('红高粱家族')
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
    expect(asEncoding('big5')).toBe('big5')
    expect(asEncoding('shift-jis')).toBe('unknown')
    expect(asContentMode('sliced')).toBe('sliced')
    expect(asChapterKind('segment')).toBe('segment')
    expect(asChapterKind('chapter')).toBe('chapter')
    expect(asChapterKind('other')).toBe('chapter')
  })

  it('书签行映射出章内偏移与摘要', () => {
    expect(
      toBookmark({
        id: 'k1',
        book_id: BOOK_ID,
        chapter_index: 2,
        char_offset: 33,
        excerpt: '读到这儿',
        created_at: 7
      })
    ).toEqual({
      id: 'k1',
      bookId: BOOK_ID,
      chapterIndex: 2,
      charOffset: 33,
      excerpt: '读到这儿',
      createdAt: 7
    })
  })

  it('书签行的脏数据夹紧：下标与偏移不为负，摘要缺失给空串', () => {
    const bookmark = toBookmark({ chapter_index: -3, char_offset: 'x' })
    expect(bookmark.chapterIndex).toBe(0)
    expect(bookmark.charOffset).toBe(0)
    expect(bookmark.excerpt).toBe('')
    expect(bookmark.bookId).toBe('')
    expect(bookmark.createdAt).toBe(0)
  })

  it('划线行映射出起止偏移与备注', () => {
    expect(
      toHighlight({
        id: 'h1',
        book_id: BOOK_ID,
        chapter_index: 1,
        start_offset: 5,
        end_offset: 12,
        text: '被划下来的七个字',
        note: '这里的伏笔',
        created_at: 8
      })
    ).toEqual({
      id: 'h1',
      bookId: BOOK_ID,
      chapterIndex: 1,
      startOffset: 5,
      endOffset: 12,
      text: '被划下来的七个字',
      note: '这里的伏笔',
      createdAt: 8
    })
  })

  it('划线行没有备注时读回 null（这一版还不写备注）', () => {
    expect(toHighlight({ note: null }).note).toBeNull()
    expect(toHighlight({ note: '' }).note).toBeNull()
  })

  it('封面种子只由书名决定', () => {
    const a = coverSeedFromTitle('三体')
    expect(a).toBe(coverSeedFromTitle('三体'))
    expect(a).not.toBe(coverSeedFromTitle('三体 '))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(0xffffffff)
  })
})
