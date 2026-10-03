import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReaderApi } from '@shared/api'
import type { Book, ImportProgress } from '@shared/types'
import { setReaderApi } from '@/core/api'
import { useLibraryStore } from '@/store/library'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function makeBook(patch: Partial<Book> = {}): Book {
  return {
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
    lastOpenedAt: null,
    ...patch
  }
}

interface Harness {
  api: ReaderApi
  importFile: ReturnType<typeof vi.fn>
  listBooks: ReturnType<typeof vi.fn>
  renameBook: ReturnType<typeof vi.fn>
  deleteBook: ReturnType<typeof vi.fn>
  pickFiles: ReturnType<typeof vi.fn>
}

function makeHarness(): Harness {
  const importFile = vi.fn(async (filePath: string): Promise<Book> => {
    if (filePath.includes('坏')) throw new Error('这不是一个纯文本文件')
    return makeBook({ id: filePath })
  })
  const listBooks = vi.fn(async (): Promise<Book[]> => [makeBook({ id: 'a' }), makeBook({ id: 'b' })])
  const renameBook = vi.fn(async (bookId: string, title: string): Promise<Book> => makeBook({ id: bookId, title }))
  const deleteBook = vi.fn(async (): Promise<void> => undefined)
  const pickFiles = vi.fn(async (): Promise<string[]> => ['x.txt'])
  const api = {
    appInfo: vi.fn(),
    pickFiles,
    importFile,
    cancelTask: vi.fn(),
    listBooks,
    getBook: vi.fn(),
    renameBook,
    deleteBook,
    chapters: vi.fn(),
    readChapter: vi.fn(),
    getProgress: vi.fn(),
    saveProgress: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    onImportProgress: vi.fn(() => (): void => undefined),
    pathForFile: vi.fn(() => '')
  } as unknown as ReaderApi
  setReaderApi(api)
  return { api, importFile, listBooks, renameBook, deleteBook, pickFiles }
}

beforeEach(() => {
  useLibraryStore.setState({ books: [], loading: false, error: null, importing: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('library store', () => {
  it('load 拉取书架', async () => {
    makeHarness()
    await useLibraryStore.getState().load()
    expect(useLibraryStore.getState().books).toHaveLength(2)
    expect(useLibraryStore.getState().loading).toBe(false)
  })

  it('load 失败落成可见错误', async () => {
    const harness = makeHarness()
    harness.listBooks.mockRejectedValueOnce(new Error('库文件坏了'))
    await useLibraryStore.getState().load()
    expect(useLibraryStore.getState().error).toContain('库文件坏了')
  })

  it('多选导入：坏的记错误，好的继续导', async () => {
    const harness = makeHarness()
    const ok = await useLibraryStore.getState().importPaths(['好.txt', '坏.txt'])
    expect(ok).toBe(1)
    expect(harness.importFile).toHaveBeenCalledTimes(2)
    expect(useLibraryStore.getState().error).toContain('这不是一个纯文本文件')
    expect(harness.listBooks).toHaveBeenCalled()
  })

  it('选完文件就导入；取消选择时什么都不做', async () => {
    const harness = makeHarness()
    await useLibraryStore.getState().pickAndImport()
    expect(harness.importFile).toHaveBeenCalledWith('x.txt')

    harness.pickFiles.mockResolvedValueOnce([])
    await useLibraryStore.getState().pickAndImport()
    expect(harness.importFile).toHaveBeenCalledTimes(1)
  })

  it('重命名与删除都同步到书架列表', async () => {
    const harness = makeHarness()
    await useLibraryStore.getState().load()

    await useLibraryStore.getState().rename('a', '  新名字  ')
    const renamed = useLibraryStore.getState().books.find((book) => book.id === 'a')
    expect(renamed?.title).toBe('新名字')
    expect(harness.renameBook).toHaveBeenCalledWith('a', '新名字')

    await useLibraryStore.getState().remove('a')
    expect(useLibraryStore.getState().books.map((book) => book.id)).toEqual(['b'])
  })

  it('空标题不触发重命名', async () => {
    const harness = makeHarness()
    await useLibraryStore.getState().load()
    await useLibraryStore.getState().rename('a', '   ')
    expect(harness.renameBook).not.toHaveBeenCalled()
  })

  it('导入进度按 taskId 覆盖，done 之后移除', () => {
    const progress = (patch: Partial<ImportProgress>): ImportProgress => ({
      taskId: 'task-1',
      filePath: 'C:/books/一.txt',
      stage: 'decoding',
      ratio: 0.5,
      ...patch
    })

    useLibraryStore.getState().applyProgress(progress({}))
    useLibraryStore.getState().applyProgress(progress({ stage: 'splitting', ratio: 0.8 }))
    expect(useLibraryStore.getState().importing).toHaveLength(1)
    expect(useLibraryStore.getState().importing[0]?.stage).toBe('splitting')

    useLibraryStore.getState().applyProgress(progress({ stage: 'done', ratio: 1 }))
    expect(useLibraryStore.getState().importing).toHaveLength(0)
  })

  it('clearError 清掉错误', async () => {
    const harness = makeHarness()
    harness.listBooks.mockRejectedValueOnce(new Error('坏了'))
    await useLibraryStore.getState().load()
    expect(useLibraryStore.getState().error).not.toBeNull()
    useLibraryStore.getState().clearError()
    expect(useLibraryStore.getState().error).toBeNull()
  })
})
