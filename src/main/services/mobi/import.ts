/**
 * MOBI 导入（0.3.0）：PalmDB → PalmDOC 解压 → HTML 分节 → 正文 + 章节 + 图片清单。
 *
 * 这是「提取器」这一层的第二个实现。接口与 EPUB 那一个完全同形
 * （`(bytes) => { text, chapters, images, blobs, title, author }`），
 * 所以下游（进度 / 书签 / 划线 / 搜索 / 统计 / 图片协议）一行都不用改。
 *
 * 能力边界（**有意为之，写在最显眼的地方**）：
 * - 只做 **MOBI6 / KF7**（file version ≤ 6）。KF8（AZW3）正文被切成碎片、要靠索引记录重组，
 *   不是这一层的活儿，遇到直接给一句人话让人去转换；
 * - 只解 **无压缩 / PalmDOC** 两种。**Huff/CDic 压缩（compression = 17480）暂不支持** ——
 *   那要再写一套 Huffman + CDIC 词典解压，等真碰上这种书再评估；
 * - 带 DRM 的书打不开，也不打算打开。
 */
import { CHAPTER_LINE_MAX_CHARS, splitChapters } from '@shared/core/chapter-split'
import type { CharOffset, Encoding } from '@shared/types'
import { extractXhtmlText, type ExtractedImage } from '../epub/xhtml-text'
import { MobiError } from './errors'
import {
  COMPRESSION_HUFF,
  COMPRESSION_NONE,
  COMPRESSION_PALMDOC,
  EXTH_AUTHOR,
  EXTH_COVER_OFFSET,
  EXTH_TITLE,
  decodeBytes,
  exthNumber,
  exthText,
  parseExth,
  readMobiHeader,
  readPalmDocHeader,
  type MobiHeader,
  type PalmDocHeader
} from './header'
import { countFileposLinks, firstHeadingText, prepareMobiHtml, recindexOf, splitSections } from './html'
import { inflatePalmDoc } from './palmdoc'
import { parsePalmDb } from './palmdb'

/** 一章超过这么多字就退回按标题切 / 定长分段（与 EPUB 那一层同一条阈值）。 */
export const HUGE_CHAPTER_CHARS = 50_000

/** 章节标题最多多少字才算「像标题」；超了就当正文。 */
const HEADING_MAX_CHARS = 40

export interface MobiChapter {
  title: string
  startOffset: number
  charLength: number
  kind: 'chapter' | 'segment'
}

export interface MobiImportResult {
  text: string
  chapters: MobiChapter[]
  images: Array<{ offset: CharOffset; file: string; source: string }>
  blobs: Map<string, Buffer>
  title: string | null
  author: string | null
  encoding: Encoding
}

/** 解析整本 MOBI。读不了时抛 MobiError（中文文案，直接给用户看）。 */
export function decodeMobi(bytes: Buffer): MobiImportResult {
  const db = parsePalmDb(bytes)
  const palm = readPalmDocHeader(db.records[0] as Buffer)
  const header = readMobiHeader(db.records[0] as Buffer)

  assertReadable(palm, header)

  const raw = assembleText(db.records, palm, header)
  const encoding: Encoding = header.textEncoding === 65001 ? 'utf-8' : 'unknown'
  const html = decodeBytes(raw, header.textEncoding)

  const exth = parseExth(db.records[0] as Buffer, header)
  const title = exthText(exth, EXTH_TITLE, header.textEncoding) ?? header.fullName
  const author = exthText(exth, EXTH_AUTHOR, header.textEncoding)

  const content = buildContent(html, title)
  // 全是图片的书（漫画那种）不算「读得了」：正文里只剩占位符，读起来一片空白
  if (content.text.replace(/\uFFFC/g, '').trim() === '') {
    throw new MobiError('这本 MOBI 里提取不到文字，可能是纯图片的书')
  }

  const { images, blobs } = collectImages(content.images, db.records, header, exth)

  return {
    text: content.text,
    chapters: content.chapters,
    images,
    blobs,
    title,
    author,
    encoding
  }
}

