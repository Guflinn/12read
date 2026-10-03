import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { cleanTitleFromPath } from '@shared/core/filename'
import { newBookId } from '@shared/core/ids'
import type { Book, ImportProgress, ImportStage } from '@shared/types'
import { SLICE_MODE_BYTES } from '@shared/types'
import type { LibraryRepository } from '../db/library-repository'
import { runDecodeJob, type DecodeJob, type DecodeJobResult } from '../workers/decode-job'
import { ImportError, toImportError } from './import-error'
import { bookDir, booksRoot } from './layout'

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

    const info = await stat(filePath).catch((cause: unknown) => {
      throw new ImportError('io-error', '打不开这个文件：' + filePath, cause)
    })
    if (!info.isFile()) throw new ImportError('io-error', '这不是一个文件：' + filePath)

    const bookId = newBookId()
    const destDir = bookDir(root, bookId)
    const job: DecodeJob = {
      taskId,
      sourcePath: filePath,
      destDir,
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
          title: cleaned.title,
          author: cleaned.author,
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
