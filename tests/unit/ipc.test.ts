import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CH } from '@shared/channels'
import type {
  BackupResult,
  Book,
  Bookmark,
  Chapter,
  Highlight,
  Progress,
  ReaderSettings,
  ReadingStats,
  SearchResult,
  ShelfBook
} from '@shared/types'
import { STAT_MAX_REPORT_CHARS, STAT_MAX_REPORT_MS } from '@shared/core/stats'
import type { IpcContext } from '@main/ipc'
import { ImportError } from '@main/services/import-error'

type Invoke = (event: unknown, raw: unknown) => Promise<unknown>
type SyncHandler = (event: { returnValue: unknown }, raw: unknown) => void

const { handlers, syncHandlers, showOpenDialog, showSaveDialog } = vi.hoisted(() => ({
  handlers: new Map<string, Invoke>(),
  syncHandlers: new Map<string, SyncHandler>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '9.9.9' },
  dialog: { showOpenDialog, showSaveDialog },
  ipcMain: {
    handle: (channel: string, fn: Invoke) => {
      handlers.set(channel, fn)
    },
    on: (channel: string, fn: SyncHandler) => {
      syncHandlers.set(channel, fn)
    }
  },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
}))

const { registerIpc } = await import('@main/ipc')

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

const BOOK: Book = {
  id: BOOK_ID,
  title: '测试书',
  author: '测试作者',
  format: 'txt',
  encoding: 'utf-8',
  byteSize: 1024,
  charCount: 5000,
  chapterCount: 3,
  contentMode: 'single',
  coverSeed: 12,
  addedAt: 1,
  lastOpenedAt: null
}

const SHELF_BOOK: ShelfBook = { ...BOOK, percent: 12.5 }

const PROGRESS: Progress = {
  bookId: BOOK_ID,
  chapterIndex: 1,
  charOffset: 20,
  anchorBefore: '前文',
  anchorAfter: '后文',
  percent: 12.5,
  updatedAt: 2,
  deviceId: 'device-1'
}

const CHAPTERS: Chapter[] = [
  { bookId: BOOK_ID, index: 0, title: '第一章', startOffset: 0, charLength: 10, kind: 'chapter' }
]

const BOOKMARK: Bookmark = {
  id: 'k1',
  bookId: BOOK_ID,
  chapterIndex: 1,
  charOffset: 20,
  excerpt: '摘一段原文',
  createdAt: 3
}

const HIGHLIGHT: Highlight = {
  id: 'h1',
  bookId: BOOK_ID,
  chapterIndex: 1,
  startOffset: 20,
  endOffset: 30,
  text: '划下来的一行字',
  note: null,
  createdAt: 4
}

const SEARCH_RESULT: SearchResult = {
  query: '山川',
  scope: 'book',
  total: 1,
  counts: [{ chapterIndex: 1, count: 1 }],
  hits: [
    {
      chapterIndex: 1,
      chapterTitle: '第二章',
      charOffset: 20,
      before: '前面的话',
      match: '山川',
      after: '后面的话'
    }
  ],
  truncated: false
}

const STATS: ReadingStats = {
  todayMs: 60_000,
  todayChars: 500,
  totalMs: 120_000,
  totalChars: 1_000,
  streakDays: 2,
  days: [{ day: '2026-10-05', ms: 60_000, chars: 500 }],
  topBooks: [{ bookId: BOOK_ID, title: '测试书', ms: 60_000, chars: 500 }]
}

const BACKUP_RESULT: BackupResult = {
  path: 'D:\\备份\\12read.zip',
  bytes: 2048,
  books: 2
}

const SETTINGS: ReaderSettings = {
  fontSize: 19,
  lineHeight: 1.9,
  theme: 'day',
  bold: false,
  fontFamily: 'song',
  pageWidth: 'medium'
}

