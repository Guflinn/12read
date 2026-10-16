import { describe, expect, it } from 'vitest'
import { markdownBlocks, mdInline } from '@/core/markdown'

describe('Markdown 行内解析（0.4.0）', () => {
  it('拼起来必须等于输入：这是偏移体系的命根子', () => {
    const samples = [
      '普通一段文字',
      '**粗体** 与 *斜体* 与 `代码`',
      '看 [这里](https://example.com) 和 ![封面](images/a.png)',
      'a\\*b\\* 转义、`未闭合 与 **未闭合',
      'snake_case_here 与 2 * 3 * 4 都不该变成斜体',
      '![图](x)![图2](y) 连着两张',
      ''
    ]
    for (const sample of samples) {
      const segments = mdInline(sample)
      expect(segments.map((s) => s.text).join('')).toBe(sample)
      // start 必须是片段在原文里的真实下标，且单调递增
      for (const segment of segments) {
        expect(sample.slice(segment.start, segment.start + segment.text.length)).toBe(segment.text)
      }
      for (let i = 1; i < segments.length; i += 1) {
        expect(segments[i].start).toBeGreaterThan(segments[i - 1].start)
      }
    }
  })

  it('粗体 / 斜体 / 行内代码：标记单独成片段（渲染时藏起来）', () => {
    const segments = mdInline('**粗**体')
    expect(segments.map((s) => [s.kind, s.text, s.start])).toEqual([
      ['syntax', '**', 0],
      ['strong', '粗', 2],
      ['syntax', '**', 3],
      ['text', '体', 5]
    ])

    expect(mdInline('*斜*').map((s) => s.kind)).toEqual(['syntax', 'em', 'syntax'])
    expect(mdInline('__粗__').map((s) => s.kind)).toEqual(['syntax', 'strong', 'syntax'])
    expect(mdInline('`码`').map((s) => s.kind)).toEqual(['syntax', 'code', 'syntax'])
  })

  it('base 偏移会加到每个片段上（章节内的绝对位置）', () => {
    const segments = mdInline('**粗**', 100)
    expect(segments.map((s) => s.start)).toEqual([100, 102, 103])
  })

  it('链接与图片：地址单独给出来，链接文字 / alt 才是可见文字', () => {
    const link = mdInline('[文字](https://a.example/x)')
    expect(link.map((s) => s.kind)).toEqual(['syntax', 'link', 'syntax'])
    expect(link[1]).toMatchObject({ text: '文字', href: 'https://a.example/x' })
    expect(link[2].text).toBe('](https://a.example/x)')

    const image = mdInline('![封面](images/a.png)')
    expect(image.map((s) => s.kind)).toEqual(['syntax', 'image', 'syntax'])
    expect(image[1]).toMatchObject({ text: '封面', href: 'images/a.png' })
    expect(image[0].text).toBe('![')
    expect(image[2].text).toBe('](images/a.png)')

    // 地址后面跟标题 `"t"` 时只取地址
    expect(mdInline('[a](https://b.example "标题")')[1].href).toBe('https://b.example')
  })

  it('防误伤：空格包围的 * 与 snake_case 的下划线都不当标记', () => {
    expect(mdInline('3 * 4 * 5').map((s) => s.kind)).toEqual(['text'])
    expect(mdInline('snake_case_here').map((s) => s.kind)).toEqual(['text'])
    expect(mdInline('未闭合的 **粗体').map((s) => s.kind)).toEqual(['text'])
    // 反斜杠转义：两个反斜杠都藏起来，星号当普通文字（星号还在文本里，只是不再是标记）
    const escaped = mdInline('\\*不斜\\*')
    expect(escaped.filter((s) => s.kind === 'syntax').map((s) => s.text)).toEqual(['\\', '\\'])
    expect(escaped.filter((s) => s.kind !== 'syntax').map((s) => s.text).join('')).toBe('*不斜*')
    expect(escaped.map((s) => s.text).join('')).toBe('\\*不斜\\*')
  })
})

describe('Markdown 块级解析（0.4.0）', () => {
  it('标题：级别与内容起点', () => {
    expect(markdownBlocks(['# 一级'])[0]).toMatchObject({ kind: 'heading', level: 1, contentStart: 2 })
    expect(markdownBlocks(['### 三级'])[0]).toMatchObject({ kind: 'heading', level: 3, contentStart: 4 })
    expect(markdownBlocks(['####### 七个'])[0]).toMatchObject({ kind: 'text', level: 0 })
  })

  it('引用、无序列表（含缩进层级）、有序列表（带序号）', () => {
    expect(markdownBlocks(['> 引用'])[0]).toMatchObject({ kind: 'quote', contentStart: 2 })
    expect(markdownBlocks(['- 项'])[0]).toMatchObject({ kind: 'ul', depth: 0, contentStart: 2 })
    expect(markdownBlocks(['  - 子项'])[0]).toMatchObject({ kind: 'ul', depth: 1, contentStart: 4 })
    expect(markdownBlocks(['12. 第十二条'])[0]).toMatchObject({ kind: 'ol', num: 12, contentStart: 4 })
    expect(markdownBlocks(['3) 第三'])[0]).toMatchObject({ kind: 'ol', num: 3, contentStart: 3 })
  })

  it('分隔线优先于列表判定（--- 不是减号列表）', () => {
    expect(markdownBlocks(['---'])[0].kind).toBe('rule')
    expect(markdownBlocks(['***'])[0].kind).toBe('rule')
    expect(markdownBlocks(['- 项'])[0].kind).toBe('ul')
  })

  it('围栏代码块：内部的 # 不当标题，首末行标出来给背景加圆角', () => {
    const blocks = markdownBlocks(['```js', 'const a = 1', '# 不是标题', '```', '正文'])
    expect(blocks.map((b) => b.kind)).toEqual(['fence', 'code', 'code', 'fence', 'text'])
    expect(blocks[1].codePos).toBe('first')
    expect(blocks[2].codePos).toBe('last')
    // 围栏行整行都是标记：内容起点推到行尾，行内解析拿到空串
    expect(blocks[0].contentStart).toBe(5)

    const single = markdownBlocks(['~~~', 'x', '~~~'])
    expect(single[1].codePos).toBe('only')
    expect(single[0].contentStart).toBe(3)
  })

  it('空行与普通文字都是 text；空行在正文里由阅读器渲染成空段', () => {
    expect(markdownBlocks(['', '普通一句']).map((b) => b.kind)).toEqual(['text', 'text'])
  })
})
