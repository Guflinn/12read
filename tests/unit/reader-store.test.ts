import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReaderApi } from '@shared/api'
import {
  CHUNK_FIRST_RENDER_CHARS,
  type BackupResult,
  type Book,
  type BookImage,
  type Bookmark,
  type BookmarkInput,
  type Chapter,
  type Highlight,
  type HighlightInput,
  type Progress,
  type ReadingStats,
  type SearchHit,
  type SearchResult
} from '@shared/types'
import { STAT_IDLE_MS, STAT_REPORT_MS } from '@shared/core/stats'
import { setReaderApi } from '@/core/api'
import { setDeviceId } from '@/core/session'
import { excerptAt } from '@/core/annotations'
import {
  BOOKMARK_DWELL_MS,
  BOOKMARK_MIN_GAP_CHARS,
  BOOKMARK_REST_MS,
  HIGHLIGHT_MAX_CHARS,
  PROGRESS_THROTTLE_MS,
  useReaderStore
} from '@/store/reader'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

const book: Book = {
  id: BOOK_ID,
  title: '测试书',
  author: null,
  format: 'txt',
  encoding: 'utf-8',
  byteSize: 1000,
  charCount: 300,
  chapterCount: 2,
  contentMode: 'single',
  coverSeed: 12,
  addedAt: 1,
  lastOpenedAt: null
}

const chapters: Chapter[] = [
  { bookId: BOOK_ID, index: 0, title: '第一章', startOffset: 0, charLength: 100, kind: 'chapter' },
  { bookId: BOOK_ID, index: 1, title: '第二章', startOffset: 100, charLength: 200, kind: 'chapter' }
]

