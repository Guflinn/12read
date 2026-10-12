import type { ReaderSettings } from '@shared/types'
import { fontStackOf, fontWeightOf, pageWidthOf } from '@/core/typography'

/**
 * applyTheme 只用得到 <html> 上的这两个能力。显式写出来有两个好处：
 * 渲染层不必依赖 jsdom 就能单测，main 侧 tsconfig（不加载 DOM lib）也不会被拖累。
 */
export interface ThemeRoot {
  dataset: { theme?: string }
  style: { setProperty(name: string, value: string): void }
}

/**
 * 主题与排版变量落在 <html>（documentElement）上，而不是内层 .app 上。
 *
 * 原因：CSS 自定义属性只向下继承。theme 属性挂在内层 div 时，body 的
 * `background: var(--bg)` / `color: var(--text)` 只能取到 :root 的日间值，
 * 于是夜间模式下 .app 子树是深色、整页 backdrop 还是浅色底，正文继承的 color
 * 也仍是深色 —— 深色顶栏上压着深色文字，看起来就是「花屏」。
 */
/**
 * 「加粗」的伪粗体（0.3.0 第二版，替换原来的 0.35px 描边）。
 *
 * 为什么不用 `-webkit-text-stroke`：描边是**从字形轮廓居中向外加一圈半透明带**
 * （0.35px 在 150% 缩放下只有 0.525 设备像素、覆盖率约 26%）。宋体的横画只有 1 个设备
 * 像素出头，这一圈落在它两侧就是两条"淡边"，把原本一行的实墨摊成两三行浅墨 —— 用户
 * 2026-10-13 报的「加粗就发虚」就是它（实测细横墨量集中度 0.716 → 0.508）。
 *
 * 现在的做法：用 **text-shadow 画若干份「完整的字形副本」**。副本是不透明的，
 * 与原字形取并集后边缘仍是各自锐利的边缘，叠出来是**实墨**，不会发灰。
 * 关键是**偏移取整数个设备像素**（1/dpr 个 CSS 像素）：
 *   - 整数偏移 → 副本与原字形错开整整一格，笔画在偏移方向上恰好增宽 1 设备像素，边缘锐利；
 *   - 小数偏移 → 副本自己的边缘就是半透明的，等于又回到描边的老毛病。
 * 四个方向各一份 = 均匀加粗（横竖都加），实测墨量约为不加粗的 2 倍，而细横依然不发灰。
 *
 * 代价：一段文字要绘制 5 次。实测打开章节/切章会略慢一点，滚动不受影响（滚动是图层位移）。
 */
export function boldShadow(enabled: boolean, devicePixelRatio: number): string {
  if (!enabled) return 'none'
  const offset = (1 / Math.max(1, devicePixelRatio)).toFixed(4) + 'px'
  return [
    offset + ' 0 0 currentColor',
    '-' + offset + ' 0 0 currentColor',
    '0 ' + offset + ' 0 currentColor',
    '0 -' + offset + ' 0 currentColor'
  ].join(', ')
}

export function applyTheme(
  settings: ReaderSettings,
  root: ThemeRoot,
  /** 设备像素比：加粗阴影的偏移要按它取整到整数设备像素（见 boldShadow）。 */
  devicePixelRatio = 1
): void {
  if (root.dataset.theme !== settings.theme) root.dataset.theme = settings.theme
  root.style.setProperty('--fs', settings.fontSize + 'px')
  root.style.setProperty('--lh', String(settings.lineHeight))
  root.style.setProperty('--ls', settings.letterSpacing + 'em')
  // 正文字重（0.3.0）：只有思源宋那一族是可变字体，能吃到 400 / 500 这种真字重；
  // 系统字体拿到 400（默认）等于什么都没做。**与「加粗」不是一回事**：加粗见 --bold-shadow。
  root.style.setProperty('--weight', String(fontWeightOf(settings.fontFamily)))
  root.style.setProperty('--bold-shadow', boldShadow(settings.bold, devicePixelRatio))
  root.style.setProperty('--font-body', fontStackOf(settings.fontFamily))
  root.style.setProperty('--page-w', pageWidthOf(settings.pageWidth))
}
