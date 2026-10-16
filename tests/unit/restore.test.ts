import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@main/db/better-sqlite3-driver'
import type { SqlDatabase } from '@main/db/driver'
import { LibraryRepository, type NewChapterRecord } from '@main/db/library-repository'
import { runMigrations } from '@main/db/migrate'
import { BackupService } from '@main/services/backup'
import { createZip } from '@main/services/zip-writer'
import { RestoreError, RestoreService } from '@main/services/restore'
import {
  BACKUP_MANIFEST_FILE,
  BOOKS_DIR,
  SOURCE_FILE,
  bookDir,
  booksRoot,
  dbPath,
  sourcePath
} from '@main/services/layout'

const BOOK_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const BOOK_B = '9c1f0a3e-2b44-4f6d-8a51-7d2c9b0e4f17'
const CHAPTERS: NewChapterRecord[] = [
  { title: '第一章 起点', startOffset: 0, charLength: 10, kind: 'chapter' }
]
const SOURCE_BYTES = Buffer.from('第一章 起点\n他推开门。\n', 'utf8')

const tempDirs: string[] = []
const openDbs: SqlDatabase[] = []

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), '12read-restore-'))
  tempDirs.push(dir)
  return dir
}

function makeDb(root: string): SqlDatabase {
  const db = openDatabase(dbPath(root))
  openDbs.push(db)
  runMigrations(db)
  return db
}

/** 往书库里放一本有原始文件的书（正文是派生物，这里不管）。 */
function seedBook(root: string, db: SqlDatabase, id: string, title: string): void {
  new LibraryRepository(db).insertBook(
    {
      id,
      title,
      author: null,
      encoding: 'utf-8',
      byteSize: SOURCE_BYTES.length,
      charCount: 10,
      contentMode: 'single',
      addedAt: 1
    },
    CHAPTERS
  )
  mkdirSync(bookDir(root, id), { recursive: true })
  writeFileSync(sourcePath(root, id), SOURCE_BYTES)
}

/** 导出成一份真备份（还原侧的用例都从这份包出发）。 */
async function exportBackup(root: string, db: SqlDatabase, destination: string): Promise<void> {
  const service = new BackupService({ root, db, repo: new LibraryRepository(db), version: '0.4.0' })
  await service.exportTo(destination)
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop()
    try {
      db?.close()
    } catch {
      // 还原时会先把连接关掉，这里重复关一下不算错
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('restore: 整库覆盖还原', () => {
  it('导出 → 清空书库 → 还原：书与原始文件都回来，报告数字对得上', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    seedBook(root, db, BOOK_A, '要还原的书')
    seedBook(root, db, BOOK_B, '第二本')

    const zip = join(makeRoot(), 'backup.zip')
    await exportBackup(root, db, zip)

    // 把书库整个清掉（模拟换了台机器 / 重装）—— 注意连 library.db 都不在了
    db.close()
    openDbs.pop()
    rmSync(dbPath(root), { force: true })
    rmSync(booksRoot(root), { recursive: true, force: true })

    // 服务只从传进来的连接读「当前数据结构版本」，所以给一个临时库也行
    const scratch = makeDb(makeRoot())
    const restore = new RestoreService({ root, db: scratch, now: () => 1_760_000_000_000 })
    const report = await restore.restoreFrom(zip)

    expect(report.books).toBe(2)
    expect(report.sources).toBe(2)
    expect(report.schemaVersion).toBe(5)
    expect(report.undoDir).toBeNull() // 还原前一个文件都没有，没东西可退
    expect(report.path).toBe(zip)

    // 原始文件逐字节回来
    expect(readFileSync(sourcePath(root, BOOK_A))).toEqual(SOURCE_BYTES)
    expect(readFileSync(sourcePath(root, BOOK_B))).toEqual(SOURCE_BYTES)

    // 库文件换成备份里那一份：打开能看到两本书（连接已被还原关掉，这里重新开）
    const after = openDatabase(dbPath(root))
    openDbs.push(after)
    const count = after.prepare('SELECT COUNT(*) AS n FROM book').get() as { n: number }
    expect(count.n).toBe(2)
  })

  it('整库覆盖：还原后是备份那一刻的样子（当前库的书与进度都被换掉）', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    seedBook(root, db, BOOK_A, '备份里的书')

    const zip = join(makeRoot(), 'backup.zip')
    await exportBackup(root, db, zip)

    // 备份之后又加了一本、还写了进度：还原之后这些都不该在
    seedBook(root, db, BOOK_B, '备份之后加的书')
    db.prepare(
      'INSERT INTO progress (book_id, chapter_index, char_offset, anchor_before, anchor_after, percent, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(BOOK_A, 0, 5, '', '', 50, 9, 'device-1')

    const restore = new RestoreService({ root, db, now: () => 1_760_000_000_000 })
    const report = await restore.restoreFrom(zip)

    // 旧库（含刚加的那本与进度）被整份挪进 undo 目录，可以反悔
    expect(report.undoDir).not.toBeNull()
    const undo = report.undoDir as string
    expect(existsSync(join(undo, 'library.db'))).toBe(true)
    expect(existsSync(join(undo, BOOKS_DIR, BOOK_B, SOURCE_FILE))).toBe(true)
    expect(existsSync(join(root, BOOKS_DIR, BOOK_B))).toBe(false)

    const after = openDatabase(dbPath(root))
    openDbs.push(after)
    const ids = after.prepare('SELECT id FROM book').all() as { id: string }[]
    expect(ids.map((row) => row.id)).toEqual([BOOK_A])
    const progress = after.prepare('SELECT COUNT(*) AS n FROM progress').get() as { n: number }
    expect(progress.n).toBe(0)
  })

  it('包里的原本不存在的书：还原后书库只剩包里的那些（旧的多余书目录被清掉）', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    seedBook(root, db, BOOK_A, '备份里的书')
    const zip = join(makeRoot(), 'backup.zip')
    await exportBackup(root, db, zip)

    // 手动塞一个不属于备份的野目录，还原后应当不在
    mkdirSync(bookDir(root, 'stray-book'), { recursive: true })

    const restore = new RestoreService({ root, db, now: () => 1 })
    const report = await restore.restoreFrom(zip)

    // 换完库文件连接就是关着的了 —— 主进程里所有仓储都得靠重启才干净（ipc 层据此安排重启）
    expect(db.isOpen()).toBe(false)
    expect(existsSync(bookDir(root, 'stray-book'))).toBe(false)
    expect(existsSync(join(report.undoDir as string, BOOKS_DIR, 'stray-book'))).toBe(true)
  })
})