/** 不支持的变体在这里一次性拦掉，文案写到用户看得懂。 */
function assertReadable(palm: PalmDocHeader, header: MobiHeader): void {
  if (palm.encryption !== 0) {
    throw new MobiError('这本书有版权保护（DRM），打不开')
  }
  if (header.version >= 8 || header.mobiType === 248) {
    throw new MobiError(
      '这是 KF8（AZW3）格式的电子书，现在读不了',
      '用 Calibre 之类的工具转成 EPUB 或 MOBI6 再导入即可'
    )
  }
  if (palm.compression === COMPRESSION_HUFF) {
    throw new MobiError(
      '这本 MOBI 用了 Huff/CDic 压缩，现在读不了',
      '用 Calibre 之类的工具转成 EPUB 再导入即可'
    )
  }
  if (palm.compression !== COMPRESSION_NONE && palm.compression !== COMPRESSION_PALMDOC) {
    throw new MobiError('这本 MOBI 的压缩方式认不出来（' + palm.compression + '），打不开')
  }
}

/**
 * 正文记录 → 未解压的整块字节流。
 *
 * **每块尾部可能挂着附加数据**（多字节补字、索引项，由 MOBI 头的 extraDataFlags 标记）。
 * 这里不去逐位解析那份变长编码（各家写法太野），而是用两个更硬的约束把它切掉：
 *   ① 每块的正文不会超过 PalmDOC 头里的 recordSize（常见 4096）；
 *   ② 全书正文总长就是 textLength。
 * 拿这两条一卡，附加数据自然被排除在外 —— 真书（白夜行 96 万字 / 235 块）实测长度分毫不差。
 * 编码相关的多字节残字不用特殊处理：块是按**字节**切的，拼起来分半的汉字自己就合上了。
 */
export function assembleText(records: Buffer[], palm: PalmDocHeader, header: MobiHeader): Buffer {
  const chunks: Buffer[] = []
  let remaining = palm.textLength > 0 ? palm.textLength : Number.POSITIVE_INFINITY

  for (let index = 0; index < palm.recordCount && remaining > 0; index += 1) {
    const record = records[index + 1]
    if (record === undefined) break
    const decoded = palm.compression === COMPRESSION_NONE ? record : inflatePalmDoc(record)
    let take = decoded.length
    if (palm.recordSize > 0 && take > palm.recordSize) {
      if (header.extraDataFlags === 0) {
        // 没有附加数据标志却超长：宁可整块留着，也别腰斩真正的正文
        take = decoded.length
      } else {
        take = palm.recordSize
      }
    }
    if (take > remaining) take = remaining
    chunks.push(decoded.subarray(0, take))
    remaining -= take
  }

  return Buffer.concat(chunks)
}

interface MobiPart {
  text: string
  images: ExtractedImage[]
}

interface MobiContent {
  text: string
  chapters: MobiChapter[]
  /** 图片占位：偏移**已换算成全书坐标**（提取时是节内坐标，拼正文时必须平移）。 */
  images: ExtractedImage[]
}

/** 分节 → 连续正文 + 章节表（章节表无缝覆盖正文，阅读器按 slice 取章）。 */
function buildContent(html: string, bookTitle: string | null): MobiContent {
  const sections = splitSections(prepareMobiHtml(html))
  const parts: MobiPart[] = sections.map((section) => extractXhtmlText(section, ''))

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

  const nonEmpty = parts
    .map((part, index) => ({ part, index }))
    .filter((entry) => entry.part.text !== '')

  const chapters =
    nonEmpty.length > 1
      ? oneChapterPerSection(nonEmpty, starts, text, sections, bookTitle)
      : wholeBookChapters(text)

  return { text, chapters, images }
}

/** 每节一章：节与节之间的 `\n` 归给前一章，保证章节表无缝覆盖。 */
function oneChapterPerSection(
  nonEmpty: Array<{ part: MobiPart; index: number }>,
  starts: number[],
  text: string,
  sections: string[],
  bookTitle: string | null
): MobiChapter[] {
  const total = text.length
  const chapters: MobiChapter[] = []

  nonEmpty.forEach((entry, order) => {
    const start = starts[entry.index] ?? 0
    const next = nonEmpty[order + 1]
    const end = next ? (starts[next.index] ?? total) : total
    const length = end - start
    if (length <= 0) return
    chapters.push({
      title: titleOfSection(
        sections[entry.index] ?? '',
        entry.part.text,
        order,
        bookTitle
      ),
      startOffset: start,
      charLength: length,
      kind: 'chapter'
    })
  })

  return splitHugeChapters(chapters, text)
}

/** 整本只有一节（没有翻页标记的书）：退回 TXT 那套切章规则。 */
function wholeBookChapters(text: string): MobiChapter[] {
  if (text.length === 0) return []
  const split = splitChapters(text)
  if (split.chapters.length <= 1) {
    return [{ title: '正文', startOffset: 0, charLength: text.length, kind: 'chapter' }]
  }
  return split.chapters.map((chapter) => ({
    title: chapter.title,
    startOffset: chapter.startOffset,
    charLength: chapter.charLength,
    kind: chapter.kind
  }))
}