// 每个字符都不重复，锚点定位才没有歧义
const body190 = Array.from({ length: 190 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('')
const DEFAULT_TEXTS = ['第一章\n' + '甲'.repeat(90), '第二章\n' + body190]

function storedProgress(patch: Partial<Progress> = {}): Progress {
  return {
    bookId: BOOK_ID,
    chapterIndex: 0,
    charOffset: 0,
    anchorBefore: null,
    anchorAfter: null,
    percent: 0,
    updatedAt: 1,
    deviceId: null,
    ...patch
  }
}

interface Harness {
  api: ReaderApi
  readChapter: ReturnType<typeof vi.fn>
  saveProgress: ReturnType<typeof vi.fn>
  getProgress: ReturnType<typeof vi.fn>
  getBook: ReturnType<typeof vi.fn>
  renameChapter: ReturnType<typeof vi.fn>
  mergeChapter: ReturnType<typeof vi.fn>
  addBookmark: ReturnType<typeof vi.fn>
  removeBookmark: ReturnType<typeof vi.fn>
  addHighlight: ReturnType<typeof vi.fn>
  removeHighlight: ReturnType<typeof vi.fn>
  listBookmarks: ReturnType<typeof vi.fn>
  listHighlights: ReturnType<typeof vi.fn>
  getBookImages: ReturnType<typeof vi.fn>
  searchBook: ReturnType<typeof vi.fn>
  addReadingStat: ReturnType<typeof vi.fn>
  addReadSpan: ReturnType<typeof vi.fn>
  getReadingStats: ReturnType<typeof vi.fn>
  exportBackup: ReturnType<typeof vi.fn>
}

function makeHarness(
  stored: Progress | null = null,
  texts: string[] = DEFAULT_TEXTS,
  storedAnnotations: { bookmarks?: Bookmark[]; highlights?: Highlight[] } = {}
): Harness {
  const readChapter = vi.fn(async (bookId: string, index: number): Promise<string> => {
    if (bookId !== BOOK_ID) throw new Error('意外的 bookId')
    return texts[index] ?? ''
  })
  const saveProgress = vi.fn(async (): Promise<void> => undefined)
  const getProgress = vi.fn(async (): Promise<Progress | null> => stored)
  const getBook = vi.fn(async (bookId: string): Promise<Book | null> => (bookId === BOOK_ID ? book : null))
  const renameChapter = vi.fn(async (): Promise<Chapter[]> => chapters)
  const mergeChapter = vi.fn(async (): Promise<Chapter[]> => chapters)
  const listBookmarks = vi.fn(async (): Promise<Bookmark[]> => storedAnnotations.bookmarks ?? [])
  const listHighlights = vi.fn(async (): Promise<Highlight[]> => storedAnnotations.highlights ?? [])
  // 主进程负责补 id 与 createdAt，这里照做，store 拿回来的就是完整记录
  const addBookmark = vi.fn(
    async (input: BookmarkInput): Promise<Bookmark> => ({ ...input, id: 'k-new', createdAt: 9 })
  )
  const addHighlight = vi.fn(
    async (input: HighlightInput): Promise<Highlight> => ({
      ...input,
      id: 'h-new',
      note: null,
      createdAt: 9
    })
  )
  const removeBookmark = vi.fn(async (): Promise<void> => undefined)
  const removeHighlight = vi.fn(async (): Promise<void> => undefined)
  // 图片清单：默认没图（TXT 走的就是这条路），要测图片的用例自己 mock
  const getBookImages = vi.fn(async (): Promise<BookImage[]> => [])
  // 搜索默认给「一处都没找到」：单个用例再按需 mockResolvedValueOnce
  const addReadingStat = vi.fn(async (): Promise<void> => undefined)
  const addReadSpan = vi.fn(async (): Promise<number> => 0)
  const getReadingStats = vi.fn(
    async (): Promise<ReadingStats> => ({
      todayMs: 0,
      todayChars: 0,
      totalMs: 0,
      totalChars: 0,
      streakDays: 0,
      days: [],
      topBooks: []
    })
  )
  const exportBackup = vi.fn(async (): Promise<BackupResult | null> => null)
  // 搜索默认给「一处都没找到」：单个用例再按需 mockResolvedValueOnce
  const searchBook = vi.fn(
    async (): Promise<SearchResult> => ({
      query: '',
      scope: 'book',
      total: 0,
      counts: [],
      hits: [],
      truncated: false
    })
  )
  const api = {
    appInfo: vi.fn(),
    pickFiles: vi.fn(async () => []),
    importFile: vi.fn(),
    cancelTask: vi.fn(),
    listBooks: vi.fn(async () => [book]),
    getBook,
    renameBook: vi.fn(),
    redecodeBook: vi.fn(async () => book),
    deleteBook: vi.fn(),
    chapters: vi.fn(async () => chapters),
    renameChapter,
    mergeChapter,
    listBookmarks,
    addBookmark,
    removeBookmark,
    listHighlights,
    getBookImages,
    addHighlight,
    removeHighlight,
    searchBook,
    addReadingStat,
    addReadSpan,
    getReadingStats,
    exportBackup,
    readChapter,
    getProgress,
    saveProgress,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    onImportProgress: vi.fn(() => (): void => undefined),
    pathForFile: vi.fn(() => '')
  } as unknown as ReaderApi
  setReaderApi(api)
  return {
    api,
    readChapter,
    saveProgress,
    getProgress,
    getBook,
    renameChapter,
    mergeChapter,
    addBookmark,
    removeBookmark,
    addHighlight,
    removeHighlight,
    listBookmarks,
    listHighlights,
    getBookImages,
    searchBook,
    addReadingStat,
    addReadSpan,
    getReadingStats,
    exportBackup
  }
}

beforeEach(() => {
  useReaderStore.setState({
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
    flash: null
  })
  setDeviceId('device-test')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reader store: 打开', () => {
  it('从进度恢复章节与章内偏移', async () => {
    const harness = makeHarness(storedProgress({ chapterIndex: 1, charOffset: 50 }))
    await useReaderStore.getState().open(BOOK_ID)

    const state = useReaderStore.getState()
    expect(harness.readChapter).toHaveBeenCalledWith(BOOK_ID, 1)
    expect(state.chapterIndex).toBe(1)
    expect(state.chapterText).toBe(DEFAULT_TEXTS[1])
    expect(state.pendingOffset).toBe(50)
    expect(state.percent).toBe(50)
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('charOffset 失效时用锚点找回同一处文字', async () => {
    const text = DEFAULT_TEXTS[1]
    const harness = makeHarness(
      storedProgress({
        chapterIndex: 1,
        charOffset: 5,
        anchorBefore: text.slice(40, 70),
        anchorAfter: text.slice(70, 100)
      })
    )
    await useReaderStore.getState().open(BOOK_ID)
    expect(harness.readChapter).toHaveBeenCalledTimes(1)
    // relocateOffset 返回「前引文 + 后引文」组合的居中位置：40 + before.length(30) = 70
    expect(useReaderStore.getState().pendingOffset).toBe(70)
  })

  it('没有进度就从第一章开头开始', async () => {
    makeHarness(null)
    await useReaderStore.getState().open(BOOK_ID)
    expect(useReaderStore.getState().chapterIndex).toBe(0)
    expect(useReaderStore.getState().pendingOffset).toBe(0)
  })

  it('书不存在时给可见错误而不是崩溃', async () => {
    const harness = makeHarness(null)
    harness.getBook.mockResolvedValueOnce(null)
    await useReaderStore.getState().open(BOOK_ID)
    expect(useReaderStore.getState().error).toContain('打开失败')
    expect(useReaderStore.getState().loading).toBe(false)
  })

  it('IPC 失败也落成可见错误', async () => {
    const harness = makeHarness(null)
    harness.readChapter.mockRejectedValueOnce(new Error('磁盘读不了'))
    await useReaderStore.getState().open(BOOK_ID)
    expect(useReaderStore.getState().error).toContain('磁盘读不了')
    expect(useReaderStore.getState().loading).toBe(false)
  })

  it('迟到的 open 结果不会覆盖后一次打开', async () => {
    const harness = makeHarness(null)
    let release: ((value: Book | null) => void) | null = null
    const slow = new Promise<Book | null>((resolve) => {
      release = resolve
    })
    harness.getBook.mockImplementationOnce(() => slow)

    const first = useReaderStore.getState().open(BOOK_ID)
    const second = useReaderStore.getState().open(BOOK_ID)
    await second
    if (release) (release as (value: Book | null) => void)(book)
    await first

    expect(useReaderStore.getState().loading).toBe(false)
    expect(useReaderStore.getState().chapterText).toBe(DEFAULT_TEXTS[0])
  })

  it('超长章节先渲染前 2 万字，继续加载是一步步展开的', async () => {
    const longText = '长'.repeat(CHUNK_FIRST_RENDER_CHARS * 3 + 5000)
    makeHarness(null, [longText, '第二章'])
    await useReaderStore.getState().open(BOOK_ID)
    expect(useReaderStore.getState().visibleChars).toBe(CHUNK_FIRST_RENDER_CHARS)

    // 一次只多渲染一步：几十万字的章节全量挂进 DOM 会卡住界面
    useReaderStore.getState().revealMore()
    expect(useReaderStore.getState().visibleChars).toBe(CHUNK_FIRST_RENDER_CHARS * 2)

    useReaderStore.getState().revealMore()
    expect(useReaderStore.getState().visibleChars).toBe(CHUNK_FIRST_RENDER_CHARS * 3)

    // 最后一步不足一整步时夹到章尾
    useReaderStore.getState().revealMore()
    expect(useReaderStore.getState().visibleChars).toBe(longText.length)

    // 已经到底再点也不会越界
    useReaderStore.getState().revealMore()
    expect(useReaderStore.getState().visibleChars).toBe(longText.length)
  })

  it('跳到章节深处时一次铺到目标之后一屏，铺够了就不动', async () => {
    const longText = '长'.repeat(CHUNK_FIRST_RENDER_CHARS * 6)
    makeHarness(null, [longText, '第二章'])
    await useReaderStore.getState().open(BOOK_ID)
    expect(useReaderStore.getState().visibleChars).toBe(CHUNK_FIRST_RENDER_CHARS)

    // 目标落在第 3 万 5 千字：铺到目标 + 一屏
    useReaderStore.getState().revealTo(CHUNK_FIRST_RENDER_CHARS + 15_000)
    expect(useReaderStore.getState().visibleChars).toBe(CHUNK_FIRST_RENDER_CHARS * 2 + 15_000)

    // 往已经铺出来的地方跳：不缩回去（不然刚要读的那一段会被收回）
    useReaderStore.getState().revealTo(1000)
    expect(useReaderStore.getState().visibleChars).toBe(CHUNK_FIRST_RENDER_CHARS * 2 + 15_000)

    // 越界的目标夹到章尾
    useReaderStore.getState().revealTo(longText.length * 2)
    expect(useReaderStore.getState().visibleChars).toBe(longText.length)
  })
})

describe('reader store: 章节切换', () => {
  it('切章前先把上一章的位置落盘', async () => {
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)

    useReaderStore.getState().onScrolled(20)
    await useReaderStore.getState().goto(1, 0)

    expect(harness.saveProgress).toHaveBeenCalledTimes(1)
    const saved = harness.saveProgress.mock.calls[0]?.[0] as unknown as Progress
    expect(saved.bookId).toBe(BOOK_ID)
    expect(saved.chapterIndex).toBe(0)
    expect(saved.charOffset).toBe(20)
    expect(saved.deviceId).toBe('device-test')
    expect(saved.anchorBefore).not.toBeNull()

    const state = useReaderStore.getState()
    expect(state.chapterIndex).toBe(1)
    expect(state.pendingOffset).toBe(0)
    expect(state.percent).toBeCloseTo(33.33, 1)
  })

  it('同章内跳转只挪位置，不重新读章节', async () => {
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)
    await useReaderStore.getState().goto(0, 42)
    expect(harness.readChapter).toHaveBeenCalledTimes(1)
    expect(useReaderStore.getState().pendingOffset).toBe(42)
  })

  it('首章不能再上一章，末章不能再下一章', async () => {
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)

    await useReaderStore.getState().prev()
    expect(useReaderStore.getState().chapterIndex).toBe(0)

    await useReaderStore.getState().next()
    expect(useReaderStore.getState().chapterIndex).toBe(1)
    expect(harness.readChapter).toHaveBeenCalledTimes(2)

    await useReaderStore.getState().next()
    expect(useReaderStore.getState().chapterIndex).toBe(1)
    expect(harness.readChapter).toHaveBeenCalledTimes(2)
  })
})

describe('reader store: 进度写入', () => {
  it('滚动时 500ms 内只落一次盘，写的是最新偏移', async () => {
    vi.useFakeTimers()
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)

    useReaderStore.getState().onScrolled(10)
    useReaderStore.getState().onScrolled(30)
    expect(harness.saveProgress).not.toHaveBeenCalled()

    vi.advanceTimersByTime(PROGRESS_THROTTLE_MS)
    expect(harness.saveProgress).toHaveBeenCalledTimes(1)
    const saved = harness.saveProgress.mock.calls[0]?.[0] as unknown as Progress
    expect(saved.charOffset).toBe(30)
    expect(saved.percent).toBeCloseTo(10, 1)
  })

  it('偏移会被夹在本章长度内', async () => {
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)

    useReaderStore.getState().onScrolled(999999)
    useReaderStore.getState().flush()
    const saved = harness.saveProgress.mock.calls[0]?.[0] as unknown as Progress
    expect(saved.charOffset).toBe(DEFAULT_TEXTS[0].length)
  })

  it('leave 先落盘再清空状态', async () => {
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().onScrolled(12)
    useReaderStore.getState().leave()

    expect(harness.saveProgress).toHaveBeenCalledTimes(1)
    const state = useReaderStore.getState()
    expect(state.book).toBeNull()
    expect(state.chapterText).toBe('')
    expect(state.chapters).toEqual([])
    expect(state.percent).toBe(0)
  })
})