function makeContext(): {
  ctx: IpcContext
  order: string[]
  importer: {
    importFile: ReturnType<typeof vi.fn>
    redecode: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  library: Record<string, ReturnType<typeof vi.fn>>
  chapters: Record<string, ReturnType<typeof vi.fn>>
  annotations: Record<string, ReturnType<typeof vi.fn>>
  search: Record<string, ReturnType<typeof vi.fn>>
  stats: Record<string, ReturnType<typeof vi.fn>>
  backup: Record<string, ReturnType<typeof vi.fn>>
  content: Record<string, ReturnType<typeof vi.fn>>
  progress: Record<string, ReturnType<typeof vi.fn>>
  settings: Record<string, ReturnType<typeof vi.fn>>
} {
  const order: string[] = []
  const importer = {
    importFile: vi.fn(async (filePath: string) => {
      order.push('import:' + filePath)
      return BOOK
    }),
    redecode: vi.fn(async (bookId: string, encoding: string): Promise<Book> => {
      order.push('redecode:' + encoding)
      return { ...BOOK, id: bookId, encoding: encoding as Book['encoding'] }
    }),
    cancel: vi.fn((taskId: string) => {
      order.push('cancel:' + taskId)
    })
  }
  const library = {
    list: vi.fn(async (): Promise<ShelfBook[]> => [SHELF_BOOK]),
    get: vi.fn(async (): Promise<Book | null> => BOOK),
    rename: vi.fn(async (): Promise<Book> => ({ ...BOOK, title: '新名' })),
    remove: vi.fn(async (bookId: string) => {
      order.push('remove:' + bookId)
    }),
    chapters: vi.fn(async (): Promise<Chapter[]> => CHAPTERS)
  }
  const chapters = {
    rename: vi.fn((): Chapter[] => CHAPTERS),
    merge: vi.fn((): Chapter[] => CHAPTERS)
  }
  const annotations = {
    listBookmarks: vi.fn((): Bookmark[] => [BOOKMARK]),
    addBookmark: vi.fn((record: unknown): Bookmark => record as Bookmark),
    removeBookmark: vi.fn((id: string) => {
      order.push('remove-bookmark:' + id)
    }),
    listHighlights: vi.fn((): Highlight[] => [HIGHLIGHT]),
    addHighlight: vi.fn((record: unknown): Highlight => record as Highlight),
    removeHighlight: vi.fn((id: string) => {
      order.push('remove-highlight:' + id)
    })
  }
  const search = {
    search: vi.fn(async (): Promise<SearchResult> => SEARCH_RESULT)
  }
  const stats = {
    add: vi.fn((input: unknown) => {
      order.push('stat:' + JSON.stringify(input))
    }),
    summary: vi.fn((): ReadingStats => STATS)
  }
  const backup = {
    exportTo: vi.fn(async (): Promise<BackupResult> => BACKUP_RESULT)
  }
  const content = {
    readChapter: vi.fn(async (): Promise<string> => '正文'),
    invalidate: vi.fn((bookId: string) => {
      order.push('invalidate:' + bookId)
    })
  }
  const progress = {
    get: vi.fn(async (): Promise<Progress | null> => PROGRESS),
    save: vi.fn(async () => undefined)
  }
  const settings = {
    get: vi.fn((): ReaderSettings => SETTINGS),
    set: vi.fn((next: ReaderSettings): ReaderSettings => next)
  }
  const ctx = {
    importer,
    library,
    chapters,
    annotations,
    search,
    stats,
    backup,
    content,
    progress,
    settings,
    deviceId: 'device-1'
  } as unknown as IpcContext
  registerIpc(ctx)
  return {
    ctx,
    order,
    importer,
    library,
    chapters,
    annotations,
    search,
    stats,
    backup,
    content,
    progress,
    settings
  }
}

function call(channel: string, raw?: unknown): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error('通道未注册: ' + channel)
  return fn({}, raw)
}

