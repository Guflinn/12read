import { clampOffset } from '@shared/core/anchor'
import type { Chapter, CharOffset, ChapterKind } from '@shared/types'
import type { LibraryRepository, NewChapterRecord } from '../db/library-repository'
import { ImportError } from './import-error'

/** 编辑期间的章节草稿：只有章节表用得上的字段，索引写回时由仓储重排。 */
interface DraftChapter {
  title: string
  startOffset: CharOffset
  charLength: number
  kind: ChapterKind
}

/**
 * 手动改分章（MVP 0.1.3 第 5 项）。
 * 正文一个字都不动，只重写章节表；进度按「绝对字符位置」重新落位，
 * 所以合并 / 改名都不会把人从正在读的地方弹走。
 */
export class ChapterEditor {
  constructor(private readonly repo: LibraryRepository) {}

  /** 改章节标题。 */
  rename(bookId: string, index: number, title: string): Chapter[] {
    const chapters = this.load(bookId)
    const target = this.pick(chapters, index)
    target.title = title
    return this.apply(bookId, chapters, this.absoluteOf(bookId, chapters))
  }

  /** 把第 index+1 章并进第 index 章：标题沿用前者，范围一直连到后者的结尾。 */
  merge(bookId: string, index: number): Chapter[] {
    const chapters = this.load(bookId)
    const absolute = this.absoluteOf(bookId, chapters)
    const head = this.pick(chapters, index)
    const tail = chapters[index + 1]
    if (tail === undefined) {
      throw new ImportError('db-error', '这已经是最后一章，后面没有可以合并的章节')
    }
    head.charLength = tail.startOffset + tail.charLength - head.startOffset
    chapters.splice(index + 1, 1)
    return this.apply(bookId, chapters, absolute)
  }

  private load(bookId: string): DraftChapter[] {
    const chapters = this.repo.listChapters(bookId)
    if (chapters.length === 0) throw new ImportError('db-error', '这本书还没有章节')
    return chapters.map((chapter) => ({
      title: chapter.title,
      startOffset: chapter.startOffset,
      charLength: chapter.charLength,
      kind: chapter.kind
    }))
  }

  private pick(chapters: DraftChapter[], index: number): DraftChapter {
    const target = chapters[index]
    if (target === undefined) throw new ImportError('db-error', '章节不存在: ' + index)
    return target
  }

  /** 编辑前把进度换算成全书绝对字符位置；没有进度就返回 null。 */
  private absoluteOf(bookId: string, chapters: DraftChapter[]): number | null {
    const progress = this.repo.getProgress(bookId)
    if (progress === null) return null
    const chapter = chapters[Math.min(progress.chapterIndex, chapters.length - 1)]
    if (chapter === undefined) return null
    return chapter.startOffset + clampOffset(progress.charOffset, chapter.charLength)
  }

  private apply(bookId: string, next: DraftChapter[], absolute: number | null): Chapter[] {
    // replaceChapters 会把 book.chapter_count 一起更新
    this.repo.replaceChapters(bookId, next as NewChapterRecord[])
    if (absolute !== null) this.reflowProgress(bookId, absolute)
    return this.repo.listChapters(bookId)
  }

  /** 正文没动，只把进度挪进新的那一章。 */
  private reflowProgress(bookId: string, absolute: number): void {
    const progress = this.repo.getProgress(bookId)
    if (progress === null) return
    const chapters = this.repo.listChapters(bookId)
    const last = chapters[chapters.length - 1]
    if (last === undefined) return
    const at = chapters.find((chapter) => absolute < chapter.startOffset + chapter.charLength) ?? last
    this.repo.saveProgress({
      ...progress,
      chapterIndex: at.index,
      charOffset: Math.max(0, absolute - at.startOffset)
    })
  }
}
