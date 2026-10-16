/**
 * Markdown 的渲染期解析（0.4.0）。**纯函数，不碰 DOM。**
 *
 * 与「正文一个字都不改」这条立场配套的两条硬约束：
 *  ① 所有解析结果拼起来的**原始字符**必须等于输入（`join(segments.text) === input`）——
 *     标记本身以 `syntax` 片段的形式留在结果里，渲染时用 display:none 藏起来，
 *     这样 DOM 的 textContent 与原始文本逐字相同，选区的「字符偏移」换算就不会跑偏
 *     （进度 / 书签 / 划线 / 搜索全靠这个偏移，见 ReaderView 的 offsetInParagraph）。
 *  ② **绝不凭空插入可见文字**（列表圆点、分隔线一律用 CSS 画）—— 插入的字符不在原始文本里，
 *     会让偏移整体错位。
 *
 * 范围（v1，够读书用，不追求完整 CommonMark）：
 *   块级：ATX 标题 / 引用 / 无序列表 / 有序列表 / 围栏代码块 / 分隔线
 *   行内：**粗** *斜* `代码` [链接](url) ![图](src)
 *   不做：表格、任务列表、脚注、HTML 块、Setext 标题（`===` 下划线式）、嵌套行内标记（只做一层）
 */

export type MdBlockKind = 'heading' | 'quote' | 'ul' | 'ol' | 'code' | 'fence' | 'rule' | 'text'

export interface MdBlock {
  kind: MdBlockKind
  /** 标题级别 1–6；非标题为 0。 */
  level: number
  /** 有序列表的序号；其它为 0。 */
  num: number
  /** 缩进层级（列表嵌套用）：按行首空白算，一级 2 格。 */
  depth: number
  /** 行内内容从这里开始 —— 之前的字符是块级标记，渲染时藏起来。 */
  contentStart: number
  /** 代码块在围栏内的位置（首行 / 末行 / 只有一行），用来给背景加圆角；不是代码块是 null。 */
  codePos: 'first' | 'mid' | 'last' | 'only' | null
}

const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(.*)$/
const HEADING_RE = /^([ \t]{0,3})(#{1,6})[ \t]+/
const QUOTE_RE = /^[ \t]{0,3}>[ \t]?/
const UL_RE = /^([ \t]*)([-*+])[ \t]+/
const OL_RE = /^([ \t]*)(\d{1,9})[.)][ \t]+/
const RULE_RE = /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/

/** 把整章的段落（一行一段）解析成块级结构。围栏代码块需要跨行状态，所以这里一次吃一整章。 */
export function markdownBlocks(lines: readonly string[]): MdBlock[] {
  const blocks: MdBlock[] = []
  let fence: string | null = null

  for (const line of lines) {
    if (fence !== null) {
      const close = FENCE_LINE_RE.exec(line)
      const closes =
        close !== null && close[1][0] === fence[0] && close[1].length >= fence.length && close[2].trim() === ''
      if (closes) {
        fence = null
        blocks.push({ kind: 'fence', level: 0, num: 0, depth: 0, contentStart: line.length, codePos: null })
      } else {
        blocks.push({ kind: 'code', level: 0, num: 0, depth: 0, contentStart: 0, codePos: null })
      }
      continue
    }

    const openFence = FENCE_LINE_RE.exec(line)
    if (openFence !== null) {
      fence = openFence[1]
      blocks.push({ kind: 'fence', level: 0, num: 0, depth: 0, contentStart: line.length, codePos: null })
      continue
    }

    // 分隔线要在列表之前判：`---` 与 `- - -` 都不是列表项
    if (RULE_RE.test(line)) {
      blocks.push({ kind: 'rule', level: 0, num: 0, depth: 0, contentStart: line.length, codePos: null })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: heading[2].length,
        num: 0,
        depth: 0,
        contentStart: heading[0].length,
        codePos: null
      })
      continue
    }

    const quote = QUOTE_RE.exec(line)
    if (quote !== null) {
      blocks.push({ kind: 'quote', level: 0, num: 0, depth: 0, contentStart: quote[0].length, codePos: null })
      continue
    }

    const ul = UL_RE.exec(line)
    if (ul !== null) {
      blocks.push({
        kind: 'ul',
        level: 0,
        num: 0,
        depth: listDepth(ul[1]),
        contentStart: ul[0].length,
        codePos: null
      })
      continue
    }

    const ol = OL_RE.exec(line)
    if (ol !== null) {
      blocks.push({
        kind: 'ol',
        level: 0,
        num: Number(ol[2]),
        depth: listDepth(ol[1]),
        contentStart: ol[0].length,
        codePos: null
      })
      continue
    }

    blocks.push({ kind: 'text', level: 0, num: 0, depth: 0, contentStart: 0, codePos: null })
  }

  // 代码块首末行：给背景加圆角要用，顺序扫一遍就能定
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].kind !== 'code') continue
    const hasPrev = blocks[i - 1]?.kind === 'code'
    const hasNext = blocks[i + 1]?.kind === 'code'
    blocks[i].codePos = hasPrev ? (hasNext ? 'mid' : 'last') : hasNext ? 'first' : 'only'
  }

  return blocks
}

/** 列表缩进层级：两个空格算一级（Tab 按 4 格算），最多认到 5 级。 */
function listDepth(indent: string): number {
  let width = 0
  for (const ch of indent) width += ch === '\t' ? 4 : 1
  return Math.min(5, Math.floor(width / 2))
}

