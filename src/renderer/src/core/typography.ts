import type { FontFamilyKey, PageWidthKey } from '@shared/types'

export const DEFAULT_FONT_STACK = '"SimSun", "Songti SC", "Noto Serif CJK SC", serif'
export const DEFAULT_PAGE_WIDTH = '40rem'

/**
 * 字体选项（0.2.1 第五轮按用户审美定稿）：经典三件套回归。
 *  - 宋体 / 仿宋 / 楷体 = 系统自带（用户点名要经典的，接受大字号的点阵观感）；
 *  - 黑体 = 打包思源黑体 Noto Sans SC（OFL）—— 用户想要的「苹方」是 macOS 独占无法打包，这是最接近的替代；
 *  - 文楷 / 思源宋 = 打包开源字体，保留但排在后面。
 * 排列按经典在前；@font-face 见 styles.css（family 名与回退栈第一位是双头契约）。
 */
export const FONT_FAMILIES: ReadonlyArray<{ value: FontFamilyKey; label: string; stack: string }> = [
  { value: 'song', label: '宋体', stack: DEFAULT_FONT_STACK },
  { value: 'fang', label: '仿宋', stack: '"FangSong", "FangSong_GB2312", "STFangsong", serif' },
  { value: 'kai', label: '楷体', stack: '"KaiTi", "Kaiti SC", "STKaiti", serif' },
  {
    value: 'sans',
    label: '黑体',
    stack: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif'
  },
  { value: 'wenkai', label: '文楷', stack: '"LXGW WenKai", "Kaiti SC", "KaiTi", serif' },
  {
    value: 'hanserif',
    label: '思源宋',
    stack: '"Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", serif'
  }
]

/** 正文栏宽：一行放多少字。全宽在大屏上一行会很长，但用户选了就按他的来。 */
export const PAGE_WIDTHS: ReadonlyArray<{ value: PageWidthKey; label: string; width: string }> = [
  { value: 'narrow', label: '窄', width: '30rem' },
  { value: 'medium', label: '中', width: DEFAULT_PAGE_WIDTH },
  { value: 'wide', label: '宽', width: '52rem' },
  // 0.2.2 新增「特大」：4K 全屏下「宽」（832px）两侧空白太多，68rem = 1088px 好得多。
  // key 用 xlarge 而不是 huge —— 契约测试拿 'huge' 当非法值使，别撞车。
  { value: 'xlarge', label: '特大', width: '68rem' },
  { value: 'full', label: '全宽', width: '100%' }
]

export function isFontFamilyKey(value: unknown): value is FontFamilyKey {
  return FONT_FAMILIES.some((item) => item.value === value)
}

export function isPageWidthKey(value: unknown): value is PageWidthKey {
  return PAGE_WIDTHS.some((item) => item.value === value)
}

export function fontStackOf(key: FontFamilyKey): string {
  return (FONT_FAMILIES.find((item) => item.value === key) ?? { stack: DEFAULT_FONT_STACK }).stack
}

export function pageWidthOf(key: PageWidthKey): string {
  return (PAGE_WIDTHS.find((item) => item.value === key) ?? { width: DEFAULT_PAGE_WIDTH }).width
}
