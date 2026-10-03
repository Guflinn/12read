import type {
  Book,
  BookFormat,
  Chapter,
  ChapterKind,
  ContentMode,
  Encoding,
  Progress,
  ShelfBook,
  CharOffset
} from '@shared/types'

/** 行 -> 领域对象的纯映射。数据库里的脏值一律往安全侧夹紧，绝不把异常抛到 UI。 */
export type SqlRow = Record<string, unknown>

const ENCODINGS: readonly Encoding[] = [
  'utf-8',
  'utf-8-bom',
  'utf-16le',
  'utf-16be',
  'gb18030',
  'unknown'
]

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  return fallback
}

function int(value: unknown, fallback = 0): number {
  return Math.trunc(num(value, fallback))
}

/** 可空整数：SQL NULL 与缺列都映射成 null，绝不悄悄变成 0。 */
function nullableInt(value: unknown): number | null {
  return value === null || value === undefined ? null : int(value)
}

export function asEncoding(value: unknown): Encoding {
  const raw = str(value)
  return (ENCODINGS as readonly string[]).includes(raw) ? (raw as Encoding) : 'unknown'
}

export function asContentMode(value: unknown): ContentMode {
  return value === 'sliced' ? 'sliced' : 'single'
}

export function asChapterKind(value: unknown): ChapterKind {
  return value === 'segment' ? 'segment' : 'chapter'
}

export function toBook(row: SqlRow): Book {
  const format: BookFormat = 'txt'
  return {
    id: str(row['id']),
    title: str(row['title'], '未命名'),
    author: nullableStr(row['author']),
    format,
    encoding: asEncoding(row['encoding']),
    byteSize: int(row['byte_size']),
    charCount: int(row['char_count']),
    chapterCount: int(row['chapter_count']),
    contentMode: asContentMode(row['content_mode']),
    coverSeed: int(row['cover_seed']),
    addedAt: int(row['added_at']),
    lastOpenedAt: nullableInt(row['last_opened_at'])
  }
}

/** 书架列表专用：Book + 进度百分比。percent 缺失或越界都夹到 0..100。 */
export function toShelfBook(row: SqlRow): ShelfBook {
  const percent = num(row['percent'])
  return { ...toBook(row), percent: Math.min(100, Math.max(0, percent)) }
}

export function toChapter(row: SqlRow): Chapter {
  return {
    bookId: str(row['book_id']),
    index: int(row['idx']),
    title: str(row['title']),
    startOffset: int(row['start_offset']) as CharOffset,
    charLength: int(row['char_length']),
    kind: asChapterKind(row['kind'])
  }
}

export function toProgress(row: SqlRow): Progress {
  return {
    bookId: str(row['book_id']),
    chapterIndex: int(row['chapter_index']),
    charOffset: int(row['char_offset']) as CharOffset,
    anchorBefore: nullableStr(row['anchor_before']),
    anchorAfter: nullableStr(row['anchor_after']),
    percent: num(row['percent']),
    updatedAt: int(row['updated_at']),
    deviceId: nullableStr(row['device_id'])
  }
}

/** FNV-1a：同一个书名永远得到同一个封面种子，不用 Math.random。 */
export function coverSeedFromTitle(title: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < title.length; i += 1) {
    hash ^= title.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}
