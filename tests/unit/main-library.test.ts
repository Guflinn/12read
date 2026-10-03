import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '@main/db/better-sqlite3-driver'
import type { SqlDatabase } from '@main/db/driver'
import { LibraryRepository } from '@main/db/library-repository'
import { runMigrations } from '@main/db/migrate'
import { FileContentReader } from '@main/services/content-reader'
import { LibraryService } from '@main/services/library'
import { bookDir, chapterFilePath, chaptersDir, contentPath } from '@main/services/layout'

/**
 * rm 默认透传真实实现，只在测试里把 fsState.failRm 打开时才失败，
 * 用来验证「删目录失败也不能挡住 UI」这条产品约束。
 */
const fsState = vi.hoisted(() => ({ failRm: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: (async (...args: Parameters<typeof actual.rm>): Promise<void> => {
      if (fsState.failRm) throw new Error('目录被占用')
      return actual.rm(...args)
    }) as typeof actual.rm
  }
})

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const BOOK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOOK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BOOK_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

let root = ''
let db: SqlDatabase
let repo: LibraryRepository

function insert(
  id: string,
  contentMode: 'single' | 'sliced',
  chapters: { title: string; startOffset: number; charLength: number }[]
): void {
  repo.insertBook(
    {
      id,
      title: '书' + id.slice(0, 1),
      author: null,
      encoding: 'utf-8',
      byteSize: 20,
      charCount: 20,
      contentMode,
      addedAt: 1
    },
    chapters.map((chapter) => ({ ...chapter, kind: 'chapter' as const }))
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'main-library-'))
  db = openDatabase(':memory:')
  runMigrations(db)
  repo = new LibraryRepository(db)
})

afterEach(async () => {
  fsState.failRm = false
  vi.restoreAllMocks()
  db.close()
  await rm(root, { recursive: true, force: true })
})

describe('LibraryService', () => {
  it('list/get/rename/chapters 都委托给仓储', async () => {
    insert(BOOK_ID, 'single', [
      { title: '第一章', startOffset: 0, charLength: 10 },
      { title: '第二章', startOffset: 10, charLength: 10 }
    ])
    const service = new LibraryService(root, repo)

    expect((await service.list()).map((book) => book.id)).toEqual([BOOK_ID])
    expect((await service.get(BOOK_ID))?.title).toBe('书3')
    expect(await service.get('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect((await service.rename(BOOK_ID, '新书名')).title).toBe('新书名')
    expect((await service.chapters(BOOK_ID)).map((chapter) => [chapter.index, chapter.title])).toEqual([
      [0, '第一章'],
      [1, '第二章']
    ])
  })

  it('remove 先删库记录再删目录', async () => {
    insert(BOOK_ID, 'single', [])
    const dir = bookDir(root, BOOK_ID)
    await mkdir(dir, { recursive: true })

    const order: string[] = []
    let dirExistedWhenDeleted = false
    const repoStub = {
      deleteBook: (bookId: string): void => {
        order.push('db')
        dirExistedWhenDeleted = existsSync(bookDir(root, bookId))
      }
    } as unknown as LibraryRepository
    const service = new LibraryService(root, repoStub)

    await service.remove(BOOK_ID)

    expect(order).toEqual(['db'])
    expect(dirExistedWhenDeleted).toBe(true)
    expect(existsSync(dir)).toBe(false)
  })

  it('删目录失败只记日志，不向外抛', async () => {
    insert(BOOK_ID, 'single', [])
    await mkdir(bookDir(root, BOOK_ID), { recursive: true })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let deleted = false
    const repoStub = {
      deleteBook: (): void => {
        deleted = true
      }
    } as unknown as LibraryRepository
    const service = new LibraryService(root, repoStub)

    fsState.failRm = true
    try {
      await expect(service.remove(BOOK_ID)).resolves.toBeUndefined()
    } finally {
      fsState.failRm = false
    }

    expect(deleted).toBe(true)
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('FileContentReader', () => {
  it('single 模式按 offset/charLength 切片', async () => {
    const text = '0123456789ABCDEFGHIJ'
    await mkdir(bookDir(root, BOOK_A), { recursive: true })
    await writeFile(contentPath(root, BOOK_A), text, 'utf8')
    insert(BOOK_A, 'single', [
      { title: '章一', startOffset: 2, charLength: 5 },
      { title: '章二', startOffset: 10, charLength: 4 }
    ])
    const reader = new FileContentReader(root, repo)

    expect(await reader.readChapter(BOOK_A, 0)).toBe('23456')
    expect(await reader.readChapter(BOOK_A, 1)).toBe('ABCD')
  })

  it('sliced 模式直接读 chapters/NNNN.txt', async () => {
    await mkdir(chaptersDir(root, BOOK_B), { recursive: true })
    await writeFile(chapterFilePath(root, BOOK_B, 0), '切片正文', 'utf8')
    insert(BOOK_B, 'sliced', [{ title: '章一', startOffset: 0, charLength: 1 }])
    const reader = new FileContentReader(root, repo)

    expect(await reader.readChapter(BOOK_B, 0)).toBe('切片正文')
  })

  it('readFull 首次读盘、再次命中缓存，invalidate 后失效', async () => {
    const text = '缓存正文内容'
    await mkdir(bookDir(root, BOOK_C), { recursive: true })
    await writeFile(contentPath(root, BOOK_C), text, 'utf8')
    insert(BOOK_C, 'single', [{ title: '章一', startOffset: 0, charLength: 2 }])
    const reader = new FileContentReader(root, repo)

    expect(await reader.readFull(BOOK_C)).toBe(text)
    // 删掉文件后仍然读得到，说明第二次走的是缓存而不是又读了一次盘。
    await rm(contentPath(root, BOOK_C))
    expect(await reader.readFull(BOOK_C)).toBe(text)

    reader.invalidate(BOOK_C)
    await expect(reader.readFull(BOOK_C)).rejects.toThrow()
  })

  it('书或章不存在时抛出可读错误', async () => {
    const reader = new FileContentReader(root, repo)

    await expect(reader.readChapter(BOOK_A, 0)).rejects.toThrow('书籍不存在')
    insert(BOOK_A, 'single', [])
    await expect(reader.readChapter(BOOK_A, 3)).rejects.toThrow('章节不存在')
  })
})