describe('reader store: 上次位置', () => {
  /** 演出「待在某个位置不动」：先滚到那儿，再把时钟往前推一段。 */
  function stayAt(offset: number, ms: number): void {
    useReaderStore.getState().onScrolled(offset)
    vi.advanceTimersByTime(ms)
  }

  it('打开时就把恢复处记成书签，按钮一进来就能用', async () => {
    makeHarness(storedProgress({ chapterIndex: 1, charOffset: 50 }))
    await useReaderStore.getState().open(BOOK_ID)

    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 50 })
  })

  it('只是快滑过去瞥一眼，不会把「上次位置」顶掉（0.1.4 修的「拖到底就回不去」）', async () => {
    vi.useFakeTimers()
    makeHarness(storedProgress({ chapterIndex: 1, charOffset: 20 }))
    await useReaderStore.getState().open(BOOK_ID)

    // 刚打开就把滚动条拖到本章末尾，松手停 1.2 秒就去点按钮
    useReaderStore.getState().onScrolled(180)
    vi.advanceTimersByTime(BOOKMARK_REST_MS + 100)
    useReaderStore.getState().settleBookmark(180)

    // 「上次位置」还是打开时那儿 —— 于是点一下真能回去（旧逻辑下这里会原地不动）
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 20 })
    await useReaderStore.getState().backToBookmark()
    expect(useReaderStore.getState().pendingOffset).toBe(20)
  })

  it('在同一个地方待够 BOOKMARK_DWELL_MS 才算读到这儿，同章挪一点点不动它', async () => {
    vi.useFakeTimers()
    makeHarness(storedProgress({ chapterIndex: 1, charOffset: 0 }))
    await useReaderStore.getState().open(BOOK_ID)

    // 刚滑到 150 就结算：还没待够，不认
    useReaderStore.getState().onScrolled(150)
    useReaderStore.getState().settleBookmark(150)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 0 })

    // 待够之后才落成「上次位置」
    stayAt(150, BOOKMARK_DWELL_MS)
    useReaderStore.getState().settleBookmark(150)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 150 })

    // 只挪了不到 BOOKMARK_MIN_GAP_CHARS：算同一个地方，不重开计时
    stayAt(150 + BOOKMARK_MIN_GAP_CHARS - 1, BOOKMARK_DWELL_MS)
    useReaderStore.getState().settleBookmark(150 + BOOKMARK_MIN_GAP_CHARS - 1)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 150 })

    // 换了地方：计时重开，刚滚过去马上结算不算数
    useReaderStore.getState().onScrolled(0)
    useReaderStore.getState().settleBookmark(0)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 150 })

    // 在新地方待够才算
    stayAt(0, BOOKMARK_DWELL_MS)
    useReaderStore.getState().settleBookmark(0)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 0 })
  })

  it('没打开书、或偏移越界时都不会写坏书签', async () => {
    vi.useFakeTimers()
    useReaderStore.getState().settleBookmark(50)
    expect(useReaderStore.getState().bookmark).toBeNull()

    makeHarness(storedProgress({ chapterIndex: 1, charOffset: 0 }))
    await useReaderStore.getState().open(BOOK_ID)
    stayAt(999999, BOOKMARK_DWELL_MS)
    useReaderStore.getState().settleBookmark(999999)
    expect(useReaderStore.getState().bookmark).toEqual({
      chapterIndex: 1,
      charOffset: DEFAULT_TEXTS[1].length
    })
  })

  it('回到上次位置：跳回停留处，再点一次回到刚才离开的地方，两个槽位互不覆盖', async () => {
    vi.useFakeTimers()
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)

    // 读到第二章开头、待够 → 「上次位置」落在这里
    await useReaderStore.getState().goto(1, 0)
    stayAt(10, BOOKMARK_DWELL_MS)
    useReaderStore.getState().settleBookmark(10)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 10 })

    // 快速往下滑到第二章中段，还没停稳就想回去
    useReaderStore.getState().onScrolled(120)
    await useReaderStore.getState().backToBookmark()
    expect(useReaderStore.getState().pendingOffset).toBe(10)
    // 「上次位置」不被换掉，离开的地方单独记在 returnSpot
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 10 })
    expect(useReaderStore.getState().returnSpot).toEqual({ chapterIndex: 1, charOffset: 120 })

    // 跳转自身触发的那次停顿不算新位置
    useReaderStore.getState().settleBookmark(10)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 10 })

    // 再点一次 → 回到刚才离开的地方
    useReaderStore.getState().onScrolled(10)
    await useReaderStore.getState().backToBookmark()
    expect(useReaderStore.getState().pendingOffset).toBe(120)
    expect(harness.readChapter).toHaveBeenLastCalledWith(BOOK_ID, 1)
  })

  it('跨章回跳会把目标章读出来，leave 后书签与回跳位都清空', async () => {
    vi.useFakeTimers()
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)
    stayAt(60, BOOKMARK_DWELL_MS)
    useReaderStore.getState().settleBookmark(60)

    await useReaderStore.getState().goto(1, 0)
    useReaderStore.getState().onScrolled(5)
    await useReaderStore.getState().backToBookmark()
    expect(harness.readChapter).toHaveBeenLastCalledWith(BOOK_ID, 0)
    expect(useReaderStore.getState().chapterIndex).toBe(0)
    expect(useReaderStore.getState().chapterText).toBe(DEFAULT_TEXTS[0])

    useReaderStore.getState().leave()
    expect(useReaderStore.getState().bookmark).toBeNull()
    expect(useReaderStore.getState().returnSpot).toBeNull()
  })
})

