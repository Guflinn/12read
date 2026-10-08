/**
 * 章节定位（0.2.0 第 3 步）：把目录映射成「章节表 + 连续正文」，形状与 TXT 管线一致
 * （章节表精确切分正文，`text.slice(start, start + charLength)` 就是那一章）。
 *
 * 真实书的两种形态都要吃下（两本真书实测）：
 * - **一个文件一章**（《莫言作品全集》：820 个 xhtml）→ 目录指向文件，落点直接用文件起点
 * - **一个文件里塞十几章**（《多情剑客无情剑》：9 个文件 90 章）→ 目录多条指向同一文件，
 *   且 href **不带 #片段**，只能靠**标题文字在正文里找位置**
 *
 * 目录层级规则（拿真书定的）：取到第 2 层，并过滤「一 / 二 / 三」这类页码式项。
 * 依据：《莫言》那本目录深度 4，顶层 18 条 = 18 册（太粗，每章一整本小说），
 * 最深一层是页码；《多情剑客》那本是平的 90 条（新规则下仍是 90 章，不受影响）。
 */
import { CHAPTER_LINE_MAX_CHARS, splitChapters } from '@shared/core/chapter-split'
import { dirOf } from './errors'
import type { OpfPackage } from './opf'
import { parseToc } from './toc'
import { extractXhtmlText, type ExtractedImage } from './xhtml-text'

export interface EpubChapter {
  title: string
  /**
   * 所属的「卷 / 册」名（合集类 EPUB 才有，0.2.0）。
   * 目录顶层就是卷名、第二层才是各卷的章 —— 把卷名单独带出来，
   * 读者才能在目录里看出「这一段属于哪本书」。
   */
  groupTitle: string | null
  /**
   * 直接父级的标题（0.2.0）：合集里「册 → 章 → 节」三级目录，
   * 节这一层的 parentTitle 是它所属的章名；章这一层的 parentTitle 等于 groupTitle。
   * 目录据此把「节」缩进画在「章」下面。
   */
  parentTitle: string | null
  startOffset: number
  charLength: number
  kind: 'chapter' | 'segment'
}

export interface EpubContent {
  /** 全书连续正文：段落之间一个 \n（与 TXT 管线同形状）。 */
  text: string
  chapters: EpubChapter[]
  /** 图片占位（偏移已换算成全书坐标）。 */
  images: ExtractedImage[]
}

/**
 * 目录取到第几层。
 * 3 = 册 → 章 → 节。用户 2026-10-08 明确要求「像 iPhone 自带图书一样细」：
 * 《红高粱》里那些「一 / 二 / 三」不是页码、是**小节**，所以第 3 层要留下。
 */
export const TOC_MAX_DEPTH = 3
/** 单章超过这么多字就退回 TXT 的切章/分段规则（「整本一个文件」的坏例子）。 */
export const HUGE_CHAPTER_CHARS = 50_000

interface SpinePart {
  text: string
  images: ExtractedImage[]
  anchors: Array<{ id: string; offset: number }>
}

/**
 * 把整本 EPUB 提取成「连续正文 + 章节表」。
 * `read(href)` 由调用方提供（ZIP 里取文本），这样这一层不依赖 zip，便于单测。
 */
export function buildEpubContent(
  opf: OpfPackage,
  read: (href: string) => string | null
): EpubContent {
  const parts: SpinePart[] = opf.spine.map((item) => {
    const source = read(item.href)
    if (source === null) return { text: '', images: [], anchors: [] }
    return extractXhtmlText(source, dirOf(item.href))
  })

  // 拼连续正文：非空部分之间补一个 \n，保证相邻两章的段落不会粘成一段
  let text = ''
  const starts: number[] = []
  const images: ExtractedImage[] = []
  parts.forEach((part, index) => {
    if (part.text === '') {
      starts[index] = text.length
      return
    }
    if (text !== '') text += '\n'
    starts[index] = text.length
    for (const image of part.images) {
      images.push({ src: image.src, offset: text.length + image.offset })
    }
    text += part.text
  })

  const spineIndexOf = spinePathIndex(opf)
  const marks = locateFromToc(opf, parts, starts, read, spineIndexOf)
  const chapters =
    marks.length > 0 ? toChapters(marks, text) : fallbackChapters(parts, starts, text)

  return { text, chapters, images }
}

