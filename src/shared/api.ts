import type { Book, Chapter, ImportProgress, Progress, ReaderSettings } from './types'

/**
 * 渲染进程可见的 API 契约（TECH.md 4.2）。
 * preload 按这个接口实现并挂到 window.reader；渲染进程只依赖这份类型，
 * 不 import 任何 Electron / Node 模块。
 */
export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** 本机设备 id，写进 Progress.deviceId，为将来的同步预留。 */
  deviceId: string
}

export interface ReaderApi {
  appInfo(): Promise<AppInfo>
  /** 打开系统文件选择器；取消返回空数组。 */
  pickFiles(): Promise<string[]>
  importFile(filePath: string): Promise<Book>
  cancelTask(taskId: string): Promise<void>
  listBooks(): Promise<Book[]>
  getBook(bookId: string): Promise<Book | null>
  renameBook(bookId: string, title: string): Promise<Book>
  deleteBook(bookId: string): Promise<void>
  chapters(bookId: string): Promise<Chapter[]>
  readChapter(bookId: string, index: number): Promise<string>
  getProgress(bookId: string): Promise<Progress | null>
  saveProgress(progress: Progress): Promise<void>
  getSettings(): Promise<ReaderSettings>
  saveSettings(settings: ReaderSettings): Promise<ReaderSettings>
  /** 订阅导入进度，返回取消订阅函数。 */
  onImportProgress(callback: (progress: ImportProgress) => void): () => void
  /**
   * 把拖放进来的 DOM File 换成真实磁盘路径（Electron 32 起没有 file.path）。
   * 渲染进程仍只把路径交给 main，自己从不读文件。
   */
  pathForFile(file: unknown): string
}
