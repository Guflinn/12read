import { create } from 'zustand'
import type { Book, ImportProgress } from '@shared/types'
import { readerApi } from '@/core/api'

export interface LibraryState {
  books: Book[]
  loading: boolean
  error: string | null
  /** 正在导入的任务，按 taskId 覆盖最新一条。 */
  importing: ImportProgress[]
  load(): Promise<void>
  /** 依次导入，返回成功数量；失败信息进 error。 */
  importPaths(paths: readonly string[]): Promise<number>
  pickAndImport(): Promise<void>
  rename(bookId: string, title: string): Promise<void>
  remove(bookId: string): Promise<void>
  applyProgress(progress: ImportProgress): void
  clearError(): void
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  loading: false,
  error: null,
  importing: [],

  async load(): Promise<void> {
    set({ loading: true })
    try {
      const books = await readerApi().listBooks()
      set({ books, loading: false, error: null })
    } catch (cause) {
      set({ loading: false, error: '读取书架失败：' + messageOf(cause) })
    }
  },

  async importPaths(paths: readonly string[]): Promise<number> {
    if (paths.length === 0) return 0
    let ok = 0
    const failures: string[] = []
    for (const filePath of paths) {
      try {
        await readerApi().importFile(filePath)
        ok += 1
      } catch (cause) {
        failures.push(messageOf(cause))
      }
    }
    await get().load()
    set({
      error: failures.length > 0 ? failures.join('；') : null,
      importing: []
    })
    return ok
  },

  async pickAndImport(): Promise<void> {
    try {
      const paths = await readerApi().pickFiles()
      await get().importPaths(paths)
    } catch (cause) {
      set({ error: '选择文件失败：' + messageOf(cause) })
    }
  },

  async rename(bookId: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (trimmed.length === 0) return
    try {
      const updated = await readerApi().renameBook(bookId, trimmed)
      set({ books: get().books.map((b) => (b.id === bookId ? updated : b)) })
    } catch (cause) {
      set({ error: '重命名失败：' + messageOf(cause) })
    }
  },

  async remove(bookId: string): Promise<void> {
    try {
      await readerApi().deleteBook(bookId)
      set({ books: get().books.filter((b) => b.id !== bookId) })
    } catch (cause) {
      set({ error: '删除失败：' + messageOf(cause) })
    }
  },

  applyProgress(progress: ImportProgress): void {
    const rest = get().importing.filter((p) => p.taskId !== progress.taskId)
    // done：任务行消失；error：失败信息已经由 importPaths 收进 error 提示条，
    // 留着只会是一条永远「正在导入」的残留行。
    if (progress.stage === 'done' || progress.stage === 'error') {
      set({ importing: rest })
      return
    }
    set({ importing: [...rest, progress] })
  },

  clearError(): void {
    set({ error: null })
  }
}))
