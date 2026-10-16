import { describe, expect, it } from 'vitest'
import {
  findMarkdownHeadings,
  pickChapterLevel,
  splitMarkdownChapters,
  stripInlineMarkdown
} from '@shared/core/markdown'

describe('Markdown 标题扫描（0.4.0）', () => {
  it('认 ATX 标题，结尾的装饰性 # 一起吃掉，行内标记从标题里剥掉', () => {
    const text = '# 书名\n## **第一章** 起点 ##\n正文\n'
    const headings = findMarkdownHeadings(text)

    expect(headings.map((h) => [h.level, h.title])).toEqual([
      [1, '书名'],
      [2, '第一章 起点']
    ])
    // 偏移是「这一行在全文里的起点」——章节从标题行开始，标题也就留在章内
    expect(text.slice(headings[0].offset, headings[0].offset + 2)).toBe('# ')
    expect(text.slice(headings[1].offset, headings[1].offset + 3)).toBe('## ')
  })

  it('围栏代码块里的 # 是代码，不算标题', () => {
    const text = '# 一\n```bash\n# 这是注释，不是标题\n```\n# 二\n'
    expect(findMarkdownHeadings(text).map((h) => h.title)).toEqual(['一', '二'])
  })

  it('七级以上的 ####### 不是标题（最多认到 6 级）', () => {
    expect(findMarkdownHeadings('####### 七个井号\n')).toHaveLength(0)
  })

  it('没有空格的 #标签 不算标题（Markdown 要求 # 后有空格）', () => {
    expect(findMarkdownHeadings('#标签\n')).toHaveLength(0)
  })

  it('选层级：默认取出现 ≥ 2 次的最靠前一级（只有一个 # 书名时往下找）', () => {
    const text = '# 书名\n## 第一章\n## 第二章\n'
    const headings = findMarkdownHeadings(text)
    expect(pickChapterLevel(headings)).toBe(2)

    expect(pickChapterLevel(findMarkdownHeadings('# 一\n# 二\n### 三\n### 四\n'))).toBe(1)
    // 每级都只出现一次 → 认不出结构，返回 null（调用方退 TXT 规则）
    expect(pickChapterLevel(findMarkdownHeadings('# 一\n## 二\n### 三\n'))).toBeNull()
  })
})

describe('Markdown 切章（0.4.0）', () => {
  const book = ['# 书名', '', '## 第一章 起点', '正文一', '', '## 第二章 转折', '正文二', ''].join('\n')

  it('按选中层级的标题切章，第一个标题之前的内容成为「开篇」', () => {
    const result = splitMarkdownChapters(book)

    expect(result.usedFallback).toBe(false)
    expect(result.chapters.map((c) => c.title)).toEqual(['开篇', '第一章 起点', '第二章 转折'])
    expect(result.chapters.map((c) => c.kind)).toEqual(['segment', 'chapter', 'chapter'])
  })

  it('章节首尾相接、合起来覆盖全文，一个字都不丢', () => {
    const result = splitMarkdownChapters(book)
    const chapters = result.chapters

    expect(chapters[0].startOffset).toBe(0)
    for (let i = 0; i < chapters.length; i += 1) {
      const end = chapters[i].startOffset + chapters[i].charLength
      expect(end).toBe(i + 1 < chapters.length ? chapters[i + 1].startOffset : book.length)
    }
    expect(chapters.reduce((sum, c) => sum + c.charLength, 0)).toBe(book.length)
    // 章名不出现在正文里的怪情况：标题行确实被包在这一章里
    expect(book.slice(chapters[1].startOffset, chapters[1].startOffset + 7)).toBe('## 第一章 ')
  })

  it('正文开头就是第一个标题时没有「开篇」', () => {
    const result = splitMarkdownChapters('## 甲\n正文\n## 乙\n正文\n')
    expect(result.chapters.map((c) => c.title)).toEqual(['甲', '乙'])
  })

  it('没有标题结构时退回 TXT 规则（第 N 章 → 否则定长分段）', () => {
    const markers = splitMarkdownChapters('第一章 起点\n正文\n第二章 转折\n正文\n')
    expect(markers.usedFallback).toBe(false)
    expect(markers.chapters.map((c) => c.title)).toEqual(['第一章 起点', '第二章 转折'])

    const fallback = splitMarkdownChapters('就是一段没有标题的正文。'.repeat(50))
    expect(fallback.usedFallback).toBe(true)
    expect(fallback.chapters[0].title).toBe('分段 1')
  })

  it('只出现一次的标题层级（整本一个 # 大标题）不会被当成章节', () => {
    // 只有一个 # 与一个 ##：都认不出结构 → 走 TXT 兜底，而不是「整本一章」
    const result = splitMarkdownChapters('# 笔记\n## 一段\n' + '正文。'.repeat(600))
    expect(result.usedFallback).toBe(true)
  })
})

describe('stripInlineMarkdown（显示用）', () => {
  it('剥掉粗体 / 斜体 / 行内代码 / 链接 / 图片标记，只留文字', () => {
    expect(stripInlineMarkdown('**粗** 与 *斜* 与 `码`')).toBe('粗 与 斜 与 码')
    expect(stripInlineMarkdown('看 [这里](https://example.com) 和 ![封面](a.png)')).toBe('看 这里 和 封面')
    expect(stripInlineMarkdown('转义 \\*不斜\\*')).toBe('转义 *不斜*')
  })
})
