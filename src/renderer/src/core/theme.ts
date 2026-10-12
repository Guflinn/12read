import type { BoldLevel, ReaderSettings } from '@shared/types'
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
 * 「加粗」的伪粗体（0.3.0 定稿：关 / 轻 / 中 三档，用户拍板）。
 *
 * 为什么只有两档有效的加粗（用户问过好几次，这里一次说清）：
 *   字体没有粗体文件时只能做伪粗体，而伪粗体要让边缘是**实**的，副本就必须错开**整数个屏幕像素**
 *   （小数偏移 = 副本自己的边缘半透明 = 又会发虚，那正是 0.35px 描边方案的老毛病）。
 *   宋体的横画只有约 1.1 个屏幕像素宽，所以最小的一步就是 +30% 落墨，再上一步 +98% —— 中间没有档位。
 *   实测（宋体 35px、150% 缩放，细横"墨量集中度"越大越锐利）：
 *     不加粗 0.716 / 轻档 0.666 / 中档 0.335 / 描边 0.508（虚）/ 合成粗体 0.457（更虚）。
 *   也试过 SVG feMorphology（形态学膨胀）：radius 0.15/0.25 完全无效、0.35 起直接跳到 +112% ——
 *   同样是整像素量化，给不了"轻档"。
 *
 * 做法：`text-shadow` 画若干份**完整的字形副本**（不透明），与原字形取并集 —— 边缘仍是各自锐利的边缘。
 *   - 轻（1）：横向错开 1 个屏幕像素 → 只加竖画，横画保持纤细锐利（+30% 落墨，接近老描边的力度）
 *   - 中（2）：四方向各 1 个屏幕像素 → 横竖都加（+98%，接近"真粗体"的分量，但明显更黑）
 */
export function boldShadow(level: BoldLevel, devicePixelRatio: number): string {
  if (level <= 0) return 'none'
  const offset = (1 / Math.max(1, devicePixelRatio)).toFixed(4) + 'px'
  const right = offset + ' 0 0 currentColor'
  if (level === 1) return right
  return [right, '-' + offset + ' 0 0 currentColor', '0 ' + offset + ' 0 currentColor', '0 -' + offset + ' 0 currentColor'].join(
    ', '
  )
}

export function applyTheme(
  settings: ReaderSettings,
  root: ThemeRoot,
  /** 设备像素比：加粗阴影的偏移要按它取整到整数屏幕像素（见 boldShadow）。 */
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
