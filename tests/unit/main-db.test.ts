import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Progress } from '@shared/types'
import { applyConnectionPragmas, type SqlDatabase, type SqlStatement } from '@main/db/driver'
import { openDatabase } from '@main/db/better-sqlite3-driver'
import { LibraryRepository, type NewBookRecord, type NewChapterRecord } from '@main/db/library-repository'
import { MetaRepository } from '@main/db/meta-repository'
import { runMigrations } from '@main/db/migrate'
import { coverSeedFromTitle } from '@main/db/mappers'

/**
 * 这里刻意用真实的 better-sqlite3：N-API prebuild 在普通 Node 下可直接 require，
 * 假驱动只能验证语句形状，验证不了 ON DELETE CASCADE / WAL 这类真实引擎行为。
 */

const tempDirs: string[] = []

/** 建一个临时目录并返回库文件路径；afterEach 统一递归清理，避免污染系统临时目录。 */
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'twelve-read-db-'))
  tempDirs.push(dir)
  return join(dir, 'library.db')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function makeBook(id: string, overrides: Partial<Omit<NewBookRecord, 'id'>> = {}): NewBookRecord {
  return {
    id,
    title: '未命名',
    author: null,
    encoding: 'utf-8',
    byteSize: 100,
    charCount: 50,
    contentMode: 'single',
    addedAt: 1000,
    ...overrides
  }
}

function makeChapter(index: number): NewChapterRecord {
  return {
    title: `第 ${index + 1} 章`,
    startOffset: index * 1000,
    charLength: 1000,
    kind: 'chapter'
  }
}

function makeProgress(bookId: string): Progress {
  return {
    bookId,
    chapterIndex: 1,
    charOffset: 10,
    anchorBefore: '前文',
    anchorAfter: '后文',
    percent: 5,
    updatedAt: 1,
    deviceId: 'dev-1'
  }
}

/** 建好库与业务表，返回可直接用的仓储。 */
function repoWithSchema(): { db: SqlDatabase; repo: LibraryRepository } {
  const db = openDatabase(':memory:')
  runMigrations(db)
  return { db, repo: new LibraryRepository(db) }
}

/** 只记录 pragma 调用的最小驱动，用来断言 applyConnectionPragmas 到底发了什么。 */
class PragmaRecorder implements SqlDatabase {
  readonly statements: string[] = []

  exec(): void {
    /* 本用例不关心 */
  }

  prepare(): SqlStatement {
    throw new Error('本用例不应调用 prepare')
  }

  transaction<T>(fn: () => T): () => T {
    return fn
  }

  pragma(statement: string): unknown {
    this.statements.push(statement)
    return undefined
  }

  close(): void {
    /* 无资源 */
  }
}

/** 可编排返回值的最小驱动，专门制造真实数据库里无法出现的错误分支。 */
class StubDatabase implements SqlDatabase {
  changes = 1
  readonly rows: unknown[] = []

  exec(): void {
    /* 本用例不关心 */
  }

  prepare(): SqlStatement {
    return {
      run: () => ({ changes: this.changes }),
      get: () => this.rows.shift(),
      all: () => []
    }
  }

  transaction<T>(fn: () => T): () => T {
    return fn
  }

  pragma(): unknown {
    return undefined
  }

  close(): void {
    /* 无资源 */
  }
}

describe('数据库驱动', () => {
  it('openDatabase 打开文件库并真的应用了 WAL 与外键 pragma', () => {
    const db = openDatabase(tempDbPath())
    // 只有文件库能进 WAL；:memory: 会回落成 memory，所以这里必须用临时文件
    const journal = db.pragma('journal_mode') as { journal_mode?: string }[]
    expect(journal[0]?.journal_mode).toBe('wal')
    const foreignKeys = db.pragma('foreign_keys') as { foreign_keys?: number }[]
    expect(foreignKeys[0]?.foreign_keys).toBe(1)
    db.close()
  })

  it('openDatabase 支持 :memory:，且适配器转发 exec/prepare/transaction/close', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')

    const insert = db.prepare('INSERT INTO t (name) VALUES (?)')
    expect(insert.run('甲').changes).toBe(1)

    const select = db.prepare('SELECT name FROM t ORDER BY id')
    expect(select.get()).toEqual({ name: '甲' })
    expect(select.all()).toEqual([{ name: '甲' }])

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO t (name) VALUES (?)').run('乙')
      return 'ok'
    })
    expect(tx()).toBe('ok')
    expect((db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(2)

    db.close()
  })

  it('事务内抛错会整体回滚', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO t (name) VALUES (?)').run('甲')
      throw new Error('boom')
    })
    expect(() => tx()).toThrowError('boom')
    expect((db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(0)
    db.close()
  })

  it('applyConnectionPragmas 依次设置 WAL 与外键', () => {
    const recorder = new PragmaRecorder()
    applyConnectionPragmas(recorder)
    expect(recorder.statements).toEqual(['journal_mode = WAL', 'foreign_keys = ON'])
  })
})

