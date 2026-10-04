import { describe, expect, it } from 'vitest'
import {
  SEARCH_CONTEXT_CHARS,
  SEARCH_MAX_HITS_PER_CHAPTER,
  SEARCH_MAX_QUERY_CHARS,
  chapterMatches,
  contextAround,
  countMatches,
  findMatches,
  foldWhitespace,
  normalizeQuery
} from '@shared/core/search'

describe('搜索：关键词归一', () => {
  it('去掉首尾空白，留着中间的空格', () => {
    expect(normalizeQuery('  山川  湖海 ')).toBe('山川  湖海')
  })

  it('超长关键词截到上限', () => {
    expect(normalizeQuery('x'.repeat(200))).toHaveLength(SEARCH_MAX_QUERY_CHARS)
  })

  it('折空白把换行和连续空格压成一个空格', () => {
    expect(foldWhitespace('第一行\n\n  第二行\t后面')).toBe('第一行 第二行 后面')
  })
})

describe('搜索：找位置', () => {
  it('默认大小写不敏感', () => {
    expect(findMatches('AbC abc', 'abc')).toEqual([0, 4])
  })

  it('命中不重叠，从上一个命中之后接着找', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([0, 2])
  })

  it('没命中给空数组', () => {
    expect(findMatches('山川湖海', '星辰')).toEqual([])
  })

  it('空关键词或空正文不进循环', () => {
    expect(findMatches('山川湖海', '')).toEqual([])
    expect(findMatches('', '山川')).toEqual([])
    expect(findMatches('山川湖海', '山川', 0)).toEqual([])
  })

  it('从指定位置之后开始找', () => {
    expect(findMatches('abcabc', 'abc', 200, 1)).toEqual([3])
  })

  it('limit 挡住后面的命中', () => {
    expect(findMatches('abcabcabc', 'abc', 2)).toEqual([0, 3])
  })

  it('偏移不是有限数时当作从头开始', () => {
    expect(findMatches('abcabc', 'abc', 200, Number.NaN)).toEqual([0, 3])
    expect(findMatches('abcabc', 'abc', 200, -5)).toEqual([0, 3])
  })

  it('小写变换会改长度的文字退回区分大小写，偏移才对得上', () => {
    // 'İ'.toLowerCase() 是两个码元，不能拿小写串的偏移去切原串
    expect(findMatches('İİ', 'i')).toEqual([])
    expect(findMatches('İİ', 'İ')).toEqual([0, 1])
  })

  it('countMatches 只数到上限就停', () => {
    expect(countMatches('abcabcabc', 'abc')).toBe(3)
    expect(countMatches('abcabcabc', 'abc', 2)).toBe(2)
  })
})

describe('搜索：上下文片段', () => {
  it('前后各取一段，命中部分单独给出来', () => {
    expect(contextAround('abcdefghij', 4, 2, 3)).toEqual({ before: 'bcd', match: 'ef', after: 'ghi' })
  })

  it('片段里的换行折成空格', () => {
    expect(contextAround('上\n下 关键词 左\n右', 4, 3, 4)).toEqual({
      before: '上 下 ',
      match: '关键词',
      after: ' 左 右'
    })
  })

  it('开头与结尾越界时夹住，不报错', () => {
    expect(contextAround('abcdef', 0, 2, 3)).toEqual({ before: '', match: 'ab', after: 'cde' })
    expect(contextAround('abcdef', 5, 2, 3)).toEqual({ before: 'cde', match: 'f', after: '' })
    // 负偏移与负数长度都当成 0，不抛也不切成怪片段
    expect(contextAround('abcdef', -5, 2, 3)).toEqual({ before: '', match: 'ab', after: 'cde' })
    expect(contextAround('abcdef', 2, -3, 3)).toEqual({ before: 'ab', match: '', after: 'cde' })
  })

  it('默认宽度是 SEARCH_CONTEXT_CHARS', () => {
    const text = 'x'.repeat(200)
    const hit = contextAround(text, 100, 1)
    expect(hit.before).toHaveLength(SEARCH_CONTEXT_CHARS)
    expect(hit.after).toHaveLength(SEARCH_CONTEXT_CHARS)
  })
})

describe('搜索：一章里的命中', () => {
  const chapter = { index: 1, title: '第二章' }

  it('命中带章号、章标题与前后文', () => {
    const text = '山川湖海风雨星辰'
    const matched = chapterMatches(chapter, text, '风雨')
    expect(matched.count).toBe(1)
    expect(matched.capped).toBe(false)
    expect(matched.hits).toEqual([
      {
        chapterIndex: 1,
        chapterTitle: '第二章',
        charOffset: 4,
        before: '山川湖海',
        match: '风雨',
        after: '星辰'
      }
    ])
  })

  it('一章超过上限时只留上限条，并说自己被截断', () => {
    const text = '山川'.repeat(SEARCH_MAX_HITS_PER_CHAPTER + 5)
    const matched = chapterMatches(chapter, text, '山川')
    expect(matched.hits).toHaveLength(SEARCH_MAX_HITS_PER_CHAPTER)
    expect(matched.count).toBe(SEARCH_MAX_HITS_PER_CHAPTER)
    expect(matched.capped).toBe(true)
  })

  it('刚好等于上限时不算截断', () => {
    const text = '山川'.repeat(SEARCH_MAX_HITS_PER_CHAPTER)
    const matched = chapterMatches(chapter, text, '山川')
    expect(matched.hits).toHaveLength(SEARCH_MAX_HITS_PER_CHAPTER)
    expect(matched.capped).toBe(false)
  })

  it('没命中给空结果', () => {
    expect(chapterMatches(chapter, '山川湖海', '星辰')).toEqual({ hits: [], count: 0, capped: false })
  })

  it('空关键词给空结果', () => {
    expect(chapterMatches(chapter, '山川湖海', '  ')).toEqual({ hits: [], count: 0, capped: false })
  })
})
