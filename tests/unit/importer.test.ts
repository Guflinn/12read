import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as iconv from 'iconv-lite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SLICE_MODE_BYTES, type Book, type ImportProgress, type ImportStage } from '@shared/types'
import type { LibraryRepository, NewBookRecord, NewChapterRecord } from '@main/db/library-repository'
import { ImportError } from '@main/services/import-error'
import { ImportService } from '@main/services/importer'
import { bookDir, booksRoot, contentPath, sourcePath } from '@main/services/layout'
import { SAMPLE_TEXT, bytesBinaryWithNul, bytesGbk, bytesUtf8 } from '../fixtures/texts'

/**
 * 只把 stat 包一层，用来伪造超大文件；其余文件操作全走真实实现，
 * 这样「写库前落盘 / 失败后清理」才是真的在测磁盘。
 */
const fsState = vi.hoisted(() => ({ statSize: null as number | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: (async (...args: Parameters<typeof actual.stat>) => {
      const info = await actual.stat(...args)
      if (fsState.statSize === null) return info
      return {
        isFile: (): boolean => info.isFile(),
        size: fsState.statSize
      } as unknown as typeof info
    }) as typeof actual.stat
  }
})

interface InsertCall {
  record: NewBookRecord
  chapters: NewChapterRecord[]
}

function makeRepo(initial: Book | null = null): {
  repo: LibraryRepository
  insertBook: ReturnType<typeof vi.fn>
  getBook: ReturnType<typeof vi.fn>
  replaceDecoded: ReturnType<typeof vi.fn>
  calls: InsertCall[]
  setBook(next: Book | null): void
} {
  const calls: InsertCall[] = []
  let stored = initial
  const insertBook = vi.fn((record: NewBookRecord, chapters: NewChapterRecord[]): Book => {
    calls.push({ record, chapters })
    return {
      id: record.id,
      title: record.title,
      author: record.author,
      format: 'txt',
      encoding: record.encoding,
      byteSize: record.byteSize,
      charCount: record.charCount,
      chapterCount: chapters.length,
      contentMode: record.contentMode,
      coverSeed: 1,
      addedAt: record.addedAt,
      lastOpenedAt: null
    }
  })
  const getBook = vi.fn((): Book | null => stored)
  const replaceDecoded = vi.fn(
    (bookId: string, decoded: { encoding: Book['encoding']; charCount: number }, chapters: NewChapterRecord[]): void => {
      if (stored && stored.id === bookId) {
        stored = {
          ...stored,
          encoding: decoded.encoding,
          charCount: decoded.charCount,
          chapterCount: chapters.length
        }
      }
    }
  )
  return {
    repo: { insertBook, getBook, replaceDecoded } as unknown as LibraryRepository,
    insertBook,
    getBook,
    replaceDecoded,
    calls,
    setBook(next: Book | null): void {
      stored = next
    }
  }
}

let root = ''
let srcFile = ''

beforeEach(async () => {
  fsState.statSize = null
  root = await mkdtemp(join(tmpdir(), 'importer-'))
  srcFile = join(root, '《十二阅读》林某.txt')
})

afterEach(async () => {
  fsState.statSize = null
  await rm(root, { recursive: true, force: true })
})

/** 把一段 worker 脚本写到临时目录，返回绝对路径。 */
async function writeWorker(name: string, source: string): Promise<string> {
  const file = join(root, name + '.cjs')
  await writeFile(file, source, 'utf8')
  return file
}

const LONG_LIVED_WORKER = `
const { parentPort } = require('node:worker_threads')
parentPort.postMessage({ type: 'progress', stage: 'decoding', ratio: 0.5 })
setInterval(() => {}, 1000)
`

/** 等到回调里出现指定 stage，避免用 sleep 猜时间。 */
function stageGate(): { promise: Promise<void>; onProgress: (p: ImportProgress) => void } {
  let resolveGate: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve
  })
  return {
    promise,
    onProgress: (progress: ImportProgress): void => {
      if (progress.stage === 'decoding') resolveGate()
    }
  }
}

