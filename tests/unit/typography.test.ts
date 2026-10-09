import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_STACK,
  DEFAULT_PAGE_WIDTH,
  FONT_FAMILIES,
  PAGE_WIDTHS,
  fontStackOf,
  isFontFamilyKey,
  isPageWidthKey,
  pageWidthOf
} from '@/core/typography'

describe('排版选项表', () => {
  it('四种字体都带回退栈，默认栈是思源宋（0.2.1 第四轮删 song/hei/kai）', () => {
    expect(FONT_FAMILIES.map((item) => item.value)).toEqual(['fang', 'deng', 'wenkai', 'hanserif'])
    expect(FONT_FAMILIES.find((item) => item.value === 'hanserif')?.stack).toContain('Noto Serif SC')
    for (const item of FONT_FAMILIES) {
      expect(item.stack.length).toBeGreaterThan(0)
      expect(item.label.length).toBeGreaterThan(0)
    }
    // 打包字体的回退栈第一位必须与 styles.css 的 @font-face family 名一致，否则加载不到
    expect(FONT_FAMILIES.find((item) => item.value === 'wenkai')?.stack).toContain('LXGW WenKai')
    expect(FONT_FAMILIES.find((item) => item.value === 'hanserif')?.stack).toContain(
      'Noto Serif SC'
    )
    expect(FONT_FAMILIES.find((item) => item.value === 'fang')?.stack).toContain(
      'Zhuque Fangsong'
    )
    // 被删掉的系统字体不能再出现在任何回退栈第一位（KaiTi 只许做兜底，不许当家）
    for (const item of FONT_FAMILIES) {
      expect(item.stack).not.toMatch(/^"(SimSun|Microsoft YaHei|KaiTi)"/)
    }
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
    expect(isFontFamilyKey('wenkai')).toBe(true)
    expect(isFontFamilyKey('hanserif')).toBe(true)
    // 已删除的系统字体不再是合法 key（老值靠 schema transform 归一化）
    expect(isFontFamilyKey('kai')).toBe(false)
    expect(isFontFamilyKey('song')).toBe(false)
    expect(isFontFamilyKey('hei')).toBe(false)
    expect(isFontFamilyKey('comic')).toBe(false)
    expect(isFontFamilyKey(undefined)).toBe(false)
    expect(isPageWidthKey('wide')).toBe(true)
    expect(isPageWidthKey('huge')).toBe(false)
    expect(isPageWidthKey(3)).toBe(false)
  })
})
