import { describe, expect, it } from 'vitest'
import type { Bookmark, Chapter, Highlight } from '@shared/types'
import {
  excerptAt,
  normalizeSelection,
  orderBookmarks,
  orderHighlights,
  rangesOfChapter,
  splitHighlighted,
  spotLabel
} from '@/core/annotations'

function chapter(index: number, title: string): Chapter {
  return { bookId: 'b', index, title, startOffset: index * 100, charLength: 100, kind: 'chapter' }
}

function highlight(patch: Partial<Highlight> = {}): Highlight {
  return {
    id: 'h1',
    bookId: 'b',
    chapterIndex: 0,
    startOffset: 2,
    endOffset: 5,
    text: 'abc',
    note: null,
    createdAt: 1,
    ...patch
  }
}

function bookmark(patch: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'k1',
    bookId: 'b',
    chapterIndex: 0,
    charOffset: 3,
    excerpt: '摘要',
    createdAt: 1,
    ...patch
  }
}

describe('splitHighlighted', () => {
  it('把一段文字按划线切成 普通 / 划线 / 普通 三段', () => {
    expect(splitHighlighted('abcdefg', 0, [{ id: 'h1', startOffset: 2, endOffset: 5 }])).toEqual([
      { text: 'ab', highlightId: null },
      { text: 'cde', highlightId: 'h1' },
      { text: 'fg', highlightId: null }
    ])
  })

  it('段落从章中间开始时换算出段内位置（base 偏移）', () => {
    // 这段文字在章内是 10..13，划线覆盖章内 11..13
    expect(splitHighlighted('abc', 10, [{ id: 'h1', startOffset: 11, endOffset: 13 }])).toEqual([
      { text: 'a', highlightId: null },
      { text: 'bc', highlightId: 'h1' }
    ])
  })

  it('整段都在划线里时不产生空段', () => {
    expect(splitHighlighted('abc', 0, [{ id: 'h1', startOffset: 0, endOffset: 3 }])).toEqual([
      { text: 'abc', highlightId: 'h1' }
    ])
  })

  it('越界的划线夹进本段，完全不相干的划线不产生任何段', () => {
    expect(splitHighlighted('abcdef', 0, [{ id: 'h1', startOffset: -3, endOffset: 2 }])).toEqual([
      { text: 'ab', highlightId: 'h1' },
      { text: 'cdef', highlightId: null }
    ])
    expect(splitHighlighted('abcdef', 0, [{ id: 'h1', startOffset: 20, endOffset: 30 }])).toEqual([
      { text: 'abcdef', highlightId: null }
    ])
  })

  it('重叠部分归先到的那条，后面那条只画多出来的尾巴，一个字都不少画', () => {
    expect(
      splitHighlighted('abcdefg', 0, [
        { id: 'h1', startOffset: 1, endOffset: 4 },
        { id: 'h2', startOffset: 2, endOffset: 6 }
      ])
    ).toEqual([
      { text: 'a', highlightId: null },
      { text: 'bcd', highlightId: 'h1' },
      { text: 'ef', highlightId: 'h2' },
      { text: 'g', highlightId: null }
    ])
  })

  it('完全被前一条包住的划线不重复画', () => {
    expect(
      splitHighlighted('abcdefg', 0, [
        { id: 'h1', startOffset: 1, endOffset: 6 },
        { id: 'h2', startOffset: 2, endOffset: 4 }
      ])
    ).toEqual([
      { text: 'a', highlightId: null },
      { text: 'bcdef', highlightId: 'h1' },
      { text: 'g', highlightId: null }
    ])
  })

  it('空文字没有段', () => {
    expect(splitHighlighted('', 0, [{ id: 'h1', startOffset: 0, endOffset: 4 }])).toEqual([])
  })
})

describe('excerptAt', () => {
  it('取附近原文并把换行与多余空白折叠掉', () => {
    const text = '第一行\n\n  第二行   后面还有很长很长很长很长的一段话'
    expect(excerptAt(text, 0, 20)).toBe('第一行 第二行 后面还有很长很')
  })

  it('偏移越界或负数都夹进正文，空正文返回空串', () => {
    expect(excerptAt('abcdef', 99, 3)).toBe('f')
    expect(excerptAt('abcdef', -5, 3)).toBe('abc')
    expect(excerptAt('', 0)).toBe('')
  })
})

describe('normalizeSelection', () => {
  it('从后往前拖也能得到正确的起止', () => {
    expect(normalizeSelection(8, 3)).toEqual({ startOffset: 3, endOffset: 8 })
  })

  it('空选区、零长度、非数字都返回 null', () => {
    expect(normalizeSelection(4, 4)).toBeNull()
    expect(normalizeSelection(0, 0)).toBeNull()
    expect(normalizeSelection(Number.NaN, 3)).toBeNull()
  })
})

describe('rangesOfChapter', () => {
  it('只挑本书本章的划线，并抹掉其它字段', () => {
    const list = [highlight({ id: 'a', chapterIndex: 1 }), highlight({ id: 'b', chapterIndex: 0 })]
    expect(rangesOfChapter(list, 1)).toEqual([{ id: 'a', startOffset: 2, endOffset: 5 }])
    expect(rangesOfChapter(list, 9)).toEqual([])
  })
})

describe('spotLabel', () => {
  it('显示「第几章 标题」，章节不在了也不留空白', () => {
    const chapters = [chapter(0, '第一章 起点'), chapter(1, '第二章 转折')]
    expect(spotLabel(chapters, 1)).toBe('2. 第二章 转折')
    expect(spotLabel(chapters, 7)).toBe('8. （章节已不在）')
  })
})

describe('排序', () => {
  it('书签与划线都按章号 → 章内偏移', () => {
    const bookmarks = [
      bookmark({ id: 'c', chapterIndex: 2, charOffset: 1 }),
      bookmark({ id: 'a', chapterIndex: 0, charOffset: 9 }),
      bookmark({ id: 'b', chapterIndex: 0, charOffset: 1 })
    ]
    expect(orderBookmarks(bookmarks).map((item) => item.id)).toEqual(['b', 'a', 'c'])
    const highlights = [
      highlight({ id: 'y', chapterIndex: 1, startOffset: 0 }),
      highlight({ id: 'x', chapterIndex: 0, startOffset: 40 })
    ]
    expect(orderHighlights(highlights).map((item) => item.id)).toEqual(['x', 'y'])
  })

  it('排序不改入参顺序', () => {
    const list = [bookmark({ id: 'b', chapterIndex: 3 }), bookmark({ id: 'a', chapterIndex: 0 })]
    orderBookmarks(list)
    expect(list.map((item) => item.id)).toEqual(['b', 'a'])
  })
})