describe('reader store: 手动改分章', () => {
  const merged: Chapter[] = [
    { bookId: BOOK_ID, index: 0, title: '第一章', startOffset: 0, charLength: 300, kind: 'chapter' }
  ]

  it('合并到当前章：按编辑前的绝对位置落位，并强制重读变长后的正文', async () => {
    const harness = makeHarness(storedProgress({ chapterIndex: 1, charOffset: 40 }))
    await useReaderStore.getState().open(BOOK_ID)
    expect(useReaderStore.getState().chapterIndex).toBe(1)

    const mergedText = DEFAULT_TEXTS[0] + DEFAULT_TEXTS[1]
    harness.mergeChapter.mockResolvedValueOnce(merged)
    harness.readChapter.mockResolvedValueOnce(mergedText)
    await useReaderStore.getState().mergeChapter(0)

    const state = useReaderStore.getState()
    expect(harness.mergeChapter).toHaveBeenCalledWith(BOOK_ID, 0)
    expect(state.chapters).toEqual(merged)
    // 绝对位置 = 100（第二章起点）+ 40
    expect(state.chapterIndex).toBe(0)
    expect(state.pendingOffset).toBe(140)
    expect(state.chapterText).toBe(mergedText)
    expect(state.visibleChars).toBe(mergedText.length)
    expect(state.error).toBeNull()
    expect(harness.readChapter).toHaveBeenLastCalledWith(BOOK_ID, 0)
  })

  it('改名只换标题：正文、位置与书签都不动', async () => {
    const harness = makeHarness(storedProgress({ chapterIndex: 0, charOffset: 30 }))
    await useReaderStore.getState().open(BOOK_ID)

    const renamed: Chapter[] = [{ ...chapters[0], title: '序章' }, chapters[1]]
    harness.renameChapter.mockResolvedValueOnce(renamed)
    await useReaderStore.getState().renameChapter(0, '序章')

    const state = useReaderStore.getState()
    expect(harness.renameChapter).toHaveBeenCalledWith(BOOK_ID, 0, '序章')
    expect(state.chapters[0].title).toBe('序章')
    expect(state.pendingOffset).toBe(30)
    expect(state.bookmark).toEqual({ chapterIndex: 0, charOffset: 30 })
    expect(state.chapterText).toBe(DEFAULT_TEXTS[0])
  })

  it('主进程拒绝时把原因写成「改分章失败」', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    harness.mergeChapter.mockRejectedValueOnce(new Error('这已经是最后一章，后面没有可以合并的章节'))
    await useReaderStore.getState().mergeChapter(1)

    expect(useReaderStore.getState().error).toBe(
      '改分章失败：这已经是最后一章，后面没有可以合并的章节'
    )
    expect(useReaderStore.getState().loading).toBe(false)
  })
})

