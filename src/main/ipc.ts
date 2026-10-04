import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { CH } from '@shared/channels'
import { newBookId } from '@shared/core/ids'
import {
  annotationIdArgsSchema,
  bookmarkAddArgsSchema,
  cancelArgsSchema,
  emptyArgsSchema,
  getArgsSchema,
  highlightAddArgsSchema,
  importArgsSchema,
  mergeChapterArgsSchema,
  progressSchema,
  readChapterArgsSchema,
  redecodeArgsSchema,
  renameArgsSchema,
  renameChapterArgsSchema,
  searchArgsSchema,
  settingsSchema,
  splitChapterArgsSchema
} from '@shared/schema'
import type {
  Book,
  Bookmark,
  Chapter,
  Highlight,
  Progress,
  ReaderSettings,
  SearchResult,
  ShelfBook
} from '@shared/types'
import type { AnnotationsRepository } from './db/annotations-repository'
import type { ChapterEditor } from './services/chapter-editor'
import type { FileContentReader } from './services/content-reader'
import { toImportError, type ImportError } from './services/import-error'
import type { ImportService } from './services/importer'
import type { LibraryService } from './services/library'
import type { SqlProgressStore } from './services/progress-store'
import type { BookSearchService } from './services/search'
import type { SettingsStore } from './services/settings-store'

export interface IpcContext {
  importer: ImportService
  library: LibraryService
  /** 手动改分章：只重写章节表，正文不动（0.1.3 第 5 项）。 */
  chapters: ChapterEditor
  /** 书签与划线（0.1.3 第 6 项）。 */
  annotations: AnnotationsRepository
  content: FileContentReader
  /** 章节内 / 全书搜索（0.1.3 第 7 项）。 */
  search: BookSearchService
  progress: SqlProgressStore
  settings: SettingsStore
  /** 本机设备 id，随 app:info 一次性交给渲染进程（TECH.md 6.1）。 */
  deviceId: string
}

/** 每个通道入参都在 main 侧再过一遍 zod（TECH.md 4.2），失败就是拒绝 + 日志。 */
function handle<TSchema extends z.ZodTypeAny, TResult>(
  channel: string,
  schema: TSchema,
  handler: (args: z.infer<TSchema>, event: IpcMainInvokeEvent) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      console.error('[12read] IPC 参数校验失败: ' + channel, parsed.error.issues)
      throw new Error('参数校验失败: ' + channel)
    }
    return handler(parsed.data as z.infer<TSchema>, event)
  })
}

function describeImportError(error: ImportError): string {
  return '导入失败（' + error.code + '）：' + error.message
}

/** 改分章失败统一翻成带 code 的中文提示（正文没动，所以不用清正文缓存）。 */
function runChapterEdit(edit: () => Chapter[]): Chapter[] {
  try {
    return edit()
  } catch (cause) {
    const error = toImportError(cause)
    throw new Error('改分章失败（' + error.code + '）：' + error.message)
  }
}

