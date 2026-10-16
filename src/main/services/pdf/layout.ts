/**
 * PDF 的排版还原（0.4.0）：把 pdfjs 给的**文字项**揉回段落。
 *
 * PDF 里没有「段落」这个概念 —— 只有一堆带着坐标的文字片。固定版面决定了它
 * **永远不可能像 TXT/EPUB 那样自由重排**，所以这里的目标定得很低：把文字按阅读顺序
 * 排好、把明显是同一段的行接起来、该分段的地方分段。缩进、表格、分栏一律不可靠，
 * 产品上也如实说了「不承诺排版保真」（见 CHANGELOG 0.4.0 与 MVP 的格式路线图）。
 *
 * 纯函数，不碰 pdfjs、不碰 DOM —— 中文排版逻辑靠合成文字项就能测（见单测）。
 */

/** 只用得到这几样（结构化类型，方便喂合成数据）。 */
export interface PdfTextItem {
  str: string
  /** PDF 坐标系：x 向右、y 向上（页底是 0）。 */
  x: number
  y: number
  width: number
  height: number
}

export interface PdfLine {
  /** 行基准线的 y（同一行的项取平均）。 */
  y: number
  height: number
  /** 行左端与右端。 */
  x: number
  right: number
  text: string
}

const FALLBACK_SIZE = 10

/** 一行里相邻两项之间超过这个比例的字高，就认为中间有空格（拉丁文常用）。 */
const WORD_GAP_RATIO = 0.25

function isCjk(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x3000 && code <= 0x303f) || // 中文标点
    (code >= 0x4e00 && code <= 0x9fff) || // 汉字
    (code >= 0xff00 && code <= 0xffef) // 全角
  )
}

/** 两个片段之间要不要插一个空格：拉丁文要、中文不要。 */
function needsSpace(before: string, after: string): boolean {
  if (before === '' || after === '') return false
  if (isCjk(before.at(-1)) || isCjk(after.at(0))) return false
  return !/\s$/.test(before)
}

export interface GroupLinesOptions {
  /** 纵向容差（px）：小于它就算同一行。默认按字高的 0.4 倍、至少 2px。 */
  tolerance?: number
}

/**
 * 把页内文字项按行归堆，行内按 x 排好、按需补空格。
 * 行序是**从上到下**（PDF 的 y 向上，所以倒着排）。
 */
export function groupLines(items: readonly PdfTextItem[], options: GroupLinesOptions = {}): PdfLine[] {
  const usable = items.filter((item) => item.str !== '' && item.str !== undefined)
  if (usable.length === 0) return []

  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfTextItem[][] = []

  for (const item of sorted) {
    const height = item.height > 0 ? item.height : FALLBACK_SIZE
    const tolerance = options.tolerance ?? Math.max(2, height * 0.4)
    // 就近归堆：与最后一行的基准 y 差得够近就算同一行（页内文字项一般已按阅读顺序给出）
    const last = lines.at(-1)
    if (last !== undefined && Math.abs(last[0].y - item.y) <= tolerance) {
      last.push(item)
      continue
    }
    lines.push([item])
  }

  return lines
    .map((line) => {
      const ordered = [...line].sort((a, b) => a.x - b.x)
      let text = ''
      let previous: PdfTextItem | null = null
      for (const item of ordered) {
        if (previous !== null) {
          const gap = item.x - (previous.x + previous.width)
          const size = Math.max(item.height, previous.height, FALLBACK_SIZE)
          if (gap > WORD_GAP_RATIO * size && needsSpace(text, item.str)) text += ' '
        }
        text += item.str
        previous = item
      }
      const height = Math.max(...ordered.map((item) => item.height), FALLBACK_SIZE)
      return {
        y: ordered.reduce((sum, item) => sum + item.y, 0) / ordered.length,
        height,
        x: ordered[0].x,
        right: Math.max(...ordered.map((item) => item.x + item.width)),
        text: text.replace(/\s+/g, ' ').trim()
      }
    })
    .filter((line) => line.text !== '')
}

/** 同一段里两行之间要不要插空格（中文换行不该凭空多出空格）。 */
function joinAcrossLines(before: string, after: string): string {
  return needsSpace(before, after) ? before + ' ' + after : before + after
}

export interface ParagraphOptions {
  /** 行首比左边距多出这个比例的**字高**，就当新段落（中文书最常见的信号）。 */
  indentFactor?: number
  /** 上一行右端比页面右边距少出这个比例的字高，就当这一段结束了。 */
  shortLineFactor?: number
  /**
   * 行间距超过「本页行距中位数 × 这个系数」就当新段落。
   * 用中位数而不是固定倍数：PDF 的行距五花八门（12pt 字配 20pt 行距很常见），
   * 固定倍数要么把正常行距误判成段距，要么漏掉真正的段距。
   */
  gapFactor?: number
  /** 行数太少（不足 3 行）拿不到中位数时，回退到「字高的几倍」。 */
  fallbackGapFactor?: number
}

/**
 * 行 → 段落。三条判据（满足任一即分段）：
 *  ① **首行缩进**：行左端明显比本页左边距更靠右；
 *  ② **上一行是短行**：明显没排到右边距（一段的收尾）；
 *  ③ **行间距过大**：段与段之间的空档。
 * 拿不准的一律当同段接起来 —— 少分段只是读起来挤，多分段会把句子切断。
 */
export function paragraphsFromLines(
  lines: readonly PdfLine[],
  options: ParagraphOptions = {}
): string[] {
  const usable = lines.filter((line) => line.text !== '')
  if (usable.length === 0) return []

  const indentFactor = options.indentFactor ?? 1.2
  const shortLineFactor = options.shortLineFactor ?? 1.2
  const gapFactor = options.gapFactor ?? 1.35
  const fallbackGapFactor = options.fallbackGapFactor ?? 1.8

  const minX = Math.min(...usable.map((line) => line.x))
  const maxRight = Math.max(...usable.map((line) => line.right))

  // 本页的行距中位数（只在够 3 行时才有意义）
  const gaps: number[] = []
  for (let i = 1; i < usable.length; i += 1) {
    const gap = usable[i - 1].y - usable[i].y
    if (gap > 0) gaps.push(gap)
  }
  const medianGap =
    gaps.length >= 2 ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null

  const paragraphs: string[] = []
  let current = usable[0].text
  let previous = usable[0]

  for (const line of usable.slice(1)) {
    const size = Math.max(previous.height, line.height, FALLBACK_SIZE)
    const gap = previous.y - line.y
    const indented = line.x - minX > indentFactor * size
    const afterShortLine = previous.right < maxRight - shortLineFactor * size
    const farApart = gap > Math.max(1.5 * size, medianGap === null ? fallbackGapFactor * size : medianGap * gapFactor)

    if (indented || afterShortLine || farApart) {
      paragraphs.push(current)
      current = line.text
    } else {
      current = joinAcrossLines(current, line.text)
    }
    previous = line
  }
  paragraphs.push(current)
  return paragraphs
}

/** 一整页的文字项 → 段落文本（页与页之间用 `\n` 连，调用方负责拼全书）。 */
export function pageToParagraphs(items: readonly PdfTextItem[]): string[] {
  return paragraphsFromLines(groupLines(items))
}
