import { describe, expect, it } from 'vitest'
import {
  indexAtOrBefore,
  offsetForScrollTop,
  scrollTopForOffset,
  splitParagraphs
} from '@/core/paragraphs'

describe('splitParagraphs', () => {
  it('按换行拆段，并记录每段在本章文本里的起始偏移', () => {
    const paragraphs = splitParagraphs('第一段\n第二段\n\n第四段')
    expect(paragraphs.map((p) => p.text)).toEqual(['第一段', '第二段', '', '第四段'])
    expect(paragraphs.map((p) => p.offset)).toEqual([0, 4, 8, 9])
  })

  it('偏移按 UTF-16 码元计（emoji 占 2）', () => {
    const paragraphs = splitParagraphs('😀a\nb')
    expect(paragraphs[0].text).toBe('😀a')
    expect(paragraphs[1].offset).toBe(4)
  })

  it('丢掉末尾换行产生的空段；空文本给一段空段', () => {
    expect(splitParagraphs('甲\n')).toHaveLength(1)
    expect(splitParagraphs('')).toEqual([{ offset: 0, text: '' }])
  })
})

describe('indexAtOrBefore', () => {
  it('返回最后一个不大于 value 的下标', () => {
    const tops = [0, 100, 200]
    expect(indexAtOrBefore(tops, -5)).toBe(0)
    expect(indexAtOrBefore(tops, 0)).toBe(0)
    expect(indexAtOrBefore(tops, 99)).toBe(0)
    expect(indexAtOrBefore(tops, 100)).toBe(1)
    expect(indexAtOrBefore(tops, 9999)).toBe(2)
    expect(indexAtOrBefore([], 10)).toBe(0)
  })
})

describe('offsetForScrollTop / scrollTopForOffset', () => {
  const paragraphs = [
    { offset: 0, text: 'a' },
    { offset: 5, text: 'b' }
  ]
  const tops = [0, 100]

  it('滚动位置换算成字符偏移', () => {
    expect(offsetForScrollTop(paragraphs, tops, 0)).toBe(0)
    expect(offsetForScrollTop(paragraphs, tops, 50)).toBe(0)
    expect(offsetForScrollTop(paragraphs, tops, 100)).toBe(5)
    expect(offsetForScrollTop(paragraphs, tops, 9999)).toBe(5)
    expect(offsetForScrollTop([], [], 10)).toBe(0)
  })

  it('字符偏移换算成滚动位置，且能容忍越界偏移', () => {
    expect(scrollTopForOffset(paragraphs, tops, 0)).toBe(0)
    expect(scrollTopForOffset(paragraphs, tops, 3)).toBe(0)
    expect(scrollTopForOffset(paragraphs, tops, 5)).toBe(100)
    expect(scrollTopForOffset(paragraphs, tops, 99)).toBe(100)
    expect(scrollTopForOffset([], [], 3)).toBe(0)
  })

  it('两个方向互为逆运算', () => {
    const back = offsetForScrollTop(paragraphs, tops, scrollTopForOffset(paragraphs, tops, 5))
    expect(back).toBe(5)
  })
})
