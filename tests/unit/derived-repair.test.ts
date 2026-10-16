import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DerivedRepair,
  needsDerivedRepair,
  type RepairBook
} from '@main/services/derived-repair'
import {
  CHAPTERS_DIR,
  CONTENT_FILE,
  SOURCE_FILE,
  bookDir,
  chapterFilePath,
  sourcePath
} from '@main/services/layout'

const tempDirs: string[] = []

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), '12read-repair-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function book(overrides: Partial<RepairBook> = {}): RepairBook {
  return { id: 'book-1', title: '样书', contentMode: 'single', chapterCount: 3, ...overrides }
}

describe('needsDerivedRepair：派生正文缺了才修', () => {
  it('整本一个文件的书看 content.txt 在不在', () => {
    const root = makeRoot()
    const target = book()
    expect(needsDerivedRepair(root, target)).toBe(true)

    mkdirSync(bookDir(root, target.id), { recursive: true })
    writeFileSync(join(bookDir(root, target.id), CONTENT_FILE), '正文')
    expect(needsDerivedRepair(root, target)).toBe(false)
  })

  it('按章切片的书看 chapters/ 里的文件数够不够（少一片就重做）', () => {
    const root = makeRoot()
    const target = book({ contentMode: 'sliced' })
    expect(needsDerivedRepair(root, target)).toBe(true)

    mkdirSync(join(bookDir(root, target.id), CHAPTERS_DIR), { recursive: true })
    writeFileSync(chapterFilePath(root, target.id, 0), '一')
    writeFileSync(chapterFilePath(root, target.id, 1), '二')
    expect(needsDerivedRepair(root, target)).toBe(true) // 3 章只有 2 个文件

    writeFileSync(chapterFilePath(root, target.id, 2), '三')
    expect(needsDerivedRepair(root, target)).toBe(false)
  })
})

describe('DerivedRepair：启动自愈', () => {
  it('只修缺正文的书，原始文件也没了的书直接跳过', async () => {
    const root = makeRoot()
    // 这本缺正文，但有原始文件 → 要修
    const broken = book({ id: 'broken' })
    mkdirSync(bookDir(root, broken.id), { recursive: true })
    writeFileSync(sourcePath(root, broken.id), '原始字节')
    // 这本正文齐了 → 不修
    const healthy = book({ id: 'healthy' })
    mkdirSync(bookDir(root, healthy.id), { recursive: true })
    writeFileSync(join(bookDir(root, healthy.id), CONTENT_FILE), '正文')
    // 这本缺正文且没有原始文件 → 修不了
    const hopeless = book({ id: 'hopeless' })

    const redecode = vi.fn(async () => undefined)
    const repair = new DerivedRepair({
      root,
      books: () => [broken, healthy, hopeless],
      redecode
    })

    const repaired = await repair.run()

    expect(repaired.map((item) => item.id)).toEqual(['broken'])
    expect(redecode).toHaveBeenCalledTimes(1)
    expect(redecode).toHaveBeenCalledWith('broken')
  })

  it('一本修失败不阻塞其他书', async () => {
    const root = makeRoot()
    const first = book({ id: 'first', title: '第一本' })
    const second = book({ id: 'second', title: '第二本' })
    for (const target of [first, second]) {
      mkdirSync(bookDir(root, target.id), { recursive: true })
      writeFileSync(sourcePath(root, target.id), '原始字节')
    }

    const redecode = vi.fn(async (bookId: string) => {
      if (bookId === 'first') throw new Error('提取器炸了')
    })
    const log = vi.fn()
    const repair = new DerivedRepair({ root, books: () => [first, second], redecode, log })

    const repaired = await repair.run()

    expect(repaired.map((item) => item.id)).toEqual(['second'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('第一本')
  })

  it('什么都不缺时一次都不重跑（启动开销就是几次 stat）', async () => {
    const root = makeRoot()
    const target = book({ contentMode: 'sliced' })
    mkdirSync(join(bookDir(root, target.id), CHAPTERS_DIR), { recursive: true })
    for (let index = 0; index < target.chapterCount; index += 1) {
      writeFileSync(chapterFilePath(root, target.id, index), 'x')
    }

    const redecode = vi.fn(async () => undefined)
    const repaired = await new DerivedRepair({ root, books: () => [target], redecode }).run()

    expect(repaired).toEqual([])
    expect(redecode).not.toHaveBeenCalled()
  })
})

describe('派生文件名常量（与 layout 一致）', () => {
  it('自愈检查的就是落盘时用的那两个名字', () => {
    expect(CONTENT_FILE).toBe('content.txt')
    expect(CHAPTERS_DIR).toBe('chapters')
    expect(SOURCE_FILE).toBe('source.bin')
  })
})
