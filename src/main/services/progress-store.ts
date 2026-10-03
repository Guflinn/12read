import type { ProgressStore } from '@shared/ports'
import type { Progress } from '@shared/types'
import type { LibraryRepository } from '../db/library-repository'

/** 进度落库；同时把 last_opened_at 推到 shelf 排序用的「最近」。 */
export class SqlProgressStore implements ProgressStore {
  constructor(private readonly repo: LibraryRepository) {}

  async get(bookId: string): Promise<Progress | null> {
    return this.repo.getProgress(bookId)
  }

  async save(progress: Progress): Promise<void> {
    this.repo.saveProgress(progress)
    this.repo.touchBook(progress.bookId, progress.updatedAt)
  }
}
