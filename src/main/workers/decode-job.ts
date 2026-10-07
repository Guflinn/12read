import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { splitChapters } from '@shared/core/chapter-split'
import type {
  BookFormat,
  ChapterKind,
  CharOffset,
  ContentMode,
  Encoding,
  ForcedEncoding,
  ImportStage
} from '@shared/types'
import { decodeBytes, decodeBytesWith } from '../services/decode'
import { decodeEpub } from '../services/epub/import'
import {
  CHAPTERS_DIR,
  CONTENT_FILE,
  IMAGES_DIR,
  IMAGES_MANIFEST,
  SOURCE_FILE,
  chapterFileName
} from '../services/layout'

/**
 * 解码 + 切章 + 落盘的纯执行体。
 * 放在 worker 里跑，主进程事件循环不被大文件卡住（TECH.md 3、6）。
 */
export interface DecodeJob {
  taskId: string
  sourcePath: string
  destDir: string
  contentMode: ContentMode
  /** 按格式分派提取器（0.2.0）；不传按 txt。 */
  format?: BookFormat
  /** 重新解码时用户指定的编码；不填 = 走自动检测。EPUB 忽略它（规范即 UTF-8/16）。 */
  encoding?: ForcedEncoding
}

export interface DecodedChapter {
  title: string
  startOffset: CharOffset
  charLength: number
  kind: ChapterKind
}

export interface DecodeJobResult {
  format: BookFormat
  encoding: Encoding
  charCount: number
  chapters: DecodedChapter[]
  contentMode: ContentMode
  usedFallback: boolean
  markerHits: number
  suspicious: boolean
  /** 从文件里读到的书名 / 作者（EPUB 取 OPF；TXT 为 null，改用文件名清洗的结果）。 */
  title: string | null
  author: string | null
}

export type ProgressReporter = (stage: ImportStage, ratio: number, message?: string) => void

const WRITE_CONCURRENCY = 8

async function runPool(count: number, limit: number, worker: (index: number) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, count) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= count) return
      await worker(index)
    }
  })
  await Promise.all(runners)
}

export async function runDecodeJob(job: DecodeJob, onProgress: ProgressReporter): Promise<DecodeJobResult> {
  onProgress('reading', 0.02)
  const bytes = await readFile(job.sourcePath)

  // 先解码、后落盘：解析失败（坏文件、二进制、加密）时目录都不会建出来 ——
  // 「失败就什么都不留下」比「失败后再清理」更稳（导入链路还有一层兜底 rm）。
  const payload =
    (job.format ?? 'txt') === 'epub'
      ? decodeEpubPayload(bytes, onProgress)
      : decodeTextPayload(bytes, job, onProgress)

  onProgress('splitting', 0.45)
  await mkdir(job.destDir, { recursive: true })
  // 原始字节永远保留：将来换提取器/解码策略时可以重新解，不用再让用户找文件（TECH.md 5.2）。
  await writeFile(join(job.destDir, SOURCE_FILE), bytes)
  await writePayload(job.destDir, job.contentMode, payload.text, payload.chapters)
  if (payload.images) await writeImages(job.destDir, payload.images, payload.blobs ?? new Map())

  onProgress('storing', 0.9)
  return {
    format: payload.format,
    encoding: payload.encoding,
    charCount: payload.text.length,
    chapters: payload.chapters.map((chapter) => ({
      title: chapter.title,
      startOffset: chapter.startOffset as CharOffset,
      charLength: chapter.charLength,
      kind: chapter.kind
    })),
    contentMode: job.contentMode,
    usedFallback: payload.usedFallback,
    markerHits: payload.markerHits,
    suspicious: payload.suspicious,
    title: payload.title,
    author: payload.author
  }
}

/** 两种格式解码后的统一形状：差別只在「正文与图片从哪来」。 */
interface DecodedPayload {
  format: BookFormat
  encoding: Encoding
  text: string
  chapters: Array<{ title: string; startOffset: number; charLength: number; kind: ChapterKind }>
  usedFallback: boolean
  markerHits: number
  suspicious: boolean
  title: string | null
  author: string | null
  images?: Array<{ offset: number; file: string }>
  blobs?: Map<string, Buffer>
}

