import type { FontFamilyKey, PageWidthKey } from '@shared/types'

export const DEFAULT_FONT_STACK = '"Songti SC", "SimSun", "Noto Serif CJK SC", serif'
export const DEFAULT_PAGE_WIDTH = '40rem'

/**
 * 字体选项：一律用系统自带的字体，不额外打包字体文件。
 * 每项给一串回退栈，Windows / macOS 上都挑得到。
 */
export const FONT_FAMILIES: ReadonlyArray<{ value: FontFamilyKey; label: string; stack: string }> = [
  { value: 'song', label: '宋体', stack: DEFAULT_FONT_STACK },
  {
    value: 'hei',
    label: '雅黑',
    stack: '"Microsoft YaHei", "PingFang SC", "Source Han Sans SC", system-ui, sans-serif'
  },
  { value: 'kai', label: '楷体', stack: '"KaiTi", "Kaiti SC", "STKaiti", "Songti SC", serif' },
  { value: 'fang', label: '仿宋', stack: '"FangSong", "FangSong_GB2312", "STFangsong", "Songti SC", serif' },
  { value: 'deng', label: '等线', stack: '"DengXian", "PingFang SC", "Microsoft YaHei", sans-serif' }
]

/** 正文栏宽：一行放多少字。全宽在大屏上一行会很长，但用户选了就按他的来。 */
export const PAGE_WIDTHS: ReadonlyArray<{ value: PageWidthKey; label: string; width: string }> = [
  { value: 'narrow', label: '窄', width: '30rem' },
  { value: 'medium', label: '中', width: DEFAULT_PAGE_WIDTH },
  { value: 'wide', label: '宽', width: '52rem' },
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