/** 同步通道（sendSync）的调用：主进程把结果写进 event.returnValue。 */
function callSync(channel: string, raw?: unknown): unknown {
  const fn = syncHandlers.get(channel)
  if (!fn) throw new Error('同步通道未注册: ' + channel)
  const event = { returnValue: undefined as unknown }
  fn(event, raw)
  return event.returnValue
}

/** 每个用例都把通道注册到干净的 map 上，避免相互污染。 */
function setup(): ReturnType<typeof makeContext> {
  handlers.clear()
  syncHandlers.clear()
  showOpenDialog.mockReset()
  showSaveDialog.mockReset()
  return makeContext()
}

describe('IPC 注册与转发', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('app:info 带上版本与本机 deviceId', async () => {
    setup()
    const info = (await call(CH.appInfo)) as Record<string, unknown>
    expect(info['name']).toBe('十二阅读')
    expect(info['version']).toBe('9.9.9')
    expect(info['deviceId']).toBe('device-1')
    expect(typeof info['platform']).toBe('string')
  })

  it('app:info 不收任何参数，传对象直接被拒', async () => {
    setup()
    await expect(call(CH.appInfo, { anything: true })).rejects.toThrow('参数校验失败: ' + CH.appInfo)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('file:pick 取消返回空数组、选中返回路径', async () => {
    setup()
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call(CH.filePick)).toEqual([])

    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['D:\\a.txt'] })
    expect(await call(CH.filePick)).toEqual(['D:\\a.txt'])
    expect(showOpenDialog.mock.calls[0]?.[0]).toMatchObject({
      properties: ['openFile', 'multiSelections']
    })
  })

  it('book:import 用主进程新生成的 taskId 调导入服务', async () => {
    const { importer } = setup()
    const book = (await call(CH.bookImport, { filePath: 'D:\\书架\\测试.txt' })) as Book
    expect(book).toEqual(BOOK)
    const args = importer.importFile.mock.calls[0] as unknown as [string, string]
    expect(args[0]).toBe('D:\\书架\\测试.txt')
    expect(args[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('book:import 把导入错误翻成带 code 的中文提示', async () => {
    const { importer } = setup()
    importer.importFile.mockRejectedValueOnce(new ImportError('binary', '这不是一个纯文本文件'))
    await expect(call(CH.bookImport, { filePath: 'D:\\a.txt' })).rejects.toThrow(
      '导入失败（binary）：这不是一个纯文本文件'
    )
  })

  it('book:import 参数非法时不碰服务', async () => {
    const { importer } = setup()
    await expect(call(CH.bookImport, { filePath: '' })).rejects.toThrow(
      '参数校验失败: ' + CH.bookImport
    )
    expect(importer.importFile).not.toHaveBeenCalled()
  })

  it('task:cancel 把 taskId 交给导入服务', async () => {
    const { importer, order } = setup()
    await call(CH.taskCancel, { taskId: 'task-1' })
    expect(order).toEqual(['cancel:task-1'])
    expect(importer.cancel).toHaveBeenCalledWith('task-1')
    await expect(call(CH.taskCancel, { taskId: '' })).rejects.toThrow()
  })

  it('book:list / book:get / book:chapters 转发查询', async () => {
    const { library } = setup()
    expect(await call(CH.bookList)).toEqual([SHELF_BOOK])
    expect(await call(CH.bookGet, { bookId: BOOK_ID })).toEqual(BOOK)
    const chapters = (await call(CH.bookChapters, { bookId: BOOK_ID })) as Chapter[]
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.kind).toBe('chapter')
    expect(library.get.mock.calls[0]?.[0]).toBe(BOOK_ID)
  })

  it('book:get 的 bookId 必须是 uuid v4，路径穿越串会被拒', async () => {
    const { library } = setup()
    await expect(call(CH.bookGet, { bookId: '../../etc/passwd' })).rejects.toThrow(
      '参数校验失败: ' + CH.bookGet
    )
    expect(library.get).not.toHaveBeenCalled()
  })

  it('book:rename 转发标题，空标题被拒', async () => {
    const { library } = setup()
    const renamed = (await call(CH.bookRename, { bookId: BOOK_ID, title: '新名' })) as Book
    expect(renamed.title).toBe('新名')
    expect(library.rename.mock.calls[0]).toEqual([BOOK_ID, '新名'])

    await expect(call(CH.bookRename, { bookId: BOOK_ID, title: '   ' })).rejects.toThrow(
      '参数校验失败: ' + CH.bookRename
    )
  })

  it('book:delete 先删库里记录再清内容缓存', async () => {
    const { order } = setup()
    await call(CH.bookDelete, { bookId: BOOK_ID })
    expect(order).toEqual(['remove:' + BOOK_ID, 'invalidate:' + BOOK_ID])
  })

  it('book:redecode 把编码交给导入服务，并清掉正文缓存', async () => {
    const { order, importer, content } = setup()

    const updated = await call(CH.bookRedecode, { bookId: BOOK_ID, encoding: 'big5' })

    expect(updated).toMatchObject({ id: BOOK_ID, encoding: 'big5' })
    expect(importer.redecode).toHaveBeenCalledTimes(1)
    const [bookId, encoding, taskId] = importer.redecode.mock.calls[0]
    expect(bookId).toBe(BOOK_ID)
    expect(encoding).toBe('big5')
    expect(typeof taskId).toBe('string')
    expect(content.invalidate).toHaveBeenCalledWith(BOOK_ID)
    expect(order).toEqual(['redecode:big5', 'invalidate:' + BOOK_ID])
  })

  it('book:redecode 失败时翻成带 code 的中文提示，缓存不动', async () => {
    const { importer, content } = setup()
    importer.redecode.mockRejectedValueOnce(new Error('找不到这本书的原始文件，只能重新导入'))

    const error = await call(CH.bookRedecode, { bookId: BOOK_ID, encoding: 'gb18030' }).then(
      () => null,
      (cause: unknown) => cause
    )

    expect((error as Error).message).toBe('重新解码失败（unknown）：找不到这本书的原始文件，只能重新导入')
    expect(content.invalidate).not.toHaveBeenCalled()
  })

  it('book:redecode 编码不合法时直接被拒', async () => {
    const { importer } = setup()
    await expect(call(CH.bookRedecode, { bookId: BOOK_ID, encoding: 'shift-jis' })).rejects.toThrow(
      '参数校验失败: ' + CH.bookRedecode
    )
    expect(importer.redecode).not.toHaveBeenCalled()
  })

  it('chapter:read 转发 bookId 与章序号，负序号被拒', async () => {
    const { content } = setup()
    expect(await call(CH.chapterRead, { bookId: BOOK_ID, index: 2 })).toBe('正文')
    expect(content.readChapter.mock.calls[0]).toEqual([BOOK_ID, 2])
    await expect(call(CH.chapterRead, { bookId: BOOK_ID, index: -1 })).rejects.toThrow(
      '参数校验失败: ' + CH.chapterRead
    )
  })

  it('chapter:rename 只改标题并把整份章节表回给渲染层', async () => {
    const { chapters } = setup()
    const renamed: Chapter[] = [{ ...CHAPTERS[0]!, title: '序章' }]
    chapters.rename.mockReturnValueOnce(renamed)
    expect(await call(CH.chapterRename, { bookId: BOOK_ID, index: 0, title: '序章' })).toEqual(
      renamed
    )
    expect(chapters.rename.mock.calls[0]).toEqual([BOOK_ID, 0, '序章'])
    await expect(
      call(CH.chapterRename, { bookId: BOOK_ID, index: 0, title: '   ' })
    ).rejects.toThrow('参数校验失败: ' + CH.chapterRename)
  })

  it('chapter:merge 把章序号交给编辑器，失败翻成中文提示', async () => {
    const { chapters } = setup()
    expect(await call(CH.chapterMerge, { bookId: BOOK_ID, index: 0 })).toEqual(CHAPTERS)
    expect(chapters.merge.mock.calls[0]).toEqual([BOOK_ID, 0])
    chapters.merge.mockImplementationOnce(() => {
      throw new ImportError('db-error', '这已经是最后一章，后面没有可以合并的章节')
    })
    await expect(call(CH.chapterMerge, { bookId: BOOK_ID, index: 0 })).rejects.toThrow(
      '改分章失败（db-error）：这已经是最后一章，后面没有可以合并的章节'
    )
  })

  it('bookmark:list / add / remove 转发，id 与时间戳由主进程生成', async () => {
    const { annotations, order } = setup()
    expect(await call(CH.bookmarkList, { bookId: BOOK_ID })).toEqual([BOOKMARK])
    expect(annotations.listBookmarks.mock.calls[0]?.[0]).toBe(BOOK_ID)

    const created = (await call(CH.bookmarkAdd, {
      bookId: BOOK_ID,
      chapterIndex: 2,
      charOffset: 33,
      excerpt: '读到这儿'
    })) as Bookmark
    expect(created.bookId).toBe(BOOK_ID)
    expect(created.chapterIndex).toBe(2)
    expect(created.charOffset).toBe(33)
    expect(created.excerpt).toBe('读到这儿')
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(typeof created.createdAt).toBe('number')

    await call(CH.bookmarkRemove, { id: 'k1' })
    expect(order).toContain('remove-bookmark:k1')
  })

  it('bookmark:add 的字段越界或缺失直接被拒', async () => {
    const { annotations } = setup()
    await expect(
      call(CH.bookmarkAdd, { bookId: BOOK_ID, chapterIndex: 0, charOffset: -1, excerpt: '摘要' })
    ).rejects.toThrow('参数校验失败: ' + CH.bookmarkAdd)
    await expect(
      call(CH.bookmarkAdd, {
        bookId: BOOK_ID,
        chapterIndex: 0,
        charOffset: 1,
        excerpt: '长'.repeat(201)
      })
    ).rejects.toThrow('参数校验失败: ' + CH.bookmarkAdd)
    await expect(call(CH.bookmarkRemove, { id: '' })).rejects.toThrow(
      '参数校验失败: ' + CH.bookmarkRemove
    )
    expect(annotations.addBookmark).not.toHaveBeenCalled()
  })

  it('highlight:list / add / remove 转发，note 先落 null（备注留到以后）', async () => {
    const { annotations, order } = setup()
    expect(await call(CH.highlightList, { bookId: BOOK_ID })).toEqual([HIGHLIGHT])
    expect(annotations.listHighlights.mock.calls[0]?.[0]).toBe(BOOK_ID)

    const created = (await call(CH.highlightAdd, {
      bookId: BOOK_ID,
      chapterIndex: 3,
      startOffset: 5,
      endOffset: 12,
      text: '被划下来的七个字'
    })) as Highlight
    expect(created.chapterIndex).toBe(3)
    expect(created.startOffset).toBe(5)
    expect(created.endOffset).toBe(12)
    expect(created.text).toBe('被划下来的七个字')
    expect(created.note).toBeNull()
    expect(typeof created.createdAt).toBe('number')

    await call(CH.highlightRemove, { id: 'h1' })
    expect(order).toContain('remove-highlight:h1')
  })

  it('highlight:add 的结束位置不在开始之后时被拒，且不碰仓储', async () => {
    const { annotations } = setup()
    await expect(
      call(CH.highlightAdd, {
        bookId: BOOK_ID,
        chapterIndex: 0,
        startOffset: 8,
        endOffset: 8,
        text: '一样长'
      })
    ).rejects.toThrow('划线范围不合法：结束位置要在开始位置之后')
    await expect(
      call(CH.highlightAdd, {
        bookId: BOOK_ID,
        chapterIndex: 0,
        startOffset: 9,
        endOffset: 3,
        text: '反着选'
      })
    ).rejects.toThrow('划线范围不合法：结束位置要在开始位置之后')
    expect(annotations.addHighlight).not.toHaveBeenCalled()
  })

  it('highlight:add 的空文字被 zod 拒', async () => {
    const { annotations } = setup()
    await expect(
      call(CH.highlightAdd, {
        bookId: BOOK_ID,
        chapterIndex: 0,
        startOffset: 1,
        endOffset: 2,
        text: ''
      })
    ).rejects.toThrow('参数校验失败: ' + CH.highlightAdd)
    expect(annotations.addHighlight).not.toHaveBeenCalled()
  })

  it('book:search 把关键词、范围与章序号交给搜索服务', async () => {
    const { search } = setup()
    expect(
      await call(CH.bookSearch, { bookId: BOOK_ID, query: ' 山川 ', scope: 'book', chapterIndex: 1 })
    ).toEqual(SEARCH_RESULT)
    // 关键词已由 schema trim 过
    expect(search.search.mock.calls[0]?.[0]).toEqual({
      bookId: BOOK_ID,
      query: '山川',
      scope: 'book',
      chapterIndex: 1
    })
  })

  it('book:search 的空关键词与非法范围被拒，不碰搜索服务', async () => {
    const { search } = setup()
    for (const raw of [
      { bookId: BOOK_ID, query: '   ', scope: 'book', chapterIndex: 0 },
      { bookId: BOOK_ID, query: '山川', scope: 'all', chapterIndex: 0 },
      { bookId: BOOK_ID, query: '山川', scope: 'book', chapterIndex: -1 },
      { bookId: BOOK_ID, query: 'x'.repeat(81), scope: 'book', chapterIndex: 0 }
    ]) {
      await expect(call(CH.bookSearch, raw)).rejects.toThrow('参数校验失败: ' + CH.bookSearch)
    }
    expect(search.search).not.toHaveBeenCalled()
  })

  it('progress:get 返回进度或 null', async () => {
    const { progress } = setup()
    expect(await call(CH.progressGet, { bookId: BOOK_ID })).toEqual(PROGRESS)
    progress.get.mockResolvedValueOnce(null)
    expect(await call(CH.progressGet, { bookId: BOOK_ID })).toBeNull()
  })

  it('progress:save 原样落库，percent 越界被拒', async () => {
    const { progress } = setup()
    await call(CH.progressSave, PROGRESS)
    expect(progress.save.mock.calls[0]?.[0]).toEqual(PROGRESS)
    await expect(call(CH.progressSave, { ...PROGRESS, percent: 101 })).rejects.toThrow(
      '参数校验失败: ' + CH.progressSave
    )
  })

  it('progress:flush 同步落盘并回执 true', () => {
    const { progress } = setup()
    expect(callSync(CH.progressFlush, PROGRESS)).toBe(true)
    expect(progress.save.mock.calls[0]?.[0]).toEqual(PROGRESS)
  })

  it('progress:flush 参数非法时回执 false 且不写库', () => {
    const { progress } = setup()
    expect(callSync(CH.progressFlush, { ...PROGRESS, bookId: 'not-a-uuid' })).toBe(false)
    expect(progress.save).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('settings:get / settings:save 转发设置，非法主题被拒', async () => {
    const { settings } = setup()
    expect(await call(CH.settingsGet)).toEqual(SETTINGS)
    const next = {
      fontSize: 22,
      lineHeight: 2.25,
      theme: 'night' as const,
      bold: true,
      fontFamily: 'kai' as const,
      pageWidth: 'wide' as const
    }
    expect(await call(CH.settingsSave, next)).toEqual(next)
    expect(settings.set.mock.calls[0]?.[0]).toEqual(next)
    await expect(call(CH.settingsSave, { ...next, theme: 'sepia' })).rejects.toThrow(
      '参数校验失败: ' + CH.settingsSave
    )
  })

  it('stat:add 把时长与字数交给统计服务', async () => {
    const { stats } = setup()
    await call(CH.statAdd, { bookId: BOOK_ID, ms: 15_000, chars: 300 })
    expect(stats.add.mock.calls[0]?.[0]).toEqual({ bookId: BOOK_ID, ms: 15_000, chars: 300 })
    await call(CH.statAdd, { bookId: BOOK_ID, ms: 0, chars: 0 })
    expect(stats.add.mock.calls[1]?.[0]).toEqual({ bookId: BOOK_ID, ms: 0, chars: 0 })
  })

  it('stat:add 的负数、小数与超上限被拒，不碰统计服务', async () => {
    const { stats } = setup()
    for (const raw of [
      { bookId: BOOK_ID, ms: -1, chars: 0 },
      { bookId: BOOK_ID, ms: 0, chars: -1 },
      { bookId: BOOK_ID, ms: 1.5, chars: 0 },
      { bookId: BOOK_ID, ms: STAT_MAX_REPORT_MS + 1, chars: 0 },
      { bookId: BOOK_ID, ms: 0, chars: STAT_MAX_REPORT_CHARS + 1 },
      { bookId: 'not-a-uuid', ms: 1, chars: 1 }
    ]) {
      await expect(call(CH.statAdd, raw)).rejects.toThrow('参数校验失败: ' + CH.statAdd)
    }
    expect(stats.add).not.toHaveBeenCalled()
  })

  it('stat:get 转发天数并返回统计，天数越界被拒', async () => {
    const { stats } = setup()
    expect(await call(CH.statGet, { days: 14 })).toEqual(STATS)
    expect(stats.summary.mock.calls[0]?.[0]).toBe(14)
    await expect(call(CH.statGet, { days: 0 })).rejects.toThrow('参数校验失败: ' + CH.statGet)
    await expect(call(CH.statGet, { days: 91 })).rejects.toThrow('参数校验失败: ' + CH.statGet)
    await expect(call(CH.statGet, { days: 1.5 })).rejects.toThrow('参数校验失败: ' + CH.statGet)
    expect(stats.summary).toHaveBeenCalledTimes(1)
  })

  it('backup:export 取消时返回 null，位置提示与通道参数都对', async () => {
    const { backup } = setup()
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })

    expect(await call(CH.backupExport)).toBeNull()
    expect(backup.exportTo).not.toHaveBeenCalled()

    const options = showSaveDialog.mock.calls[0]?.[0] as {
      defaultPath?: string
      filters?: unknown
    }
    expect(options.filters).toEqual([{ name: 'ZIP 压缩包', extensions: ['zip'] }])
    expect(String(options.defaultPath)).toMatch(/^十二阅读备份-\d{8}\.zip$/)
  })

  it('backup:export 把用户选的位置交给备份服务', async () => {
    const { backup } = setup()
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: 'D:\\备份\\12read.zip' })

    expect(await call(CH.backupExport)).toEqual(BACKUP_RESULT)
    expect(backup.exportTo.mock.calls[0]?.[0]).toBe('D:\\备份\\12read.zip')
  })

  it('backup:export 失败时翻成中文提示', async () => {
    const { backup } = setup()
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: 'D:\\备份\\12read.zip' })
    backup.exportTo.mockRejectedValueOnce(new Error('磁盘满了'))

    await expect(call(CH.backupExport)).rejects.toThrow('导出失败：磁盘满了')
  })

  it('backup:export 不收参数，传对象直接被拒', async () => {
    setup()
    await expect(call(CH.backupExport, { path: 'x' })).rejects.toThrow(
      '参数校验失败: ' + CH.backupExport
    )
    expect(showSaveDialog).not.toHaveBeenCalled()
  })
})
