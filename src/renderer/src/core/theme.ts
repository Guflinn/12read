import type { ReaderSettings } from '@shared/types'
import { fontStackOf, pageWidthOf } from '@/core/typography'

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
export function applyTheme(settings: ReaderSettings, root: ThemeRoot): void {
  if (root.dataset.theme !== settings.theme) root.dataset.theme = settings.theme
  root.style.setProperty('--fs', settings.fontSize + 'px')
  root.style.setProperty('--lh', String(settings.lineHeight))
  root.style.setProperty('--fw', settings.bold ? '600' : '400')
  root.style.setProperty('--font-body', fontStackOf(settings.fontFamily))
  root.style.setProperty('--page-w', pageWidthOf(settings.pageWidth))
}