describe('书库仓储', () => {
  it('insertBook 落库并读回，章节数、格式与派生的封面种子都正确', () => {
    const { db, repo } = repoWithSchema()
    const book = repo.insertBook(makeBook('b1', { title: '三体', author: '刘慈欣' }), [
      makeChapter(0),
      makeChapter(1)
    ])

    expect(book.id).toBe('b1')
    expect(book.title).toBe('三体')
    expect(book.author).toBe('刘慈欣')
    expect(book.format).toBe('txt')
    expect(book.chapterCount).toBe(2)
    expect(book.lastOpenedAt).toBeNull()
    // 未显式给种子时必须由书名派生，保证封面稳定
    expect(book.coverSeed).toBe(coverSeedFromTitle('三体'))
    expect(repo.getBook('b1')).toEqual(book)
    expect(repo.listChapters('b1')).toHaveLength(2)
    db.close()
  })

  it('insertBook 接受显式 coverSeed，且允许没有章节', () => {
    const { db, repo } = repoWithSchema()
    const book = repo.insertBook(makeBook('b2', { coverSeed: 7 }), [])
    expect(book.coverSeed).toBe(7)
    expect(book.chapterCount).toBe(0)
    db.close()
  })

  it('getBook 不存在时返回 null，listBooks 空库返回空数组', () => {
    const { db, repo } = repoWithSchema()
    expect(repo.getBook('missing')).toBeNull()
    expect(repo.listBooks()).toEqual([])
    db.close()
  })

  it('listBooks 按 COALESCE(last_opened_at, added_at) 与 added_at 倒序', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { addedAt: 100 }), [])
    repo.insertBook(makeBook('b', { addedAt: 200 }), [])
    repo.insertBook(makeBook('c', { addedAt: 50 }), [])
    // c 的导入时间最早，但最近打开过，应该排最前
    repo.touchBook('c', 300)

    expect(repo.listBooks().map((book) => book.id)).toEqual(['c', 'b', 'a'])
    db.close()
  })

  it('listBooks 一次 LEFT JOIN 就把进度带出来', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { addedAt: 100 }), [])
    repo.insertBook(makeBook('b', { addedAt: 200 }), [])
    repo.saveProgress({ ...makeProgress('a'), percent: 33.5 })

    // 没读过的书是 0，不再需要渲染层逐本补一次 getProgress
    expect(repo.listBooks().map((book) => [book.id, book.percent])).toEqual([
      ['b', 0],
      ['a', 33.5]
    ])
    db.close()
  })

  it('touchBook 写入 lastOpenedAt', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { addedAt: 100 }), [])
    repo.touchBook('a', 999)
    expect(repo.getBook('a')?.lastOpenedAt).toBe(999)
    db.close()
  })

  it('renameBook 改名并返回更新后的书', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { title: '旧名' }), [])
    const renamed = repo.renameBook('a', '新名')
    expect(renamed.title).toBe('新名')
    expect(repo.getBook('a')?.title).toBe('新名')
    db.close()
  })

  it('listChapters 按 idx 升序，getChapter 区分命中与缺失', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { title: '书' }), [
      makeChapter(0),
      makeChapter(1),
      makeChapter(2)
    ])

    const chapters = repo.listChapters('a')
    expect(chapters.map((chapter) => chapter.index)).toEqual([0, 1, 2])
    expect(chapters.map((chapter) => chapter.bookId)).toEqual(['a', 'a', 'a'])
    expect(repo.getChapter('a', 1)?.title).toBe('第 2 章')
    expect(repo.getChapter('a', 99)).toBeNull()
    expect(repo.getChapter('nope', 0)).toBeNull()
    db.close()
  })

  it('replaceChapters 覆盖旧章节并同步 chapter_count', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { title: '书' }), [makeChapter(0), makeChapter(1)])

    repo.replaceChapters('a', [makeChapter(0), makeChapter(1), makeChapter(2)])
    expect(repo.listChapters('a')).toHaveLength(3)
    expect(repo.getBook('a')?.chapterCount).toBe(3)

    repo.replaceChapters('a', [])
    expect(repo.listChapters('a')).toEqual([])
    expect(repo.getBook('a')?.chapterCount).toBe(0)
    db.close()
  })

  it('deleteBook 靠外键级联删掉章节与进度', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { title: '书' }), [makeChapter(0)])
    repo.saveProgress(makeProgress('a'))
    expect(repo.listChapters('a')).toHaveLength(1)
    expect(repo.getProgress('a')).not.toBeNull()

    repo.deleteBook('a')

    expect(repo.getBook('a')).toBeNull()
    expect(repo.listChapters('a')).toEqual([])
    expect(repo.getProgress('a')).toBeNull()
    db.close()
  })

  it('saveProgress 可重复写入并按书读回', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { title: '书' }), [])
    expect(repo.getProgress('a')).toBeNull()

    const progress = makeProgress('a')
    repo.saveProgress(progress)
    expect(repo.getProgress('a')).toEqual(progress)

    // 同一本书再存一次应覆盖而不是插入第二行
    repo.saveProgress({ ...progress, charOffset: 44, percent: 12.5 })
    const updated = repo.getProgress('a')
    expect(updated?.charOffset).toBe(44)
    expect(updated?.percent).toBe(12.5)
    db.close()
  })

  it('saveProgress 允许空引文与空设备号', () => {
    const { db, repo } = repoWithSchema()
    repo.insertBook(makeBook('a', { title: '书' }), [])
    repo.saveProgress({
      bookId: 'a',
      chapterIndex: 0,
      charOffset: 0,
      anchorBefore: null,
      anchorAfter: null,
      percent: 0,
      updatedAt: 1,
      deviceId: null
    })

    const progress = repo.getProgress('a')
    expect(progress?.anchorBefore).toBeNull()
    expect(progress?.anchorAfter).toBeNull()
    expect(progress?.deviceId).toBeNull()
    db.close()
  })

  it('insertBook 写库后读不到时抛错', () => {
    // 真实数据库里 insert 之后必然读得到，用桩驱动固定这条防御分支
    const stub = new StubDatabase()
    expect(() => new LibraryRepository(stub).insertBook(makeBook('x'), [])).toThrowError(
      '导入后写库失败: x'
    )
  })

  it('renameBook 更新 0 行时抛错', () => {
    const stub = new StubDatabase()
    stub.changes = 0
    expect(() => new LibraryRepository(stub).renameBook('x', '新名')).toThrowError('书籍不存在: x')
  })

  it('renameBook 更新后读不到时抛错', () => {
    const stub = new StubDatabase()
    expect(() => new LibraryRepository(stub).renameBook('x', '新名')).toThrowError('书籍不存在: x')
  })
})

describe('meta 仓储', () => {
  it('set 后 get 读回，重复 set 覆盖旧值', () => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    const meta = new MetaRepository(db)

    // 迁移会把 schema_version 写进去
    expect(meta.get('schema_version')).toBe('1')

    meta.set('reader.settings', '{"fontSize":19}')
    expect(meta.get('reader.settings')).toBe('{"fontSize":19}')
    meta.set('reader.settings', '{}')
    expect(meta.get('reader.settings')).toBe('{}')
    db.close()
  })

  it('get 缺失键返回 null', () => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    expect(new MetaRepository(db).get('nope')).toBeNull()
    db.close()
  })

  it('get 遇到非字符串值按 null 处理', () => {
    const stub = new StubDatabase()
    stub.rows.push({ value: 123 })
    expect(new MetaRepository(stub).get('k')).toBeNull()
  })
})
