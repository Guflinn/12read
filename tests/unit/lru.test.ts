import { describe, expect, it } from 'vitest'
import { LruCache } from '@shared/core/lru'

const weigh = (value: string): number => value.length

describe('LruCache', () => {
  it('存取的记账正确', () => {
    const cache = new LruCache<string, string>(10, weigh)
    cache.set('a', 'four')
    expect(cache.get('a')).toBe('four')
    expect(cache.size).toBe(1)
    expect(cache.weight).toBe(4)
    expect(cache.has('a')).toBe(true)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('覆盖同一个 key 不会重复计重', () => {
    const cache = new LruCache<string, string>(10, weigh)
    cache.set('a', 'four')
    cache.set('a', 'sixsix')
    expect(cache.size).toBe(1)
    expect(cache.weight).toBe(6)
    expect(cache.get('a')).toBe('sixsix')
  })

  it('超重时淘汰最久未用的那个', () => {
    const cache = new LruCache<string, string>(10, weigh)
    cache.set('a', 'aaaa')
    cache.set('b', 'bbbb')
    cache.set('c', 'cccc')
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.weight).toBe(8)
  })

  it('get 会把条目提到最近使用，从而改变淘汰顺序', () => {
    const cache = new LruCache<string, string>(8, weigh)
    cache.set('a', 'aaaa')
    cache.set('b', 'bbbb')
    expect(cache.get('a')).toBe('aaaa')
    cache.set('c', 'cccc')
    expect(cache.has('b')).toBe(false)
    expect(cache.has('a')).toBe(true)
  })

  it('单个条目超过上限时缓存为空，但不会抛异常', () => {
    const cache = new LruCache<string, string>(4, weigh)
    cache.set('big', 'way too long')
    expect(cache.size).toBe(0)
    expect(cache.weight).toBe(0)
  })

  it('delete 与 clear 都要更新权重', () => {
    const cache = new LruCache<string, string>(100, weigh)
    cache.set('a', 'aaaa')
    cache.set('b', 'bb')
    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false)
    expect(cache.weight).toBe(2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.weight).toBe(0)
  })
})
