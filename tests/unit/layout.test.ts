import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertInside,
  bookDir,
  chapterFileName,
  chapterFilePath,
  chaptersDir,
  contentPath,
  dbPath,
  isInside,
  sourcePath
} from '@main/services/layout'

const BOOK_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('书库目录布局', () => {
  const root = join('base', 'library')

  it('数据库与书目录都在 root 下面', () => {
    expect(dbPath(root)).toBe(join(root, 'library.db'))
    expect(bookDir(root, BOOK_ID)).toBe(join(root, 'books', BOOK_ID))
    expect(sourcePath(root, BOOK_ID)).toBe(join(root, 'books', BOOK_ID, 'source.bin'))
    expect(contentPath(root, BOOK_ID)).toBe(join(root, 'books', BOOK_ID, 'content.txt'))
    expect(chaptersDir(root, BOOK_ID)).toBe(join(root, 'books', BOOK_ID, 'chapters'))
    expect(chapterFilePath(root, BOOK_ID, 7)).toBe(
      join(root, 'books', BOOK_ID, 'chapters', '0007.txt')
    )
  })

  it('章节文件名按 4 位补零排列', () => {
    expect(chapterFileName(0)).toBe('0000.txt')
    expect(chapterFileName(7)).toBe('0007.txt')
    expect(chapterFileName(9999)).toBe('9999.txt')
    expect(chapterFileName(12345)).toBe('12345.txt')
  })

  it('isInside 只认 root 里面的路径', () => {
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, join(root, 'books', BOOK_ID))).toBe(true)
    expect(isInside(root, join(root, '..', 'outside'))).toBe(false)
    expect(isInside(root, join(root, '..'))).toBe(false)
  })

  it('assertInside 对库外路径抛中文错误', () => {
    expect(() => assertInside(root, join(root, '..', 'outside'))).toThrowError(
      '拒绝访问书库以外的路径'
    )
    expect(() => assertInside(root, join(root, 'books'))).not.toThrow()
  })
})
