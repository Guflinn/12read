import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import { CH } from '@shared/channels'
import { installCsp } from './csp'
import { AnnotationsRepository } from './db/annotations-repository'
import { openDatabase } from './db/better-sqlite3-driver'
import { LibraryRepository } from './db/library-repository'
import { MetaRepository } from './db/meta-repository'
import { ReadingStatRepository } from './db/reading-repository'
import { runMigrations } from './db/migrate'
import { registerIpc } from './ipc'
import { ChapterEditor } from './services/chapter-editor'
import { FileContentReader } from './services/content-reader'
import { deviceIdOf } from './services/device-id'
import { ImportService } from './services/importer'
import { booksRoot, dbPath } from './services/layout'
import { LibraryService } from './services/library'
import { SqlProgressStore } from './services/progress-store'
import { ReadingStatsService } from './services/reading-stats'
import { BookSearchService } from './services/search'
import { SettingsStore } from './services/settings-store'
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

function bootstrap(): void {
  mkdirSync(root, { recursive: true })
  mkdirSync(booksRoot(root), { recursive: true })

  const db = openDatabase(dbPath(root))
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
  const importer = new ImportService({ root, repo }, broadcast())
  const meta = new MetaRepository(db)

  // 正文缓存 64MB：阅读与搜索共用同一个实例，别各建一份（0.1.3 第 7 项）
  const content = new FileContentReader(root, repo)

  registerIpc({
    importer,
    library: new LibraryService(root, repo),
    chapters: new ChapterEditor(repo),
    annotations: new AnnotationsRepository(db),
    content,
    search: new BookSearchService(content, repo),
    stats: new ReadingStatsService(new ReadingStatRepository(db)),
    progress: new SqlProgressStore(repo),
    settings: new SettingsStore(meta),
    deviceId: deviceIdOf(meta)
  })

  app.on('will-quit', () => {
    importer.cancelAll()
    db.close()
  })
}

app.whenReady().then(() => {
  installCsp(isDev)
  bootstrap()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
