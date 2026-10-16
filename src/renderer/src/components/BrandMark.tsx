import brandMark from '../assets/brand-mark.png'

/**
 * 应用图标（品牌标）：纸色圆角底 + 宋体「十二」+ 朱红书签。
 *
 * 与打包进 exe 的图标**同源**（`build/icon.svg`），位图由 `tools/icon/render-icon.mjs`
 * 一并渲染到 `src/renderer/src/assets/brand-mark.png`（256px）—— 改了图标源要重跑那个脚本，
 * 两处才会一致。这里用位图而不是内联 SVG，是为了不在字体尚未就绪时闪一下回退字形。
 *
 * 放在书架页头、启动卡与错误卡三处；`alt=""` 是故意的：旁边就是「十二阅读」标题，
 * 图标属装饰，念屏时不必重复报一遍。
 */
export function BrandMark(): React.JSX.Element {
  return <img className="logo" src={brandMark} alt="" draggable={false} />
}
