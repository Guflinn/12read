import type { Progress } from '../types'

/**
 * 进度锚点（TECH.md 9）。锚点是兜底手段，主定位始终是 chapterIndex + charOffset。
 */

/** 锚点引文长度。 */
export const ANCHOR_LENGTH = 30

export function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0
  const i = Math.trunc(offset)
  if (i < 0) return 0
  return i > length ? length : i
}

/** 取 offset 前后各 30 字作为引文锚点。 */
export function makeAnchor(text: string, offset: number): { before: string; after: string } {
  const safe = clampOffset(offset, text.length)
  const from = Math.max(0, safe - ANCHOR_LENGTH)
  const to = Math.min(text.length, safe + ANCHOR_LENGTH)
  return { before: text.slice(from, safe), after: text.slice(safe, to) }
}

/**
 * 四级降级定位：前+后引文组合 -> 后引文 -> 前引文 -> 夹紧后的 charOffset。
 * 排版变化绝不重写 charOffset，只在渲染时用本函数重新滚屏。
 */
export function relocateOffset(
  text: string,
  progress: Pick<Progress, 'charOffset' | 'anchorBefore' | 'anchorAfter'>
): number {
  const before = progress.anchorBefore ?? ''
  const after = progress.anchorAfter ?? ''

  const combo = before + after
  if (combo.length > 0) {
    const idx = text.indexOf(combo)
    if (idx >= 0) return idx + before.length
  }
  if (before.length > 0) {
    const idx = text.lastIndexOf(before)
    if (idx >= 0) return idx + before.length
  }
  if (after.length > 0) {
    const idx = text.indexOf(after)
    if (idx >= 0) return idx
  }
  return clampOffset(progress.charOffset, text.length)
}

/**
 * 书架/阅读页展示用的全书百分比。仅展示，不参与定位。
 */
export function estimatePercent(totalChars: number, chapterStart: number, charOffset: number): number {
  if (!Number.isFinite(totalChars) || totalChars <= 0) return 0
  const absolute = clampOffset(chapterStart + charOffset, totalChars)
  const pct = (absolute / totalChars) * 100
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100))
}