describe('reader store: 书签与划线', () => {
  function bookmarkAt(chapterIndex: number, charOffset: number, id: string): Bookmark {
    return { id, bookId: BOOK_ID, chapterIndex, charOffset, excerpt: '读到这儿', createdAt: 1 }
  }

  function highlightAt(chapterIndex: number, startOffset: number, id: string): Highlight {
    return {
      id,
      bookId: BOOK_ID,
      chapterIndex,
      startOffset,
      endOffset: startOffset + 4,
      text: '一段话',
      note: null,
      createdAt: 1
    }
  }

  it('加书签记的是当前停下的位置，摘要是那一小段原文', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().onScrolled(43)
    await expect(useReaderStore.getState().addBookmark()).resolves.toBe(true)

    const excerpt = excerptAt(DEFAULT_TEXTS[0], 43)
    expect(harness.addBookmark).toHaveBeenCalledWith({
      bookId: BOOK_ID,
      chapterIndex: 0,
      charOffset: 43,
      excerpt
    })
    expect(useReaderStore.getState().bookmarks).toEqual([
      { bookId: BOOK_ID, chapterIndex: 0, charOffset: 43, excerpt, id: 'k-new', createdAt: 9 }
    ])
    expect(useReaderStore.getState().error).toBeNull()
  })

  it('加书签失败时给出可见错误，列表不动', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().onScrolled(10)
    harness.addBookmark.mockRejectedValueOnce(new Error('库锁住了'))

    await expect(useReaderStore.getState().addBookmark()).resolves.toBe(false)
    expect(useReaderStore.getState().error).toBe('加书签失败：库锁住了')
    expect(useReaderStore.getState().bookmarks).toEqual([])
  })

  it('没打开书时加书签什么也不做，返回 false（不弹「已加书签」）', async () => {
    const harness = makeHarness()
    await expect(useReaderStore.getState().addBookmark()).resolves.toBe(false)
    expect(harness.addBookmark).not.toHaveBeenCalled()
  })

  it('划线记下起止偏移与原文，超长时裁到上限并把结束位置收回来', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    const long = '字'.repeat(HIGHLIGHT_MAX_CHARS + 300)
    await useReaderStore.getState().addHighlight(10, 10 + long.length, long)

    const sent = harness.addHighlight.mock.calls[0]?.[0] as HighlightInput
    expect(sent.startOffset).toBe(10)
    expect(sent.endOffset).toBe(10 + HIGHLIGHT_MAX_CHARS)
    expect(sent.text).toHaveLength(HIGHLIGHT_MAX_CHARS)
    expect(useReaderStore.getState().highlights).toEqual([
      { ...sent, id: 'h-new', note: null, createdAt: 9 }
    ])
  })

  it('反着选的一段会被摆正，空白文字与空范围不落库', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)

    // 从右往左选在界面上很常见，起点终点摆正后照常划线
    await useReaderStore.getState().addHighlight(30, 10, '反着选的')
    const sent = harness.addHighlight.mock.calls[0]?.[0] as HighlightInput
    expect(sent.startOffset).toBe(10)
    expect(sent.endOffset).toBe(14)
    expect(sent.text).toBe('反着选的')

    harness.addHighlight.mockClear()
    await useReaderStore.getState().addHighlight(0, 5, '   \n  ')
    await useReaderStore.getState().addHighlight(5, 5, '同一点上点两下')
    expect(harness.addHighlight).not.toHaveBeenCalled()
  })

  it('划线写不进去时给出可见错误，列表不动', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)

    harness.addHighlight.mockRejectedValueOnce(new Error('写不进去'))
    await useReaderStore.getState().addHighlight(0, 5, '一段话')
    expect(useReaderStore.getState().error).toBe('加划线失败：写不进去')
    expect(useReaderStore.getState().highlights).toEqual([])
  })

  it('打开时把书签与划线都带回来，并按正文顺序排好', async () => {
    makeHarness(null, DEFAULT_TEXTS, {
      bookmarks: [bookmarkAt(1, 5, 'k2'), bookmarkAt(0, 30, 'k1'), bookmarkAt(0, 10, 'k0')],
      highlights: [highlightAt(1, 0, 'h2'), highlightAt(0, 40, 'h1'), highlightAt(0, 4, 'h0')]
    })
    await useReaderStore.getState().open(BOOK_ID)

    const state = useReaderStore.getState()
    expect(state.bookmarks.map((item) => item.id)).toEqual(['k0', 'k1', 'k2'])
    expect(state.highlights.map((item) => item.id)).toEqual(['h0', 'h1', 'h2'])
  })

  it('书签与划线读不出来也不挡着看书', async () => {
    const harness = makeHarness()
    harness.listBookmarks.mockRejectedValueOnce(new Error('表还没建'))
    harness.listHighlights.mockRejectedValueOnce(new Error('表还没建'))

    await useReaderStore.getState().open(BOOK_ID)
    const state = useReaderStore.getState()
    expect(state.error).toBeNull()
    expect(state.chapterText).toBe(DEFAULT_TEXTS[0])
    expect(state.bookmarks).toEqual([])
    expect(state.highlights).toEqual([])
  })

  it('删书签与划线先发请求再从列表拿掉', async () => {
    const harness = makeHarness(null, DEFAULT_TEXTS, {
      bookmarks: [bookmarkAt(0, 10, 'k1')],
      highlights: [highlightAt(0, 10, 'h1')]
    })
    await useReaderStore.getState().open(BOOK_ID)

    await useReaderStore.getState().removeBookmark('k1')
    await useReaderStore.getState().removeHighlight('h1')

    expect(harness.removeBookmark).toHaveBeenCalledWith('k1')
    expect(harness.removeHighlight).toHaveBeenCalledWith('h1')
    expect(useReaderStore.getState().bookmarks).toEqual([])
    expect(useReaderStore.getState().highlights).toEqual([])
  })

  it('删除失败时列表保持原样并报错', async () => {
    const harness = makeHarness(null, DEFAULT_TEXTS, {
      bookmarks: [bookmarkAt(0, 10, 'k1')],
      highlights: [highlightAt(0, 10, 'h1')]
    })
    await useReaderStore.getState().open(BOOK_ID)

    harness.removeBookmark.mockRejectedValueOnce(new Error('删不动'))
    harness.removeHighlight.mockRejectedValueOnce(new Error('也删不动'))
    await useReaderStore.getState().removeBookmark('k1')
    expect(useReaderStore.getState().error).toBe('删除书签失败：删不动')
    await useReaderStore.getState().removeHighlight('h1')
    expect(useReaderStore.getState().error).toBe('删除划线失败：也删不动')

    expect(useReaderStore.getState().bookmarks).toHaveLength(1)
    expect(useReaderStore.getState().highlights).toHaveLength(1)
  })

  it('leave 把书签与划线一起清空', async () => {
    makeHarness(null, DEFAULT_TEXTS, {
      bookmarks: [bookmarkAt(0, 10, 'k1')],
      highlights: [highlightAt(0, 10, 'h1')]
    })
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().leave()

    expect(useReaderStore.getState().bookmarks).toEqual([])
    expect(useReaderStore.getState().highlights).toEqual([])
  })
})

