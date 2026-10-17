import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, protocol } from 'electron'
import { CH } from '@shared/channels'
import type { RestoreResult } from '@shared/types'
import { installCsp } from './csp'
import { AnnotationsRepository } from './db/annotations-repository'
import { openDatabase } from './db/better-sqlite3-driver'
import { LibraryRepository } from './db/library-repository'
import { MetaRepository } from './db/meta-repository'
import { ReadingStatRepository } from './db/reading-repository'
import { runMigrations } from './db/migrate'
import { BookImagesService, IMAGE_SCHEME } from './services/book-images'
import { registerIpc, type IpcContext } from './ipc'
import { BackupService } from './services/backup'
import { ChapterEditor } from './services/chapter-editor'
import { FileContentReader } from './services/content-reader'
import { deviceIdOf } from './services/device-id'
import { DerivedRepair } from './services/derived-repair'
import { ImportService } from './services/importer'
import { booksRoot, dbPath } from './services/layout'
import { LibraryService } from './services/library'
import { SqlProgressStore } from './services/progress-store'
import { ReadingStatsService } from './services/reading-stats'
import { RestoreService } from './services/restore'
import { restoreInPlace } from './services/restore-in-place'
import { BookSearchService } from './services/search'
import { SettingsStore } from './services/settings-store'
import { UpdateService } from './services/update'
import { defaultUpdaterDeps, UpdaterService } from './services/updater'
import { WindowStateStore, captureWindowState } from './services/window-state'
import { createMainWindow } from './window'

const isDev = !app.isPackaged

/**
 * 数据目录固定为 %APPDATA%/12read（TECH.md 5.2），
 * 不跟着 app name 走，避免打包后路径漂移；e2e 用环境变量指到临时目录。
 */
const dataDirOverride = process.env['TWELVE_READ_DATA_DIR']
app.setPath('userData', dataDirOverride ? dataDirOverride : join(app.getPath('appData'), '12read'))

const root = app.getPath('userData')

function broadcast(): (progress: import('@shared/types').ImportProgress) => void {
  return (progress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CH.importProgress, progress)
    }
  }
}

/**
 * 一次「运行时装配」：开库 + 迁移 + 全部仓储/服务 + 启动自愈。
 * 启动时跑一次；**还原备份后原地再跑一次**（1.0.1）—— 换完库文件不退出应用，
 * 把新库重新接上来。所有依赖旧连接的东西都必须在这里造，别在别处攥着 db / repo。
 */
interface LibraryRuntime {
  db: ReturnType<typeof openDatabase>
  meta: MetaRepository
  importer: ImportService
  library: LibraryService
  chapters: ChapterEditor
  annotations: AnnotationsRepository
  content: FileContentReader
  search: BookSearchService
  stats: ReadingStatsService
  backup: BackupService
  restore: RestoreService
  progress: SqlProgressStore
  settings: SettingsStore
  windowState: WindowStateStore
}

async function buildRuntime(): Promise<LibraryRuntime> {
  mkdirSync(root, { recursive: true })
  mkdirSync(booksRoot(root), { recursive: true })

  const db = openDatabase(dbPath(root))
  try {
    const migrated = runMigrations(db, {
      onBeforeMigrate: (from) => {
        const backup = dbPath(root) + '.bak-' + from
        copyFileSync(dbPath(root), backup)
        console.info('[12read] 已把数据库备份到 ' + backup)
      }
    })
    if (migrated.applied.length > 0) {
      console.info('[12read] schema v' + migrated.from + ' -> v' + migrated.to)
    }

    const repo = new LibraryRepository(db)
    const meta = new MetaRepository(db)
    const importer = new ImportService({ root, repo }, broadcast())

    // 启动自愈（0.4.0）：派生正文缺失就按 source.bin 重新提取一次。
    // 还原备份之后每本书都缺正文（包里只放原始文件），靠这一步补齐；
    // 开窗 / 刷新书架前跑完，免得界面已经能点书、正文却还没生成。
    const repaired = await new DerivedRepair({
      root,
      books: () =>
        repo.listBooks().map((book) => ({
          id: book.id,
          title: book.title,
          contentMode: book.contentMode,
          chapterCount: book.chapterCount
        })),
      redecode: (bookId) => importer.redecode(bookId, 'auto', 'repair-' + bookId)
    }).run()
    if (repaired.length > 0) {
      console.info('[12read] 已重新生成 ' + repaired.length + ' 本书的正文（派生文件缺失）')
    }

    // 正文缓存 64MB：阅读与搜索共用同一个实例，别各建一份（0.1.3 第 7 项）
    const content = new FileContentReader(root, repo)

    return {
      db,
      meta,
      importer,
      content,
      library: new LibraryService(root, repo),
      chapters: new ChapterEditor(repo),
      annotations: new AnnotationsRepository(db),
      search: new BookSearchService(content, repo),
      stats: new ReadingStatsService(new ReadingStatRepository(db)),
      backup: new BackupService({ root, db, repo, version: app.getVersion() }),
      restore: new RestoreService({ root, db }),
      progress: new SqlProgressStore(repo),
      settings: new SettingsStore(meta),
      windowState: new WindowStateStore(meta, () => db.isOpen())
    }
  } catch (cause) {
    // 半建好的运行时别留一个开着的连接：上层兜底重启前要能干净退出
    if (db.isOpen()) db.close()
    throw cause
  }
}

