/**
 * 导出备份（0.1.3 第 9 项）：把整库打成一个 zip。
 * 包里三样东西：
 *   12read-backup.json   清单，方便以后辨认版本与内容
 *   library.db           用 VACUUM INTO 拿的一致快照（book/chapter/progress/bookmark/highlight/reading_stat 全在里面）
 *   books/<id>/source.bin 原始字节，有才打包（留着以后重新解码）
 * 派生出来的 content.txt 与 chapters/NNNN.txt 不进包：它们都能从 source.bin 重新生成。
 * 只做导出不做恢复，所以这里从头到尾不写库、不动 books 目录。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackupResult } from '@shared/types'
import type { SqlDatabase } from '../db/driver'
import { readSchemaVersion } from '../db/migrate'
import { BACKUP_MANIFEST_FILE, SOURCE_FILE, sourcePath } from './layout'
import { createZip, type ZipEntry } from './zip-writer'

/** 清单里记的书：只记能认人的信息，正文不在这里。 */
export interface BackupManifestBook {
  id: string
  title: string
  /** 作者识别不出来时是 null，跟 book.author 一致。 */
  author: string | null
  /** false 表示 books/<id>/source.bin 不在了，这份备份里没有这本书的原始文件。 */
  hasSource: boolean
}

export interface BackupManifestCounts {
  books: number
  chapters: number
  progress: number
  bookmarks: number
  highlights: number
  stats: number
}

export interface BackupManifest {
  app: string
  version: string
  schemaVersion: number
  exportedAt: string
  counts: BackupManifestCounts
  books: BackupManifestBook[]
}

export interface BackupBundle {
  entries: ZipEntry[]
  manifest: BackupManifest
}

/** 只用到 listBooks，用结构化类型就能在单测里给个假的。 */
export interface BackupBookSource {
  listBooks(): { id: string; title: string; author: string | null }[]
}

export interface BackupServiceOptions {
  root: string
  db: SqlDatabase
  repo: BackupBookSource
  /** app.getVersion()：写进清单，以后拿到包能认出是哪个版本导的。 */
  version: string
  now?: () => number
}

/** 统计张数：表不在或者读不出来都当 0，不能让统计拖垮整份备份。 */
function countRows(db: SqlDatabase, table: string): number {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as { n?: unknown } | undefined
    const value = Number(row?.n ?? 0)
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
  } catch {
    return 0
  }
}

export class BackupService {
  private readonly now: () => number

  constructor(private readonly options: BackupServiceOptions) {
    this.now = options.now ?? ((): number => Date.now())
  }

  /** 收集包里的条目与清单（不落盘，方便单测直接看）。 */
  async collect(): Promise<BackupBundle> {
    const { root, db, repo } = this.options
    const books = repo.listBooks()
    const entries: ZipEntry[] = []
    const listed: BackupManifestBook[] = []

    // 快照先做：万一 VACUUM 失败，不要在临时目录里留下一堆读到一半的文件
    const dir = await mkdtemp(join(tmpdir(), '12read-backup-'))
    try {
      const snapshot = join(dir, 'library-snapshot.db')
      db.exec("VACUUM INTO '" + snapshot.replace(/'/g, "''") + "'")
      entries.push({ path: 'library.db', data: await readFile(snapshot) })
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }

    // 一本一本读，别把整个书库同时摊在内存里
    for (const book of books) {
      const data = await readFile(sourcePath(root, book.id)).catch(() => null)
      if (data) entries.push({ path: 'books/' + book.id + '/' + SOURCE_FILE, data })
      listed.push({
        id: book.id,
        title: book.title,
        author: book.author,
        hasSource: data !== null
      })
    }

    const manifest: BackupManifest = {
      app: '十二阅读',
      version: this.options.version,
      schemaVersion: readSchemaVersion(db),
      exportedAt: new Date(this.now()).toISOString(),
      counts: {
        books: books.length,
        chapters: countRows(db, 'chapter'),
        progress: countRows(db, 'progress'),
        bookmarks: countRows(db, 'bookmark'),
        highlights: countRows(db, 'highlight'),
        stats: countRows(db, 'reading_stat')
      },
      books: listed
    }

    entries.push({
      path: BACKUP_MANIFEST_FILE,
      data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    })

    return { entries, manifest }
  }

  /** 打包写到 destination（系统「另存为」已经问过覆盖了）。 */
  async exportTo(destination: string): Promise<BackupResult> {
    const { entries, manifest } = await this.collect()
    const zip = await createZip(entries, new Date(this.now()))
    await writeFile(destination, zip)
    return { path: destination, bytes: zip.length, books: manifest.counts.books }
  }
}
