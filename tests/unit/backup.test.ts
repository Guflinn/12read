import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@main/db/better-sqlite3-driver'
import type { SqlDatabase } from '@main/db/driver'
import { LibraryRepository, type NewChapterRecord } from '@main/db/library-repository'
import { runMigrations } from '@main/db/migrate'
import { BackupService, type BackupManifest } from '@main/services/backup'
import { BACKUP_MANIFEST_FILE, SOURCE_FILE, bookDir, dbPath, sourcePath } from '@main/services/layout'

const BOOK_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const BOOK_B = '9c1f0a3e-2b44-4f6d-8a51-7d2c9b0e4f17'

const CHAPTERS: NewChapterRecord[] = [
  { title: '第一章 起点', startOffset: 0, charLength: 10, kind: 'chapter' }
]

const tempDirs: string[] = []
const openDbs: SqlDatabase[] = []

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), '12read-backup-'))
  tempDirs.push(dir)
  return dir
}

function makeDb(root: string): SqlDatabase {
  const db = openDatabase(dbPath(root))
  openDbs.push(db)
  runMigrations(db)
  return db
}

/** 从 zip 里按名字取内容（结构本身由 zip-writer.test.ts 校验）。 */
function readZip(zip: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let cursor = zip.length - 22
  const count = zip.readUInt16LE(cursor + 10)
  cursor = zip.readUInt32LE(cursor + 16)

  for (let index = 0; index < count; index += 1) {
    const method = zip.readUInt16LE(cursor + 10)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const path = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26)
    const raw = zip.subarray(start, start + compressedSize)
    files.set(path, method === 8 ? inflateRawSync(raw) : Buffer.from(raw))
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return files
}

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('backup: 打包内容', () => {
  it('包里是数据库快照 + 原始文件 + 清单，统计按表数出来', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    const repo = new LibraryRepository(db)
    repo.insertBook(
      {
        id: BOOK_A,
        title: '有源文件的书',
        author: '作者甲',
        encoding: 'utf-8',
        byteSize: 32,
        charCount: 10,
        contentMode: 'single',
        addedAt: 2
      },
      CHAPTERS
    )
    repo.insertBook(
      {
        id: BOOK_B,
        title: '没有作者的书',
        author: null,
        encoding: 'gb18030',
        byteSize: 8,
        charCount: 4,
        contentMode: 'single',
        addedAt: 1
      },
      []
    )
    mkdirSync(bookDir(root, BOOK_A), { recursive: true })
    writeFileSync(sourcePath(root, BOOK_A), Buffer.from('第1章 原始的字节', 'utf8'))

    db.prepare(
      'INSERT INTO progress (book_id, chapter_index, char_offset, anchor_before, anchor_after, percent, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(BOOK_A, 0, 3, '', '', 30, 5, 'device-1')
    db.prepare(
      'INSERT INTO bookmark (id, book_id, chapter_index, char_offset, excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('k1', BOOK_A, 0, 3, '摘要', 5)
    db.prepare(
      'INSERT INTO highlight (id, book_id, chapter_index, start_offset, end_offset, text, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('h1', BOOK_A, 0, 1, 3, '划的原文', null, 6)
    db.prepare(
      'INSERT INTO reading_stat (book_id, day, ms, chars, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(BOOK_A, '2026-10-05', 60_000, 500, 7)

    const stamp = new Date(2026, 9, 5, 8, 30, 0).getTime()
    const service = new BackupService({ root, db, repo, version: '0.1.2', now: () => stamp })
    const { entries, manifest } = await service.collect()

    expect(entries.map((entry) => entry.path)).toEqual([
      'library.db',
      'books/' + BOOK_A + '/' + SOURCE_FILE,
      BACKUP_MANIFEST_FILE
    ])
    expect(manifest.version).toBe('0.1.2')
    expect(manifest.schemaVersion).toBe(4)
    expect(manifest.exportedAt).toBe(new Date(stamp).toISOString())
    expect(manifest.counts).toEqual({
      books: 2,
      chapters: 1,
      progress: 1,
      bookmarks: 1,
      highlights: 1,
      stats: 1,
      spans: 0
    })
    expect(manifest.books).toEqual([
      { id: BOOK_A, title: '有源文件的书', author: '作者甲', hasSource: true },
      { id: BOOK_B, title: '没有作者的书', author: null, hasSource: false }
    ])
  })

  it('清单条目里的 JSON 与 collect 返回的一致，缩进两格且以换行结尾', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    const repo = new LibraryRepository(db)

    const service = new BackupService({ root, db, repo, version: '0.1.2', now: () => 1 })
    const { entries, manifest } = await service.collect()
    const entry = entries.find((item) => item.path === BACKUP_MANIFEST_FILE)
    const text = (entry?.data ?? Buffer.alloc(0)).toString('utf8')

    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text) as BackupManifest).toEqual(manifest)
    expect(text).toBe(JSON.stringify(manifest, null, 2) + '\n')
  })

  it('source.bin 不见了也照打包，清单里标 hasSource=false', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    const repo = new LibraryRepository(db)
    repo.insertBook(
      {
        id: BOOK_A,
        title: '缺原始文件',
        author: null,
        encoding: 'utf-8',
        byteSize: 1,
        charCount: 1,
        contentMode: 'single',
        addedAt: 1
      },
      CHAPTERS
    )

    const service = new BackupService({ root, db, repo, version: '0.1.2' })
    const { entries, manifest } = await service.collect()

    expect(entries.map((entry) => entry.path)).toEqual(['library.db', BACKUP_MANIFEST_FILE])
    expect(manifest.books[0]?.hasSource).toBe(false)
    expect(manifest.counts.books).toBe(1)
  })
})

