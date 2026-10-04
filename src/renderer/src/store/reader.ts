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
/** 停止滚动多久算「在这儿看了一会儿」，把这里记成下次可以回来的位置。 */
export const BOOKMARK_REST_MS = 1200
/** 同章内挪动不到这么多字不算换地方，免得「上次位置」跟着微小滚动乱跑。 */
export const BOOKMARK_MIN_GAP_CHARS = 100

/** 书签：章号 + 章内字符偏移，和进度用同一套定位语义。 */
export interface ReadingSpot {
  chapterIndex: number
  charOffset: CharOffset
}

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
  /** 「上次位置」：回到这里的目标；点一次会把当前位置换进来，于是再点一次能回去。 */
  bookmark: ReadingSpot | null
  open(bookId: string): Promise<void>
  /** 回书架：先落一次盘再清空，返回的 Promise 在进度写回主进程后 resolve。 */
  leave(): Promise<void>
  goto(index: number, offset?: CharOffset): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  onScrolled(offset: CharOffset): void
  /** 停下来读了一会儿：把当前位置记成「上次位置」。 */
  settleBookmark(offset: CharOffset): void
  /** 回到上次停留的位置；再点一次回到刚才离开的地方。 */
  backToBookmark(): Promise<void>
  /** 改章节标题（只动章节表，正文一个字都不动）。 */
  renameChapter(index: number, title: string): Promise<void>
  /** 把第 index+1 章并进第 index 章。 */
  mergeChapter(index: number): Promise<void>
  /** 在第 index 章的章内偏移 offset 处拆成两章。 */
  splitChapter(index: number, offset: CharOffset): Promise<void>
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
/** 书签跳转自己会触发一次「停顿」，那一次不能算新位置，否则来回跳会互相覆盖。 */
let skipNextSettle = false

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(length - 1, Math.max(0, Math.trunc(index)))
}

/** 全书绝对字符位置 → 新章节表里的章号 + 章内偏移。 */
function spotAt(chapters: Chapter[], absolute: number): ReadingSpot {
  let index = chapters.findIndex((chapter) => absolute < chapter.startOffset + chapter.charLength)
  if (index < 0) index = Math.max(0, chapters.length - 1)
  const chapter: Chapter | undefined = chapters[index]
  return {
    chapterIndex: index,
    charOffset: chapter ? Math.max(0, absolute - chapter.startOffset) : 0
  }
}