describe('reader store: 搜索', () => {
  const HIT: SearchHit = {
    chapterIndex: 1,
    chapterTitle: '第二章',
    charOffset: 7,
    before: '前面的话',
    match: '山川',
    after: '后面的话'
  }

  function searchResult(patch: Partial<SearchResult> = {}): SearchResult {
    return {
      query: '山川',
      scope: 'book',
      total: 1,
      counts: [{ chapterIndex: 1, count: 1 }],
      hits: [HIT],
      truncated: false,
      ...patch
    }
  }

  it('搜一次：关键词去掉首尾空白，带上当前章号，结果落进 state', async () => {
    const harness = makeHarness()
    harness.searchBook.mockResolvedValueOnce(searchResult())
    await useReaderStore.getState().open(BOOK_ID)
    await useReaderStore.getState().runSearch('  山川  ', 'book')

    expect(harness.searchBook).toHaveBeenCalledWith(BOOK_ID, '山川', 'book', 0)
    const state = useReaderStore.getState()
    expect(state.searchResult?.hits[0]).toEqual(HIT)
    expect(state.searchQuery).toBe('山川')
    expect(state.searchScope).toBe('book')
    expect(state.searching).toBe(false)
    expect(state.searchError).toBeNull()
  })

  it('超长关键词截到上限再发出去', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    await useReaderStore.getState().runSearch('x'.repeat(120), 'chapter')

    expect(harness.searchBook).toHaveBeenCalledWith(BOOK_ID, 'x'.repeat(80), 'chapter', 0)
  })

  it('空关键词清掉旧结果，也不发请求', async () => {
    const harness = makeHarness()
    harness.searchBook.mockResolvedValueOnce(searchResult())
    await useReaderStore.getState().open(BOOK_ID)
    await useReaderStore.getState().runSearch('山川', 'book')
    expect(useReaderStore.getState().searchResult).not.toBeNull()

    await useReaderStore.getState().runSearch('   ', 'book')
    expect(harness.searchBook).toHaveBeenCalledTimes(1)
    expect(useReaderStore.getState().searchResult).toBeNull()
    expect(useReaderStore.getState().searchQuery).toBe('')
  })

  it('迟到的结果不会盖掉后一次搜索', async () => {
    const harness = makeHarness()
    let release: (value: SearchResult) => void = () => undefined
    harness.searchBook.mockImplementationOnce(
      () =>
        new Promise<SearchResult>((resolve) => {
          release = resolve
        })
    )
    await useReaderStore.getState().open(BOOK_ID)

    const pending = useReaderStore.getState().runSearch('旧词', 'book')
    useReaderStore.getState().clearSearch()
    release(searchResult({ query: '旧词' }))
    await pending

    expect(useReaderStore.getState().searchResult).toBeNull()
    expect(useReaderStore.getState().searching).toBe(false)
  })

  it('搜索失败时写中文提示，好赖都不弹出结果', async () => {
    const harness = makeHarness()
    harness.searchBook.mockRejectedValueOnce(new Error('翻页翻丢了'))
    await useReaderStore.getState().open(BOOK_ID)
    await useReaderStore.getState().runSearch('山川', 'book')

    expect(useReaderStore.getState().searchError).toBe('搜索失败：翻页翻丢了')
    expect(useReaderStore.getState().searching).toBe(false)
    expect(useReaderStore.getState().searchResult).toBeNull()
  })

  it('没打开书时不发请求', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().runSearch('山川', 'book')
    expect(harness.searchBook).not.toHaveBeenCalled()
  })

  it('点一条命中：先记下要闪的位置，再跳到那一处', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    await useReaderStore.getState().jumpToHit(HIT)

    const state = useReaderStore.getState()
    expect(harness.readChapter).toHaveBeenCalledWith(BOOK_ID, 1)
    expect(state.chapterIndex).toBe(1)
    expect(state.pendingOffset).toBe(7)
    expect(state.flash).toEqual({ chapterIndex: 1, offset: 7 })

    useReaderStore.getState().clearFlash()
    expect(useReaderStore.getState().flash).toBeNull()
  })

  it('clearSearch 把面板状态收干净', async () => {
    const harness = makeHarness()
    harness.searchBook.mockResolvedValueOnce(searchResult())
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().setSearch(true)
    await useReaderStore.getState().runSearch('山川', 'book')

    useReaderStore.getState().clearSearch()
    const state = useReaderStore.getState()
    expect(state.searchQuery).toBe('')
    expect(state.searchResult).toBeNull()
    expect(state.searchError).toBeNull()
    expect(state.searching).toBe(false)
    expect(state.flash).toBeNull()
    // 面板开合由 UI 决定，clearSearch 不替它关
    expect(state.searchOpen).toBe(true)
  })

  it('open 与 leave 都把搜索状态收掉', async () => {
    makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().setSearch(true)
    expect(useReaderStore.getState().searchOpen).toBe(true)

    useReaderStore.getState().leave()
    const left = useReaderStore.getState()
    expect(left.searchOpen).toBe(false)
    expect(left.searchQuery).toBe('')
    expect(left.searchResult).toBeNull()
    expect(left.flash).toBeNull()
  })
})

