import { describe, expect, it } from 'vitest'
import {
  CHAPTER_LINE_MAX_CHARS,
  FALLBACK_MAX_CHARS,
  FALLBACK_MIN_CHARS,
  FALLBACK_TARGET_CHARS,
  findChapterMarkers,
  splitByLength,
  splitChapters
} from '@shared/core/chapter-split'
import {
  CHAPTERED_TEXT,
  CRLF_TEXT,
  EMPTY_TEXT,
  FALSE_POSITIVE_TEXT,
  MIXED_TEXT,
  SINGLE_MARKER_TEXT,
  UNCHAPTERED_TEXT
} from '../fixtures/texts'

interface Span {
  startOffset: number
  charLength: number
}

/** 章节必须首尾相接、无缝无重、完整覆盖全文。 */
function expectContiguous(chapters: Span[], textLength: number): void {
  expect(chapters.length).toBeGreaterThan(0)
  expect(chapters[0].startOffset).toBe(0)
  let at = 0
  for (const c of chapters) {
    expect(c.startOffset).toBe(at)
    expect(c.charLength).toBeGreaterThanOrEqual(0)
    at += c.charLength
  }
  expect(at).toBe(textLength)
}

describe('章节识别', () => {
  it('常量与 TECH.md 7.2 一致', () => {
    expect(CHAPTER_LINE_MAX_CHARS).toBe(40)
    expect(FALLBACK_TARGET_CHARS).toBe(4000)
    expect(FALLBACK_MIN_CHARS).toBe(3000)
    expect(FALLBACK_MAX_CHARS).toBe(5000)
  })

  it('识别整行章节标题，忽略正文行', () => {
    const hits = findChapterMarkers(CHAPTERED_TEXT)
    expect(hits.map((h) => h.title)).toEqual(['第一章 初见', '第二章 归途', '序章 其实这里是标记'])
  })

  it('支持 第十一章 / 第 12 章 / 第十二回 等变体', () => {
    const text = '第十一章 甲\n正文\n第 12 章 乙\n正文\n第十二回 丙\n正文\n'
    expect(findChapterMarkers(text).map((h) => h.title)).toEqual(['第十一章 甲', '第 12 章 乙', '第十二回 丙'])
  })

  it('防误伤一：超过 40 字的行即使以“第一章”开头也不算标题', () => {
    const long = '第一章' + '很'.repeat(CHAPTER_LINE_MAX_CHARS)
    expect(findChapterMarkers(long + '\n').length).toBe(0)
    expect(findChapterMarkers(FALSE_POSITIVE_TEXT).map((h) => h.title)).toEqual([
      '第一章 真正的标题',
      '第二章 第二个标题'
    ])
  })

  it('防误伤二：空行和空白行不算标题', () => {
    expect(findChapterMarkers('\n   \n\t\n').length).toBe(0)
  })

  it('章节起点单调递增', () => {
    const hits = findChapterMarkers(CHAPTERED_TEXT)
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i].offset).toBeGreaterThan(hits[i - 1].offset)
    }
  })

  it('CRLF 文本同样识别，标题里不留 \\r', () => {
    const hits = findChapterMarkers(CRLF_TEXT)
    expect(hits.map((h) => h.title)).toEqual(['第一章 标题甲', '第二章 标题乙'])
    expect(hits.every((h) => !h.title.includes('\r'))).toBe(true)
  })
})

