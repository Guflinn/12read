import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { z } from 'zod'
import { CH } from '@shared/channels'
import type { ReaderApi } from '@shared/api'
import {
  cancelArgsSchema,
  emptyArgsSchema,
  getArgsSchema,
  importArgsSchema,
  importProgressSchema,
  annotationIdArgsSchema,
  bookmarkAddArgsSchema,
  highlightAddArgsSchema,
  progressSchema,
  mergeChapterArgsSchema,
  readChapterArgsSchema,
  redecodeArgsSchema,
  renameArgsSchema,
  searchArgsSchema,
  renameChapterArgsSchema,
  settingsSchema,
  statAddArgsSchema,
  statReadArgsSchema,
  statGetArgsSchema,
  statCalendarArgsSchema,
  updateOpenArgsSchema
} from '@shared/schema'
import type {
  AnnotationId,
  BackupResult,
  Book,
  BookImage,
  Bookmark,
  BookmarkInput,
  Chapter,
  Highlight,
  HighlightInput,
  ImportProgress,
  ManualEncoding,
  Progress,
  ReaderSettings,
  ReadSpanInput,
  ReadingCalendar,
  ReadingStats,
  SearchResult,
  SearchScope,
  ShelfBook,
  UpdateCheckResult
} from '@shared/types'

/**
 * contextBridge 暴露层（TECH.md 2.1 铁律 1、4.2）。
 * 方法白名单穷举，不透传 ipcRenderer；入参先在渲染侧校验一次。
 */
function invoke<T>(channel: string, schema: z.ZodType, payload: unknown): Promise<T> {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return Promise.reject(new Error('参数校验失败: ' + channel))
  }
  return ipcRenderer.invoke(channel, parsed.data) as Promise<T>
}

const readerApi: ReaderApi = {
  appInfo: () => invoke(CH.appInfo, emptyArgsSchema, undefined),
  pickFiles: (): Promise<string[]> => invoke(CH.filePick, emptyArgsSchema, undefined),
  importFile: (filePath: string): Promise<Book> =>
    invoke(CH.bookImport, importArgsSchema, { filePath }),
  cancelTask: (taskId: string): Promise<void> => invoke(CH.taskCancel, cancelArgsSchema, { taskId }),
  listBooks: (): Promise<ShelfBook[]> => invoke(CH.bookList, emptyArgsSchema, undefined),
  getBook: (bookId: string): Promise<Book | null> => invoke(CH.bookGet, getArgsSchema, { bookId }),
  renameBook: (bookId: string, title: string): Promise<Book> =>
    invoke(CH.bookRename, renameArgsSchema, { bookId, title }),
  redecodeBook: (bookId: string, encoding: ManualEncoding): Promise<Book> =>
    invoke(CH.bookRedecode, redecodeArgsSchema, { bookId, encoding }),
  deleteBook: (bookId: string): Promise<void> => invoke(CH.bookDelete, getArgsSchema, { bookId }),
  chapters: (bookId: string): Promise<Chapter[]> =>
    invoke(CH.bookChapters, getArgsSchema, { bookId }),
  renameChapter: (bookId: string, index: number, title: string): Promise<Chapter[]> =>
    invoke(CH.chapterRename, renameChapterArgsSchema, { bookId, index, title }),
  mergeChapter: (bookId: string, index: number): Promise<Chapter[]> =>
    invoke(CH.chapterMerge, mergeChapterArgsSchema, { bookId, index }),
  readChapter: (bookId: string, index: number): Promise<string> =>
    invoke(CH.chapterRead, readChapterArgsSchema, { bookId, index }),
  listBookmarks: (bookId: string): Promise<Bookmark[]> =>
    invoke(CH.bookmarkList, getArgsSchema, { bookId }),
  addBookmark: (input: BookmarkInput): Promise<Bookmark> =>
    invoke(CH.bookmarkAdd, bookmarkAddArgsSchema, input),
  removeBookmark: (id: AnnotationId): Promise<void> =>
    invoke(CH.bookmarkRemove, annotationIdArgsSchema, { id }),
  listHighlights: (bookId: string): Promise<Highlight[]> =>
    invoke(CH.highlightList, getArgsSchema, { bookId }),
  addHighlight: (input: HighlightInput): Promise<Highlight> =>
    invoke(CH.highlightAdd, highlightAddArgsSchema, input),
  removeHighlight: (id: AnnotationId): Promise<void> =>
    invoke(CH.highlightRemove, annotationIdArgsSchema, { id }),
  searchBook: (
    bookId: string,
    query: string,
    scope: SearchScope,
    chapterIndex: number
  ): Promise<SearchResult> =>
    invoke(CH.bookSearch, searchArgsSchema, { bookId, query, scope, chapterIndex }),
  addReadingStat: (bookId: string, ms: number, chars: number): Promise<void> =>
    invoke(CH.statAdd, statAddArgsSchema, { bookId, ms, chars }),
  addReadSpan: (input: ReadSpanInput): Promise<number> =>
    invoke(CH.statRead, statReadArgsSchema, input),
  getBookImages: (bookId: string): Promise<BookImage[]> =>
    invoke(CH.bookImages, getArgsSchema, { bookId }),
  getReadingStats: (days: number): Promise<ReadingStats> =>
    invoke(CH.statGet, statGetArgsSchema, { days }),
  getReadingCalendar: (month: string): Promise<ReadingCalendar> =>
    invoke(CH.statCalendar, statCalendarArgsSchema, { month }),
  checkUpdate: (): Promise<UpdateCheckResult> => invoke(CH.updateCheck, emptyArgsSchema, undefined),
  openUpdatePage: (url: string): Promise<void> => invoke(CH.updateOpen, updateOpenArgsSchema, { url }),
  exportBackup: (): Promise<BackupResult | null> =>
    invoke(CH.backupExport, emptyArgsSchema, undefined),
  getProgress: (bookId: string): Promise<Progress | null> =>
    invoke(CH.progressGet, getArgsSchema, { bookId }),
  saveProgress: (progress: Progress): Promise<void> =>
    invoke(CH.progressSave, progressSchema, progress),
  flushProgress: (progress: Progress): void => {
    const parsed = progressSchema.safeParse(progress)
    if (!parsed.success) {
      console.error('[12read] 参数校验失败: ' + CH.progressFlush)
      return
    }
    void ipcRenderer.sendSync(CH.progressFlush, parsed.data)
  },
  getSettings: (): Promise<ReaderSettings> => invoke(CH.settingsGet, emptyArgsSchema, undefined),
  saveSettings: (settings: ReaderSettings): Promise<ReaderSettings> =>
    invoke(CH.settingsSave, settingsSchema, settings),
  pathForFile: (file: unknown): string =>
    webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
  /** 返回取消订阅函数；回调只拿到校验过的进度对象，拿不到 IpcRendererEvent。 */
  onImportProgress: (callback: (progress: ImportProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      const parsed = importProgressSchema.safeParse(payload)
      if (parsed.success) callback(parsed.data as ImportProgress)
    }
    ipcRenderer.on(CH.importProgress, listener)
    return () => {
      ipcRenderer.removeListener(CH.importProgress, listener)
    }
  }
}

export function expose(): void {
  contextBridge.exposeInMainWorld('reader', readerApi)
}

expose()
