import { describe, expect, it } from 'vitest'
import { cleanTitleFromPath } from '@shared/core/filename'

describe('文件名清洗', () => {
  it('从 《书名》作者.txt 里拆出书名与作者', () => {
    expect(cleanTitleFromPath('D:\\books\\《三体》刘慈欣.txt')).toEqual({
      title: '三体',
      author: '刘慈欣'
    })
  })

  it('剥掉半角与全角的完结标注', () => {
    expect(cleanTitleFromPath('三体(完结).txt')).toEqual({ title: '三体', author: null })
    expect(cleanTitleFromPath('三体（全本）.txt')).toEqual({ title: '三体', author: null })
    expect(cleanTitleFromPath('三体【精校版】.txt')).toEqual({ title: '三体', author: null })
  })

  it('作者末尾的身份词会被去掉', () => {
    expect(cleanTitleFromPath('《活着》余华 著.txt')).toEqual({ title: '活着', author: '余华' })
  })

  it('书名带标注、作者也带标注时两边都清洗', () => {
    expect(cleanTitleFromPath('《鬼吹灯》(完结)【全本】.txt')).toEqual({
      title: '鬼吹灯',
      author: null
    })
    expect(cleanTitleFromPath('《三体》刘慈欣(精校版).txt')).toEqual({
      title: '三体',
      author: '刘慈欣'
    })
  })

  it('只剥已知标注，不误伤括号里的正常词', () => {
    expect(cleanTitleFromPath('西游记(上册).txt')).toEqual({ title: '西游记(上册)', author: null })
  })

  it('没有扩展名、没有标注、没有作者时回落原文件名', () => {
    expect(cleanTitleFromPath('/novels/明朝那些事儿.txt')).toEqual({
      title: '明朝那些事儿',
      author: null
    })
    expect(cleanTitleFromPath('无扩展名')).toEqual({ title: '无扩展名', author: null })
  })

  it('小数点不会被当成扩展名', () => {
    expect(cleanTitleFromPath('1.5万字.txt')).toEqual({ title: '1.5万字', author: null })
  })

  it('清洗后为空时退回原始名字，绝不返回空标题', () => {
    expect(cleanTitleFromPath('(完结).txt').title).toBe('(完结)')
    expect(cleanTitleFromPath('《》.txt').title.length).toBeGreaterThan(0)
  })

  it('只有书名号、没有作者时 author 为 null', () => {
    expect(cleanTitleFromPath('《三体》.txt')).toEqual({ title: '三体', author: null })
  })
})