describe('章节切分', () => {
  it('命中 >= 2 时按章节切，开篇单独成段', () => {
    const result = splitChapters(CHAPTERED_TEXT)
    expect(result.usedFallback).toBe(false)
    expect(result.markerHits).toBe(3)
    expect(result.chapters).toHaveLength(4)
    expect(result.chapters[0]).toEqual({
      title: '开篇',
      startOffset: 0,
      charLength: CHAPTERED_TEXT.indexOf('第一章 初见'),
      kind: 'segment'
    })
    expect(result.chapters[0].charLength).toBeGreaterThan(0)
    expect(result.chapters.slice(1).map((c) => c.title)).toEqual([
      '第一章 初见',
      '第二章 归途',
      '序章 其实这里是标记'
    ])
    expect(result.chapters.slice(1).every((c) => c.kind === 'chapter')).toBe(true)
    expectContiguous(result.chapters, CHAPTERED_TEXT.length)
  })

  it('正文从第一个标记开始时没有开篇', () => {
    const text = '第一章 甲\n正文\n第二章 乙\n正文\n'
    const result = splitChapters(text)
    expect(result.usedFallback).toBe(false)
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[0].title).toBe('第一章 甲')
    expect(result.chapters[0].startOffset).toBe(0)
    expect(result.chapters.every((c) => c.kind === 'chapter')).toBe(true)
    expectContiguous(result.chapters, text.length)
  })

  it('偏移是 UTF-16 code unit：emoji 计 2', () => {
    // 固定文本里有 2 个 emoji（🌏 与 🚀），每个占 2 个 code unit
    expect(MIXED_TEXT.length - Array.from(MIXED_TEXT).length).toBe(2)
    const result = splitChapters(MIXED_TEXT)
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[0].charLength).toBe(MIXED_TEXT.indexOf('第二章 结束'))
    expectContiguous(result.chapters, MIXED_TEXT.length)
  })

  it('CRLF 文本按章切分且首尾相接', () => {
    const result = splitChapters(CRLF_TEXT)
    expect(result.usedFallback).toBe(false)
    expect(result.chapters[0].title).toBe('开篇')
    expectContiguous(result.chapters, CRLF_TEXT.length)
  })
})

describe('兜底分段', () => {
  it('命中不足 2 个时整本定长分段', () => {
    const result = splitChapters(SINGLE_MARKER_TEXT)
    expect(result.usedFallback).toBe(true)
    expect(result.markerHits).toBe(1)
    expect(result.chapters.every((c) => c.kind === 'segment')).toBe(true)
    expect(result.chapters.every((c) => c.title.startsWith('分段 '))).toBe(true)
    expectContiguous(result.chapters, SINGLE_MARKER_TEXT.length)
  })

  it('没有任何章节标记的长文也能切成 3000-4000 字的分段', () => {
    const result = splitChapters(UNCHAPTERED_TEXT)
    expect(result.usedFallback).toBe(true)
    expect(result.markerHits).toBe(0)
    expect(result.chapters.length).toBeGreaterThan(1)
    expectContiguous(result.chapters, UNCHAPTERED_TEXT.length)
    const body = result.chapters.slice(0, -1)
    for (const c of body) {
      expect(c.charLength).toBeGreaterThan(FALLBACK_MIN_CHARS)
      expect(c.charLength).toBeLessThanOrEqual(FALLBACK_TARGET_CHARS)
    }
  })

  it('分段优先落在段落边界上', () => {
    const chapters = splitByLength(UNCHAPTERED_TEXT)
    for (const c of chapters.slice(0, -1)) {
      expect(UNCHAPTERED_TEXT[c.startOffset + c.charLength - 1]).toBe('\n')
    }
  })

  it('分段标题从 1 开始编号，UI 能区分章节与分段', () => {
    const titles = splitByLength(UNCHAPTERED_TEXT).map((c) => c.title)
    expect(titles[0]).toBe('分段 1')
    expect(titles[1]).toBe('分段 2')
  })

  it('自定义长度参数生效', () => {
    const chapters = splitByLength(UNCHAPTERED_TEXT, { targetChars: 1000, minChars: 500 })
    for (const c of chapters.slice(0, -1)) {
      expect(c.charLength).toBeGreaterThan(500)
      expect(c.charLength).toBeLessThanOrEqual(1000)
    }
    expectContiguous(chapters, UNCHAPTERED_TEXT.length)
  })

  it('空文本也给一个空分段，不返回空数组', () => {
    const result = splitChapters(EMPTY_TEXT)
    expect(result.usedFallback).toBe(true)
    expect(result.chapters).toEqual([
      { title: '分段 1', startOffset: 0, charLength: 0, kind: 'segment' }
    ])
  })
})
