import type { CharOffset } from '@shared/types'

/**
 * 章内段落与偏移的纯计算（不含 DOM）。
 * 阅读器把 <p> 的 offsetTop 量出来交给这些函数，就能在滚动位置和字符偏移之间换算，
 * 排版变化（改字号）后重新量一次即可回到同一处文字，而不是同一页。
 */
export interface Paragraph {
  offset: CharOffset
  text: string
}

/** 按换行拆段，保留每段在本章文本里的起始偏移；末尾的空段不渲染。 */
export function splitParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = []
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      out.push({ offset: start, text: text.slice(start, i) })
      start = i + 1
    }
  }
  out.push({ offset: start, text: text.slice(start) })
  while (out.length > 1 && out[out.length - 1].text.length === 0) out.pop()
  return out
}

/** 二分：返回 tops 里最后一个 <= value 的下标；空数组或越小则返回 0。 */
export function indexAtOrBefore(tops: readonly number[], value: number): number {
  if (tops.length === 0) return 0
  let low = 0
  let high = tops.length - 1
  let found = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (tops[mid] <= value) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** 当前滚动位置对应本章的第几个字符。 */
export function offsetForScrollTop(
  paragraphs: readonly Paragraph[],
  tops: readonly number[],
  scrollTop: number
): CharOffset {
  if (paragraphs.length === 0) return 0
  const index = Math.min(indexAtOrBefore(tops, scrollTop), paragraphs.length - 1)
  return paragraphs[index].offset
}

/** 要把某段文字滚到视口顶部，需要设置的 scrollTop。 */
export function scrollTopForOffset(
  paragraphs: readonly Paragraph[],
  tops: readonly number[],
  offset: CharOffset
): number {
  if (paragraphs.length === 0 || tops.length === 0) return 0
  let low = 0
  let high = paragraphs.length - 1
  let found = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (paragraphs[mid].offset <= offset) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return tops[Math.min(found, tops.length - 1)] ?? 0
}
