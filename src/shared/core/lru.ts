/**
 * 极简 LRU：按「权重」而不是条数淘汰。
 * 用途是 main 侧的解码文本缓存（TECH.md 5.3，上限 64MB）。
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; weight: number }>()
  private totalWeight = 0

  constructor(
    private readonly maxWeight: number,
    private readonly weigh: (value: V) => number
  ) {}

  get size(): number {
    return this.entries.size
  }

  get weight(): number {
    return this.totalWeight
  }

  has(key: K): boolean {
    return this.entries.has(key)
  }

  get(key: K): V | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    // 重新插入一次，把它挪到 Map 末尾（最近使用）。
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit.value
  }

  set(key: K, value: V): void {
    const weight = Math.max(0, this.weigh(value))
    this.drop(key)
    this.entries.set(key, { value, weight })
    this.totalWeight += weight
    this.evict()
  }

  delete(key: K): boolean {
    return this.drop(key)
  }

  clear(): void {
    this.entries.clear()
    this.totalWeight = 0
  }

  private drop(key: K): boolean {
    const existing = this.entries.get(key)
    if (!existing) return false
    this.entries.delete(key)
    this.totalWeight -= existing.weight
    return true
  }

  private evict(): void {
    while (this.totalWeight > this.maxWeight && this.entries.size > 0) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.drop(oldest.value)
    }
  }
}