describe('backup: 落盘', () => {
  it('exportTo 写出的 zip 能解开，含快照、原始文件与清单', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    const repo = new LibraryRepository(db)
    repo.insertBook(
      {
        id: BOOK_A,
        title: '快照验证',
        author: null,
        encoding: 'utf-8',
        byteSize: 4,
        charCount: 4,
        contentMode: 'single',
        addedAt: 1
      },
      CHAPTERS
    )
    mkdirSync(bookDir(root, BOOK_A), { recursive: true })
    writeFileSync(sourcePath(root, BOOK_A), Buffer.from('正文', 'utf8'))

    const service = new BackupService({ root, db, repo, version: '0.1.2' })
    const destination = join(root, 'export.zip')
    const result = await service.exportTo(destination)

    expect(result.path).toBe(destination)
    expect(result.books).toBe(1)
    expect(result.bytes).toBe(statSync(destination).size)

    const files = readZip(readFileSync(destination))
    expect([...files.keys()]).toEqual([
      'library.db',
      'books/' + BOOK_A + '/' + SOURCE_FILE,
      BACKUP_MANIFEST_FILE
    ])
    expect(files.get('books/' + BOOK_A + '/' + SOURCE_FILE)?.toString('utf8')).toBe('正文')
    expect(files.get(BACKUP_MANIFEST_FILE)?.toString('utf8')).toContain('"books": 1')
  })

  it('快照里的库是完整可用的：能打开、能查到书与章节', async () => {
    const root = makeRoot()
    const db = makeDb(root)
    const repo = new LibraryRepository(db)
    repo.insertBook(
      {
        id: BOOK_A,
        title: '快照验证',
        author: '作者甲',
        encoding: 'utf-8',
        byteSize: 4,
        charCount: 10,
        contentMode: 'single',
        addedAt: 1
      },
      CHAPTERS
    )

    const service = new BackupService({ root, db, repo, version: '0.1.2' })
    const { entries } = await service.collect()
    const snapshot = entries.find((entry) => entry.path === 'library.db')
    const snapshotPath = join(root, 'snapshot-check.db')
    writeFileSync(snapshotPath, snapshot?.data ?? Buffer.alloc(0))

    const opened = openDatabase(snapshotPath)
    openDbs.push(opened)
    const books = opened.prepare('SELECT COUNT(*) AS n FROM book').get() as { n: number }
    const chapters = opened.prepare('SELECT COUNT(*) AS n FROM chapter').get() as { n: number }
    const title = opened.prepare('SELECT title FROM book WHERE id = ?').get(BOOK_A) as {
      title: string
    }

    expect(books.n).toBe(1)
    expect(chapters.n).toBe(1)
    expect(title.title).toBe('快照验证')
  })
})
