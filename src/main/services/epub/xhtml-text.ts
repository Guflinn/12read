/**
 * XHTML → 纯文本（0.2.0 第 3 项）。
 *
 * 目标只有一个：把一章 XHTML 变成**与 TXT 管线完全同形状**的正文 ——
 * 「段落之间恰好一个 \n、没有空段、没有首尾空行」。做到这一点，下游
 * （段落渲染 / 进度锚点 / 书签划线 / 搜索 / 统计）就一个字都不用改。
 *
 * 真实书里见到的两种极端，这里都得吃得下：
 * - **老式表现型标记**（Mobi 转 EPUB 常见）：`<div><p height="1em" width="2em"
 *   align="justify"><font size="4"><b>第一章</b></font></p>` —— 排版属性全丢掉，只留文字
 * - **干净语义标记**（现代 EPUB 3）：`<h1>第一章</h1><p>正文…</p>` —— 只有块级标签有意义
 *
 * 图片按立项拍板走 U+FFFC 占位（BMP 内 1 个 code unit，不破坏 UTF-16 偏移体系）；
 * alt 文字若像人话就附在占位符后面，像文件名就丢掉。
 */
import { normalizePath } from './errors'
import { localName, parseXml, type XmlNode } from './xml'

/** 提取出来的图片：包内路径 + 占位符在文本里的偏移。 */
export interface ExtractedImage {
  /** 包内路径（已按 baseDir 归一化）；SVG 这类没有 src 的给空串。 */
  src: string
  /** U+FFFC 在 `text` 里的下标。 */
  offset: number
}

/** 带 id 的元素在文本里的落点：EPUB 的目录靠 `href#id` 定位到章（0.2.0 第 3 步）。 */
export interface ExtractedAnchor {
  id: string
  /** 该元素内容**开始处**在 `text` 里的下标。 */
  offset: number
}

export interface ExtractedText {
  /** 纯文本：段落之间一个 \n，无空段。 */
  text: string
  images: ExtractedImage[]
  /** 带 id 的元素的落点，给目录的 `#片段` 用。 */
  anchors: ExtractedAnchor[]
}

/** 图片占位符：Unicode 对象替换字符。 */
export const IMAGE_PLACEHOLDER = '\uFFFC'

/** 整棵子树都丢掉：脚本样式、文档头，以及日文注音（rt 是重复内容，读了反而乱）。 */
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'rt', 'rp', 'noscript', 'template'])

/** 块级：自带断行，落下就把当前段落收掉。 */
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote', 'section',
  'article', 'aside', 'figure', 'figcaption', 'dt', 'dd', 'pre', 'table', 'ul', 'ol',
  'header', 'footer', 'nav', 'center', 'address', 'form', 'fieldset', 'legend', 'caption',
  'tbody', 'thead', 'tfoot', 'dl', 'main', 'details', 'summary'
])

/** alt 像文件名就别当正文（`image1.jpg` / `图1` / `IMG_0123` 这类不是给人读的）。 */
function isNoisyAlt(alt: string): boolean {
  const value = alt.trim()
  if (value === '') return true
  if (/\.(jpe?g|png|gif|svg|webp|bmp)$/i.test(value)) return true
  if (/^(img|image|photo|pic|illustration|cover)[\s_-]*\d*$/i.test(value)) return true
  // 中文书里常见「图1」「插图2」「图片」这种，也是给机器看的
  if (/^(图|圖|插图|插圖|图片|圖片|封面)[\s_-]*\d*$/.test(value)) return true
  if (/^[\d\s._-]+$/.test(value)) return true
  return false
}

/**
 * 提取一章的正文。
 * `baseDir` 是这一章 XHTML 在包内的目录，用来把相对的 `img@src` 归一化成包内路径。
 */