export function registerIpc(ctx: IpcContext): void {
  handle(CH.appInfo, emptyArgsSchema, () => ({
    name: '十二阅读',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    deviceId: ctx.deviceId
  }))

  handle(CH.filePick, emptyArgsSchema, async (): Promise<string[]> => {
    const result = await dialog.showOpenDialog({
      title: '选择要导入的 TXT 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '纯文本', extensions: ['txt'] }]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(CH.bookImport, importArgsSchema, async ({ filePath }): Promise<Book> => {
    const taskId = newBookId()
    try {
      return await ctx.importer.importFile(filePath, taskId)
    } catch (cause) {
      throw new Error(describeImportError(toImportError(cause)))
    }
  })

  handle(CH.taskCancel, cancelArgsSchema, ({ taskId }) => {
    ctx.importer.cancel(taskId)
  })

  handle(CH.bookList, emptyArgsSchema, (): Promise<ShelfBook[]> => ctx.library.list())

  handle(CH.bookGet, getArgsSchema, ({ bookId }): Promise<Book | null> => ctx.library.get(bookId))

  handle(CH.bookRename, renameArgsSchema, ({ bookId, title }): Promise<Book> =>
    ctx.library.rename(bookId, title)
  )

  handle(CH.bookDelete, getArgsSchema, async ({ bookId }): Promise<void> => {
    await ctx.library.remove(bookId)
    ctx.content.invalidate(bookId)
  })

  handle(CH.bookRedecode, redecodeArgsSchema, async ({ bookId, encoding }): Promise<Book> => {
    const taskId = newBookId()
    try {
      const book = await ctx.importer.redecode(bookId, encoding, taskId)
      // 正文整份换了，64MB 的章节缓存必须丢掉，否则读到的还是旧解码
      ctx.content.invalidate(bookId)
      return book
    } catch (cause) {
      const error = toImportError(cause)
      throw new Error('重新解码失败（' + error.code + '）：' + error.message)
    }
  })

  handle(CH.bookChapters, getArgsSchema, ({ bookId }): Promise<Chapter[]> =>
    ctx.library.chapters(bookId)
  )

  handle(CH.chapterRead, readChapterArgsSchema, ({ bookId, index }): Promise<string> =>
    ctx.content.readChapter(bookId, index)
  )

  // 手动改分章：正文一个字都不动，只重写章节表；进度按字符位置重新落位
  handle(CH.chapterRename, renameChapterArgsSchema, ({ bookId, index, title }): Chapter[] =>
    runChapterEdit(() => ctx.chapters.rename(bookId, index, title))
  )

  handle(CH.chapterMerge, mergeChapterArgsSchema, ({ bookId, index }): Chapter[] =>
    runChapterEdit(() => ctx.chapters.merge(bookId, index))
  )

  handle(CH.chapterSplit, splitChapterArgsSchema, ({ bookId, index, offset }): Chapter[] =>
    runChapterEdit(() => ctx.chapters.split(bookId, index, offset))
  )

  // 书签与划线：id 与时间戳一律由主进程生成，渲染进程只报位置
  handle(CH.bookmarkList, getArgsSchema, ({ bookId }): Bookmark[] =>
    ctx.annotations.listBookmarks(bookId)
  )

  handle(
    CH.bookmarkAdd,
    bookmarkAddArgsSchema,
    ({ bookId, chapterIndex, charOffset, excerpt }): Bookmark =>
      ctx.annotations.addBookmark({
        id: newBookId(),
        bookId,
        chapterIndex,
        charOffset,
        excerpt,
        createdAt: Date.now()
      })
  )

  handle(CH.bookmarkRemove, annotationIdArgsSchema, ({ id }): void => {
    ctx.annotations.removeBookmark(id)
  })

  handle(CH.highlightList, getArgsSchema, ({ bookId }): Highlight[] =>
    ctx.annotations.listHighlights(bookId)
  )

  handle(
    CH.highlightAdd,
    highlightAddArgsSchema,
    ({ bookId, chapterIndex, startOffset, endOffset, text }): Highlight => {
      if (endOffset <= startOffset) throw new Error('划线范围不合法：结束位置要在开始位置之后')
      return ctx.annotations.addHighlight({
        id: newBookId(),
        bookId,
        chapterIndex,
        startOffset,
        endOffset,
        text,
        note: null,
        createdAt: Date.now()
      })
    }
  )

  handle(CH.highlightRemove, annotationIdArgsSchema, ({ id }): void => {
    ctx.annotations.removeHighlight(id)
  })

  // 搜索：关键词归一化与上限都在服务里，ipc 只转发
  handle(
    CH.bookSearch,
    searchArgsSchema,
    ({ bookId, query, scope, chapterIndex }): Promise<SearchResult> =>
      ctx.search.search({ bookId, query, scope, chapterIndex })
  )

  handle(CH.progressGet, getArgsSchema, ({ bookId }): Promise<Progress | null> =>
    ctx.progress.get(bookId)
  )

  handle(CH.progressSave, progressSchema, async (progress): Promise<void> => {
    await ctx.progress.save(progress)
  })

  // 退出前的同步落盘（TECH.md 6.3）：beforeunload 之后异步 IPC 未必来得及。
  // better-sqlite3 的写入本身是同步的，所以这里发出去就落库了。
  ipcMain.on(CH.progressFlush, (event, raw: unknown) => {
    const parsed = progressSchema.safeParse(raw)
    if (!parsed.success) {
      console.error('[12read] IPC 参数校验失败: ' + CH.progressFlush, parsed.error.issues)
      event.returnValue = false
      return
    }
    void ctx.progress.save(parsed.data)
    event.returnValue = true
  })

  handle(CH.settingsGet, emptyArgsSchema, (): ReaderSettings => ctx.settings.get())

  handle(CH.settingsSave, settingsSchema, (settings): ReaderSettings => ctx.settings.set(settings))
}