/**
 * 内联图片的自定义协议（0.2.0 第 5 项）：`registerSchemesAsPrivileged` 必须在
 * app ready **之前**调用，否则渲染层的 `<img src="reader-image://…">` 会被当成
 * 非法协议挡掉。standard + secure 让它按普通 URL 处理（相对路径、CSP 匹配都正常）。
 */
protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } }
])

// IPC 处理器都在调用时才读 ctx 的字段（ctx.importer.importFile 这种），
// 所以还原后原地换一套实现，处理器不用重新注册 —— 改这个对象就行。
// images（不碰库）/ update / updater（带用户状态）与 deviceId 整个会话只用这一份。
const images = new BookImagesService(root)
const ctx = {
  images,
  update: new UpdateService(),
  updater: new UpdaterService(defaultUpdaterDeps()),
  deviceId: ''
} as IpcContext

let runtime: LibraryRuntime | null = null

function applyRuntime(next: LibraryRuntime): void {
  runtime = next
  ctx.importer = next.importer
  ctx.library = next.library
  ctx.chapters = next.chapters
  ctx.annotations = next.annotations
  ctx.content = next.content
  ctx.search = next.search
  ctx.stats = next.stats
  ctx.backup = next.backup
  ctx.progress = next.progress
  ctx.settings = next.settings
  // 还原编排（1.0.1）：换库 + 原地重建运行时，应用不退出。
  ctx.restore = (zipPath: string): Promise<RestoreResult> =>
    restoreInPlace(
      {
        cancelImports: () => next.importer.cancelAll(),
        swap: (target) => next.restore.restoreFrom(target),
        isDbOpen: () => next.db.isOpen(),
        reopen: async () => applyRuntime(await buildRuntime())
      },
      zipPath
    )
}

function openWindow(): void {
  const win = createMainWindow(runtime?.windowState.get() ?? null)
  win.on('close', () => {
    // 关窗回调在应用退出与还原换库时都会跑，永远读当前运行时（0.1.4）。
    // 写入有 isOpen 与 try/catch 两道闸（0.4.0），连接不在了就跳过，绝不卡关窗。
    runtime?.windowState.set(captureWindowState(win))
  })
}

app.whenReady().then(async () => {
  installCsp(isDev)

  // 内联图片：清单走 IPC，字节走自定义协议（只放行书库内的 images/ 文件）。
  // images 实例整个会话只有一份（只认 root、不碰数据库），还原换库不用动它。
  protocol.handle(IMAGE_SCHEME, (request: Request): Response => {
    const found = images.resolve(request.url)
    if (!found) return new Response('', { status: 404 })
    return new Response(new Uint8Array(found.data), {
      headers: { 'content-type': found.mime, 'cache-control': 'no-store' }
    })
  })

  applyRuntime(await buildRuntime())
  // 本机设备 id 只认一次：还原换库不应该换 deviceId
  ctx.deviceId = deviceIdOf(runtime!.meta)

  // 退出前的收尾（TECH.md 6.3）：永远读当前运行时 —— 还原后旧连接已经作废，
  // 还去 close 旧的会抛「connection is not open」并弹主进程错误框（0.4.0 的坑）。
  app.on('will-quit', () => {
    const current = runtime
    if (current === null) return
    current.importer.cancelAll()
    if (current.db.isOpen()) current.db.close()
  })

  registerIpc(ctx)
  openWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