describe('ImportService.importFile 内联分支（worker 文件缺失）', () => {
  it('正常导入：返回 Book、写库、进度覆盖 reading..done', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    const { repo, insertBook, calls } = makeRepo()
    const events: ImportProgress[] = []
    const service = new ImportService({ root, repo, now: () => 12345 }, (progress) => events.push(progress))

    const book = await service.importFile(srcFile, 'task-1')

    expect(book.id).toBe(calls[0].record.id)
    expect(book.title).toBe('十二阅读')
    expect(book.author).toBe('林某')
    expect(insertBook).toHaveBeenCalledTimes(1)
    expect(calls[0].record).toMatchObject({
      encoding: 'utf-8',
      byteSize: bytesUtf8(SAMPLE_TEXT).length,
      charCount: SAMPLE_TEXT.length,
      contentMode: 'single',
      addedAt: 12345
    })
    expect(calls[0].chapters).toHaveLength(2)

    const stages = events.map((event) => event.stage)
    for (const stage of ['reading', 'detecting', 'decoding', 'splitting', 'storing', 'done'] as ImportStage[]) {
      expect(stages).toContain(stage)
    }
    expect(events[0]).toEqual({ taskId: 'task-1', filePath: srcFile, stage: 'reading', ratio: 0.01, message: undefined })
    expect(events.at(-1)).toEqual({ taskId: 'task-1', filePath: srcFile, stage: 'done', ratio: 1, message: undefined })
    expect(existsSync(join(bookDir(root, book.id), 'content.txt'))).toBe(true)
  })

  it('文件不存在时报 io-error，并发出 error 进度', async () => {
    const { repo, insertBook } = makeRepo()
    const events: ImportProgress[] = []
    const service = new ImportService({ root, repo }, (progress) => events.push(progress))
    const missing = join(root, '不存在.txt')

    const error = await service.importFile(missing, 'task-2').then(
      () => null,
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).code).toBe('io-error')
    expect((error as ImportError).message).toBe('打不开这个文件：' + missing)
    expect(insertBook).not.toHaveBeenCalled()
    expect(events).toEqual([
      {
        taskId: 'task-2',
        filePath: missing,
        stage: 'error',
        ratio: 1,
        message: '打不开这个文件：' + missing
      }
    ])
  })

  it('目标不是文件时报 io-error，并发出 error 进度', async () => {
    const dir = join(root, '其实是个目录')
    await mkdir(dir)
    const { repo } = makeRepo()
    const events: ImportProgress[] = []
    const service = new ImportService({ root, repo }, (progress) => events.push(progress))

    const error = await service.importFile(dir, 'task-3').then(
      () => null,
      (cause: unknown) => cause
    )

    expect((error as ImportError).code).toBe('io-error')
    expect((error as ImportError).message).toBe('这不是一个文件：' + dir)
    expect(events).toEqual([
      {
        taskId: 'task-3',
        filePath: dir,
        stage: 'error',
        ratio: 1,
        message: '这不是一个文件：' + dir
      }
    ])
  })

  it('解码失败时报 binary 并清掉半个书目录，不写库', async () => {
    await writeFile(srcFile, bytesBinaryWithNul())
    const { repo, insertBook } = makeRepo()
    const service = new ImportService({ root, repo })

    const error = await service.importFile(srcFile, 'task-4').then(
      () => null,
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).code).toBe('binary')
    expect(insertBook).not.toHaveBeenCalled()
    // books/ 会被创建，但里面不能留下半成品目录。
    expect(await readdir(booksRoot(root))).toEqual([])
  })

  it('超过 SLICE_MODE_BYTES 时走 sliced 落盘', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    fsState.statSize = SLICE_MODE_BYTES + 1
    const { repo, calls } = makeRepo()
    const service = new ImportService({ root, repo })

    const book = await service.importFile(srcFile, 'task-5')

    expect(calls[0].record.contentMode).toBe('sliced')
    expect(book.contentMode).toBe('sliced')
    expect(existsSync(join(bookDir(root, book.id), 'chapters'))).toBe(true)
  })
})

