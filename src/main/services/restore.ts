/**
 * 备份还原（0.4.0）：把导出备份的 zip 恢复成整库。
 *
 * 语义（2026-10-16 用户拍板）：**整库覆盖** —— 还原之后书库就是备份那一刻的样子，
 * 当前库里的书、进度、书签、划线全部被替换掉。所以：
 *   ① 还原前把**当前书库整份挪到 `<root>/restore-undo-<时间>`**（不是复制，省一半空间），
 *      想反悔就把这个目录里的东西搬回去；
 *   ② 调用方必须先拿到用户的明确二次确认（界面上的弹窗负责这件事）；
 *   ③ 失败一律回滚：要么是旧库、要么是新库，绝不留一个半拉子书库。
 *
 * 包里只带**原始文件**（source.bin）与数据库快照，派生正文（content.txt / chapters/）
 * 不进包（0.1.3 的口径：能重新生成的东西不进包）。所以还原之后，
 * 每本书的正文由启动自愈（`derived-repair.ts`）按 source.bin 重新提取一次补齐。
 *
 * 换完库文件后**必须重启应用**：主进程里所有的仓储都还攥着旧的数据库连接。
 */
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RestoreResult } from '@shared/types'
import type { SqlDatabase } from '../db/driver'
import { readSchemaVersion } from '../db/migrate'
import { openZip, ZipError, type ZipArchive } from './epub/zip-reader'
import { BACKUP_MANIFEST_FILE, BOOKS_DIR, DB_FILE, SOURCE_FILE, bookDir, booksRoot, dbPath } from './layout'

/** ZIP 里每本书的原始文件：`books/<id>/source.bin`。 */
const BOOK_ENTRY_RE = /^books\/([0-9a-zA-Z_-]{1,64})\/source\.bin$/

/** SQLite 文件头：确认包里的 library.db 真是个数据库，而不是空文件或别的东西。 */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\u0000', 'utf8')

/** message 是给人看的中文，界面直接显示。 */
export class RestoreError extends Error {
  constructor(
    message: string,
    /** true 表示数据库连接已经关了（换库文件之前就关）—— 调用方必须重启应用才干净。 */
    readonly closed: boolean = false
  ) {
    super(message)
    this.name = 'RestoreError'
  }
}

export interface RestoreServiceOptions {
  root: string
  db: SqlDatabase
  now?: () => number
  /** 只为了让单测能在「解压到临时目录」这一步插一脚（默认用系统临时目录）。 */
  tempRoot?: string
}

interface StagedBook {
  id: string
  path: string
}

/**
 * Windows 上 rename 会因为「文件被别的进程短暂占着」失败（另一个实例、杀毒、索引器），
 * 而库文件与 books 目录恰恰是最容易被碰的。挪旧库这一步失败就会走回滚，
 * 用户看到的是「还原失败」—— 所以这里给几次重试，多半第二次就成了。
 */
async function renameWithRetry(from: string, to: string, attempts = 4): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (cause) {
      if (attempt >= attempts) throw cause
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
}

/** 简单的时间戳（用于 undo 目录名）：20261016-181530。 */
function stampOf(ms: number): string {
  const iso = new Date(ms).toISOString()
  return iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 19).replace(/:/g, '')
}

export class RestoreService {
  private readonly now: () => number

  constructor(private readonly options: RestoreServiceOptions) {
    this.now = options.now ?? ((): number => Date.now())
  }

  /**
   * 还原：读包 → 校验 → 解出原始文件 → 关库 → 换库 → 返回报告。
   * 返回后**必须重启应用**（数据库连接已关、文件已换）。
   */
  async restoreFrom(zipPath: string): Promise<RestoreResult> {
    const { root, db } = this.options

    const bytes = await readFile(zipPath).catch(() => null)
    if (bytes === null) throw new RestoreError('读不到这个文件：' + zipPath)

    let archive: ZipArchive
    try {
      archive = openZip(bytes)
    } catch (cause) {
      throw new RestoreError(cause instanceof ZipError ? '这个文件不是有效的备份包：' + cause.message : '这个文件不是有效的备份包')
    }

    if (!archive.has(DB_FILE)) {
      throw new RestoreError('这不是十二阅读的备份包（里面没有 library.db）')
    }
    const libraryDb = archive.read(DB_FILE)
    if (libraryDb === null || !libraryDb.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
      throw new RestoreError('备份包里的数据库文件不完整，没法还原')
    }

    const manifest = readManifest(archive)
    const currentSchema = readSchemaVersion(db)
    if (manifest.schemaVersion !== null && manifest.schemaVersion > currentSchema) {
      throw new RestoreError(
        '这份备份来自更新的版本（数据格式 v' + manifest.schemaVersion + '，当前支持到 v' + currentSchema + '），请先升级十二阅读再还原'
      )
    }

    const staged = await this.stageSources(archive)
    try {
      return await this.swap(root, db, libraryDb, staged, manifest, zipPath)
    } finally {
      await rm(staged.root, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** 把包里的 books/<id>/source.bin 解到临时目录（先全部解出来，再动现有书库）。 */
  private async stageSources(archive: ZipArchive): Promise<{ root: string; books: StagedBook[] }> {
    const root = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), '12read-restore-'))
    const books: StagedBook[] = []

    for (const name of archive.names) {
      const match = BOOK_ENTRY_RE.exec(name)
      if (match === null) continue
      const id = match[1]
      const data = archive.read(name)
      if (data === null) continue
      const target = join(root, BOOKS_DIR, id, SOURCE_FILE)
      await mkdir(join(root, BOOKS_DIR, id), { recursive: true })
      await writeFile(target, data)
      books.push({ id, path: target })
    }

    return { root, books }
  }

