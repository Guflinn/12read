import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
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
  statAddArgsSchema,
  statReadArgsSchema,
  statCalendarArgsSchema,
  updateOpenArgsSchema,
  statGetArgsSchema
} from '@shared/schema'
import type {
  BackupResult,
  BookImage,
  Book,
  Bookmark,
  Chapter,
  Highlight,
  Progress,
  ReaderSettings,
  ReadingCalendar,
  ReadingStats,
  RestoreResult,
  UpdateCheckResult,
  UpdateProgress,
  SearchResult,
  ShelfBook
} from '@shared/types'
import type { AnnotationsRepository } from './db/annotations-repository'
import type { BackupService } from './services/backup'
import type { BookImagesService } from './services/book-images'
import type { UpdateService } from './services/update'
import type { ChapterEditor } from './services/chapter-editor'
import type { FileContentReader } from './services/content-reader'
import { toImportError, type ImportError } from './services/import-error'
import type { ImportService } from './services/importer'
import type { LibraryService } from './services/library'
import type { SqlProgressStore } from './services/progress-store'
import type { ReadingStatsService } from './services/reading-stats'
import { RestoreError, type RestoreService } from './services/restore'
import { scheduleRestartAfterDelay, spawnDetached } from './services/relaunch'
import type { BookSearchService } from './services/search'
import type { SettingsStore } from './services/settings-store'
import type { UpdaterService } from './services/updater'

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
  /** 阅读统计（0.1.3 第 8 项）。 */
  stats: ReadingStatsService
  /** 导出备份（0.1.3 第 9 项）：只读本机数据打一个 zip。 */
  backup: BackupService
  /** 还原备份（0.4.0）：整库覆盖还原，换完库文件后由本模块负责重启应用。 */
  restore: RestoreService
  /** 检查更新（0.1.5）：拉远端 Release 比版本号；0.4.0 起还负责「去下载」这条退路。 */
  update: UpdateService
  /** 应用内更新（0.4.0）：下载 + 重启安装（走 electron-updater）。 */
  updater: UpdaterService
  /** EPUB 内联图片（0.2.0 第 5 项）。 */
  images: BookImagesService
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

/**
 * 换完库文件后原地重启：主进程里所有仓储都还攥着旧的数据库连接，
 * 与其在进程内重新装配一遍（容易漏掉某个缓存），不如重启来得干净可预期。
 * 留一点延时，好让界面把「还原完成，正在重启」显示出来。
 *
 * 具体怎么拉起新进程（1.0.0 后重做）见 services/relaunch.ts —— 旧的
 * `app.relaunch()` 在免安装版上必然失败（execPath 指向退出即被清理的临时
 * 解包目录），用户看到的就是「应用自己关了，像闪退」。
 *
 * `TWELVE_READ_NO_RELAUNCH=1` 时不重启：**给 e2e 留的口子**（与 TWELVE_READ_DATA_DIR 同类），
 * 因为这个测试要自己关掉应用再重新起一次，比进程内 relaunch 更硬；普通使用不会设它。
 */
/** 把应用内更新的进度推给所有窗口（0.4.0）。 */
function broadcastUpdateProgress(progress: UpdateProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CH.updateProgress, progress)
  }
}