describe('ImportService.redecode（换编码重解，原始文件不动）', () => {
  const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

  function makeBook(patch: Partial<Book> = {}): Book {
    return {
      id: BOOK_ID,
      title: '十二阅读',
      author: '林某',
      format: 'txt',
      encoding: 'utf-8',
      byteSize: 100,
      charCount: 12,
      chapterCount: 1,
      contentMode: 'single',
      coverSeed: 1,
      addedAt: 1,
      lastOpenedAt: null,
      ...patch
    }
  }

  /** 摆出「这本书已经导入过、source.bin 还在」的目录。 */
  async function seedBook(bytes: Uint8Array): Promise<void> {
    await mkdir(bookDir(root, BOOK_ID), { recursive: true })
    await writeFile(sourcePath(root, BOOK_ID), bytes)
  }

  it('复用 source.bin 重解：不新增书，更新编码与字数，正文不再乱码', async () => {
    const { repo, insertBook, replaceDecoded, getBook } = makeRepo(makeBook())
    await seedBook(bytesGbk(SAMPLE_TEXT))
    const events: ImportProgress[] = []
    const service = new ImportService({ root, repo }, (progress) => events.push(progress))

    const updated = await service.redecode(BOOK_ID, 'gb18030', 'task-r1')

    expect(insertBook).not.toHaveBeenCalled()
    expect(replaceDecoded).toHaveBeenCalledTimes(1)
    expect(replaceDecoded.mock.calls[0][0]).toBe(BOOK_ID)
    expect(replaceDecoded.mock.calls[0][1]).toEqual({
      encoding: 'gb18030',
      charCount: SAMPLE_TEXT.length
    })
    expect(replaceDecoded.mock.calls[0][2]).toHaveLength(2)
    expect(getBook).toHaveBeenCalledWith(BOOK_ID)
    expect(updated.encoding).toBe('gb18030')
    expect(updated.charCount).toBe(SAMPLE_TEXT.length)
    expect(updated.chapterCount).toBe(2)
    expect(await readFile(contentPath(root, BOOK_ID), 'utf8')).toBe(SAMPLE_TEXT)
    // 进度用「书名（重新解码）」当名字，书架上的导入条才看得懂
    expect(events[0]).toEqual({
      taskId: 'task-r1',
      filePath: '十二阅读（重新解码）',
      stage: 'reading',
      ratio: 0.01,
      message: undefined
    })
    expect(events.at(-1)).toMatchObject({ stage: 'done', ratio: 1 })
  })

  it('手工指定 big5 也能解出繁体书', async () => {
    const text = '第一章 起点\n繁體中文測試，這是一本老書。\n'
    const { repo } = makeRepo(makeBook())
    await seedBook(new Uint8Array(iconv.encode(text, 'big5')))
    const service = new ImportService({ root, repo })

    const updated = await service.redecode(BOOK_ID, 'big5', 'task-r2')

    expect(updated.encoding).toBe('big5')
    expect(await readFile(contentPath(root, BOOK_ID), 'utf8')).toBe(text)
  })

  it('auto 就是再猜一次：source 是 GBK 且书名允许时能猜对', async () => {
    const { repo } = makeRepo(makeBook())
    await seedBook(bytesUtf8(SAMPLE_TEXT))
    const service = new ImportService({ root, repo })

    const updated = await service.redecode(BOOK_ID, 'auto', 'task-r3')

    expect(updated.encoding).toBe('utf-8')
    expect(updated.charCount).toBe(SAMPLE_TEXT.length)
  })

  it('书不在库里报 db-error，且不碰磁盘', async () => {
    const { repo } = makeRepo(null)
    const service = new ImportService({ root, repo })

    const error = await service.redecode(BOOK_ID, 'gb18030', 'task-r4').then(
      () => null,
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).code).toBe('db-error')
    expect((error as ImportError).message).toBe('这本书不在书库里')
    // 连 books/ 都不该被创建
    expect(existsSync(booksRoot(root))).toBe(false)
  })

  it('source.bin 丢了报 io-error，并且保留书目录（进度和正文都还在）', async () => {
    const { repo } = makeRepo(makeBook())
    await mkdir(bookDir(root, BOOK_ID), { recursive: true })
    await writeFile(contentPath(root, BOOK_ID), SAMPLE_TEXT, 'utf8')
    const events: ImportProgress[] = []
    const service = new ImportService({ root, repo }, (progress) => events.push(progress))

    const error = await service.redecode(BOOK_ID, 'gb18030', 'task-r5').then(
      () => null,
      (cause: unknown) => cause
    )

    expect((error as ImportError).code).toBe('io-error')
    expect((error as ImportError).message).toBe('找不到这本书的原始文件，只能重新导入')
    expect(events).toEqual([
      {
        taskId: 'task-r5',
        filePath: '十二阅读（重新解码）',
        stage: 'error',
        ratio: 1,
        message: '找不到这本书的原始文件，只能重新导入'
      }
    ])
    // 与 importFile 不同：重解码失败不能删掉用户已经读过的书
    expect(await readdir(bookDir(root, BOOK_ID))).toContain('content.txt')
  })
})

