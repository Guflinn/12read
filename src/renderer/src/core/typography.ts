import type { FontFamilyKey, PageWidthKey } from '@shared/types'

export const DEFAULT_FONT_STACK = '"SimSun", "Songti SC", "Noto Serif CJK SC", serif'
export const DEFAULT_PAGE_WIDTH = '40rem'
/** 正文默认字重（只有思源宋那一族是可变字体，能吃到这个值）。 */
export const DEFAULT_FONT_WEIGHT = 400

/** 打包的思源宋是可变字体，family 名与 styles.css 的 @font-face 逐字一致。 */
const SERIF_VF_STACK = '"Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", serif'

/**
 * 字体选项表（0.2.1 第五轮按用户审美定稿；0.3.0 补「中宋」）：
 *  - 宋体 / 仿宋 / 楷体 = 系统自带（用户点名要经典的，接受大字号的点阵观感）；
 *  - 黑体 = 打包思源黑体 Noto Sans SC（OFL）—— 用户想要的「苹方」是 macOS 独占无法打包，这是最接近的替代；
 *  - 文楷 = 打包霞鹜文楷；思源宋 / 中宋 = 打包思源宋可变字体的两个字重；
 *  - 秀楷 = 打包方正宋刻本秀楷（1.1.0，用户已购软件内置字体授权，见 styles.css）。
 *
 * `weight` 只有思源宋那一族吃得到（styles.css 的 @font-face 声明了 wght 200–900）；
 * 系统字体没有多字重，写进去也只是个普通 font-weight，不影响观感。
 * 排列按经典在前；@font-face 见 styles.css（family 名与回退栈第一位是双头契约）。
 */
export const FONT_FAMILIES: ReadonlyArray<{
  value: FontFamilyKey
  label: string
  stack: string
  weight: number
}> = [
  { value: 'song', label: '宋体', stack: DEFAULT_FONT_STACK, weight: DEFAULT_FONT_WEIGHT },
  {
    value: 'fang',
    label: '仿宋',
    stack: '"FangSong", "FangSong_GB2312", "STFangsong", serif',
    weight: DEFAULT_FONT_WEIGHT
  },
  {
    value: 'kai',
    label: '楷体',
    stack: '"KaiTi", "Kaiti SC", "STKaiti", serif',
    weight: DEFAULT_FONT_WEIGHT
  },
  {
    value: 'sans',
    label: '黑体',
    stack: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif',
    weight: DEFAULT_FONT_WEIGHT
  },
  {
    value: 'wenkai',
    label: '文楷',
    stack: '"LXGW WenKai", "Kaiti SC", "KaiTi", serif',
    weight: DEFAULT_FONT_WEIGHT
  },
  { value: 'hanserif', label: '思源宋', stack: SERIF_VF_STACK, weight: DEFAULT_FONT_WEIGHT },
  // 中宋（0.3.0）：用户拿华文中宋做参照说「这个就挺好，但会不会粗了」。
  // 华文中宋（STZhongsong）是**系统字体**（Windows 中文版自带），而且是单字重、没有细体，
  // 所以这一档的做法是**系统字体优先**：装了华文中宋就直接用它（一个字节都不打包，
  // 也没有商业字体的授权问题）；没装则回退到打包的思源宋，最差也不会变成衬线兜底。
  // 实测两者分量：华文中宋竖画 0.093em、横画 0.025em（高对比）；思源宋 400 竖 0.079em、
  // 横 0.075em（低对比）—— 想要「比华文中宋轻」就把字体切到「思源宋」。
  {
    value: 'zhongsong',
    label: '中宋',
    stack: '"STZhongsong", "FZShuSong", "Source Han Serif SC", "Noto Serif SC", serif',
    weight: DEFAULT_FONT_WEIGHT
  },
  // 秀楷（1.1.0）：方正宋刻本秀楷 简繁（GBK）Regular，打包分发。
  // 与「中宋」不同：这是商业字体（方正精品字），打包进安装包需要「软件内置字体应用授权」
  // —— 用户已购（按应用名授权，2026-10-25），授权凭证由用户留存。
  // 简繁 GBK 一个文件就同时覆盖简体与繁体，不再打 GB2312 简体版（超集关系，纯冗余）。
  // 静态单字重：字重恒为 400；回退栈第一位与 styles.css 的 @font-face family 名逐字一致。
  {
    value: 'xiukai',
    label: '秀楷',
    stack: '"FZSongKeBenXiuKaiJF", "KaiTi", "STKaiti", serif',
    weight: DEFAULT_FONT_WEIGHT
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

/**
 * 这一档正文字体该用的字重。
 * 只有思源宋那一族是真可变字体（styles.css 的 @font-face 声明了 wght 200–900），
 * 系统字体（宋体 / 仿宋 / 楷体）拿到 400 就是普通字重，不影响观感。
 */
export function fontWeightOf(key: FontFamilyKey): number {
  return (FONT_FAMILIES.find((item) => item.value === key) ?? { weight: DEFAULT_FONT_WEIGHT }).weight
}

export function pageWidthOf(key: PageWidthKey): string {
  return (PAGE_WIDTHS.find((item) => item.value === key) ?? { width: DEFAULT_PAGE_WIDTH }).width
}
