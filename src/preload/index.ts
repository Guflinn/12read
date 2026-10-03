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
  progressSchema,
  readChapterArgsSchema,
  renameArgsSchema,
  settingsSchema
} from '@shared/schema'
import type { Book, Chapter, ImportProgress, Progress, ReaderSettings, ShelfBook } from '@shared/types'

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
  deleteBook: (bookId: string): Promise<void> => invoke(CH.bookDelete, getArgsSchema, { bookId }),
  chapters: (bookId: string): Promise<Chapter[]> =>
    invoke(CH.bookChapters, getArgsSchema, { bookId }),
  readChapter: (bookId: string, index: number): Promise<string> =>
    invoke(CH.chapterRead, readChapterArgsSchema, { bookId, index }),
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