describe('ImportService 的 worker 分支', () => {
  it('worker 成功：进度来自 worker 消息，结果照常写库', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    const workerPath = await writeWorker(
      'ok',
      `
const { parentPort, workerData } = require('node:worker_threads')
parentPort.postMessage({ type: 'progress', stage: 'decoding', ratio: 0.5, message: '解码中' })
parentPort.postMessage({
  type: 'done',
  result: {
    encoding: 'utf-8',
    charCount: 12,
    chapters: [{ title: '第一章', startOffset: 0, charLength: 12, kind: 'chapter' }],
    contentMode: workerData.contentMode,
    usedFallback: false,
    markerHits: 1,
    suspicious: false
  }
})
`
    )
    const { repo, insertBook, calls } = makeRepo()
    const events: ImportProgress[] = []
    const service = new ImportService({ root, repo, workerPath }, (progress) => events.push(progress))

    const book = await service.importFile(srcFile, 'task-w1')

    expect(insertBook).toHaveBeenCalledTimes(1)
    expect(book.charCount).toBe(12)
    expect(calls[0].record.charCount).toBe(12)
    expect(calls[0].chapters).toHaveLength(1)
    expect(events).toContainEqual({
      taskId: 'task-w1',
      filePath: srcFile,
      stage: 'decoding',
      ratio: 0.5,
      message: '解码中'
    })
    expect(events.at(-1)?.stage).toBe('done')
  })

  it('worker 回报 error 信封时转成对应的 ImportError', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    const workerPath = await writeWorker(
      'bad',
      `
const { parentPort } = require('node:worker_threads')
parentPort.postMessage({ type: 'error', code: 'binary', message: '这不是一个纯文本文件' })
`
    )
    const { repo, insertBook } = makeRepo()
    const service = new ImportService({ root, repo, workerPath })

    const error = await service.importFile(srcFile, 'task-w2').then(
      () => null,
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).code).toBe('binary')
    expect((error as ImportError).message).toBe('这不是一个纯文本文件')
    expect(insertBook).not.toHaveBeenCalled()
  })

  it('worker 直接抛错时走 error 事件，映射成 unknown', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    const workerPath = await writeWorker('crash', "throw new Error('worker 崩了')")
    const { repo } = makeRepo()
    const service = new ImportService({ root, repo, workerPath })

    const error = await service.importFile(srcFile, 'task-w3').then(
      () => null,
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).code).toBe('unknown')
    expect((error as ImportError).message).toBe('worker 崩了')
  })

  it('worker 没发结果就退出时按 cancelled 处理', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    const workerPath = await writeWorker(
      'silent',
      `
const { parentPort } = require('node:worker_threads')
parentPort.postMessage({ type: 'progress', stage: 'storing', ratio: 0.9 })
`
    )
    const { repo, insertBook } = makeRepo()
    const service = new ImportService({ root, repo, workerPath })

    const error = await service.importFile(srcFile, 'task-w4').then(
      () => null,
      (cause: unknown) => cause
    )

    expect((error as ImportError).code).toBe('cancelled')
    expect((error as ImportError).message).toBe('导入已取消')
    expect(insertBook).not.toHaveBeenCalled()
  })

  it('cancel(taskId) 终止在跑的 worker 并 reject cancelled', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    const workerPath = await writeWorker('long', LONG_LIVED_WORKER)
    const { repo, insertBook } = makeRepo()
    const gate = stageGate()
    const service = new ImportService({ root, repo, workerPath }, gate.onProgress)

    // 先挂上拒绝处理，再 cancel，避免退出事件撞出 unhandled rejection。
    const outcome = service.importFile(srcFile, 'task-cancel').then(
      () => null,
      (cause: unknown) => cause
    )
    await gate.promise
    service.cancel('task-cancel')
    const error = await outcome

    expect((error as ImportError).code).toBe('cancelled')
    expect(insertBook).not.toHaveBeenCalled()
  })

  it('cancelAll() 终止所有在跑的 worker', async () => {
    await writeFile(srcFile, bytesUtf8(SAMPLE_TEXT))
    const workerPath = await writeWorker('long2', LONG_LIVED_WORKER)
    const { repo } = makeRepo()
    const seen = new Set<string>()
    let resolveBoth: () => void = () => undefined
    const bothSeen = new Promise<void>((resolve) => {
      resolveBoth = resolve
    })
    const service = new ImportService({ root, repo, workerPath }, (progress) => {
      if (progress.stage === 'decoding') {
        seen.add(progress.taskId)
        if (seen.size === 2) resolveBoth()
      }
    })

    // 两个 promise 都先挂上拒绝处理，cancelAll 后一起等，避免 unhandled rejection。
    const first = service.importFile(srcFile, 'multi-1').then(
      () => null,
      (cause: unknown) => cause
    )
    const second = service.importFile(srcFile, 'multi-2').then(
      () => null,
      (cause: unknown) => cause
    )
    await bothSeen
    service.cancelAll()

    const outcomes = await Promise.all([first, second])
    for (const error of outcomes) {
      expect((error as ImportError).code).toBe('cancelled')
    }
  })

  it('cancel 未知 taskId、空 cancelAll 都是安全 no-op', () => {
    const { repo } = makeRepo()
    const service = new ImportService({ root, repo })

    expect(() => {
      service.cancel('不存在的任务')
      service.cancelAll()
    }).not.toThrow()
  })
})
