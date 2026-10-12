/**
 * MOBI 的正文 HTML 预处理（0.3.0）。
 *
 * MOBI6（KF7）的正文是**一坨 HTML 片段**，不是 XML：`<br>`、`<img>` 这类空标签不闭合，
 * 图片用 `recindex`（第几条图片记录）而不是 `src` 引用，翻页用 `<mbp:pagebreak/>`。
 * 三件事都在这里做掉，后面就能直接复用 EPUB 那一层的 `extractXhtmlText`
 * （它对命名空间前缀、老式表现型标记都已经吃得很开）：
 *
 * 1. 空标签自闭合 —— 否则手写解析器会把后面的正文挂到 `<img>` 底下，一整段文字凭空消失；
 * 2. `recindex` 改写成 `src="@recindex:N"` —— 提取器只认 `src`，这里换成它能看懂的写法；
 * 3. 按 `<mbp:pagebreak/>` 切「节」—— 这是 MOBI 里最可靠的章节边界（目录本身只是文件内链接）。
 */
import { localName, parseXml, type XmlNode } from '../epub/xml'

/** 图片引用的临时写法：`@recindex:3` 对应第 3 条图片记录。 */
export const RECINDEX_PREFIX = '@recindex:'

/** 从 `src="@recindex:N"` 里读出 N；不是这种写法就给 null。 */
export function recindexOf(src: string): number | null {
  if (!src.startsWith(RECINDEX_PREFIX)) return null
  const value = Number.parseInt(src.slice(RECINDEX_PREFIX.length), 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 必须自闭合的标签（HTML 的空元素 + MOBI 自己的翻页标记）。
 * `mbp:pagebreak` 也要：它常常写成 `<mbp:pagebreak>` 而不是 `<mbp:pagebreak/>`。
 */
const VOID_TAGS =
  'br|hr|img|image|meta|link|input|wbr|area|base|col|embed|source|track|param|mbp:pagebreak|mbp:filepos|mbp:flow'

const VOID_RE = new RegExp(`<(/?)(${VOID_TAGS})([^>]*)>`, 'gi')

/** 图片标签：`<img …>`（含 `<image …>`，老书里见过）。 */
const IMG_RE = /<(img|image)([^>]*)>/gi

export function prepareMobiHtml(html: string): string {
  const closed = html.replace(VOID_RE, (whole, closing: string, tag: string, rest: string) => {
    if (closing === '/' || rest.trimEnd().endsWith('/')) return whole
    return '<' + tag + rest + '/>'
  })

  return closed.replace(IMG_RE, (whole, tag: string, attrs: string) => {
    if (/\bsrc\s*=/i.test(attrs)) return whole
    // 老写法：recindex="00012"；KF8 偶尔写 src="kindle:embed:0012"
    const recindex =
      /recindex\s*=\s*["']?(\d+)/i.exec(attrs) ?? /kindle:embed:(\d+)/i.exec(attrs)
    if (!recindex) return whole
    const index = Number.parseInt(recindex[1] as string, 10)
    if (!Number.isFinite(index) || index <= 0) return whole
    return '<' + tag + ' src="' + RECINDEX_PREFIX + index + '"' + attrs + '>'
  })
}

/** `<mbp:pagebreak/>`（含被预处理成自闭合的形态）—— 章节边界。 */
const PAGE_BREAK_RE = /<mbp:pagebreak\b[^>]*>/gi

/**
 * 按翻页标记切「节」。
 * 没有翻页标记的书会得到只有一节的结果，交给上层退回「按标题切章 / 定长分段」。
 */
export function splitSections(html: string): string[] {
  return html
    .split(PAGE_BREAK_RE)
    .map((section) => section.trim())
    .filter((section) => section !== '')
}

/** `h1`..`h6` */
const HEADING_RE = /^h[1-6]$/

/**
 * 一节里第一个「像标题」的标签文本（按文档顺序取，`<h3>` 比后面的 `<h1>` 优先）。
 * 找不到给 null，上层再退回「第一段短文字」的规则。
 */
export function firstHeadingText(section: string): string | null {
  const root = parseXml(section)
  if (!root) return null
  let found: string | null = null
  const walk = (node: XmlNode): void => {
    if (found !== null) return
    if (HEADING_RE.test(localName(node.tag).toLowerCase())) {
      const text = textOfNode(node)
      if (text !== '') {
        found = text
        return
      }
    }
    for (const child of node.children) walk(child)
  }
  walk(root)
  return found
}

/** 节点内所有文本按文档顺序拼起来（`textOf` 会把空白压成一个空格，标题够用了）。 */
function textOfNode(node: XmlNode): string {
  let out = ''
  for (const child of node.nodes) out += typeof child === 'string' ? child : textOfNode(child)
  return out.replace(/\s+/g, ' ').trim()
}

/** 这一节里有多少条 `filepos` 链接 —— 多到一定数量就认定它是**目录页**。 */
export function countFileposLinks(section: string): number {
  return (section.match(/filepos\s*=/gi) ?? []).length
}
