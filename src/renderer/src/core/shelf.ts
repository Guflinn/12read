import type { ShelfBook } from '@shared/types'

/** 书架排序方式。recent 与数据库默认顺序一致：最近读过的在前。 */
export type ShelfSort = 'recent' | 'added' | 'title' | 'progress'

export const SHELF_SORTS: readonly { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: '最近阅读' },
  { value: 'added', label: '导入时间' },
  { value: 'title', label: '书名' },
  { value: 'progress', label: '进度' }
]

/** 最近一次读过的时刻；没读过就用导入时间顶上，与 SQL 里的 COALESCE 一个意思。 */
function recentAt(book: ShelfBook): number {
  return book.lastOpenedAt ?? book.addedAt
}

/** 按书名或作者筛选。首尾空格与大小写都不敏感，空查询返回全部（且不改动入参）。 */
export function filterBooks(books: readonly ShelfBook[], query: string): ShelfBook[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...books]
  return books.filter((book) => ((book.title + '\n' + (book.author ?? '')).toLowerCase().includes(needle)))
}

export function sortBooks(books: readonly ShelfBook[], sort: ShelfSort): ShelfBook[] {
  const copy = [...books]
  switch (sort) {
    case 'added':
      return copy.sort((a, b) => b.addedAt - a.addedAt)
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
    case 'progress':
      return copy.sort((a, b) => b.percent - a.percent || recentAt(b) - recentAt(a))
    case 'recent':
    default:
      return copy.sort((a, b) => recentAt(b) - recentAt(a) || b.addedAt - a.addedAt)
  }
}

/** 书架实际展示什么：先筛后排。 */
export function shelfView(books: readonly ShelfBook[], query: string, sort: ShelfSort): ShelfBook[] {
  return sortBooks(filterBooks(books, query), sort)
}