/**
 * 全书标题索引：把每个文件里「像标题的短段落」（去空白后 ≤ 60 字）登记成
 * `标题 → [{ 文件下标, 章内偏移 }]`。
 *
 * 为什么要全局索引：真书实测（《多情剑客无情剑》）里目录的**文件映射本身是错的** ——
 * 第五～七章被指向下一个文件，而正文里它们在当前文件。只按目录给的文件找，就会整章丢掉
 * （90 章只剩 53 章）。标题文字比文件路径可靠，所以先按目录的文件找，找不到再全局捞。
 */
const HEADING_MAX_CHARS = 60

function buildHeadingIndex(parts: SpinePart[]): Map<string, Array<{ spine: number; offset: number }>> {
  const index = new Map<string, Array<{ spine: number; offset: number }>>()
  parts.forEach((part, spine) => {
    if (part.text === '') return
    let at = 0
    for (const paragraph of part.text.split('\n')) {
      const key = stripSpaces(paragraph)
      if (key !== '' && key.length <= HEADING_MAX_CHARS) {
        const list = index.get(key)
        if (list) list.push({ spine, offset: at })
        else index.set(key, [{ spine, offset: at }])
      }
      at += paragraph.length + 1
    }
  })
  return index
}

/** 把目录项落到「全书第几个字」。 */
function locateFromToc(
  opf: OpfPackage,
  parts: SpinePart[],
  starts: number[],
  read: (href: string) => string | null,
  spineIndexOf: Map<string, number>
): Array<{
  title: string
  groupTitle: string | null
  parentTitle: string | null
  offset: number
}> {
  const entries = parseToc(opf, read).filter((entry) => entry.depth <= TOC_MAX_DEPTH)

  const headings = buildHeadingIndex(parts)
  const marks: Array<{
    title: string
    groupTitle: string | null
    parentTitle: string | null
    offset: number
  }> = []

  /**
   * 哪些顶层条目算「卷」：**只有下面还挂着子项的那些**。
   * 不然一本目录本来就平的书（普通小说，全是一级章），会被当成「每章自成一本书」，
   * 章节表里凭空多出一堆组名。
   */
  const groupingTitles = new Set<string>()
  {
    let top: string | null = null
    for (const entry of entries) {
      if (entry.depth === 1) top = entry.title
      else if (entry.depth === 2 && top !== null) groupingTitles.add(top)
    }
  }

  /** 当前所属的卷名：目录按文档顺序给，遇到顶层就换卷（不是卷的顶层给 null）。 */
  let group: string | null = null
  /** 按层级记最近一次出现的标题：`ancestors[2]` 就是当前所在的章名。 */
  const ancestors = new Map<number, string>()

  for (const entry of entries) {
    if (entry.depth === 1) group = groupingTitles.has(entry.title) ? entry.title : null
    const own = entry.depth === 1 ? group : group
    // 父级 = 上一层最近出现的那个标题（册的父级是它自己，方便统一处理）
    const parent = entry.depth <= 1 ? own : (ancestors.get(entry.depth - 1) ?? own)
    ancestors.set(entry.depth, entry.title)
    for (const depth of [...ancestors.keys()]) {
      if (depth > entry.depth) ancestors.delete(depth)
    }
    const index = spineIndexOf.get(entry.path) ?? lookupByBaseName(spineIndexOf, entry.path)
    const part = index === undefined ? undefined : parts[index]
    const start = index === undefined ? undefined : starts[index]

    // 1) 目录指定的文件里：先按 #片段（EPUB 3 常见），再按标题文字
    if (part && start !== undefined) {
      const anchored =
        entry.fragment === ''
          ? null
          : (part.anchors.find((anchor) => anchor.id === entry.fragment)?.offset ?? null)
      const within = anchored ?? locateByTitle(part.text, entry.title)
      if (within !== null) {
        marks.push({ title: entry.title, groupTitle: own, parentTitle: parent, offset: start + within })
        continue
      }
      // 标题在正文里找不到，但这一页本身没有文字（封面 / 纯插图页）：
      // 落点定在文件开头，别把这一页整条丢掉（真书实测：每卷的「封面」就是这么丢的）。
      if (isBlankText(part.text)) {
        marks.push({ title: entry.title, groupTitle: own, parentTitle: parent, offset: start })
        continue
      }
    }

    // 2) 全局标题索引兜底（目录的文件映射不可靠时救回来）：优先取「不早于该文件」的那次出现
    const wanted = stripSpaces(entry.title)
    const hits = headings.get(wanted)
    if (!hits || hits.length === 0) continue
    const forward = index === undefined ? undefined : hits.find((hit) => hit.spine >= index)
    const hit = forward ?? hits[0]
    const hitStart = starts[hit.spine]
    if (hitStart === undefined) continue
    marks.push({
      title: entry.title,
      groupTitle: own,
      parentTitle: parent,
      offset: hitStart + hit.offset
    })
  }
  return marks
}

