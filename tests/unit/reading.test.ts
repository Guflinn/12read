import { describe, expect, it } from 'vitest'
import type { Book, Chapter } from '@shared/types'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHTS,
  chapterLabel,
  clampFontSize,
  coverGradient,
  coverInitial,
  describeBook,
  formatChars,
  formatPercent,
  formatRelative,
  kindLabel,
  percentOf,
  progressLabel,
  remainingChars
} from '@/core/reading'

function makeBook(patch: Partial<Book> = {}): Book {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    title: '测试书',
    author: null,
    format: 'txt',
    encoding: 'utf-8',
    byteSize: 1000,
    charCount: 300,
    chapterCount: 2,
    contentMode: 'single',
    coverSeed: 12,
    addedAt: 1,
    lastOpenedAt: null,
    ...patch
  }
}

function makeChapter(patch: Partial<Chapter> = {}): Chapter {
  return {
    bookId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    index: 1,
    title: '第二章',
    startOffset: 100,
    charLength: 200,
    kind: 'chapter',
    ...patch
  }
}

describe('字号', () => {
  it('夹在 15..27 之间并取整', () => {
    expect(clampFontSize(10)).toBe(FONT_SIZE_MIN)
    expect(clampFontSize(99)).toBe(FONT_SIZE_MAX)
    expect(clampFontSize(19.6)).toBe(20)
    expect(clampFontSize(Number.NaN)).toBe(19)
  })

  it('预设行距是有序的三个档位', () => {
    expect(LINE_HEIGHTS).toHaveLength(3)
    expect([...LINE_HEIGHTS].sort((a, b) => a - b)).toEqual(LINE_HEIGHTS)
  })
})

describe('进度与标签', () => {
  it('整体百分比按「本章起始 + 章内偏移」算', () => {
    expect(percentOf(300, 100, 50)).toBe(50)
    expect(percentOf(0, 0, 0)).toBe(0)
    expect(percentOf(300, 0, 300)).toBe(100)
  })

  it('格式化百分比保留一位小数', () => {
    expect(formatPercent(12.345)).toBe('12.3%')
  })

  it('区分章节与分段', () => {
    expect(kindLabel('chapter')).toBe('章节')
    expect(kindLabel('segment')).toBe('分段')
  })

  it('节标题带序号与类型', () => {
    expect(chapterLabel(makeChapter(), 5)).toBe('章节 2/5 · 第二章')
    expect(chapterLabel(makeChapter({ kind: 'segment', index: 0, title: '分段 1' }), 5)).toBe(
      '分段 1/5 · 分段 1'
    )
    expect(chapterLabel(undefined, 0)).toBe('还没有内容')
  })
})

describe('书架展示', () => {
  it('字数按汉字习惯换算', () => {
    expect(formatChars(0)).toBe('0 字')
    expect(formatChars(9999)).toBe('9999 字')
    expect(formatChars(123456)).toBe('12.3 万字')
  })

  it('剩余字数按全书百分比折算，边界都夹住', () => {
    expect(remainingChars(300, 0)).toBe(300)
    expect(remainingChars(300, 50)).toBe(150)
    expect(remainingChars(300, 100)).toBe(0)
    expect(remainingChars(300, 120)).toBe(0)
    expect(remainingChars(300, -5)).toBe(300)
    expect(remainingChars(0, 50)).toBe(0)
    expect(remainingChars(Number.NaN, 50)).toBe(0)
  })

  it('底部那行字把百分比与剩余字数拼在一起', () => {
    expect(progressLabel(300, 0)).toBe('已读 0.0% · 剩余 300 字')
    expect(progressLabel(123456, 50)).toBe('已读 50.0% · 剩余 6.2 万字')
    expect(progressLabel(0, 0)).toBe('已读 0.0% · 剩余 0 字')
  })

  it('书籍副标题带字数与节数', () => {
    expect(describeBook(makeBook({ charCount: 123456, chapterCount: 12 }))).toBe('12.3 万字 · 12 节')
  })

  it('相对时间跨天回退到日期', () => {
    const now = new Date(2024, 4, 20, 12, 0, 0).getTime()
    expect(formatRelative(now - 1000, now)).toBe('刚刚')
    expect(formatRelative(now - 120000, now)).toBe('2 分钟前')
    expect(formatRelative(now - 7200000, now)).toBe('2 小时前')
    expect(formatRelative(now - 2 * 86400000, now)).toBe('2 天前')
    expect(formatRelative(now - 10 * 86400000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('封面配色由 coverSeed 决定，可复现', () => {
    expect(coverGradient(12)).toBe(coverGradient(12))
    expect(coverGradient(30)).toContain('hsl(30, 40%, 47%)')
    expect(coverGradient(-30)).toBe(coverGradient(30))
  })

  it('封面首字不会被拆断代理对', () => {
    expect(coverInitial('😀书')).toBe('😀')
    expect(coverInitial('  十二  ')).toBe('十')
    expect(coverInitial('   ')).toBe('书')
  })
})
