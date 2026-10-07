import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { cleanTitleFromPath } from '@shared/core/filename'
import { newBookId } from '@shared/core/ids'
import type { Book, BookFormat, ImportProgress, ImportStage, ManualEncoding } from '@shared/types'
import { SLICE_MODE_BYTES } from '@shared/types'
import type { LibraryRepository } from '../db/library-repository'
import { runDecodeJob, type DecodeJob, type DecodeJobResult } from '../workers/decode-job'
import { ImportError, toImportError } from './import-error'
import { bookDir, booksRoot, sourcePath } from './layout'

export interface ImportServiceOptions {
  root: string
  repo: LibraryRepository
  now?: () => number
  /**
   * worker 脚本路径，默认是构建产物 decode.worker.js。
   * 只为可测性留出的注入口：单测指向临时脚本就能覆盖 worker 分支，生产行为完全不变。
   */
  workerPath?: string
}

/** 按扩展名分派提取器（0.2.0）：认得的走各自的分支，其它一律按 TXT 处理。 */
function formatOf(filePath: string): BookFormat {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.epub') return 'epub'
  return 'txt'
}

type WorkerEnvelope =
  | { type: 'progress'; stage: string; ratio: number; message?: string }
  | { type: 'done'; result: DecodeJobResult }
  | { type: 'error'; code: ImportError['code']; message: string }

/**
 * 导入编排：分配 bookId -> 交给 worker 解码切章 -> 写库 -> 失败时清理半个书目录。
 * worker 起不来时退回主进程内联执行，绝不白屏（TECH.md 3.4 第 5 步）。
 */
export class ImportService {
  private readonly workers = new Map<string, Worker>()
  private readonly emit: (progress: ImportProgress) => void
  private readonly now: () => number

  constructor(
    private readonly options: ImportServiceOptions,
    emit: (progress: ImportProgress) => void = () => {}
  ) {
    this.emit = emit
    this.now = options.now ?? (() => Date.now())
  }

  cancel(taskId: string): void {
    const worker = this.workers.get(taskId)
    if (worker) void worker.terminate()
  }

  cancelAll(): void {
    for (const worker of this.workers.values()) void worker.terminate()
    this.workers.clear()
  }

  async importFile(filePath: string, taskId: string): Promise<Book> {
    const { root, repo } = this.options
    const report = (stage: ImportStage, ratio: number, message?: string): void => {
      this.emit({ taskId, filePath, stage, ratio, message })
    }

    // 早期失败（文件不在、路径是目录）也要发一条 error 进度：
    // 否则界面上的进度条会停在半路，用户只能从 reject 的异常里猜发生了什么。
    const failEarly = (message: string, cause?: unknown): never => {
      const error = new ImportError('io-error', message, cause)
      report('error', 1, error.message)
      throw error
    }
    const info = await stat(filePath).catch((cause: unknown) =>
      failEarly('打不开这个文件：' + filePath, cause)
    )
    if (!info.isFile()) failEarly('这不是一个文件：' + filePath)

    const bookId = newBookId()
    const destDir = bookDir(root, bookId)
    const format = formatOf(filePath)
    const job: DecodeJob = {
      taskId,
      sourcePath: filePath,
      destDir,
      format,
      // 大头书按章切片，阅读器一次只读一章（TXT 与 EPUB 同一套判断）
      contentMode: info.size > SLICE_MODE_BYTES ? 'sliced' : 'single'
    }

    report('reading', 0.01)
    try {
      await mkdir(booksRoot(root), { recursive: true })
      const result = await this.runJob(job)
      const cleaned = cleanTitleFromPath(filePath)

      const book = repo.insertBook(
        {
          id: bookId,
          // 文件里写了书名/作者就用它（EPUB 的 OPF 通常比文件名干净得多），没写才退文件名
          title: result.title ?? cleaned.title,
          author: result.author ?? cleaned.author,
          format: result.format,
          encoding: result.encoding,
          byteSize: info.size,
          charCount: result.charCount,
          contentMode: result.contentMode,
          addedAt: this.now()
        },
        result.chapters
      )
      report('done', 1)
      return book
    } catch (cause) {
      await rm(destDir, { recursive: true, force: true }).catch(() => undefined)
      const error = toImportError(cause)
      report('error', 1, error.message)
      throw error
    }
  }

  /**
   * 手动指定编码重新解码。
   * 原始字节一直留在 books/<id>/source.bin（TECH.md 5.2），所以乱码书不用重新导入；
   * 代价是所有字符偏移都变了，这本书的阅读进度会被清零。
   */
  async redecode(bookId: string, encoding: ManualEncoding, taskId: string): Promise<Book> {
    const { root, repo } = this.options
    const book = repo.getBook(bookId)
    if (!book) throw new ImportError('db-error', '这本书不在书库里')

    const source = sourcePath(root, bookId)
    const report = (stage: ImportStage, ratio: number, message?: string): void => {
      this.emit({ taskId, filePath: book.title + '（重新解码）', stage, ratio, message })
    }
    if (!existsSync(source)) {
      const error = new ImportError('io-error', '找不到这本书的原始文件，只能重新导入')
      report('error', 1, error.message)
      throw error
    }

    report('reading', 0.01)
    try {
      const result = await this.runJob({
        taskId,
        sourcePath: source,
        destDir: bookDir(root, bookId),
        contentMode: book.contentMode,
        // 非 TXT 格式没有「编码」这回事：EPUB 按规范就是 UTF-8/UTF-16，
        // 这里的「重新解码」等价于「用最新提取器重新提取」（0.2.0 第 6 项）。
        format: book.format,
        encoding: book.format === 'txt' && encoding !== 'auto' ? encoding : undefined
      })
      repo.replaceDecoded(
        bookId,
        { encoding: result.encoding, charCount: result.charCount },
        result.chapters
      )
      const updated = repo.getBook(bookId)
      if (!updated) throw new ImportError('db-error', '重新解码后读不回这本书')
      report('done', 1)
      return updated
    } catch (cause) {
      const error = toImportError(cause)
      report('error', 1, error.message)
      throw error
    }
  }

  /** worker 文件缺失（例如开发分支没构建）时内联执行，功能优先。 */
  private runJob(job: DecodeJob): Promise<DecodeJobResult> {
    const workerPath = this.options.workerPath ?? join(__dirname, 'decode.worker.js')
    if (!existsSync(workerPath)) {
      return runDecodeJob(job, (stage, ratio, message) =>
        this.emit({ taskId: job.taskId, filePath: job.sourcePath, stage, ratio, message })
      )
    }

    return new Promise<DecodeJobResult>((resolve, reject) => {
      let settled = false
      const worker = new Worker(workerPath, { workerData: job })
      this.workers.set(job.taskId, worker)

      const finish = (): boolean => {
        if (settled) return false
        settled = true
        this.workers.delete(job.taskId)
        return true
      }

      worker.on('message', (message: WorkerEnvelope) => {
        if (message.type === 'progress') {
          this.emit({
            taskId: job.taskId,
            filePath: job.sourcePath,
            stage: message.stage as ImportStage,
            ratio: message.ratio,
            message: message.message
          })
          return
        }
        if (!finish()) return
        if (message.type === 'done') resolve(message.result)
        else reject(new ImportError(message.code, message.message))
      })

      worker.on('error', (cause) => {
        if (!finish()) return
        reject(toImportError(cause))
      })

      worker.on('exit', () => {
        if (!finish()) return
        reject(new ImportError('cancelled', '导入已取消'))
      })
    })
  }
}