/** 这一页有没有「文字」：只有空白与图片占位符就算没有（封面、纯插图页）。 */
function isBlankText(text: string): boolean {
  return text.replace(/\uFFFC/g, '').trim() === ''
}

/** 在章内按标题文字找落点：段落文字与目录标题**去掉所有空白**后比较（全角空格/换行写法不一）。 */
function locateByTitle(text: string, title: string): number | null {
  const wanted = stripSpaces(title)
  if (wanted === '') return null

  let at = 0
  let exact: number | null = null
  let loose: number | null = null
  for (const paragraph of text.split('\n')) {
    if (exact === null && stripSpaces(paragraph) === wanted) exact = at
    if (loose === null && stripSpaces(paragraph).includes(wanted)) loose = at
    at += paragraph.length + 1
  }
  return exact ?? loose
}

function stripSpaces(value: string): string {
  return value.replace(/[\s\u00a0\u3000]+/g, '')
}

/** 路径 → spine 下标（含 basename 兜底，见 lookupByBaseName）。 */
function spinePathIndex(opf: OpfPackage): Map<string, number> {
  const map = new Map<string, number>()
  opf.spine.forEach((item, index) => {
    if (!map.has(item.href)) map.set(item.href, index)
  })
  return map
}

/** 目录里的路径与 OPF 里的写法可能差一层（大小写、`./`），拿 basename 再试一次。 */
function lookupByBaseName(map: Map<string, number>, path: string): number | undefined {
  const base = baseName(path).toLowerCase()
  if (base === '') return undefined
  for (const [key, index] of map) {
    if (baseName(key).toLowerCase() === base) return index
  }
  return undefined
}

function baseName(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? path : path.slice(at + 1)
}

