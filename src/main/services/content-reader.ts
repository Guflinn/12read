import { readFile } from 'node:fs/promises'
import { LruCache } from '@shared/core/lru'
import type { ContentReader } from '@shared/ports'
import { chapterFilePath, contentPath } from './layout'
import type { LibraryRepository } from '../db/library-repository'

/** 解码文本缓存上限 64MB；JS 字符串按 UTF-16 计，所以字节数除以 2 得到字符数。 */
export const CONTENT_CACHE_MAX_CHARS = (64 * 1024 * 1024) / 2

export class FileContentReader implements ContentReader {
  private readonly cache = new LruCache<string, string>(
    CONTENT_CACHE_MAX_CHARS,
    (text) => text.length * 2
  )

  constructor(
    private readonly root: string,
    private readonly repo: LibraryRepository
  ) {}

  async readChapter(bookId: string, index: number): Promise<string> {
    const book = this.repo.getBook(bookId)
    if (!book) throw new Error('书籍不存在: ' + bookId)
    const chapter = this.repo.getChapter(bookId, index)
    if (!chapter) throw new Error('章节不存在: ' + bookId + ' #' + index)

    if (book.contentMode === 'sliced') {
      return readFile(chapterFilePath(this.root, bookId, index), 'utf8')
    }
    const full = await this.readFull(bookId)
    return full.slice(chapter.startOffset, chapter.startOffset + chapter.charLength)
  }

  async readFull(bookId: string): Promise<string> {
    const cached = this.cache.get(bookId)
    if (cached !== undefined) return cached
    const text = await readFile(contentPath(this.root, bookId), 'utf8')
    this.cache.set(bookId, text)
    return text
  }

  /** 设置变更、重命名等操作后不该留着旧缓存。 */
  invalidate(bookId: string): void {
    this.cache.delete(bookId)
  }
}
