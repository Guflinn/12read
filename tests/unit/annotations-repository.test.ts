import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AnnotationsRepository,
  type NewBookmarkRecord,
  type NewHighlightRecord
} from '@main/db/annotations-repository'
import { openDatabase } from '@main/db/better-sqlite3-driver'
import type { SqlDatabase } from '@main/db/driver'
import { LibraryRepository, type NewBookRecord } from '@main/db/library-repository'
import { runMigrations } from '@main/db/migrate'

/** 用真实 better-sqlite3：级联删除、排序、列默认值都只有真引擎说了算。 */

const tempDirs: string[] = []
const openDbs: SqlDatabase[] = []

afterEach(() => {
  // Windows 上文件被打开着就删不掉：先关连接再递归清理
  while (openDbs.length > 0) openDbs.pop()?.close()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function makeBook(id: string): NewBookRecord {
  return {
    id,
    title: '书 ' + id,
    author: null,
    encoding: 'utf-8',
    byteSize: 100,
    charCount: 500,
    contentMode: 'single',
    addedAt: 1000
  }
}

/** 建一个临时库文件（不是 :memory:，好让 WAL 与外键都按真实配置跑）。 */
function makeRepo(): {
  repo: LibraryRepository
  annotations: AnnotationsRepository
} {
  const dir = mkdtempSync(join(tmpdir(), 'twelve-read-anno-'))
  tempDirs.push(dir)
  const db = openDatabase(join(dir, 'library.db'))
  openDbs.push(db)
  runMigrations(db)
  const repo = new LibraryRepository(db)
  repo.insertBook(makeBook('b1'), [])
  repo.insertBook(makeBook('b2'), [])
  return { repo, annotations: new AnnotationsRepository(db) }
}

function bookmark(id: string, patch: Partial<NewBookmarkRecord> = {}): NewBookmarkRecord {
  return {
    id,
    bookId: 'b1',
    chapterIndex: 0,
    charOffset: 10,
    excerpt: '摘要',
    createdAt: 1,
    ...patch
  }
}

function highlight(id: string, patch: Partial<NewHighlightRecord> = {}): NewHighlightRecord {
  return {
    id,
    bookId: 'b1',
    chapterIndex: 0,
    startOffset: 10,
    endOffset: 20,
    text: '被划下来的十个字',
    note: null,
    createdAt: 1,
    ...patch
  }
}

describe('书签仓储', () => {
  it('写入后读回，字段一个不差', () => {
    const { annotations } = makeRepo()
    const created = annotations.addBookmark(bookmark('k1'))
    expect(created).toEqual({
      id: 'k1',
      bookId: 'b1',
      chapterIndex: 0,
      charOffset: 10,
      excerpt: '摘要',
      createdAt: 1
    })
    expect(annotations.listBookmarks('b1')).toEqual([created])
  })

  it('按章号 → 章内偏移 → 写入时间排序，别的书的看不到', () => {
    const { annotations } = makeRepo()
    annotations.addBookmark(bookmark('late', { chapterIndex: 2, charOffset: 1, createdAt: 1 }))
    annotations.addBookmark(bookmark('same-pos-later', { chapterIndex: 0, charOffset: 10, createdAt: 20 }))
    annotations.addBookmark(bookmark('same-pos-first', { chapterIndex: 0, charOffset: 10, createdAt: 5 }))
    annotations.addBookmark(bookmark('earliest', { chapterIndex: 0, charOffset: 3 }))
    annotations.addBookmark(bookmark('other', { bookId: 'b2' }))
    expect(annotations.listBookmarks('b1').map((item) => item.id)).toEqual([
      'earliest',
      'same-pos-first',
      'same-pos-later',
      'late'
    ])
    expect(annotations.listBookmarks('b2').map((item) => item.id)).toEqual(['other'])
  })

  it('删掉就没了，删别人的 id 不报错', () => {
    const { annotations } = makeRepo()
    annotations.addBookmark(bookmark('k1'))
    annotations.removeBookmark('k1')
    expect(annotations.listBookmarks('b1')).toEqual([])
    expect(() => annotations.removeBookmark('k1')).not.toThrow()
  })

  it('删书时书签跟着级联删掉', () => {
    const { repo, annotations } = makeRepo()
    annotations.addBookmark(bookmark('k1'))
    annotations.addBookmark(bookmark('k2', { bookId: 'b2' }))
    repo.deleteBook('b1')
    expect(annotations.listBookmarks('b1')).toEqual([])
    expect(annotations.listBookmarks('b2')).toHaveLength(1)
  })
})

describe('划线仓储', () => {
  it('写入后读回，note 为空时读回 null', () => {
    const { annotations } = makeRepo()
    const created = annotations.addHighlight(highlight('h1'))
    expect(created).toEqual({
      id: 'h1',
      bookId: 'b1',
      chapterIndex: 0,
      startOffset: 10,
      endOffset: 20,
      text: '被划下来的十个字',
      note: null,
      createdAt: 1
    })
    expect(annotations.listHighlights('b1')).toEqual([created])
  })

  it('备注字段现在就能存下来（这一版还不写，但以后加备注不用再迁库）', () => {
    const { annotations } = makeRepo()
    annotations.addHighlight(highlight('h1', { note: '这里的伏笔' }))
    expect(annotations.listHighlights('b1')[0].note).toBe('这里的伏笔')
  })

  it('按章号 → 章内起点排序，删掉就没了，删书级联', () => {
    const { repo, annotations } = makeRepo()
    annotations.addHighlight(highlight('later', { chapterIndex: 1, startOffset: 0 }))
    annotations.addHighlight(highlight('first', { chapterIndex: 0, startOffset: 4 }))
    expect(annotations.listHighlights('b1').map((item) => item.id)).toEqual(['first', 'later'])
    annotations.removeHighlight('first')
    expect(annotations.listHighlights('b1').map((item) => item.id)).toEqual(['later'])
    expect(() => annotations.removeHighlight('nope')).not.toThrow()
    repo.deleteBook('b1')
    expect(annotations.listHighlights('b1')).toEqual([])
  })
})
