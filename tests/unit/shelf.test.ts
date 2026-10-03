import { describe, expect, it } from 'vitest'
import type { ShelfBook } from '@shared/types'
import { filterBooks, shelfView, sortBooks } from '@/core/shelf'

function book(patch: Partial<ShelfBook> = {}): ShelfBook {
  return {
    id: 'id',
    title: '书',
    author: null,
    format: 'txt',
    encoding: 'utf-8',
    byteSize: 10,
    charCount: 10,
    chapterCount: 1,
    contentMode: 'single',
    coverSeed: 1,
    addedAt: 100,
    lastOpenedAt: null,
    percent: 0,
    ...patch
  }
}

describe('书架筛选与排序', () => {
  it('筛选按书名与作者匹配，大小写和首尾空格都不敏感', () => {
    const books = [book({ id: 'a', title: '三体', author: '刘慈欣' }), book({ id: 'b', title: 'Dune', author: null })]

    expect(filterBooks(books, '').map((b) => b.id)).toEqual(['a', 'b'])
    expect(filterBooks(books, '   ').map((b) => b.id)).toEqual(['a', 'b'])
    expect(filterBooks(books, ' 刘慈 ').map((b) => b.id)).toEqual(['a'])
    expect(filterBooks(books, 'dune').map((b) => b.id)).toEqual(['b'])
    expect(filterBooks(books, '没有这本')).toEqual([])
  })

  it('筛选不改动传入的数组', () => {
    const books = [book({ id: 'a' }), book({ id: 'b' })]
    filterBooks(books, 'a')
    sortBooks(books, 'title')
    expect(books.map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('最近阅读用 lastOpenedAt，没读过就用导入时间顶', () => {
    const books = [
      book({ id: 'old', addedAt: 100, lastOpenedAt: 500 }),
      book({ id: 'never', addedAt: 400, lastOpenedAt: null }),
      book({ id: 'newest', addedAt: 900, lastOpenedAt: null })
    ]
    expect(sortBooks(books, 'recent').map((b) => b.id)).toEqual(['newest', 'old', 'never'])
  })

  it('按导入时间与进度排序', () => {
    const books = [
      book({ id: 'a', addedAt: 100, percent: 10 }),
      book({ id: 'b', addedAt: 300, percent: 80 }),
      book({ id: 'c', addedAt: 200, percent: 80 })
    ]
    expect(sortBooks(books, 'added').map((b) => b.id)).toEqual(['b', 'c', 'a'])
    // 进度相同再看谁最近读过
    expect(sortBooks(books, 'progress').map((b) => b.id)).toEqual(['b', 'c', 'a'])
  })

  it('按书名排序，中文按拼音先后', () => {
    const books = [book({ id: 'yi', title: '乙书' }), book({ id: 'jia', title: '甲书' }), book({ id: 'bing', title: '丙书' })]
    expect(sortBooks(books, 'title').map((b) => b.id)).toEqual(['bing', 'jia', 'yi'])
  })

  it('shelfView 先筛后排', () => {
    const books = [
      book({ id: 'a', title: '甲书', addedAt: 100 }),
      book({ id: 'b', title: '甲书二', addedAt: 300 }),
      book({ id: 'c', title: '乙书', addedAt: 200 })
    ]
    expect(shelfView(books, '甲', 'added').map((b) => b.id)).toEqual(['b', 'a'])
  })
})