/** 章号 + 章内偏移 → 全书绝对字符位置；章节表对不上时返回 null。 */
function absoluteOfSpot(chapters: Chapter[], spot: ReadingSpot): number | null {
  const chapter: Chapter | undefined = chapters[spot.chapterIndex]
  if (!chapter) return null
  return chapter.startOffset + clampOffset(spot.charOffset, chapter.charLength)
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

/**
 * 改分章的统一流程：先记下「编辑前的绝对字符位置」，改完按新章节表落位，
 * 再强制重读正文 —— 合并会让同一章的正文变长，只改 pendingOffset 会读到旧长度。
 */
async function applyChapterEdit(run: (bookId: string) => Promise<Chapter[]>): Promise<void> {
  const state = useReaderStore.getState()
  const book = state.book
  if (!book) return
  const here = absoluteOfSpot(state.chapters, {
    chapterIndex: state.chapterIndex,
    charOffset: clampOffset(lastOffset, state.chapterText.length)
  })
  const bookmarkAbsolute =
    state.bookmark === null ? null : absoluteOfSpot(state.chapters, state.bookmark)
  const mine = (seq += 1)
  useReaderStore.setState({ loading: true, error: null })
  try {
    const chapters = await run(book.id)
    if (mine !== seq) return
    const spot = here === null ? { chapterIndex: 0, charOffset: 0 } : spotAt(chapters, here)
    const text =
      chapters.length > 0 ? await readerApi().readChapter(book.id, spot.chapterIndex) : ''
    if (mine !== seq) return
    const offset = clampOffset(spot.charOffset, text.length)
    lastOffset = offset
    const chapter: Chapter | undefined = chapters[spot.chapterIndex]
    skipNextSettle = true
    useReaderStore.setState({
      chapters,
      chapterIndex: spot.chapterIndex,
      chapterText: text,
      visibleChars: initialVisible(text),
      pendingOffset: offset,
      percent: percentOf(book.charCount, chapter ? chapter.startOffset : 0, offset),
      bookmark: bookmarkAbsolute === null ? null : spotAt(chapters, bookmarkAbsolute),
      loading: false
    })
  } catch (cause) {
    if (mine !== seq) return
    useReaderStore.setState({ loading: false, error: '改分章失败：' + messageOf(cause) })
  }
}

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
  bookmark: null,

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
      bookmark: null,
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
        // 打开时就记一个位置：还没滚动过也能「回到打开本书的地方」，按钮不会一开始就是灰的
        bookmark: { chapterIndex: index, charOffset: offset },
        loading: false
      })
      skipNextSettle = false
    } catch (cause) {
      if (mine !== seq) return
      set({ loading: false, error: '打开失败：' + messageOf(cause) })
    }
  },

  async leave(): Promise<void> {
    // 离开阅读器时无条件落盘一次：只要打开过书就算「最近读过」，
    // 书架排序（last_opened_at）和「已读 x%」就不依赖用户是否滚动过。
    // persist() 会在第一个 await 之前同步取出进度快照，所以可以先拿住快照再清空 state。
    saver.cancel()
    const saving = persist()
    seq += 1
    set({
      book: null,
      chapters: [],
      chapterIndex: 0,
      chapterText: '',
      visibleChars: 0,
      pendingOffset: null,
      percent: 0,
      bookmark: null,
      tocOpen: false,
      sheetOpen: false,
      error: null
    })
    // 等落盘完成再让调用方接着做（App 会等它结束后再刷新书架，顺序才确定）
    await saving
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

  settleBookmark(offset: CharOffset): void {
    const state = get()
    if (!state.book || state.chapterText.length === 0) return
    const next: ReadingSpot = {
      chapterIndex: state.chapterIndex,
      charOffset: clampOffset(offset, state.chapterText.length)
    }
    if (skipNextSettle) {
      skipNextSettle = false
      return
    }
    const current = state.bookmark
    if (
      current &&
      current.chapterIndex === next.chapterIndex &&
      Math.abs(current.charOffset - next.charOffset) < BOOKMARK_MIN_GAP_CHARS
    ) {
      return
    }
    set({ bookmark: next })
  },

  async backToBookmark(): Promise<void> {
    const state = get()
    const target = state.bookmark
    if (!state.book || !target) return
    const here: ReadingSpot = {
      chapterIndex: state.chapterIndex,
      charOffset: clampOffset(lastOffset, state.chapterText.length)
    }
    // 先把自己现在的位置换成新书签，再跳过去：这样再点一次就是「回到刚才那里」
    set({ bookmark: here })
    skipNextSettle = true
    await get().goto(target.chapterIndex, target.charOffset)
  },

  async renameChapter(index: number, title: string): Promise<void> {
    await applyChapterEdit((bookId) => readerApi().renameChapter(bookId, index, title))
  },

  async mergeChapter(index: number): Promise<void> {
    await applyChapterEdit((bookId) => readerApi().mergeChapter(bookId, index))
  },

  async splitChapter(index: number, offset: CharOffset): Promise<void> {
    if (offset < 1) {
      set({ error: '拆分位置要落在这一章中间：先往下读一点，再在想要断开的地方拆' })
      return
    }
    await applyChapterEdit((bookId) => readerApi().splitChapter(bookId, index, offset))
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

  /**
   * 按步展开，而不是一次性把整章塞进 DOM：
   * 章动辄几十万字，全量渲染会一次性挂出上万个段落、卡死主线程。
   * 滚到接近底部会再次触发，读起来就是「继续往下就有了」。
   */
  revealMore(): void {
    set((state) => ({
      visibleChars: Math.min(state.chapterText.length, state.visibleChars + CHUNK_FIRST_RENDER_CHARS)
    }))
  },

  setToc(open: boolean): void {
    set({ tocOpen: open })
  },

  setSheet(open: boolean): void {
    set({ sheetOpen: open })
  }
}))
