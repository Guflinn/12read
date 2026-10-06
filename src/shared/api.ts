import type {
  AnnotationId,
  BackupResult,
  Book,
  Bookmark,
  BookmarkInput,
  Chapter,
  Highlight,
  HighlightInput,
  ImportProgress,
  ManualEncoding,
  Progress,
  ReadSpanInput,
  ReadingCalendar,
  ReaderSettings,
  ReadingStats,
  SearchResult,
  SearchScope,
  ShelfBook
} from './types'

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
  listBooks(): Promise<ShelfBook[]>
  getBook(bookId: string): Promise<Book | null>
  renameBook(bookId: string, title: string): Promise<Book>
  /**
   * 用指定编码把已导入的书重新解码一遍（原始字节留在 books/<id>/source.bin）。
   * 重新解码后字符偏移全部变化，所以这本书的阅读进度会被清零。
   */
  redecodeBook(bookId: string, encoding: ManualEncoding): Promise<Book>
  deleteBook(bookId: string): Promise<void>
  chapters(bookId: string): Promise<Chapter[]>
  /** 手动改分章（目录里用）：都返回改完的整份章节表，进度按字符位置重新落位。 */
  renameChapter(bookId: string, index: number, title: string): Promise<Chapter[]>
  mergeChapter(bookId: string, index: number): Promise<Chapter[]>
  readChapter(bookId: string, index: number): Promise<string>
  /**
   * 书签与划线（0.1.3 第 6 项）：都按「章号 + 章内偏移」定位，与进度同一套语义；
   * 划线记的是同一章里的 startOffset..endOffset，note 本版一律 null。
   */
  listBookmarks(bookId: string): Promise<Bookmark[]>
  addBookmark(input: BookmarkInput): Promise<Bookmark>
  removeBookmark(id: AnnotationId): Promise<void>
  listHighlights(bookId: string): Promise<Highlight[]>
  addHighlight(input: HighlightInput): Promise<Highlight>
  removeHighlight(id: AnnotationId): Promise<void>
  /**
   * 章节内 / 全书搜索（0.1.3 第 7 项）：整本一次扫完，命中的位置用当前章节表换算成章号 + 章内偏移。
   * query 传原始输入即可，归一化（trim + 截到 80 字）在主进程做。
   */
  searchBook(bookId: string, query: string, scope: SearchScope, chapterIndex: number): Promise<SearchResult>
  /**
   * 阅读统计（0.1.3 第 8 项）：renderer 每 15 秒报一次「这段时间读了多少」，
   * 主进程按本地日期累加；书架上的统计面板用 getReadingStats 汇总。
   */
  addReadingStat(bookId: string, ms: number, chars: number): Promise<void>
  /**
   * 阅读统计（0.1.4）：报「在这个位置停下读过一会儿」。字数由主进程按
   * `reading_span` 里当天的水位线去重后计算（同一段当天只算一次，
   * 拖过去的整段不算），返回这次记了多少字。
   */
  addReadSpan(input: ReadSpanInput): Promise<number>
  getReadingStats(days: number): Promise<ReadingStats>
  /** 日历视图（0.1.4）：某个自然月每天的阅读量，没读的日子补 0。 */
  getReadingCalendar(month: string): Promise<ReadingCalendar>
  /**
   * 导出备份（0.1.3 第 9 项）：主进程弹「另存为」，把整库打成一个 zip。
   * 用户取消返回 null；导出本身只读本机数据，不会动书库。
   */
  exportBackup(): Promise<BackupResult | null>
  getProgress(bookId: string): Promise<Progress | null>
  saveProgress(progress: Progress): Promise<void>
  /**
   * 关窗/退出前的同步落盘（TECH.md 6.3）：走 sendSync，主进程写完才返回。
   * 参数非法时静默失败（只在控制台记账），绝不阻塞关窗。
   */
  flushProgress(progress: Progress): void
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