function scheduleRelaunch(): void {
  scheduleRestartAfterDelay({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    portableExecutableFile: process.env['PORTABLE_EXECUTABLE_FILE'],
    noRelaunchEnv: process.env['TWELVE_READ_NO_RELAUNCH'],
    relaunch: () => app.relaunch(),
    spawnDetached,
    exit: (code) => app.exit(code),
    setTimer: setTimeout
  })
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
      title: '选择要导入的书',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的格式', extensions: ['txt', 'epub', 'mobi', 'md', 'pdf'] },
        { name: '纯文本 / Markdown', extensions: ['txt', 'md', 'markdown'] },
        { name: 'EPUB 电子书', extensions: ['epub'] },
        { name: 'MOBI 电子书', extensions: ['mobi'] },
        { name: 'PDF（文字层）', extensions: ['pdf'] }
      ]
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

  handle(CH.bookList, emptyArgsSchema, async (): Promise<ShelfBook[]> => {
    const books = await ctx.library.list()
    // 封面是派生物（books/<id>/images/cover.*），不进库、随文件走
    return books.map((book) => ({ ...book, coverUrl: ctx.images.coverUrl(book.id) }))
  })

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

  // 内联图片清单（0.2.0 第 5 项）：字节走 reader-image:// 协议，这里只给「偏移 → URL」
  handle(CH.bookImages, getArgsSchema, ({ bookId }): BookImage[] => ctx.images.list(bookId))

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

  // 阅读统计：日期换算与汇总都在服务里，ipc 只转发
  handle(CH.statAdd, statAddArgsSchema, ({ bookId, ms, chars }): void => {
    ctx.stats.add({ bookId, ms, chars })
  })

  // 0.1.4：字数不信任渲染层 —— 只收「读完停哪儿了」，去重与累计都在服务里做
  handle(
    CH.statRead,
    statReadArgsSchema,
    ({ bookId, chapterIndex, charOffset, enteredAt }): number =>
      ctx.stats.readAt({ bookId, chapterIndex, charOffset, enteredAt })
  )

  handle(CH.statGet, statGetArgsSchema, ({ days }): ReadingStats => ctx.stats.summary(days))

  // 日历视图（0.1.4）：整月每天的阅读量，没读的日子补 0
  handle(CH.statCalendar, statCalendarArgsSchema, ({ month }): ReadingCalendar =>
    ctx.stats.calendar(month)
  )

  // 检查更新（0.1.5）：只提示不下载；失败一律 null，界面不显示任何东西
  handle(CH.updateCheck, emptyArgsSchema, (): Promise<UpdateCheckResult> => ctx.update.check())

  // 打开下载页：地址由渲染层回传，但两边都只放 github.com 的 https 链接进来
  handle(CH.updateOpen, updateOpenArgsSchema, ({ url }): Promise<void> => ctx.update.open(url))

  // 应用内更新（0.4.0）：下载与安装分成两条通道 —— 下载要能一路报进度，
  // 装的时候必须等用户点头（下载完不会自动重启）。
  ctx.updater.onProgress(broadcastUpdateProgress)
  handle(CH.updateDownload, emptyArgsSchema, (): Promise<UpdateProgress> => ctx.updater.startDownload())
  handle(CH.updateInstall, emptyArgsSchema, (): void => ctx.updater.install())

  // 导出备份：位置由用户在「另存为」里选，取消返回 null；失败翻成中文提示
  handle(CH.backupExport, emptyArgsSchema, async (): Promise<BackupResult | null> => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const picked = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: '十二阅读备份-' + stamp + '.zip',
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    })
    if (picked.canceled || picked.filePath === '') return null
    try {
      return await ctx.backup.exportTo(picked.filePath)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error('导出失败：' + message)
    }
  })

  /**
   * 还原备份（0.4.0）：选一个备份 zip，**整库覆盖**。换库文件后主进程的数据库连接
   * 已经作废，所以无论成败都要重启应用（成功 → 进新库；失败已回滚 → 进旧库）。
   * 界面负责在调这里之前拿到用户的二次确认（会丢当前进度 / 书签 / 划线）。
   */
  handle(CH.backupRestore, emptyArgsSchema, async (): Promise<RestoreResult | null> => {
    const picked = await dialog.showOpenDialog({
      title: '选择要还原的备份包',
      properties: ['openFile'],
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null

    const target = picked.filePaths[0]
    try {
      const result = await ctx.restore.restoreFrom(target)
      scheduleRelaunch()
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!(cause instanceof RestoreError) || !cause.closed) {
        // 包本身不对：库文件一个字都没动，界面 toast 说清就够了
        throw new Error('还原失败：' + message)
      }
      // 已经动过库文件了（连接也关了）：**必须重启**才能干净地继续用。
      // 这种时候界面上的 toast 会被重启抹掉，所以先用系统弹窗把原因讲清楚再重启 ——
      // 失败原因不让人看见的话，用户只会觉得「点了没反应还崩了」。
      await dialog.showMessageBox({
        type: 'error',
        title: '还原失败',
        message,
        detail: '已经退回还原前的书库，应用会重启一次，你的书和进度都还在。',
        buttons: ['知道了'],
        noLink: true
      })
      scheduleRelaunch()
      throw new Error('还原失败：' + message)
    }
  })

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
    // 这是 sendSync：**不管出什么事都得把 returnValue 写回去**，否则渲染层的关窗会一直等。
    // 「还原备份已经把连接关了」那种情况（0.4.0）就靠这一层兜底 —— 进度存不下无所谓，
    // 不能因此卡住关窗。
    try {
      void ctx.progress.save(parsed.data).catch((cause: unknown) => {
        console.warn('[12read] 退出前落盘失败（不影响关窗）', cause)
      })
    } catch (cause) {
      console.warn('[12read] 退出前落盘失败（不影响关窗）', cause)
    }
    event.returnValue = true
  })

  handle(CH.settingsGet, emptyArgsSchema, (): ReaderSettings => ctx.settings.get())

  handle(CH.settingsSave, settingsSchema, (settings): ReaderSettings => ctx.settings.set(settings))
}
