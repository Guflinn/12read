/**
 * EPUB 导入（0.2.0 第 4 项）：ZIP → 容器 → OPF → 正文提取 + 章节定位 + 图片清单。
 *
 * 这是「提取器」这一层的第一个实现，顺带把接口形状定死（路线图要求）：
 *   `(bytes) => { text, chapters, images, title, author }`
 * 后面的 MOBI / MD / PDF 照着填即可 —— 它们的差别只在「怎么解出正文与章节」，
 * 下游（进度 / 书签 / 划线 / 搜索 / 统计）统统只认连续正文 + 章节表 + UTF-16 偏移。
 */
import { EpubError } from './errors'
import { buildEpubContent, type EpubChapter } from './chapters'
import { findOpfPath } from './ocf'
import { parseOpf } from './opf'
import { openZip } from './zip-reader'

/** 一张图片在正文里的落点与落盘文件名。 */
export interface EpubImage {
  /** U+FFFC 占位符在正文里的偏移。 */
  offset: number
  /** 落盘文件名（`images/` 下），按出现顺序编号去重。 */
  file: string
  /** 它在包内的原始路径（排查用）。 */
  source: string
}

export interface EpubImportResult {
  text: string
  chapters: EpubChapter[]
  images: EpubImage[]
  /** 要落盘的图片字节，键与 `EpubImage.file` 对应。 */
  blobs: Map<string, Buffer>
  title: string | null
  author: string | null
}

/** 认得的图片后缀；认不出的存成 .bin（浏览器靠内容判断，读不出来就不显示）。 */
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'])
/** 封面用的文件名（放在 images/ 里，与正文图片的顺序编号不冲突）。 */
export const COVER_BASENAME = 'cover'

/** 解析整本 EPUB。解析不了时抛 EpubError（中文文案，直接给用户看）。 */
export function decodeEpub(bytes: Buffer): EpubImportResult {
  const zip = openZip(bytes)
  const opfPath = findOpfPath(zip)
  const opf = parseOpf(zip.readText(opfPath) ?? '', opfPath)
  if (opf.spine.length === 0) {
    throw new EpubError('这个 EPUB 里没有可读的正文（spine 是空的），文件可能不完整')
  }

  const content = buildEpubContent(opf, (href) => zip.readText(href))
  if (content.text.trim() === '') {
    throw new EpubError('这个 EPUB 里提取不到文字（可能是纯图片的漫画书）')
  }

  // 图片：按正文顺序编号 + 同一源文件只落一次
  const bySource = new Map<string, string>()
  const blobs = new Map<string, Buffer>()
  const images: EpubImage[] = []
  let serial = 0
  for (const image of content.images) {
    if (image.src === '') continue
    if (image.offset >= content.text.length) continue
    let file = bySource.get(image.src)
    if (file === undefined) {
      const data = zip.read(image.src)
      if (data === null) continue
      serial += 1
      file = String(serial).padStart(4, '0') + '.' + extensionOf(image.src)
      bySource.set(image.src, file)
      blobs.set(file, data)
    }
    images.push({ offset: image.offset, file, source: image.src })
  }

  // 封面：单独存一份 images/cover.<ext>，书架卡片直接用它（正文里的占位不变）
  const coverExt = coverExtension(opf.coverPath)
  if (opf.coverPath !== null && coverExt !== null) {
    const data = zip.read(opf.coverPath)
    if (data !== null) blobs.set('cover.' + coverExt, data)
  }

  return {
    text: content.text,
    chapters: content.chapters,
    images,
    blobs,
    title: opf.title,
    author: opf.author
  }
}

/** 封面文件的后缀（认不出就给 null，宁可不放封面也别写个坏文件）。 */
function coverExtension(path: string | null): string | null {
  if (path === null) return null
  const ext = extensionOf(path)
  return ext === 'bin' ? null : ext
}

function extensionOf(path: string): string {
  const at = path.lastIndexOf('.')
  const ext = at < 0 ? '' : path.slice(at + 1).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext) ? ext : 'bin'
}
