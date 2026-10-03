import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * userData 目录布局（TECH.md 5.2）。
 * 纯路径计算，不 import electron，因此可以直接单测。
 *   <root>/library.db
 *   <root>/books/<bookId>/source.bin | content.txt | chapters/0000.txt
 */
export const DB_FILE = 'library.db'
export const BOOKS_DIR = 'books'
export const SOURCE_FILE = 'source.bin'
export const CONTENT_FILE = 'content.txt'
export const CHAPTERS_DIR = 'chapters'

export function dbPath(root: string): string {
  return join(root, DB_FILE)
}

export function booksRoot(root: string): string {
  return join(root, BOOKS_DIR)
}

export function bookDir(root: string, bookId: string): string {
  return join(booksRoot(root), bookId)
}

export function sourcePath(root: string, bookId: string): string {
  return join(bookDir(root, bookId), SOURCE_FILE)
}

export function contentPath(root: string, bookId: string): string {
  return join(bookDir(root, bookId), CONTENT_FILE)
}

export function chaptersDir(root: string, bookId: string): string {
  return join(bookDir(root, bookId), CHAPTERS_DIR)
}

/** 章节文件名固定 4 位补零，保证目录内按章序排列。 */
export function chapterFileName(index: number): string {
  return String(index).padStart(4, '0') + '.txt'
}

export function chapterFilePath(root: string, bookId: string, index: number): string {
  return join(chaptersDir(root, bookId), chapterFileName(index))
}

/** 目标路径是否真的落在 root 之内（跨盘符、.. 都会被挡掉）。 */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '') return true
  if (rel === '..') return false
  if (rel.startsWith('..' + sep)) return false
  return !isAbsolute(rel)
}

/** 库外路径一律拒绝（TECH.md 10）。 */
export function assertInside(root: string, target: string): void {
  if (!isInside(root, target)) {
    throw new Error('拒绝访问书库以外的路径: ' + target)
  }
}
