import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CH } from '@shared/channels'
import type { Book, Chapter, Progress, ReaderSettings, ShelfBook } from '@shared/types'
import type { IpcContext } from '@main/ipc'
import { ImportError } from '@main/services/import-error'

type Invoke = (event: unknown, raw: unknown) => Promise<unknown>
type SyncHandler = (event: { returnValue: unknown }, raw: unknown) => void

const { handlers, syncHandlers, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, Invoke>(),
  syncHandlers: new Map<string, SyncHandler>(),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '9.9.9' },
  dialog: { showOpenDialog },
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
  importer: { importFile: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
  library: Record<string, ReturnType<typeof vi.fn>>
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
    chapters: vi.fn(async (): Promise<Chapter[]> => [
      { bookId: BOOK_ID, index: 0, title: '第一章', startOffset: 0, charLength: 10, kind: 'chapter' }
    ])
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
  const ctx = { importer, library, content, progress, settings, deviceId: 'device-1' } as unknown as IpcContext
  registerIpc(ctx)
  return { ctx, order, importer, library, content, progress, settings }
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

  it('chapter:read 转发 bookId 与章序号，负序号被拒', async () => {
    const { content } = setup()
    expect(await call(CH.chapterRead, { bookId: BOOK_ID, index: 2 })).toBe('正文')
    expect(content.readChapter.mock.calls[0]).toEqual([BOOK_ID, 2])
    await expect(call(CH.chapterRead, { bookId: BOOK_ID, index: -1 })).rejects.toThrow(
      '参数校验失败: ' + CH.chapterRead
    )
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
})
