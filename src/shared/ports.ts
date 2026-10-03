import type {
  Book,
  BookId,
  Chapter,
  ImportProgress,
  Progress
} from './types'

/**
 * 平台抽象层（TECH.md 3）。
 * 定义不依赖任何运行时；Electron / Web / Tauri 各自实现，接口不变。
 */

export interface Importer {
  /** 用户选择文件；返回绝对路径。用户取消返回空数组。 */
  pick(): Promise<string[]>
  /** 读字节 → 检测编码 → 解码 → 切分 → 落库。可取消、可报进度。 */
  import(
    filePath: string,
    onProgress: (p: ImportProgress) => void,
    signal?: AbortSignal
  ): Promise<Book>
}

export interface Library {
  list(): Promise<Book[]>
  get(bookId: BookId): Promise<Book | null>
  rename(bookId: BookId, title: string): Promise<Book>
  remove(bookId: BookId): Promise<void>
  chapters(bookId: BookId): Promise<Chapter[]>
}

export interface ContentReader {
  /** 读取第 index 章正文（已解码的字符串）。 */
  readChapter(bookId: BookId, index: number): Promise<string>
}

export interface ProgressStore {
  get(bookId: BookId): Promise<Progress | null>
  save(p: Progress): Promise<void>
}

export interface Ports {
  importer: Importer
  library: Library
  content: ContentReader
  progress: ProgressStore
}
