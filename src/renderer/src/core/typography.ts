import type { FontFamilyKey, PageWidthKey } from '@shared/types'

export const DEFAULT_FONT_STACK = '"Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", serif'
export const DEFAULT_PAGE_WIDTH = '40rem'

/**
 * 字体选项（0.2.1 第四轮收窄）。全部为矢量字体，无点阵马赛克：
 *  - 仿宋 = 打包的朱雀仿宋（OFL，TrionesType，@font-face 见 styles.css），回退系统 FangSong；
 *  - 等线 = 系统自带（Word 2016 起默认中文，现代矢量）；
 *  - 文楷 = 打包的霞鹜文楷（楷体风格最柔和的选择 —— 开源界没有第二个高质量简体楷体）；
 *  - 思源宋 = 打包的 Noto Serif SC，是默认字体。
 * 0.2.1 早先的 song / hei / kai（中易宋体 / 雅黑 / 楷体 KaiTi）已删除：
 * 中易宋体与 KaiTi 在大字号走内嵌点阵或老轮廓，又细又硬（用户 4K 屏实测）；
 * 雅黑是 UI 字体不适合长文；旧值由 settingsSchema 的 transform 归一化。
 */
export const FONT_FAMILIES: ReadonlyArray<{ value: FontFamilyKey; label: string; stack: string }> = [
  {
    value: 'fang',
    label: '仿宋',
    stack: '"Zhuque Fangsong", "FangSong", "FangSong_GB2312", "STFangsong", serif'
  },
  { value: 'deng', label: '等线', stack: '"DengXian", "PingFang SC", "Microsoft YaHei", sans-serif' },
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
