import type { Bookmark, CharOffset, Highlight } from '@shared/types'
import type { SqlDatabase } from './driver'
import { toBookmark, toHighlight, type SqlRow } from './mappers'

const BOOKMARK_COLUMNS = 'id, book_id, chapter_index, char_offset, excerpt, created_at'

const HIGHLIGHT_COLUMNS =
  'id, book_id, chapter_index, start_offset, end_offset, text, note, created_at'

export interface NewBookmarkRecord {
  id: string
  bookId: string
  chapterIndex: number
  charOffset: CharOffset
  excerpt: string
  createdAt: number
}

export interface NewHighlightRecord {
  id: string
  bookId: string
  chapterIndex: number
  startOffset: CharOffset
  endOffset: CharOffset
  text: string
  note: string | null
  createdAt: number
}

/**
 * 书签与划线仓储（0.1.3 第 6 项）：只碰数据库，不碰文件系统。
 * 两者都按「章号 + 章内偏移」定位，和进度同一套语义。
 */
export class AnnotationsRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** 按正文顺序返回，阅读器里列表的顺序就跟书里出现的顺序一致。 */
  listBookmarks(bookId: string): Bookmark[] {
    const rows = this.db
      .prepare(
        `SELECT ${BOOKMARK_COLUMNS} FROM bookmark WHERE book_id = ?
         ORDER BY chapter_index ASC, char_offset ASC, created_at ASC`
      )
      .all(bookId)
    return rows.map((row) => toBookmark(row as SqlRow))
  }

  addBookmark(record: NewBookmarkRecord): Bookmark {
    this.db
      .prepare(`INSERT INTO bookmark (${BOOKMARK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        record.id,
        record.bookId,
        record.chapterIndex,
        record.charOffset,
        record.excerpt,
        record.createdAt
      )
    const row = this.db.prepare(`SELECT ${BOOKMARK_COLUMNS} FROM bookmark WHERE id = ?`).get(record.id)
    if (row === undefined || row === null) throw new Error('写书签失败: ' + record.id)
    return toBookmark(row as SqlRow)
  }

  removeBookmark(id: string): void {
    this.db.prepare('DELETE FROM bookmark WHERE id = ?').run(id)
  }

  listHighlights(bookId: string): Highlight[] {
    const rows = this.db
      .prepare(
        `SELECT ${HIGHLIGHT_COLUMNS} FROM highlight WHERE book_id = ?
         ORDER BY chapter_index ASC, start_offset ASC, created_at ASC`
      )
      .all(bookId)
    return rows.map((row) => toHighlight(row as SqlRow))
  }

  addHighlight(record: NewHighlightRecord): Highlight {
    this.db
      .prepare(`INSERT INTO highlight (${HIGHLIGHT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        record.id,
        record.bookId,
        record.chapterIndex,
        record.startOffset,
        record.endOffset,
        record.text,
        record.note,
        record.createdAt
      )
    const row = this.db
      .prepare(`SELECT ${HIGHLIGHT_COLUMNS} FROM highlight WHERE id = ?`)
      .get(record.id)
    if (row === undefined || row === null) throw new Error('写划线失败: ' + record.id)
    return toHighlight(row as SqlRow)
  }

  removeHighlight(id: string): void {
    this.db.prepare('DELETE FROM highlight WHERE id = ?').run(id)
  }
}