export function extractXhtmlText(xhtml: string, baseDir: string): ExtractedText {
  const root = parseXml(xhtml)
  if (!root) return { text: '', images: [], anchors: [] }

  const paragraphs: string[] = []
  const images: ExtractedImage[] = []
  const anchors: ExtractedAnchor[] = []
  /** 当前正在处理的元素上挂着的 id（收段时换算成全局偏移）。 */
  let pendingIds: string[] = []
  /** 当前段落累积的文字。 */
  let buffer = ''
  /** 当前段落里已出现的图片（记录占位符在 buffer 中的下标，收段时再换算成全局偏移）。 */
  let pending: Array<{ src: string; inBuffer: number }> = []
  /** 已经拼进最终文本的长度（含段落间的 \n）。 */
  let emitted = 0

  const pushChar = (char: string): void => {
    // 连续空白压成一个空格；零宽字符直接丢
    if (char === '\u200b' || char === '\ufeff') return
    const isSpace = char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\u00a0'
    if (isSpace) {
      if (buffer === '' || buffer.endsWith(' ')) return
      buffer += ' '
      return
    }
    buffer += char
  }

  const flush = (): void => {
    const raw = buffer
    buffer = ''
    const pendingHere = pending
    const idsHere = pendingIds
    pending = []
    pendingIds = []

    const trimmed = raw.trim()
    if (trimmed === '') {
      // 空段落里的 id 也算落点：读者跳到那儿就是这一段的开头
      for (const id of idsHere) anchors.push({ id, offset: emitted })
      return
    }
    const lead = raw.length - raw.trimStart().length

    if (paragraphs.length > 0) emitted += 1 // 段落之间的 \n
    const paragraphStart = emitted
    for (const image of pendingHere) {
      const at = image.inBuffer - lead
      if (at >= 0 && at < trimmed.length) {
        images.push({ src: image.src, offset: paragraphStart + at })
      }
    }
    for (const id of idsHere) anchors.push({ id, offset: paragraphStart })
    paragraphs.push(trimmed)
    emitted += trimmed.length
  }

  const visit = (node: XmlNode): void => {
    const tag = node.tag.toLowerCase()
    const local = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag
    if (SKIP_TAGS.has(local)) return

    if (local === 'img' || local === 'image') {
      const src = node.attrs['src'] ?? node.attrs['xlink:href'] ?? ''
      pushChar(IMAGE_PLACEHOLDER)
      pending.push({ src: src === '' ? '' : normalizePath(baseDir, src), inBuffer: buffer.length - 1 })
      const alt = node.attrs['alt'] ?? ''
      if (!isNoisyAlt(alt)) {
        for (const char of '（' + alt.trim() + '）') pushChar(char)
      }
      return
    }

    if (local === 'svg') {
      // SVG 整块当一个图（免得把路径数据当正文读进来），但**要把里面的图片引用捞出来**：
      // EPUB 的封面标准写法就是 `<svg><image xlink:href="封面.jpg"/></svg>`，
      // 只当一个空占位的话封面就整张丢了（真书实测：书名页的封面图就是这么没的）。
      const ref = findImageRef(node)
      pushChar(IMAGE_PLACEHOLDER)
      pending.push({
        src: ref === '' ? '' : normalizePath(baseDir, ref),
        inBuffer: buffer.length - 1
      })
      return
    }

    if (local === 'br') {
      flush()
      return
    }
    if (local === 'hr') return

    // 带 id 的元素：它内容开始的位置就是目录 `#片段` 的落点
    const id = node.attrs['id']
    if (id !== undefined && id !== '') pendingIds.push(id)

    // **必须按 nodes 的文档顺序走**：节点自己的文字可能夹在子元素中间（`甲<span>乙</span>丙`）
    for (const child of node.nodes) {
      if (typeof child === 'string') {
        for (const char of child) pushChar(char)
      } else {
        visit(child)
      }
    }

    if (BLOCK_TAGS.has(local)) flush()
  }

  visit(root)
  flush()

  return { text: paragraphs.join('\n'), images, anchors }
}

/** 在 SVG 子树里找 `<image>` 的实际引用（`xlink:href` 或 `href`），没有就返回空串。 */
function findImageRef(node: XmlNode): string {
  for (const child of node.nodes) {
    if (typeof child === 'string') continue
    if (localName(child.tag).toLowerCase() === 'image') {
      const ref = child.attrs['xlink:href'] ?? child.attrs['href'] ?? ''
      if (ref !== '') return ref
    }
    const deeper = findImageRef(child)
    if (deeper !== '') return deeper
  }
  return ''
}