/** 超长节（「整本一节」那种坏例子）再用 TXT 的切章规则切一遍，偏移平移回全书坐标。 */
function splitHugeChapters(chapters: MobiChapter[], text: string): MobiChapter[] {
  if (!chapters.some((chapter) => chapter.charLength > HUGE_CHAPTER_CHARS)) return chapters
  const out: MobiChapter[] = []
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
        startOffset: chapter.startOffset + inner.startOffset,
        charLength: inner.charLength,
        kind: inner.kind
      })
    }
  }
  return out
}

/**
 * 一节叫什么。
 * 优先标题标签；其次「第一段很短的话」（老书常把章名写成 `<p><b>第一章</b></p>`）；
 * 目录页按链接数量认出来；首页标题等于书名时叫「封面」（否则目录里会有一条与书同名的怪项）。
 */
function titleOfSection(
  section: string,
  partText: string,
  order: number,
  bookTitle: string | null
): string {
  if (countFileposLinks(section) >= 3) return '目录'

  const heading = firstHeadingText(section)
  if (heading !== null && heading.length <= HEADING_MAX_CHARS) {
    if (order === 0 && bookTitle !== null && stripSpaces(heading) === stripSpaces(bookTitle)) {
      return '封面'
    }
    return heading
  }

  const firstLine = stripPlaceholders(partText.split('\n')[0] ?? '').trim()
  if (firstLine !== '' && firstLine.length <= CHAPTER_LINE_MAX_CHARS) return firstLine
  // 整节只有图片（书名页、插图页）：别把占位符 U+FFFC 当成章名
  if (stripPlaceholders(partText).trim() === '') return order === 0 ? '封面' : '插图'
  return '第 ' + (order + 1) + ' 节'
}

/** 去掉图片占位符 —— 判断「这一节有没有文字」时要把它排除掉。 */
function stripPlaceholders(value: string): string {
  return value.replace(/\uFFFC/g, ' ')
}

function stripSpaces(value: string): string {
  return value.replace(/[\s\u00a0\u3000]+/g, '')
}

/**
 * 图片落盘清单。
 * - 正文里的 `@recindex:N` → 第 `firstImageIndex + N - 1` 条记录（真书实测对得上：封面就是 N=1）；
 * - EXTH 201 给的是封面在图片记录里的**下标**（0 起算）；
 * - 记录里混着索引/FLIS/FCIS 这类非图片数据，所以**按 magic 字节认图**，认不出就当没有。
 */
function collectImages(
  extracted: ExtractedImage[],
  records: Buffer[],
  header: MobiHeader,
  exth: Map<number, Buffer[]>
): { images: MobiImportResult['images']; blobs: Map<string, Buffer> } {
  const blobs = new Map<string, Buffer>()
  const images: MobiImportResult['images'] = []
  const byRecindex = new Map<number, string>()
  let serial = 0

  const readImageRecord = (recordIndex: number): { ext: string; data: Buffer } | null => {
    if (recordIndex < 0 || recordIndex >= records.length) return null
    const data = records[recordIndex] as Buffer
    const ext = imageExtension(data)
    return ext === null ? null : { ext, data }
  }

  for (const image of extracted) {
    const recindex = recindexOf(image.src)
    if (recindex === null) continue
    let file = byRecindex.get(recindex)
    if (file === undefined) {
      const found = readImageRecord(header.firstImageIndex + recindex - 1)
      if (found === null) continue
      serial += 1
      file = String(serial).padStart(4, '0') + '.' + found.ext
      byRecindex.set(recindex, file)
      blobs.set(file, found.data)
    }
    images.push({ offset: image.offset, file, source: image.src })
  }

  const coverOffset = exthNumber(exth, EXTH_COVER_OFFSET)
  if (coverOffset !== null) {
    const found = readImageRecord(header.firstImageIndex + coverOffset)
    if (found !== null) blobs.set('cover.' + found.ext, found.data)
  }

  return { images, blobs }
}

/** 按 magic 字节认图片；认不出给 null（索引记录、FLIS/FCIS/SRCS 这些都会走到这条）。 */
function imageExtension(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg'
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return 'png'
  if (data.length >= 6 && data.subarray(0, 3).toString('latin1') === 'GIF') return 'gif'
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) return 'bmp'
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}
