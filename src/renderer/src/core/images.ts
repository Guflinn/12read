import type { BookImage } from '@shared/types'

/**
 * 内联图片在阅读器里的处理（0.2.0 第 5 项）。
 *
 * 正文里的图片是 **U+FFFC** 占位（一个 BMP 字符，不破坏 UTF-16 偏移体系），
 * 这里只做两件纯计算的事：挑出本章的图、把段落文字按占位符拆成「文字 / 图片」片段。
 * 真正的字节由主进程的自定义协议按需取，这里只管 URL 与位置。
 */

/** 图片占位符（与主进程 xhtml-text.ts 保持一致）。 */
export const IMAGE_PLACEHOLDER = '\uFFFC'

export interface ChapterImage {
  /** **本章内**的偏移（已减掉章的起点）。 */
  offset: number
  url: string
}

export type ParagraphPiece =
  | { kind: 'text'; text: string; start: number }
  /** `at` 是占位符在段落文字里的下标（拼绝对偏移、调试与测试都用得上）。 */
  | { kind: 'image'; url: string | null; at: number }

/**
 * 挑出落在本章范围内的图片，并把偏移换算成章内偏移。
 * 图片是全局偏移（全书正文坐标），而段落偏移是本章坐标，所以必须减一次。
 */
export function chapterImages(
  images: readonly BookImage[],
  chapterStart: number,
  chapterLength: number
): ChapterImage[] {
  const end = chapterStart + chapterLength
  const picked: ChapterImage[] = []
  for (const image of images) {
    if (image.offset < chapterStart || image.offset >= end) continue
    picked.push({ offset: image.offset - chapterStart, url: image.url })
  }
  return picked.sort((left, right) => left.offset - right.offset)
}

/**
 * 把一段文字按 U+FFFC 拆成片段。
 * - 找不到对应图片的占位符 → `url: null`（渲染时忽略，正文一个字符都不丢）
 * - `start` 是这段文字在**段落内**的起始下标，供高亮切分继续用
 */
export function splitByImages(
  text: string,
  paragraphOffset: number,
  byOffset: ReadonlyMap<number, string>
): ParagraphPiece[] {
  if (!text.includes(IMAGE_PLACEHOLDER)) {
    return text === '' ? [] : [{ kind: 'text', text, start: 0 }]
  }

  const pieces: ParagraphPiece[] = []
  let cursor = 0
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] !== IMAGE_PLACEHOLDER) continue
    if (at > cursor) pieces.push({ kind: 'text', text: text.slice(cursor, at), start: cursor })
    pieces.push({ kind: 'image', url: byOffset.get(paragraphOffset + at) ?? null, at })
    cursor = at + 1
  }
  if (cursor < text.length) {
    pieces.push({ kind: 'text', text: text.slice(cursor), start: cursor })
  }
  return pieces
}

/** 搜索命中上下文里的占位符按「[图]」显示（不然会是一个看不见的怪字符）。 */
export function placeholderAsText(text: string): string {
  return text.includes(IMAGE_PLACEHOLDER) ? text.split(IMAGE_PLACEHOLDER).join('[图]') : text
}