describe('restore: 校验与错误', () => {
  it('不是 zip 的文件：给中文错误，且一根头发都不动', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    seedBook(root, db, BOOK_A, '原来的书')

    const bogus = join(makeRoot(), 'not-a-zip.zip')
    writeFileSync(bogus, '这不是 zip')

    const restore = new RestoreService({ root, db })
    await expect(restore.restoreFrom(bogus)).rejects.toThrow(/备份包/)

    // 原书库完好（连接没关、文件没换）
    expect(existsSync(sourcePath(root, BOOK_A))).toBe(true)
    const count = db.prepare('SELECT COUNT(*) AS n FROM book').get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('读不到文件 / zip 里没有 library.db：都拒绝', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    const restore = new RestoreService({ root, db })

    await expect(restore.restoreFrom(join(root, '不存在.zip'))).rejects.toThrow(RestoreError)

    const emptyZip = join(makeRoot(), 'empty.zip')
    writeFileSync(emptyZip, await createZip([{ path: 'readme.txt', data: Buffer.from('hi') }]))
    await expect(restore.restoreFrom(emptyZip)).rejects.toThrow(/没有 library\.db/)
  })

  it('清单说这是别的应用的包：拒绝，不动书库', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    seedBook(root, db, BOOK_A, '原来的书')

    const zip = join(makeRoot(), 'other.zip')
    const bytes = await createZip([
      { path: 'library.db', data: readFileSync(dbPath(root)) },
      {
        path: BACKUP_MANIFEST_FILE,
        data: Buffer.from(JSON.stringify({ app: '别的阅读器', schemaVersion: 1 }))
      }
    ])
    writeFileSync(zip, bytes)

    const restore = new RestoreService({ root, db })
    await expect(restore.restoreFrom(zip)).rejects.toThrow(/不是十二阅读/)
    expect(existsSync(sourcePath(root, BOOK_A))).toBe(true)
    // 校验失败发生在关库之前：连接照旧开着，书库一点没动
    expect(db.isOpen()).toBe(true)
  })

  it('备份来自更新的数据格式：拒绝，并说清当前支持到哪一版', async () => {
    const root = makeRoot()
    const db = makeDb(root)

    const zip = join(makeRoot(), 'future.zip')
    const bytes = await createZip([
      { path: 'library.db', data: readFileSync(dbPath(root)) },
      {
        path: BACKUP_MANIFEST_FILE,
        data: Buffer.from(JSON.stringify({ app: '十二阅读', schemaVersion: 99 }))
      }
    ])
    writeFileSync(zip, bytes)

    const restore = new RestoreService({ root, db })
    await expect(restore.restoreFrom(zip)).rejects.toThrow(/当前支持到 v5/)
  })

  it('包里的 library.db 不是 SQLite：拒绝', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    const zip = join(makeRoot(), 'fake-db.zip')
    writeFileSync(
      zip,
      await createZip([{ path: 'library.db', data: Buffer.from('这不是数据库') }])
    )

    const restore = new RestoreService({ root, db })
    await expect(restore.restoreFrom(zip)).rejects.toThrow(/数据库文件不完整/)
  })
})
