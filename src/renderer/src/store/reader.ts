import { create } from 'zustand'
import { clampOffset, makeAnchor, relocateOffset } from '@shared/core/anchor'
import { normalizeQuery } from '@shared/core/search'
import { STAT_MIN_REPORT_CHARS } from '@shared/core/stats'
import {
  CHUNK_FIRST_RENDER_CHARS,
  CHUNK_THRESHOLD_CHARS,
  type AnnotationId,
  type Book,
  type Bookmark,
  type CharOffset,
  type Chapter,
  type Highlight,
  type Progress,
  type SearchHit,
  type SearchResult,
  type SearchScope
} from '@shared/types'
import { excerptAt, normalizeSelection, orderBookmarks, orderHighlights } from '@/core/annotations'
import { readerApi } from '@/core/api'
import { percentOf } from '@/core/reading'
import { browserClockDeps, createReadingClock } from '@/core/reading-clock'
import { currentDeviceId } from '@/core/session'
import { createThrottle, type Throttler } from '@/core/throttle'

/** 滚动时最多每 500ms 落一次盘（TECH.md 6.3）。 */
export const PROGRESS_THROTTLE_MS = 500
/** 停止滚动多久算「停稳了」。只用来确认滚动结束，能不能算「读过这儿」还要看停留时长。 */
export const BOOKMARK_REST_MS = 1200
/**
 * 在同一个地方连续待够这么久，才算「在这儿读」，「上次位置」才会跟过来。
 *
 * 为什么不是「停 1.2 秒就算」（0.1.4 修）：刚打开一本书时快速把滚动条拖到最底下、
 * 松手再去点「回到上次位置」，中间通常已经超过 1.2 秒 —— 于是「上次位置」被改写成
 * 刚滑到的地方，点下去等于原地不动，用户看到的就是「回不去」。门槛提到 5 秒之后，
 * 只滑过去瞥一眼、或者拖完随即点按钮的，都不会把「上次阅读位置」顶掉。
 */
export const BOOKMARK_DWELL_MS = 5000
/** 同章内挪动不到这么多字不算换地方，免得「上次位置」跟着微小滚动乱跑。 */
export const BOOKMARK_MIN_GAP_CHARS = 100
/** 单条划线的文字上限，与 shared/schema.ts 的 highlightAddArgsSchema 保持一致。 */
export const HIGHLIGHT_MAX_CHARS = 2000

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
  /** 「上次位置」：读过一会儿的地方，回到这里的目标。 */
  bookmark: ReadingSpot | null
  /** 「刚才的位置」：点第一次「回到上次位置」时把你当时的位置记在这儿，再点一次就回到这儿。 */
  returnSpot: ReadingSpot | null
  open(bookId: string): Promise<void>
  /** 回书架：先落一次盘再清空，返回的 Promise 在进度写回主进程后 resolve。 */
  leave(): Promise<void>
  goto(index: number, offset?: CharOffset): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  onScrolled(offset: CharOffset): void
  /** 停下来读了一会儿：把当前位置记成「上次位置」。 */
  settleBookmark(offset: CharOffset): void
  /**
   * 停下来读了一会儿（0.1.4）：把位置报给主进程记账。
   * 字数由主进程按「当天在这一章读到过的最远偏移」去重后算，这里不传字数。
   */
  readPaused(offset: CharOffset): void
  /** 回到上次停留的位置；再点一次回到刚才离开的地方。 */
  backToBookmark(): Promise<void>
  /** 改章节标题（只动章节表，正文一个字都不动）。 */
  renameChapter(index: number, title: string): Promise<void>
  /** 把第 index+1 章并进第 index 章。 */
  mergeChapter(index: number): Promise<void>
  /** 本书的书签，按正文顺序排（打开时随章节一起带回）。 */
  bookmarks: Bookmark[]
  /** 本书的划线，按正文顺序排。 */
  highlights: Highlight[]
  /** 把当前位置加为书签（摘要取附近原文）。成功返回 true，失败返回 false 并置 error。 */
  addBookmark(): Promise<boolean>
  removeBookmark(id: AnnotationId): Promise<void>
  /** 把选中的一段文字划下来；文字过长会截到 schema 允许的上限。 */
  addHighlight(startOffset: CharOffset, endOffset: CharOffset, text: string): Promise<void>
  removeHighlight(id: AnnotationId): Promise<void>
  /** 搜索面板是否展开（0.1.3 第 7 项）。 */
  searchOpen: boolean
  /** 上一次真正发出去的关键词（归一化后的），面板回显用。 */
  searchQuery: string
  searchScope: SearchScope
  searching: boolean
  searchError: string | null
  searchResult: SearchResult | null
  /** 刚跳到的命中位置：ReaderView 拿它给所在段落闪一下高亮。 */
  flash: { chapterIndex: number; offset: CharOffset } | null
  setSearch(open: boolean): void
  /** 跑一次搜索；迟到的结果会被丢弃（同一时刻只认最后一次）。 */
  runSearch(query: string, scope: SearchScope): Promise<void>
  /** 跳到某条命中，并让那一小段闪一下。 */
  jumpToHit(hit: SearchHit): Promise<void>
  clearFlash(): void
  clearSearch(): void
  flush(): void
  /** 关窗前的同步落盘（TECH.md 6.3），主进程写完才返回。 */
  flushSync(): void
  consumePending(): void
  revealMore(): void
  /** 一口气把正文铺到目标偏移之后：从进度/书签/搜索结果跳进章节深处时用。 */
  revealTo(offset: CharOffset): void
  setToc(open: boolean): void
  setSheet(open: boolean): void
}