/** TXT：编码检测 → 正则切章（老路径，行为不变）。 */
function decodeTextPayload(bytes: Buffer, job: DecodeJob, onProgress: ProgressReporter): DecodedPayload {
  onProgress('detecting', 0.1)
  // 指定了编码（重新解码）就不猜了，直接按它解
  const decoded = job.encoding ? decodeBytesWith(bytes, job.encoding) : decodeBytes(bytes)
  onProgress('decoding', 0.25)
  const split = splitChapters(decoded.text)
  return {
    format: 'txt',
    encoding: decoded.encoding,
    text: decoded.text,
    chapters: split.chapters.map((chapter) => ({
      title: chapter.title,
      startOffset: chapter.startOffset,
      charLength: chapter.charLength,
      kind: chapter.kind
    })),
    usedFallback: split.usedFallback,
    markerHits: split.markerHits,
    suspicious: decoded.suspicious,
    title: null,
    author: null
  }
}

/** EPUB（0.2.0 第 4 项）：ZIP 解包 → 容器/OPF → 正文 + 章节 + 图片清单。 */
function decodeEpubPayload(bytes: Buffer, onProgress: ProgressReporter): DecodedPayload {
  onProgress('detecting', 0.1)
  const book = decodeEpub(bytes)
  onProgress('decoding', 0.3)
  return {
    format: 'epub',
    // EPUB 的正文按 XML 规范就是 UTF-8/UTF-16，xml 那一层已经解成字符串了
    encoding: 'utf-8',
    text: book.text,
    chapters: book.chapters,
    usedFallback: false,
    markerHits: 0,
    suspicious: false,
    title: book.title,
    author: book.author,
    images: book.images,
    blobs: book.blobs
  }
}

/** 正文落盘：整本一个 content.txt，或按章切到 chapters/NNNN.txt（TXT / EPUB 共用）。 */
async function writePayload(
  destDir: string,
  contentMode: ContentMode,
  text: string,
  chapters: Array<{ startOffset: number; charLength: number }>
): Promise<void> {
  if (contentMode === 'sliced') {
    const target = join(destDir, CHAPTERS_DIR)
    // 重新解码后章节数可能变少，旧章文件先清掉，别留下过期正文
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await runPool(chapters.length, WRITE_CONCURRENCY, async (index) => {
      const chapter = chapters[index]
      if (!chapter) return
      const body = text.slice(chapter.startOffset, chapter.startOffset + chapter.charLength)
      await writeFile(join(target, chapterFileName(index)), body, 'utf8')
    })
    return
  }
  await writeFile(join(destDir, CONTENT_FILE), text, 'utf8')
}

/**
 * 图片落盘（0.2.0 第 5 项）：`images/<序号>.<后缀>` + `images.json`（偏移 → 文件名）。
 * 清单是派生物：正文里的 U+FFFC 占位符由渲染层按这张表换成 `<img>`。
 */
async function writeImages(
  destDir: string,
  images: Array<{ offset: number; file: string }>,
  blobs: Map<string, Buffer>
): Promise<void> {
  const target = join(destDir, IMAGES_DIR)
  await rm(target, { recursive: true, force: true })
  if (images.length === 0) {
    await rm(join(destDir, IMAGES_MANIFEST), { force: true })
    return
  }
  await mkdir(target, { recursive: true })
  const files = [...blobs.keys()]
  await runPool(files.length, WRITE_CONCURRENCY, async (index) => {
    const file = files[index]
    const data = file === undefined ? undefined : blobs.get(file)
    if (file === undefined || data === undefined) return
    await writeFile(join(target, file), data)
  })
  await writeFile(
    join(destDir, IMAGES_MANIFEST),
    JSON.stringify({ images: images.map((image) => ({ offset: image.offset, file: image.file })) }),
    'utf8'
  )
}