export type MdInlineKind = 'text' | 'strong' | 'em' | 'code' | 'link' | 'image' | 'syntax'

export interface MdInline {
  kind: MdInlineKind
  /** 原始字符（含标记）：全部片段拼起来必须等于输入。 */
  text: string
  /** 在章内文本里的起始偏移。 */
  start: number
  /** link / image 的目标地址。 */
  href?: string
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>]/
const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * 行内解析。返回的片段按顺序拼起来 === 输入（含被隐藏的标记），
 * `start` 是每个片段在章内文本里的偏移 —— 渲染层据此把划线（mark）套在正确的字符上。
 */
export function mdInline(text: string, base = 0): MdInline[] {
  const out: MdInline[] = []
  let plain = 0
  let i = 0

  const pushPlain = (from: number, to: number): void => {
    if (to > from) out.push({ kind: 'text', text: text.slice(from, to), start: base + from })
  }
  /** 标记 + 内容 + 标记：前后两截以 syntax 片段的形式保留，等渲染时藏起来。 */
  const pushWrapped = (
    openLen: number,
    closeLen: number,
    innerFrom: number,
    innerTo: number,
    kind: MdInlineKind,
    href?: string
  ): void => {
    pushPlain(plain, i)
    out.push({ kind: 'syntax', text: text.slice(i, i + openLen), start: base + i })
    out.push({
      kind,
      text: text.slice(innerFrom, innerTo),
      start: base + innerFrom,
      ...(href === undefined ? {} : { href })
    })
    out.push({ kind: 'syntax', text: text.slice(innerTo, innerTo + closeLen), start: base + innerTo })
  }

  while (i < text.length) {
    const ch = text[i]

    // 反斜杠转义：藏掉反斜杠，被转义的字符整段当普通文字（并跳过它，别当成标记）
    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      pushPlain(plain, i)
      out.push({ kind: 'syntax', text: '\\', start: base + i })
      out.push({ kind: 'text', text: text[i + 1], start: base + i + 1 })
      i += 2
      plain = i
      continue
    }

    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i + 1) {
        pushWrapped(1, 1, i + 1, close, 'code')
        i = close + 1
        plain = i
        continue
      }
    }

    if (ch === '!' || ch === '[') {
      const image = ch === '!'
      const link = readBracket(text, i + (image ? 1 : 0))
      if (link !== null) {
        pushWrapped(
          image ? 2 : 1,
          // 隐藏的尾巴是 `](地址)`：1 个 `]` + 1 个 `(` + 地址 + 1 个 `)`
          link.hrefRaw.length + 3,
          link.textFrom,
          link.textTo,
          image ? 'image' : 'link',
          link.href
        )
        i = link.end
        plain = i
        continue
      }
    }

    if (ch === '*' || ch === '_') {
      const marker = text[i + 1] === ch ? ch + ch : ch
      const emphasis = readEmphasis(text, i, marker)
      if (emphasis !== null) {
        pushWrapped(marker.length, marker.length, emphasis.innerFrom, emphasis.innerTo, marker.length === 2 ? 'strong' : 'em')
        i = emphasis.closeAt + marker.length
        plain = i
        continue
      }
    }

    i += 1
  }

  pushPlain(plain, text.length)
  return out
}

interface BracketLink {
  textFrom: number
  textTo: number
  href: string
  /** 括号里 `](… )` 的原始内容长度（算隐藏标记用）。 */
  hrefRaw: string
  end: number
}

/** 解析 `[文字](地址)`（地址后面跟 "标题" 时只取地址）。 */
function readBracket(text: string, open: number): BracketLink | null {
  if (text[open] !== '[') return null
  const closeBracket = text.indexOf(']', open + 1)
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return null
  const closeParen = text.indexOf(')', closeBracket + 2)
  if (closeParen === -1) return null
  const hrefRaw = text.slice(closeBracket + 2, closeParen)
  const href = hrefRaw.trim().split(/\s+/)[0] ?? ''
  if (href === '' || href.length > 500) return null
  return {
    textFrom: open + 1,
    textTo: closeBracket,
    href,
    hrefRaw,
    end: closeParen + 1
  }
}

interface Emphasis {
  innerFrom: number
  innerTo: number
  closeAt: number
}

/**
 * 找最短的合法闭合标记。两条防误伤：标记后面不能是空格（那是乘号 / 分隔线），
 * `_` 不能落在词中（`snake_case` 不该变成斜体）。
 */
function readEmphasis(text: string, open: number, marker: string): Emphasis | null {
  const innerFrom = open + marker.length
  const next = text[innerFrom]
  if (next === undefined || /\s/.test(next)) return null
  if (marker === '_') {
    const before = text[open - 1]
    if (before !== undefined && WORD_CHAR.test(before)) return null
  }

  let search = innerFrom
  for (;;) {
    const close = text.indexOf(marker, search)
    if (close === -1) return null
    const before = text[close - 1]
    const after = text[close + marker.length]
    // 被反斜杠转义的标记不算闭合：`\*不斜\*` 里那两个星号是普通文字
    const escaped = before === '\\'
    const okBefore = before !== undefined && !/\s/.test(before)
    const okAfter = marker !== '_' || after === undefined || !WORD_CHAR.test(after)
    if (close > innerFrom && okBefore && okAfter && !escaped) {
      return { innerFrom, innerTo: close, closeAt: close }
    }
    search = close + marker.length
  }
}
