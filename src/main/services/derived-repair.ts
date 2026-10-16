/**
 * 启动自愈：派生正文缺失时按原始文件重新提取一次（0.4.0）。
 *
 * 为什么需要它：备份还原（`restore.ts`）只把**原始文件**与数据库快照放进包里 ——
 * content.txt / chapters/ / images/ 都是能重新生成的派生物，不进包（0.1.3 的口径）。
 * 所以还原之后每本书都缺正文，靠这一步补齐；顺带也兜住「用户手贱删了某个
 * content.txt」这类意外，不必让他重新导入。
 *
 * 做的事与书卡上的「提取」完全一样（`ImportService.redecode`）：用 source.bin 重跑一遍
 * 提取器，重写派生文件并把章节表刷新成新提取的结果 —— 同一版本重新提取是逐字节等价的，
 * 所以进度 / 书签 / 划线不受影响；万一提取器改过（跨版本还原），章节表与正文仍是一致的。
 *
 * 约束：**一本失败不阻塞启动**（只记日志），原始文件也没了的书直接跳过（修不了）。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentMode } from '@shared/types'
import { CHAPTERS_DIR, CONTENT_FILE, bookDir, sourcePath } from './layout'

export interface RepairBook {
  id: string
  title: string
  contentMode: ContentMode
  /** 章节数：切片模式下用来判断有没有切漏（文件数对不上就重做）。 */
  chapterCount: number
}

export interface DerivedRepairDeps {
  exists(path: string): boolean
  list(dir: string): string[]
}

const nodeDeps: DerivedRepairDeps = {
  exists: existsSync,
  list: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  }
}

/**
 * 这本书的派生正文要重做吗？
 * - 整本一个文件（single）：content.txt 不在 → 要
 * - 按章切片（sliced）：chapters/ 不在，或者里面的文件数少于章节数 → 要
 */
export function needsDerivedRepair(
  root: string,
  book: RepairBook,
  deps: DerivedRepairDeps = nodeDeps
): boolean {
  const dir = bookDir(root, book.id)
  if (book.contentMode === 'sliced') {
    const files = deps.list(join(dir, CHAPTERS_DIR))
    return files.length < book.chapterCount
  }
  return !deps.exists(join(dir, CONTENT_FILE))
}

export interface DerivedRepairOptions {
  root: string
  /** 库里的书（每次 run 现取，别缓存 —— 还原之后库已经换了）。 */
  books(): RepairBook[]
  /** 重新提取（与书卡上的「提取」同一个动作）。 */
  redecode(bookId: string): Promise<unknown>
  log?: (message: string, cause?: unknown) => void
  deps?: DerivedRepairDeps
}

export class DerivedRepair {
  private readonly deps: DerivedRepairDeps

  constructor(private readonly options: DerivedRepairOptions) {
    this.deps = options.deps ?? nodeDeps
  }

  /** 返回这次补过的书（正常情况是空数组，启动开销就是几次 existsSync）。 */
  async run(): Promise<RepairBook[]> {
    const { root } = this.options
    const repaired: RepairBook[] = []

    for (const book of this.options.books()) {
      if (!needsDerivedRepair(root, book, this.deps)) continue
      // 原始文件也没了：修不了，等用户打开时给「找不到原始文件」的提示
      if (!this.deps.exists(sourcePath(root, book.id))) continue
      try {
        await this.options.redecode(book.id)
        repaired.push(book)
      } catch (cause) {
        this.log('重新生成正文失败：' + book.title, cause)
      }
    }

    return repaired
  }

  private log(message: string, cause?: unknown): void {
    if (this.options.log) {
      this.options.log(message, cause)
      return
    }
    console.warn('[12read] ' + message, cause)
  }
}