describe('reader store: 阅读统计', () => {
  it('在读的时候每 15 秒报一段时长；字数不再由渲染层算', async () => {
    vi.useFakeTimers()
    const harness = makeHarness(storedProgress({ chapterIndex: 0, charOffset: 0 }))
    await useReaderStore.getState().open(BOOK_ID)

    // 打开就把节拍挂上：安静读了 15 秒
    vi.advanceTimersByTime(STAT_REPORT_MS)
    expect(harness.addReadingStat.mock.calls[0]).toEqual([BOOK_ID, STAT_REPORT_MS, 0])

    // 滚动 + 落盘也不再往上报里塞字数：0.1.4 起字数归主进程按水位线算
    useReaderStore.getState().onScrolled(50)
    vi.advanceTimersByTime(PROGRESS_THROTTLE_MS)
    expect(harness.saveProgress).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(STAT_REPORT_MS - PROGRESS_THROTTLE_MS)
    expect(harness.addReadingStat.mock.calls[1]).toEqual([BOOK_ID, STAT_REPORT_MS, 0])
  })

  it('一分钟没人动就停表，挂机时间不算读', async () => {
    vi.useFakeTimers()
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)

    vi.advanceTimersByTime(STAT_IDLE_MS * 3)
    // 只有前 60 秒内的四拍算数：15 / 30 / 45 / 60 秒
    expect(harness.addReadingStat).toHaveBeenCalledTimes(4)
    const reported = harness.addReadingStat.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0)
    expect(reported).toBe(STAT_REPORT_MS * 4)
  })

  it('离开阅读器时不再需要补字数：字数在「停下读过」那一下就报给主进程了', async () => {
    vi.useFakeTimers()
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().onScrolled(30)
    vi.advanceTimersByTime(PROGRESS_THROTTLE_MS)
    harness.addReadingStat.mockClear()

    // 时长这一拍还没到点，所以离开时什么都不用补（0.1.4 起字数不在这里攒）
    useReaderStore.getState().leave()
    expect(harness.addReadingStat).not.toHaveBeenCalled()
  })

  it('停下来读过就报位置给主进程，原地不动不重复报，进章点跟着换章走', async () => {
    const harness = makeHarness(storedProgress({ chapterIndex: 0, charOffset: 0 }))
    await useReaderStore.getState().open(BOOK_ID)

    // 第一章正文只有 94 字，报的偏移会被夹在章长以内
    useReaderStore.getState().readPaused(60)
    expect(harness.addReadSpan).toHaveBeenCalledTimes(1)
    expect(harness.addReadSpan.mock.calls[0]?.[0]).toEqual({
      bookId: BOOK_ID,
      chapterIndex: 0,
      charOffset: 60,
      // 打开这本书时停在 0，所以这一章的水位线从 0 起算
      enteredAt: 0
    })

    // 位置几乎没动：不再报（主进程算出来也会是 0）
    useReaderStore.getState().readPaused(64)
    expect(harness.addReadSpan).toHaveBeenCalledTimes(1)

    // 换到第二章（从 10 处进去）：报的位置与进章点都跟着换
    await useReaderStore.getState().goto(1, 10)
    useReaderStore.getState().readPaused(80)
    expect(harness.addReadSpan).toHaveBeenCalledTimes(2)
    expect(harness.addReadSpan.mock.calls[1]?.[0]).toEqual({
      bookId: BOOK_ID,
      chapterIndex: 1,
      charOffset: 80,
      enteredAt: 10
    })
  })
})


