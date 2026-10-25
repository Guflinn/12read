import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_STACK,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_PAGE_WIDTH,
  FONT_FAMILIES,
  PAGE_WIDTHS,
  fontStackOf,
  fontWeightOf,
  isFontFamilyKey,
  isPageWidthKey,
  pageWidthOf
} from '@/core/typography'

describe('排版选项表', () => {
  it('八种字体都带回退栈，默认栈是经典宋体（0.2.1 第五轮经典回归 + 0.3.0 中宋 + 1.1.0 秀楷）', () => {
    expect(FONT_FAMILIES.map((item) => item.value)).toEqual([
      'song',
      'fang',
      'kai',
      'sans',
      'wenkai',
      'hanserif',
      'zhongsong',
      'xiukai'
    ])
    // 用户点名要回经典宋体（中易宋体）做默认
    expect(FONT_FAMILIES[0]?.stack).toBe(DEFAULT_FONT_STACK)
    expect(DEFAULT_FONT_STACK).toContain('SimSun')
    for (const item of FONT_FAMILIES) {
      expect(item.stack.length).toBeGreaterThan(0)
      expect(item.label.length).toBeGreaterThan(0)
    }
    // 打包字体的回退栈第一位必须与 styles.css 的 @font-face family 名一致，否则加载不到
    expect(FONT_FAMILIES.find((item) => item.value === 'wenkai')?.stack).toContain('LXGW WenKai')
    expect(FONT_FAMILIES.find((item) => item.value === 'hanserif')?.stack).toContain(
      'Noto Serif SC'
    )
    expect(FONT_FAMILIES.find((item) => item.value === 'sans')?.stack).toContain('Noto Sans SC')
    expect(FONT_FAMILIES.find((item) => item.value === 'xiukai')?.stack).toContain(
      'FZSongKeBenXiuKaiJF'
    )
  })

  it('字重只有思源宋那一族吃得到（0.3.0 换成了可变字体，为以后调字重铺路）', () => {
    expect(fontWeightOf('hanserif')).toBe(DEFAULT_FONT_WEIGHT)
    // 系统字体没有多字重：拿到 400 就等于什么都不做
    expect(fontWeightOf('song')).toBe(DEFAULT_FONT_WEIGHT)
    expect(fontWeightOf('fang')).toBe(DEFAULT_FONT_WEIGHT)
    expect(fontWeightOf('kai')).toBe(DEFAULT_FONT_WEIGHT)
    // 未知取值回退默认
    expect(fontWeightOf('comic' as never)).toBe(DEFAULT_FONT_WEIGHT)
  })

  it('中宋走系统字体优先（华文中宋），装了就用、没装回退打包的思源宋', () => {
    // 华文中宋是单字重、没有细体，所以不打包字节，只声明回退栈（0.3.0）
    const zhongsong = fontStackOf('zhongsong')
    expect(zhongsong).toContain('STZhongsong')
    expect(zhongsong).toContain('Noto Serif SC')
    // 第一位必须是系统字体，否则「中宋」就不是中宋了
    expect(zhongsong.startsWith('"STZhongsong"')).toBe(true)
    // 与思源宋是两档不同的字体（一个高对比、一个低对比）
    expect(zhongsong).not.toBe(fontStackOf('hanserif'))
  })

  it('秀楷是打包的静态单字重（1.1.0，已购方正软件内置字体授权）', () => {
    // 回退栈第一位与 styles.css @font-face 的 family 名逐字一致；楷体垫底（字形最近）
    const xiukai = fontStackOf('xiukai')
    expect(xiukai.startsWith('"FZSongKeBenXiuKaiJF"')).toBe(true)
    expect(xiukai).toContain('KaiTi')
    // 静态单字重：字重恒为 400，不是可变字体那一族
    expect(fontWeightOf('xiukai')).toBe(DEFAULT_FONT_WEIGHT)
  })

  it('五档栏宽里 40rem 是默认（0.2.2 起含特大档）', () => {
    expect(PAGE_WIDTHS.map((item) => item.value)).toEqual([
      'narrow',
      'medium',
      'wide',
      'xlarge',
      'full'
    ])
    expect(pageWidthOf('medium')).toBe(DEFAULT_PAGE_WIDTH)
    expect(pageWidthOf('narrow')).toBe('30rem')
    expect(pageWidthOf('xlarge')).toBe('68rem')
    expect(pageWidthOf('full')).toBe('100%')
    expect(pageWidthOf('narrow')).not.toBe(pageWidthOf('wide'))
  })

  it('未知取值回退默认，不会写出 undefined', () => {
    expect(fontStackOf('comic' as never)).toBe(DEFAULT_FONT_STACK)
    expect(pageWidthOf('huge' as never)).toBe(DEFAULT_PAGE_WIDTH)
  })

  it('isFontFamilyKey / isPageWidthKey 只认表里的取值', () => {
    expect(isFontFamilyKey('song')).toBe(true)
    expect(isFontFamilyKey('kai')).toBe(true)
    expect(isFontFamilyKey('fang')).toBe(true)
    expect(isFontFamilyKey('sans')).toBe(true)
    expect(isFontFamilyKey('wenkai')).toBe(true)
    expect(isFontFamilyKey('hanserif')).toBe(true)
    expect(isFontFamilyKey('zhongsong')).toBe(true)
    expect(isFontFamilyKey('xiukai')).toBe(true)
    // 已删除的 key 不再合法（老值靠 schema transform 归一化到 sans）
    expect(isFontFamilyKey('hei')).toBe(false)
    expect(isFontFamilyKey('deng')).toBe(false)
    expect(isFontFamilyKey('comic')).toBe(false)
    expect(isFontFamilyKey(undefined)).toBe(false)
    expect(isPageWidthKey('wide')).toBe(true)
    expect(isPageWidthKey('huge')).toBe(false)
    expect(isPageWidthKey(3)).toBe(false)
  })
})