/** 当前章内偏移，模块级持有：滚动很热，不值得每帧进 store。 */
let lastOffset = 0
/** 请求序号：丢弃迟到的 open()/goto() 结果，避免旧请求覆盖新章节。 */
let seq = 0
/** 书签跳转自己会触发一次「停顿」，那一次不能算新位置，否则来回跳会互相覆盖。 */
let skipNextSettle = false
/**
 * 「停留候选」：当前待着的地方 + 从什么时候开始待。
 * 换了地方（换章，或同章挪动 ≥ BOOKMARK_MIN_GAP_CHARS）就重开计时；
 * 只有待够 BOOKMARK_DWELL_MS，`settleBookmark` 才认它、才更新「上次位置」。
 * 快滑经过的地方永远攒不够这个时长，于是不会把「上次位置」冲掉。
 */
let dwell: { chapterIndex: number; offset: CharOffset; since: number } | null = null
/** 搜索请求序号：连打几个关键词时只认最后一次的结果。 */
let searchSeq = 0

/**
 * 记下「现在待在哪儿、从什么时候开始待」。换了地方（换章，或同章挪动 ≥ 100 字）就重开计时。
 * 于是「快滑经过」永远攒不够停留时长，只有真在某处停下来读才算数。
 */
function noteDwell(chapterIndex: number, offset: CharOffset): void {
  if (
    dwell === null ||
    dwell.chapterIndex !== chapterIndex ||
    Math.abs(dwell.offset - offset) >= BOOKMARK_MIN_GAP_CHARS
  ) {
    dwell = { chapterIndex, offset, since: Date.now() }
  }
}

/** 要记的这个位置，是不是「已经待够 BOOKMARK_DWELL_MS 的那一处」。 */
function hasDwelled(spot: ReadingSpot): boolean {
  if (dwell === null) return false
  if (dwell.chapterIndex !== spot.chapterIndex) return false
  if (Math.abs(dwell.offset - spot.charOffset) >= BOOKMARK_MIN_GAP_CHARS) return false
  return Date.now() - dwell.since >= BOOKMARK_DWELL_MS
}

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

/** 还没落库的阅读时长（0.1.3 第 8 项）。字数不在这里攒 —— 0.1.4 起交给主进程按水位线算。 */
let pendingStatMs = 0
/** 上一次上报「读过」的落点，免得停在原地不动时反复上报。 */
let lastReadSpot: ReadingSpot | null = null
/** 这一章是从哪个偏移进来的：当天第一次读这一章时，统计的水位线从这里起算。 */
let chapterEntry: ReadingSpot | null = null