  /**
   * 换库：旧库整体挪到 undo 目录 → 铺新库 → 失败回滚。
   * 关连接之后才动文件（WAL 还在的话库文件未必落全）。
   */
  private async swap(
    root: string,
    db: SqlDatabase,
    libraryDb: Buffer,
    staged: { root: string; books: StagedBook[] },
    manifest: { exportedAt: string | null; schemaVersion: number | null; books: number },
    zipPath: string
  ): Promise<RestoreResult> {
    const undoDir = join(root, 'restore-undo-' + stampOf(this.now()))
    const liveDb = dbPath(root)
    const liveBooks = booksRoot(root)

    db.close()
    try {
      // ① 旧库挪走（不是删：用户还有一次反悔的机会）
      await mkdir(undoDir, { recursive: true })
      let moved = false
      if (existsSync(liveDb)) {
        await renameWithRetry(liveDb, join(undoDir, DB_FILE))
        moved = true
      }
      // 关连接后 WAL / SHM 是残留，直接删掉；不删的话新库会被旧 WAL 污染
      for (const suffix of ['-wal', '-shm']) await rm(liveDb + suffix, { force: true })
      if (existsSync(liveBooks)) {
        await renameWithRetry(liveBooks, join(undoDir, BOOKS_DIR))
        moved = true
      }
      if (!moved) await rm(undoDir, { recursive: true, force: true })

      // ② 铺新库
      await mkdir(liveBooks, { recursive: true })
      await writeFile(liveDb, libraryDb)
      for (const book of staged.books) {
        const target = bookDir(root, book.id)
        await mkdir(target, { recursive: true })
        await copyFile(book.path, join(target, SOURCE_FILE))
      }

      return {
        path: zipPath,
        books: manifest.books,
        sources: staged.books.length,
        restoredAt: new Date(this.now()).toISOString(),
        exportedAt: manifest.exportedAt,
        schemaVersion: manifest.schemaVersion,
        undoDir: moved ? undoDir : null
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      await this.rollback(root, undoDir, liveDb, liveBooks)
      throw new RestoreError('还原失败，已经退回原来的书库：' + message, true)
    }
  }

  /** 回滚：把半铺的新库删掉，再把 undo 里的旧库搬回原位。 */
  private async rollback(root: string, undoDir: string, liveDb: string, liveBooks: string): Promise<void> {
    await rm(liveBooks, { recursive: true, force: true }).catch(() => undefined)
    await rm(liveDb, { force: true }).catch(() => undefined)
    for (const suffix of ['-wal', '-shm']) await rm(liveDb + suffix, { force: true }).catch(() => undefined)
    const oldDb = join(undoDir, DB_FILE)
    const oldBooks = join(undoDir, BOOKS_DIR)
    if (existsSync(oldDb)) await renameWithRetry(oldDb, liveDb).catch(() => undefined)
    if (existsSync(oldBooks)) await renameWithRetry(oldBooks, booksRoot(root)).catch(() => undefined)
    await rm(undoDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

interface ManifestInfo {
  books: number
  exportedAt: string | null
  schemaVersion: number | null
}

/**
 * 读清单。清单不是必需品（老包或手改过的包可能没有），所以读不出来就当没有 ——
 * 但**认得出来的字段一律校验**：`app` 不是十二阅读的包直接拒，schemaVersion 比当前新也拒。
 */
function readManifest(archive: ZipArchive): ManifestInfo {
  const text = archive.has(BACKUP_MANIFEST_FILE) ? archive.readText(BACKUP_MANIFEST_FILE) : null
  if (text === null) return { books: 0, exportedAt: null, schemaVersion: null }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RestoreError('备份包里的清单读不懂（不是合法 JSON），没法确认这是十二阅读的备份')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new RestoreError('备份包里的清单读不懂，没法确认这是十二阅读的备份')
  }
  const record = parsed as Record<string, unknown>
  if (record['app'] !== '十二阅读') {
    throw new RestoreError('这个包不是十二阅读导出的备份')
  }
  const books = Array.isArray(record['books']) ? record['books'].length : 0
  const exportedAt = typeof record['exportedAt'] === 'string' ? record['exportedAt'] : null
  const schemaVersion = typeof record['schemaVersion'] === 'number' ? record['schemaVersion'] : null
  return { books, exportedAt, schemaVersion }
}

/** 备份文件是否存在且像个文件（给界面上的按钮做前置判断用）。 */
export async function isRestorableFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  return info !== null && info.isFile() && info.size > 0
}
