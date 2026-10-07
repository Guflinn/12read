import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book, Chapter, Progress } from '@shared/types'
import type { ReaderApi } from '@shared/api'
import { setReaderApi } from '@/core/api'
import { setDeviceId } from '@/core/session'
import { useReaderStore } from '@/store/reader'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

const BOOK: Book = {
  id: BOOK_ID,
  title: '状态测试书',
  author: null,
  format: 'txt',
  encoding: 'utf-8',
  byteSize: 100,
  charCount: 400,
  chapterCount: 2,
  contentMode: 'single',
  coverSeed: 3,
  addedAt: 1,
  lastOpenedAt: null
}

const CHAPTERS: Chapter[] = [
  { bookId: BOOK_ID, index: 0, title: '第一章', startOffset: 0, charLength: 200, kind: 'chapter' },
  { bookId: BOOK_ID, index: 1, title: '第二章', startOffset: 200, charLength: 200, kind: 'chapter' }
]

const TEXT = '第一章 开篇\n' + '山川湖海'.repeat(40)

const PROGRESS: Progress = {
  bookId: BOOK_ID,
  chapterIndex: 0,
  charOffset: 0,
  anchorBefore: null,
  anchorAfter: null,
  percent: 0,
  updatedAt: 1,
  deviceId: 'device-1'
}

type ApiMock = { [K in keyof ReaderApi]: ReturnType<typeof vi.fn> }

let currentApi: ApiMock

function makeApi(): ApiMock {
  return {
    appInfo: vi.fn(),
    pickFiles: vi.fn(),
    importFile: vi.fn(),
    cancelTask: vi.fn(),
    listBooks: vi.fn(),
    getBook: vi.fn(async () => BOOK),
    renameBook: vi.fn(),
    redecodeBook: vi.fn(async () => BOOK),
    deleteBook: vi.fn(),
    chapters: vi.fn(async () => CHAPTERS),
    renameChapter: vi.fn(),
    mergeChapter: vi.fn(),
    listBookmarks: vi.fn(async () => []),
    addBookmark: vi.fn(),
    removeBookmark: vi.fn(),
    listHighlights: vi.fn(async () => []),
    addHighlight: vi.fn(),
    removeHighlight: vi.fn(),
    searchBook: vi.fn(),
    addReadingStat: vi.fn(async () => undefined),
    addReadSpan: vi.fn(async () => 0),
    getReadingStats: vi.fn(),
    getReadingCalendar: vi.fn(),
    getBookImages: vi.fn(async () => []),
    checkUpdate: vi.fn(async () => null),
    openUpdatePage: vi.fn(async () => undefined),
    exportBackup: vi.fn(async () => null),
    readChapter: vi.fn(async () => TEXT),
    getProgress: vi.fn(async () => PROGRESS),
    saveProgress: vi.fn(async () => undefined),
    flushProgress: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    pathForFile: vi.fn(() => 'D:\\a.txt'),
    onImportProgress: vi.fn(() => () => undefined)
  }
}

/** 每个用例从干净状态开始：store 是模块级单例。 */
beforeEach(() => {
  currentApi = makeApi()
  setReaderApi(currentApi as unknown as ReaderApi)
  setDeviceId('device-1')
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
})

describe('阅读器开关类状态', () => {
  it('打开后 consumePending 清掉待定位偏移（ReaderView 滚到位后调用）', async () => {
    await useReaderStore.getState().open(BOOK_ID)
    expect(useReaderStore.getState().pendingOffset).toBe(0)
    useReaderStore.getState().consumePending()
    expect(useReaderStore.getState().pendingOffset).toBeNull()
  })

  it('目录 / 设置面板互相独立，leave 后全部关掉', async () => {
    const store = useReaderStore.getState()
    store.setToc(true)
    expect(useReaderStore.getState().tocOpen).toBe(true)
    expect(useReaderStore.getState().sheetOpen).toBe(false)

    store.setSheet(true)
    store.setToc(false)
    expect(useReaderStore.getState().sheetOpen).toBe(true)
    expect(useReaderStore.getState().tocOpen).toBe(false)

    useReaderStore.getState().leave()
    const left = useReaderStore.getState()
    expect(left.book).toBeNull()
    expect(left.chapters).toEqual([])
    expect(left.tocOpen).toBe(false)
    expect(left.sheetOpen).toBe(false)
    expect(left.pendingOffset).toBeNull()
    expect(left.percent).toBe(0)
  })

  it('回书架时无条件落盘一次，没滚动过也算「最近读过」', async () => {
    await useReaderStore.getState().open(BOOK_ID)
    expect(currentApi.saveProgress).not.toHaveBeenCalled()

    await useReaderStore.getState().leave()

    expect(currentApi.saveProgress).toHaveBeenCalledTimes(1)
    const saved = currentApi.saveProgress.mock.calls[0]?.[0] as Progress
    expect(saved.bookId).toBe(BOOK_ID)
    expect(saved.chapterIndex).toBe(0)
    expect(saved.charOffset).toBe(0)
    expect(saved.deviceId).toBe('device-1')
  })

  it('没打开书时加书签与划线都不发请求，也不报错', async () => {
    await expect(useReaderStore.getState().addBookmark()).resolves.toBe(false)
    await useReaderStore.getState().addHighlight(0, 5, '一段文字')

    expect(currentApi.addBookmark).not.toHaveBeenCalled()
    expect(currentApi.addHighlight).not.toHaveBeenCalled()
    expect(useReaderStore.getState().error).toBeNull()
  })

  it('flushSync 关窗前把当前位置同步交给主进程，没打开书时什么都不做', async () => {
    useReaderStore.getState().flushSync()
    expect(currentApi.flushProgress).not.toHaveBeenCalled()

    await useReaderStore.getState().open(BOOK_ID)
    useReaderStore.getState().onScrolled(10)
    useReaderStore.getState().flushSync()

    expect(currentApi.flushProgress).toHaveBeenCalledTimes(1)
    const sent = currentApi.flushProgress.mock.calls[0]?.[0] as Progress
    expect(sent.bookId).toBe(BOOK_ID)
    expect(sent.charOffset).toBe(10)
    expect(sent.deviceId).toBe('device-1')

    useReaderStore.getState().flush()
    useReaderStore.getState().leave()
  })
})
