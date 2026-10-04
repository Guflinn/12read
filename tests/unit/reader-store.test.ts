import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReaderApi } from '@shared/api'
import { CHUNK_FIRST_RENDER_CHARS, type Book, type Chapter, type Progress } from '@shared/types'
import { setReaderApi } from '@/core/api'
import { setDeviceId } from '@/core/session'
import { BOOKMARK_MIN_GAP_CHARS, PROGRESS_THROTTLE_MS, useReaderStore } from '@/store/reader'

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
  splitChapter: ReturnType<typeof vi.fn>
}

function makeHarness(
  stored: Progress | null = null,
  texts: string[] = DEFAULT_TEXTS
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
  const splitChapter = vi.fn(async (): Promise<Chapter[]> => chapters)
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
    splitChapter,
    readChapter,
    getProgress,
    saveProgress,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    onImportProgress: vi.fn(() => (): void => undefined),
    pathForFile: vi.fn(() => '')
  } as unknown as ReaderApi
  setReaderApi(api)
  return { api, readChapter, saveProgress, getProgress, getBook, renameChapter, mergeChapter, splitChapter }
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
    bookmark: null
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
  it('打开时就把恢复处记成书签，按钮一进来就能用', async () => {
    makeHarness(storedProgress({ chapterIndex: 1, charOffset: 50 }))
    await useReaderStore.getState().open(BOOK_ID)

    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 50 })
  })

  it('停下来读一会儿就更新书签，同章挪一点点不动它', async () => {
    // 第二章 194 字，够跨过 BOOKMARK_MIN_GAP_CHARS
    makeHarness(storedProgress({ chapterIndex: 1, charOffset: 0 }))
    await useReaderStore.getState().open(BOOK_ID)

    useReaderStore.getState().settleBookmark(150)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 150 })

    // 只挪了不到 BOOKMARK_MIN_GAP_CHARS：还是原来那个位置
    useReaderStore.getState().settleBookmark(150 + BOOKMARK_MIN_GAP_CHARS - 1)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 150 })

    useReaderStore.getState().settleBookmark(0)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 0 })
  })

  it('没打开书、或偏移越界时都不会写坏书签', async () => {
    useReaderStore.getState().settleBookmark(50)
    expect(useReaderStore.getState().bookmark).toBeNull()

    makeHarness(storedProgress({ chapterIndex: 1, charOffset: 0 }))
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().settleBookmark(999999)
    expect(useReaderStore.getState().bookmark).toEqual({
      chapterIndex: 1,
      charOffset: DEFAULT_TEXTS[1].length
    })
  })

  it('回到上次位置：跳回停留处，再点一次回到刚才离开的地方', async () => {
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)

    // 读到第二章开头，停下来 → 书签落在这里
    await useReaderStore.getState().goto(1, 0)
    useReaderStore.getState().onScrolled(10)
    useReaderStore.getState().settleBookmark(10)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 10 })

    // 快速往下滑到第二章中段，还没停稳就想回去
    useReaderStore.getState().onScrolled(120)
    await useReaderStore.getState().backToBookmark()
    expect(useReaderStore.getState().chapterIndex).toBe(1)
    expect(useReaderStore.getState().pendingOffset).toBe(10)
    // 离开的地方被换成了新书签，于是再点一次能回去
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 120 })

    // 跳转自身触发的那次停顿不算新位置，书签还在 120
    useReaderStore.getState().settleBookmark(10)
    expect(useReaderStore.getState().bookmark).toEqual({ chapterIndex: 1, charOffset: 120 })

    useReaderStore.getState().onScrolled(120)
    await useReaderStore.getState().backToBookmark()
    expect(useReaderStore.getState().pendingOffset).toBe(120)
    expect(harness.readChapter).toHaveBeenLastCalledWith(BOOK_ID, 1)
  })

  it('跨章回跳会把目标章读出来，leave 后书签清空', async () => {
    const harness = makeHarness(storedProgress())
    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().onScrolled(60)
    useReaderStore.getState().settleBookmark(60)

    await useReaderStore.getState().goto(1, 0)
    useReaderStore.getState().onScrolled(5)
    await useReaderStore.getState().backToBookmark()
    expect(harness.readChapter).toHaveBeenLastCalledWith(BOOK_ID, 0)
    expect(useReaderStore.getState().chapterIndex).toBe(0)
    expect(useReaderStore.getState().chapterText).toBe(DEFAULT_TEXTS[0])

    useReaderStore.getState().leave()
    expect(useReaderStore.getState().bookmark).toBeNull()
  })
})

describe('reader store: 手动改分章', () => {
  const merged: Chapter[] = [
    { bookId: BOOK_ID, index: 0, title: '第一章', startOffset: 0, charLength: 300, kind: 'chapter' }
  ]
  const split: Chapter[] = [
    { bookId: BOOK_ID, index: 0, title: '第一章', startOffset: 0, charLength: 50, kind: 'chapter' },
    {
      bookId: BOOK_ID,
      index: 1,
      title: '第一章（续）',
      startOffset: 50,
      charLength: 50,
      kind: 'chapter'
    },
    { bookId: BOOK_ID, index: 2, title: '第二章', startOffset: 100, charLength: 200, kind: 'chapter' }
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

  it('拆分后位置与书签都落到后半章', async () => {
    const harness = makeHarness(storedProgress({ chapterIndex: 0, charOffset: 80 }))
    await useReaderStore.getState().open(BOOK_ID)

    // 假正文要够长，否则偏移会被夹到正文长度（真实数据里两者是一致的）
    const tailText = '後'.repeat(60)
    harness.splitChapter.mockResolvedValueOnce(split)
    harness.readChapter.mockResolvedValueOnce(tailText)
    await useReaderStore.getState().splitChapter(0, 80)

    const state = useReaderStore.getState()
    expect(harness.splitChapter).toHaveBeenCalledWith(BOOK_ID, 0, 80)
    // 绝对位置 80 落进新的「第一章（续）」（50 起）
    expect(state.chapterIndex).toBe(1)
    expect(state.pendingOffset).toBe(30)
    expect(state.chapterText).toBe(tailText)
    expect(state.bookmark).toEqual({ chapterIndex: 1, charOffset: 30 })
  })

  it('拆分位置在章首时给出提示，不发请求', async () => {
    const harness = makeHarness()
    await useReaderStore.getState().open(BOOK_ID)
    await useReaderStore.getState().splitChapter(0, 0)

    expect(harness.splitChapter).not.toHaveBeenCalled()
    expect(useReaderStore.getState().error).toContain('拆分位置要落在这一章中间')
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