/**
 * 把攒下的时长交给主进程。失败只记日志、不重试：
 * 统计是「大概读了多久」，不值得为它挡着看书或者把界面弄脏。
 */
function flushStats(): void {
  const book = useReaderStore.getState().book
  const ms = pendingStatMs
  if (!book || ms <= 0) return
  pendingStatMs = 0
  void readerApi()
    .addReadingStat(book.id, ms, 0)
    .catch((cause: unknown) => {
      console.error('[12read] 保存阅读统计失败', cause)
    })
}

/**
 * 「读了一会儿，停在哪儿」——0.1.4 起字数由主进程算，这里只报位置。
 *
 * 为什么要报位置而不是报字数：字数得按「这一天在这一章读到过的最远偏移」去重，
 * 才算不出「来回刷两遍 = 读了双倍」这种账；那个水位线存在主进程的库里，
 * 渲染层只负责说「我停在这儿读了一会儿」。算不算新字、算多少，由主进程决定。
 */
function reportReadAt(offset: CharOffset): void {
  const state = useReaderStore.getState()
  const book = state.book
  if (!book || state.chapterText.length === 0) return
  const spot: ReadingSpot = {
    chapterIndex: state.chapterIndex,
    charOffset: clampOffset(offset, state.chapterText.length)
  }
  // 停在原地不动就别反复上报（主进程算出来也会是 0，省点 IPC）
  if (
    lastReadSpot &&
    lastReadSpot.chapterIndex === spot.chapterIndex &&
    Math.abs(lastReadSpot.charOffset - spot.charOffset) < STAT_MIN_REPORT_CHARS
  ) {
    return
  }
  const entry =
    chapterEntry && chapterEntry.chapterIndex === spot.chapterIndex ? chapterEntry.charOffset : null
  lastReadSpot = spot
  void readerApi()
    .addReadSpan({
      bookId: book.id,
      chapterIndex: spot.chapterIndex,
      charOffset: spot.charOffset,
      // 拿不准这一章是从哪儿进来的，就保守地从当前位置起算（宁可少算，不多算）
      enteredAt: entry === null ? spot.charOffset : entry
    })
    .catch((cause: unknown) => {
      console.error('[12read] 保存阅读字数失败', cause)
    })
}

