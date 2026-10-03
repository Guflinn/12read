import type {
  Book,
  Chapter,
  ChapterKind,
  CharOffset,
  ContentMode,
  Encoding,
  Progress,
  ShelfBook
} from '@shared/types'
import type { SqlDatabase } from './driver'
import { coverSeedFromTitle, toBook, toChapter, toProgress, toShelfBook, type SqlRow } from './mappers'

export interface NewBookRecord {
  id: string
  title: string
  author: string | null
  encoding: Encoding
  byteSize: number
  charCount: number
  contentMode: ContentMode
  addedAt: number
  coverSeed?: number
}

export interface NewChapterRecord {
  title: string
  startOffset: CharOffset
  charLength: number
  kind: ChapterKind
}

const BOOK_COLUMNS =
  'id, title, author, format, encoding, byte_size, char_count, chapter_count, content_mode, cover_seed, added_at, last_opened_at'

const CHAPTER_COLUMNS = 'book_id, idx, title, start_offset, char_length, kind'

const PROGRESS_COLUMNS =
  'book_id, chapter_index, char_offset, anchor_before, anchor_after, percent, updated_at, device_id'

/** 书库仓储：只碰数据库，不碰文件系统。 */
export class LibraryRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** 最近读过的排在前面；从未打开的用导入时间参与排序（MVP 3.3「按最近排序」）。 */
  listBooks(): ShelfBook[] {
    // 进度用 LEFT JOIN 一次带出来：书架不再为每本书各发一次 progress:get（N+1）。
    const rows = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS}, COALESCE(progress.percent, 0) AS percent
         FROM book LEFT JOIN progress ON progress.book_id = book.id
         ORDER BY COALESCE(book.last_opened_at, book.added_at) DESC, book.added_at DESC`
      )
      .all()
    return rows.map((row) => toShelfBook(row as SqlRow))
  }

  getBook(bookId: string): Book | null {
    const row = this.db.prepare(`SELECT ${BOOK_COLUMNS} FROM book WHERE id = ?`).get(bookId)
    return row === undefined || row === null ? null : toBook(row as SqlRow)
  }

  insertBook(record: NewBookRecord, chapters: NewChapterRecord[]): Book {
    const coverSeed = record.coverSeed ?? coverSeedFromTitle(record.title)
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO book (${BOOK_COLUMNS}) VALUES (?, ?, ?, 'txt', ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          record.id,
          record.title,
          record.author,
          record.encoding,
          record.byteSize,
          record.charCount,
          chapters.length,
          record.contentMode,
          coverSeed,
          record.addedAt
        )
      this.replaceChapters(record.id, chapters)
    })
    insert()
    const created = this.getBook(record.id)
    if (!created) throw new Error('导入后写库失败: ' + record.id)
    return created
  }

  renameBook(bookId: string, title: string): Book {
    const result = this.db.prepare('UPDATE book SET title = ? WHERE id = ?').run(title, bookId)
    if (result.changes === 0) throw new Error('书籍不存在: ' + bookId)
    const updated = this.getBook(bookId)
    if (!updated) throw new Error('书籍不存在: ' + bookId)
    return updated
  }

  touchBook(bookId: string, at: number): void {
    this.db.prepare('UPDATE book SET last_opened_at = ? WHERE id = ?').run(at, bookId)
  }

  deleteBook(bookId: string): void {
    this.db.prepare('DELETE FROM book WHERE id = ?').run(bookId)
  }

  replaceChapters(bookId: string, chapters: NewChapterRecord[]): void {
    this.db.prepare('DELETE FROM chapter WHERE book_id = ?').run(bookId)
    const statement = this.db.prepare(
      `INSERT INTO chapter (${CHAPTER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`
    )
    chapters.forEach((chapter, index) => {
      statement.run(bookId, index, chapter.title, chapter.startOffset, chapter.charLength, chapter.kind)
    })
    this.db.prepare('UPDATE book SET chapter_count = ? WHERE id = ?').run(chapters.length, bookId)
  }

  listChapters(bookId: string): Chapter[] {
    const rows = this.db
      .prepare(`SELECT ${CHAPTER_COLUMNS} FROM chapter WHERE book_id = ? ORDER BY idx ASC`)
      .all(bookId)
    return rows.map((row) => toChapter(row as SqlRow))
  }

  getChapter(bookId: string, index: number): Chapter | null {
    const row = this.db
      .prepare(`SELECT ${CHAPTER_COLUMNS} FROM chapter WHERE book_id = ? AND idx = ?`)
      .get(bookId, index)
    return row === undefined || row === null ? null : toChapter(row as SqlRow)
  }

  getProgress(bookId: string): Progress | null {
    const row = this.db
      .prepare(`SELECT ${PROGRESS_COLUMNS} FROM progress WHERE book_id = ?`)
      .get(bookId)
    return row === undefined || row === null ? null : toProgress(row as SqlRow)
  }

  saveProgress(progress: Progress): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO progress (${PROGRESS_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        progress.bookId,
        progress.chapterIndex,
        progress.charOffset,
        progress.anchorBefore,
        progress.anchorAfter,
        progress.percent,
        progress.updatedAt,
        progress.deviceId
      )
  }
}