/** 落点排序、同落点去重（保留更具体的那条），再算每章长度；开头有内容就补「开篇」。 */
function toChapters(
  marks: Array<{ title: string; groupTitle: string | null; parentTitle: string | null; offset: number }>,
  text: string
): EpubChapter[] {
  const total = text.length
  const sorted = marks
    .filter((mark) => mark.offset >= 0 && mark.offset < total)
    .slice()
    .sort((left, right) => left.offset - right.offset)
  const deduped: Array<{
    title: string
    groupTitle: string | null
    parentTitle: string | null
    offset: number
  }> = []
  for (const mark of sorted) {
    const last = deduped[deduped.length - 1]
    if (last && last.offset === mark.offset) deduped[deduped.length - 1] = mark
    else deduped.push(mark)
  }

  const chapters: EpubChapter[] = []
  const first = deduped[0]
  if (!first || first.offset > 0) {
    const end = first ? first.offset : total
    if (end > 0) {
      // 开头这一页：EPUB 合集里它通常就是**整本书的封面**（只有一张图），
      // 叫「开篇」会让人以为里面有内容（用户 2026-10-08 的反馈）；
      // 真有文字的（TXT 的序言之类）才叫「开篇」。
      chapters.push({
        title: isBlankText(text.slice(0, end)) ? '封面' : '开篇',
        groupTitle: null,
        parentTitle: null,
        startOffset: 0,
        charLength: end,
        kind: 'segment'
      })
    }
  }
  deduped.forEach((mark, index) => {
    const next = deduped[index + 1]
    const length = (next ? next.offset : total) - mark.offset
    if (length <= 0) return
    chapters.push({
      title: mark.title,
      groupTitle: mark.groupTitle,
      parentTitle: mark.parentTitle,
      startOffset: mark.offset,
      charLength: length,
      kind: 'chapter'
    })
  })
  return chapters
}

/**
 * 没有目录（或一条都对不上）时的兜底：一个 spine 文件一章；文件里第一行短就当章名，
 * 太长就「第 N 节」；单章还是太大就交给 TXT 那套切章规则（立项定的退路）。
 */
function fallbackChapters(parts: SpinePart[], starts: number[], text: string): EpubChapter[] {
  const total = text.length
  const chapters: EpubChapter[] = []
  // 章长一律延伸到下一个非空文件的起点：这样文件之间的 \n 分隔符被吸收掉，
  // 章节表才能「无缝覆盖整段正文」（阅读器按 slice 取章，缝隙就是丢字）。
  const nonEmpty = parts
    .map((part, index) => ({ part, index }))
    .filter((entry) => entry.part.text !== '')

  nonEmpty.forEach((entry, order) => {
    const start = starts[entry.index] ?? 0
    const next = nonEmpty[order + 1]
    const end = next ? (starts[next.index] ?? total) : total
    const length = end - start
    if (length <= 0) return
    const firstLine = (entry.part.text.split('\n')[0] ?? '').trim()
    const title =
      firstLine !== '' && firstLine.length <= CHAPTER_LINE_MAX_CHARS
        ? firstLine
        : '第 ' + (order + 1) + ' 节'
    chapters.push({
      title,
      groupTitle: null,
      parentTitle: null,
      startOffset: start,
      charLength: length,
      kind: 'chapter'
    })
  })
  if (chapters.length === 0 && total > 0) {
    chapters.push({
      title: '正文',
      groupTitle: null,
      parentTitle: null,
      startOffset: 0,
      charLength: total,
      kind: 'chapter'
    })
  }
  return splitHugeChapters(chapters, text)
}

/**
 * 超长章（「整本一个 XHTML」那种坏例子）退回 TXT 的切章规则：
 * `splitChapters` 先试章节标题正则，不中就给 3–5k 的定长分段；偏移按章起点平移回全书坐标。
 */
function splitHugeChapters(chapters: EpubChapter[], text: string): EpubChapter[] {
  if (!chapters.some((chapter) => chapter.charLength > HUGE_CHAPTER_CHARS)) return chapters
  const out: EpubChapter[] = []
  for (const chapter of chapters) {
    if (chapter.charLength <= HUGE_CHAPTER_CHARS) {
      out.push(chapter)
      continue
    }
    const slice = text.slice(chapter.startOffset, chapter.startOffset + chapter.charLength)
    const split = splitChapters(slice)
    if (split.chapters.length <= 1) {
      out.push(chapter)
      continue
    }
    for (const inner of split.chapters) {
      out.push({
        title: inner.title,
        groupTitle: chapter.groupTitle,
        parentTitle: chapter.parentTitle,
        startOffset: chapter.startOffset + inner.startOffset,
        charLength: inner.charLength,
        kind: inner.kind
      })
    }
  }
  return out
}