/** 阅读计时：窗口在看着、人也没走开，每 15 秒算一段（详见 core/reading-clock.ts）。 */
const statClock = createReadingClock(browserClockDeps(), (ms) => {
  pendingStatMs += ms
  flushStats()
})

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
    // 改分章后章节表变了，把统计水位线的起点也重新落位
    chapterEntry = { chapterIndex: spot.chapterIndex, charOffset: offset }
    const chapter: Chapter | undefined = chapters[spot.chapterIndex]
    skipNextSettle = true
    dwell = null
    useReaderStore.setState({
      chapters,
      chapterIndex: spot.chapterIndex,
      chapterText: text,
      visibleChars: initialVisible(text),
      pendingOffset: offset,
      percent: percentOf(book.charCount, chapter ? chapter.startOffset : 0, offset),
      bookmark: bookmarkAbsolute === null ? null : spotAt(chapters, bookmarkAbsolute),
      returnSpot: null,
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
  returnSpot: null,
  bookmarks: [],
  highlights: [],
  searchOpen: false,
  searchQuery: '',
  searchScope: 'book',
  searching: false,
  searchError: null,
  searchResult: null,
  flash: null,

  async open(bookId: string): Promise<void> {
    const api = readerApi()
    const mine = (seq += 1)
    // 换书前先把上一本没落库的统计收尾
    statClock.stop()
    flushStats()
    pendingStatMs = 0
    lastReadSpot = null
    chapterEntry = null
    dwell = null
    skipNextSettle = false
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
      returnSpot: null,
      bookmarks: [],
      highlights: [],
      tocOpen: false,
      sheetOpen: false,
      searchOpen: false,
      searchQuery: '',
      searching: false,
      searchError: null,
      searchResult: null,
      flash: null
    })
    try {
      const [book, chapters, progress, bookmarks, highlights] = await Promise.all([
        api.getBook(bookId),
        api.chapters(bookId),
        api.getProgress(bookId),
        // 书签与划线读不出来也不该挡着看书，交给 catch 之外的默认空列表
        api.listBookmarks(bookId).catch((): Bookmark[] => []),
        api.listHighlights(bookId).catch((): Highlight[] => [])
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
        returnSpot: null,
        bookmarks: orderBookmarks(bookmarks),
        highlights: orderHighlights(highlights),
        loading: false
      })
      lastReadSpot = { chapterIndex: index, charOffset: offset }
      chapterEntry = { chapterIndex: index, charOffset: offset }
      statClock.start()
      skipNextSettle = false
      dwell = null
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
    statClock.stop()
    const saving = persist()
    flushStats()
    seq += 1
    searchSeq += 1
    dwell = null
    set({
      book: null,
      chapters: [],
      chapterIndex: 0,
      chapterText: '',
      visibleChars: 0,
      pendingOffset: null,
      percent: 0,
      bookmark: null,
      returnSpot: null,
      bookmarks: [],
      highlights: [],
      tocOpen: false,
      sheetOpen: false,
      searchOpen: false,
      searchQuery: '',
      searching: false,
      searchError: null,
      searchResult: null,
      flash: null,
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
      // 换章了：统计的水位线要从「进这一章的位置」起算（跳进章中间时别把前半章算成读过）
      chapterEntry = { chapterIndex: target, charOffset: offset }
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
    noteDwell(state.chapterIndex, lastOffset)
    const chapter: Chapter | undefined = state.chapters[state.chapterIndex]
    const percent = percentOf(state.book.charCount, chapter ? chapter.startOffset : 0, lastOffset)
    if (Math.abs(percent - state.percent) >= 0.05) set({ percent })
    saver.schedule()
  },

  readPaused(offset: CharOffset): void {
    reportReadAt(offset)
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
    // 只是快滑过去瞥一眼的地方不算「读过这儿」：待够 BOOKMARK_DWELL_MS 才认（0.1.4 修）
    if (!hasDwelled(next)) return
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
    const anchor = state.bookmark
    if (!state.book || !anchor) return
    const here: ReadingSpot = {
      chapterIndex: state.chapterIndex,
      charOffset: clampOffset(lastOffset, state.chapterText.length)
    }
    // 两个槽位互不覆盖：bookmark 是「上次读的位置」，returnSpot 是「刚才离开的位置」。
    // 人已经站在「上次位置」上时，这一下该回到「刚才那儿」；否则就是回到「上次位置」。
    const atAnchor =
      here.chapterIndex === anchor.chapterIndex &&
      Math.abs(here.charOffset - anchor.charOffset) < BOOKMARK_MIN_GAP_CHARS
    const target = atAnchor ? state.returnSpot : anchor
    if (!target) return
    set({ returnSpot: here })
    skipNextSettle = true
    await get().goto(target.chapterIndex, target.charOffset)
  },

  async renameChapter(index: number, title: string): Promise<void> {
    await applyChapterEdit((bookId) => readerApi().renameChapter(bookId, index, title))
  },

  async mergeChapter(index: number): Promise<void> {
    await applyChapterEdit((bookId) => readerApi().mergeChapter(bookId, index))
  },

  async addBookmark(): Promise<boolean> {
    const state = get()
    const book = state.book
    if (!book) return false
    const offset = clampOffset(lastOffset, state.chapterText.length)
    try {
      const created = await readerApi().addBookmark({
        bookId: book.id,
        chapterIndex: state.chapterIndex,
        charOffset: offset,
        excerpt: excerptAt(state.chapterText, offset)
      })
      set((current) => ({ bookmarks: orderBookmarks([...current.bookmarks, created]) }))
      return true
    } catch (cause) {
      set({ error: '加书签失败：' + messageOf(cause) })
      return false
    }
  },

  async removeBookmark(id: AnnotationId): Promise<void> {
    try {
      await readerApi().removeBookmark(id)
      set((current) => ({ bookmarks: current.bookmarks.filter((item) => item.id !== id) }))
    } catch (cause) {
      set({ error: '删除书签失败：' + messageOf(cause) })
    }
  },

  async addHighlight(startOffset: CharOffset, endOffset: CharOffset, text: string): Promise<void> {
    const state = get()
    const book = state.book
    if (!book) return
    const range = normalizeSelection(startOffset, endOffset)
    const body = text.slice(0, HIGHLIGHT_MAX_CHARS)
    if (!range || body.trim().length === 0) return
    try {
      const created = await readerApi().addHighlight({
        bookId: book.id,
        chapterIndex: state.chapterIndex,
        startOffset: range.startOffset,
        // 文字被截断时结束位置跟着收，别让记下来的范围比文字长
        endOffset: range.startOffset + body.length,
        text: body
      })
      set((current) => ({ highlights: orderHighlights([...current.highlights, created]) }))
    } catch (cause) {
      set({ error: '加划线失败：' + messageOf(cause) })
    }
  },

  async removeHighlight(id: AnnotationId): Promise<void> {
    try {
      await readerApi().removeHighlight(id)
      set((current) => ({ highlights: current.highlights.filter((item) => item.id !== id) }))
    } catch (cause) {
      set({ error: '删除划线失败：' + messageOf(cause) })
    }
  },

  setSearch(open: boolean): void {
    set({ searchOpen: open })
  },

  async runSearch(query: string, scope: SearchScope): Promise<void> {
    const state = get()
    const book = state.book
    if (!book) return
    const needle = normalizeQuery(query)
    if (needle.length === 0) {
      // 输入框清空：结果跟着下架，序号 +1 把在路上的那次请求作废
      searchSeq += 1
      set({ searchQuery: '', searchResult: null, searchError: null, searching: false })
      return
    }
    const mine = (searchSeq += 1)
    set({ searchQuery: needle, searchScope: scope, searching: true, searchError: null })
    try {
      const result = await readerApi().searchBook(book.id, needle, scope, state.chapterIndex)
      if (mine !== searchSeq) return
      set({ searchResult: result, searching: false })
    } catch (cause) {
      if (mine !== searchSeq) return
      set({ searching: false, searchError: '搜索失败：' + messageOf(cause) })
    }
  },

  async jumpToHit(hit: SearchHit): Promise<void> {
    // 先把要闪的位置记下：goto 之后 ReaderView 按这个给所在段落加一次性高亮
    set({ flash: { chapterIndex: hit.chapterIndex, offset: hit.charOffset } })
    await get().goto(hit.chapterIndex, hit.charOffset)
  },

  clearFlash(): void {
    set({ flash: null })
  },

  clearSearch(): void {
    searchSeq += 1
    set({ searchQuery: '', searchResult: null, searchError: null, searching: false, flash: null })
  },

  flush(): void {
    saver.flush()
    flushStats()
  },

  flushSync(): void {
    flushStats()
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

  /**
   * 铺到目标偏移之后一屏为止，一次搞定。
   * 位处超长章节深处时，一格一格往前挪要么来回几十轮（跳一次要等好几秒），
   * 要么半路停下不动 —— 因为滚动位置一旦不在底部，「继续加载」就不会再触发。
   * 铺出来的量正好是「目标位置 + 一屏」，DOM 大小约等于人离开这里时的那一屏。
   */
  revealTo(offset: CharOffset): void {
    const state = get()
    const end = clampOffset(offset, state.chapterText.length) + CHUNK_FIRST_RENDER_CHARS
    const need = Math.min(state.chapterText.length, end)
    if (need > state.visibleChars) set({ visibleChars: need })
  },

  setToc(open: boolean): void {
    set({ tocOpen: open })
  },

  setSheet(open: boolean): void {
    set({ sheetOpen: open })
  }
}))
