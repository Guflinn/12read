import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { splitChapters } from '@shared/core/chapter-split'
import type {
  ChapterKind,
  CharOffset,
  ContentMode,
  Encoding,
  ForcedEncoding,
  ImportStage
} from '@shared/types'
import { decodeBytes, decodeBytesWith } from '../services/decode'
import { CHAPTERS_DIR, CONTENT_FILE, SOURCE_FILE, chapterFileName } from '../services/layout'

/**
 * 解码 + 切章 + 落盘的纯执行体。
 * 放在 worker 里跑，主进程事件循环不被大文件卡住（TECH.md 3、6）。
 */
export interface DecodeJob {
  taskId: string
  sourcePath: string
  destDir: string
  contentMode: ContentMode
  /** 重新解码时用户指定的编码；不填 = 走自动检测。 */
  encoding?: ForcedEncoding
}

export interface DecodedChapter {
  title: string
  startOffset: CharOffset
  charLength: number
  kind: ChapterKind
}

export interface DecodeJobResult {
  encoding: Encoding
  charCount: number
  chapters: DecodedChapter[]
  contentMode: ContentMode
  usedFallback: boolean
  markerHits: number
  suspicious: boolean
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

  onProgress('detecting', 0.1)
  // 指定了编码（重新解码）就不猜了，直接按它解
  const decoded = job.encoding ? decodeBytesWith(bytes, job.encoding) : decodeBytes(bytes)

  onProgress('decoding', 0.25)
  const split = splitChapters(decoded.text)

  onProgress('splitting', 0.45)
  await mkdir(job.destDir, { recursive: true })
  // 原始字节永远保留：将来换解码策略时可以重新解，不用再让用户找文件（TECH.md 5.2）。
  await writeFile(join(job.destDir, SOURCE_FILE), bytes)

  if (job.contentMode === 'sliced') {
    const target = join(job.destDir, CHAPTERS_DIR)
    // 重新解码后章节数可能变少，旧章文件先清掉，别留下过期正文
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await runPool(split.chapters.length, WRITE_CONCURRENCY, async (index) => {
      const chapter = split.chapters[index]
      const body = decoded.text.slice(chapter.startOffset, chapter.startOffset + chapter.charLength)
      await writeFile(join(target, chapterFileName(index)), body, 'utf8')
    })
  } else {
    await writeFile(join(job.destDir, CONTENT_FILE), decoded.text, 'utf8')
  }

  onProgress('storing', 0.9)
  return {
    encoding: decoded.encoding,
    charCount: decoded.text.length,
    chapters: split.chapters.map((chapter) => ({
      title: chapter.title,
      startOffset: chapter.startOffset as CharOffset,
      charLength: chapter.charLength,
      kind: chapter.kind
    })),
    contentMode: job.contentMode,
    usedFallback: split.usedFallback,
    markerHits: split.markerHits,
    suspicious: decoded.suspicious
  }
}
