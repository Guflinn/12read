import { create } from 'zustand'
import { clampOffset, makeAnchor, relocateOffset } from '@shared/core/anchor'
import {
  CHUNK_FIRST_RENDER_CHARS,
  CHUNK_THRESHOLD_CHARS,
  type Book,
  type CharOffset,
  type Chapter,
  type Progress
} from '@shared/types'
import { readerApi } from '@/core/api'
import { percentOf } from '@/core/reading'
import { currentDeviceId } from '@/core/session'
import { createThrottle, type Throttler } from '@/core/throttle'

/** 滚动时最多每 500ms 落一次盘（TECH.md 6.3）。 */
export const PROGRESS_THROTTLE_MS = 500

export interface ReaderState {
  book: Book | null
  chapters: Chapter[]
  chapterIndex: number
  chapterText: string
  /** 分块渲染：已渲染到本章的第几个字符。 */
  visibleChars: number
  loading: boolean
  error: string | null
  tocOpen: boolean
  sheetOpen: boolean
  /** 待还原的章内偏移；ReaderView 滚动到位后调用 consumePending() 清空。 */
  pendingOffset: CharOffset | null
  percent: number
  open(bookId: string): Promise<void>
  leave(): void
  goto(index: number, offset?: CharOffset): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  onScrolled(offset: CharOffset): void
  flush(): void
  /** 关窗前的同步落盘（TECH.md 6.3），主进程写完才返回。 */
  flushSync(): void
  consumePending(): void
  revealMore(): void
  setToc(open: boolean): void
  setSheet(open: boolean): void
}

/** 当前章内偏移，模块级持有：滚动很热，不值得每帧进 store。 */
let lastOffset = 0
/** 请求序号：丢弃迟到的 open()/goto() 结果，避免旧请求覆盖新章节。 */
let seq = 0

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(length - 1, Math.max(0, Math.trunc(index)))
}

function initialVisible(text: string): number {
  return text.length > CHUNK_THRESHOLD_CHARS
    ? Math.min(CHUNK_FIRST_RENDER_CHARS, text.length)
    : text.length
}

function buildProgress(): Progress | null {
  const state = useReaderStore.getState()
  if (!state.book) return null
  const chapter = state.chapters[state.chapterIndex]
  const offset = clampOffset(lastOffset, state.chapterText.length)
  const anchor = makeAnchor(state.chapterText, offset)
  return {
    bookId: state.book.id,
    chapterIndex: state.chapterIndex,
    charOffset: offset,
    anchorBefore: anchor.before,
    anchorAfter: anchor.after,
    percent: percentOf(state.book.charCount, chapter ? chapter.startOffset : 0, offset),
    updatedAt: Date.now(),
    deviceId: currentDeviceId()
  }
}

async function persist(): Promise<void> {
  const progress = buildProgress()
  if (!progress) return
  try {
    await readerApi().saveProgress(progress)
  } catch (cause) {
    console.error('[12read] 保存进度失败', cause)
  }
}

const saver: Throttler = createThrottle(PROGRESS_THROTTLE_MS, () => {
  void persist()
})

export const useReaderStore = create<ReaderState>((set, get) => ({
  book: null,
  chapters: [],
  chapterIndex: 0,
  chapterText: '',
  visibleChars: 0,
  loading: false,
  error: null,
  tocOpen: false,
  sheetOpen: false,
  pendingOffset: null,
  percent: 0,

  async open(bookId: string): Promise<void> {
    const api = readerApi()
    const mine = (seq += 1)
    set({
      loading: true,
      error: null,
      book: null,
      chapters: [],
      chapterIndex: 0,
      chapterText: '',
      visibleChars: 0,
      pendingOffset: null,
      percent: 0,
      tocOpen: false,
      sheetOpen: false
    })
    try {
      const [book, chapters, progress] = await Promise.all([
        api.getBook(bookId),
        api.chapters(bookId),
        api.getProgress(bookId)
      ])
      if (mine !== seq) return
      if (!book) throw new Error('这本书已不在书架里')
      const index = clampIndex(progress ? progress.chapterIndex : 0, chapters.length)
      const text = chapters.length > 0 ? await api.readChapter(bookId, index) : ''
      if (mine !== seq) return
      const offset = progress ? relocateOffset(text, progress) : 0
      lastOffset = offset
      const chapter: Chapter | undefined = chapters[index]
      set({
        book,
        chapters,
        chapterIndex: index,
        chapterText: text,
        visibleChars: initialVisible(text),
        pendingOffset: offset,
        percent: percentOf(book.charCount, chapter ? chapter.startOffset : 0, offset),
        loading: false
      })
    } catch (cause) {
      if (mine !== seq) return
      set({ loading: false, error: '打开失败：' + messageOf(cause) })
    }
  },

  leave(): void {
    saver.flush()
    seq += 1
    set({
      book: null,
      chapters: [],
      chapterIndex: 0,
      chapterText: '',
      visibleChars: 0,
      pendingOffset: null,
      percent: 0,
      tocOpen: false,
      sheetOpen: false,
      error: null
    })
  },

  async goto(index: number, offset: CharOffset = 0): Promise<void> {
    const state = get()
    if (!state.book || state.chapters.length === 0) return
    const target = clampIndex(index, state.chapters.length)
    if (target === state.chapterIndex && state.chapterText.length > 0) {
      // 同一章只挪位置，不重新渲染
      set({ pendingOffset: offset })
      return
    }
    saver.flush() // 切章前先把上一章的位置落盘
    const mine = (seq += 1)
    set({ loading: true, error: null })
    try {
      const text = await readerApi().readChapter(state.book.id, target)
      if (mine !== seq) return
      const chapter: Chapter | undefined = state.chapters[target]
      lastOffset = offset
      set({
        chapterIndex: target,
        chapterText: text,
        visibleChars: initialVisible(text),
        pendingOffset: offset,
        percent: percentOf(state.book.charCount, chapter ? chapter.startOffset : 0, offset),
        loading: false
      })
    } catch (cause) {
      if (mine !== seq) return
      set({ loading: false, error: '读取章节失败：' + messageOf(cause) })
    }
  },

  async next(): Promise<void> {
    const { chapterIndex, chapters } = get()
    if (chapterIndex >= chapters.length - 1) return
    await get().goto(chapterIndex + 1, 0)
  },

  async prev(): Promise<void> {
    const { chapterIndex } = get()
    if (chapterIndex <= 0) return
    await get().goto(chapterIndex - 1, 0)
  },

  onScrolled(offset: CharOffset): void {
    const state = get()
    if (!state.book || state.chapterText.length === 0) return
    lastOffset = clampOffset(offset, state.chapterText.length)
    const chapter: Chapter | undefined = state.chapters[state.chapterIndex]
    const percent = percentOf(state.book.charCount, chapter ? chapter.startOffset : 0, lastOffset)
    if (Math.abs(percent - state.percent) >= 0.05) set({ percent })
    saver.schedule()
  },

  flush(): void {
    saver.flush()
  },

  flushSync(): void {
    const progress = buildProgress()
    if (!progress) return
    try {
      readerApi().flushProgress(progress)
    } catch (cause) {
      console.error('[12read] 退出前同步保存进度失败', cause)
    }
  },

  consumePending(): void {
    set({ pendingOffset: null })
  },

  revealMore(): void {
    set((state) => ({ visibleChars: state.chapterText.length }))
  },

  setToc(open: boolean): void {
    set({ tocOpen: open })
  },

  setSheet(open: boolean): void {
    set({ sheetOpen: open })
  }
}))
