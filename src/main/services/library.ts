import { rm } from 'node:fs/promises'
import type { Library } from '@shared/ports'
import type { Book, Chapter, ShelfBook } from '@shared/types'
import type { LibraryRepository } from '../db/library-repository'
import { bookDir } from './layout'

/** 书库服务：数据库 + 书目录一起管。 */
export class LibraryService implements Library {
  constructor(
    private readonly root: string,
    private readonly repo: LibraryRepository
  ) {}

  async list(): Promise<ShelfBook[]> {
    return this.repo.listBooks()
  }

  async get(bookId: string): Promise<Book | null> {
    return this.repo.getBook(bookId)
  }

  async rename(bookId: string, title: string): Promise<Book> {
    return this.repo.renameBook(bookId, title)
  }

  /** 先删记录再删目录；目录删不掉也只记日志，不能挡住 UI（TECH.md 5.4）。 */
  async remove(bookId: string): Promise<void> {
    this.repo.deleteBook(bookId)
    try {
      await rm(bookDir(this.root, bookId), { recursive: true, force: true })
    } catch (cause) {
      console.error('[12read] 删除书目录失败: ' + bookId, cause)
    }
  }

  async chapters(bookId: string): Promise<Chapter[]> {
    return this.repo.listChapters(bookId)
  }
}
