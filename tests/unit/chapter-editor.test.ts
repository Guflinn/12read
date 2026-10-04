import { describe, expect, it, vi } from 'vitest'
import type { Chapter, Progress } from '@shared/types'
import type { LibraryRepository, NewChapterRecord } from '@main/db/library-repository'
import { ChapterEditor } from '@main/services/chapter-editor'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function chapter(index: number, start: number, length: number, title?: string): Chapter {
  return {
    bookId: BOOK_ID,
    index,
    title: title ?? '第 ' + (index + 1) + ' 章',
    startOffset: start,
    charLength: length,
    kind: 'chapter'
  }
}

interface Harness {
  editor: ChapterEditor
  replaceChapters: ReturnType<typeof vi.fn>
  saveProgress: ReturnType<typeof vi.fn>
  chapters(): Chapter[]
  progress(): Progress | null
}

function makeHarness(initial: Chapter[], progress: Progress | null = null): Harness {
  let current = initial.map((item) => ({ ...item }))
  let saved = progress === null ? null : { ...progress }
  const replaceChapters = vi.fn((_bookId: string, next: NewChapterRecord[]): void => {
    current = next.map((item, index) => ({
      bookId: BOOK_ID,
      index,
      title: item.title,
      startOffset: item.startOffset,
      charLength: item.charLength,
      kind: item.kind
    }))
  })
  const saveProgress = vi.fn((next: Progress): void => {
    saved = { ...next }
  })
  const repo = {
    listChapters: vi.fn((): Chapter[] => current.map((item) => ({ ...item }))),
    replaceChapters,
    getProgress: vi.fn((): Progress | null => (saved === null ? null : { ...saved })),
    saveProgress
  } as unknown as LibraryRepository
  return {
    editor: new ChapterEditor(repo),
    replaceChapters,
    saveProgress,
    chapters: () => current.map((item) => ({ ...item })),
    progress: () => (saved === null ? null : { ...saved })
  }
}

function makeProgress(patch: Partial<Progress> = {}): Progress {
  return {
    bookId: BOOK_ID,
    chapterIndex: 0,
    charOffset: 10,
    anchorBefore: null,
    anchorAfter: null,
    percent: 5,
    updatedAt: 1000,
    deviceId: 'device-1',
    ...patch
  }
}

const THREE: Chapter[] = [
  chapter(0, 0, 100, '第一章 起点'),
  chapter(1, 100, 200, '第二章 转折'),
  chapter(2, 300, 50, '第三章 归途')
]

describe('ChapterEditor.rename', () => {
  it('只改标题，范围与章数都不动', () => {
    const harness = makeHarness(THREE)
    const next = harness.editor.rename(BOOK_ID, 1, '第二章 改过名')
    expect(next.map((item) => item.title)).toEqual(['第一章 起点', '第二章 改过名', '第三章 归途'])
    expect(next.map((item) => item.startOffset)).toEqual([0, 100, 300])
    expect(next.map((item) => item.charLength)).toEqual([100, 200, 50])
    expect(harness.chapters()).toHaveLength(3)
  })

  it('章节不存在时报错', () => {
    const harness = makeHarness(THREE)
    expect(() => harness.editor.rename(BOOK_ID, 9, '没有这章')).toThrow('章节不存在: 9')
  })
})

describe('ChapterEditor.merge', () => {
  it('把下一章并进来：标题沿用前者，长度相加，章数减一', () => {
    const harness = makeHarness(THREE)
    const next = harness.editor.merge(BOOK_ID, 0)
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ title: '第一章 起点', startOffset: 0, charLength: 300 })
    expect(next[1]).toMatchObject({ title: '第三章 归途', startOffset: 300, charLength: 50 })
    // 写回时索引会重排
    expect(next.map((item) => item.index)).toEqual([0, 1])
  })

  it('最后一章后面没得合并就报错', () => {
    const harness = makeHarness(THREE)
    expect(() => harness.editor.merge(BOOK_ID, 2)).toThrow('这已经是最后一章')
    expect(harness.replaceChapters).not.toHaveBeenCalled()
  })
})

describe('ChapterEditor.split', () => {
  it('在章内偏移处拆成两半，长度守恒，后半标题带（续）', () => {
    const harness = makeHarness(THREE)
    const next = harness.editor.split(BOOK_ID, 1, 80)
    expect(next).toHaveLength(4)
    expect(next[1]).toMatchObject({ title: '第二章 转折', startOffset: 100, charLength: 80 })
    expect(next[2]).toMatchObject({ title: '第二章 转折（续）', startOffset: 180, charLength: 120 })
    expect(next[3]).toMatchObject({ title: '第三章 归途', startOffset: 300 })
  })

  it('拆分位置不在章节中间时报错', () => {
    const harness = makeHarness(THREE)
    expect(() => harness.editor.split(BOOK_ID, 1, 0)).toThrow('拆分位置要落在这一章中间')
    expect(() => harness.editor.split(BOOK_ID, 1, 200)).toThrow('拆分位置要落在这一章中间')
  })
})

describe('ChapterEditor 与进度联动', () => {
  it('合并到正在读的那一章时，进度按绝对字符位置重新落位', () => {
    // 进度在第二章开头往后 30 字（绝对位置 130）
    const harness = makeHarness(THREE, makeProgress({ chapterIndex: 1, charOffset: 30 }))
    const next = harness.editor.merge(BOOK_ID, 0)
    expect(next).toHaveLength(2)
    expect(harness.saveProgress).toHaveBeenCalledTimes(1)
    expect(harness.progress()).toMatchObject({ chapterIndex: 0, charOffset: 130 })
  })

  it('拆分之后进度落在后半章', () => {
    const harness = makeHarness(THREE, makeProgress({ chapterIndex: 1, charOffset: 150 }))
    harness.editor.split(BOOK_ID, 1, 80)
    // 绝对位置 100+150 = 250，落进新第二章（180 起，120 长）
    expect(harness.progress()).toMatchObject({ chapterIndex: 2, charOffset: 70 })
  })

  it('没有进度就不写进度', () => {
    const harness = makeHarness(THREE)
    harness.editor.rename(BOOK_ID, 0, '改个名')
    expect(harness.saveProgress).not.toHaveBeenCalled()
  })

  it('空章节表直接报错', () => {
    const harness = makeHarness([])
    expect(() => harness.editor.rename(BOOK_ID, 0, '随便')).toThrow('这本书还没有章节')
  })
})
