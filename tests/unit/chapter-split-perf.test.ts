import { describe, expect, it } from 'vitest'
import { detectEncoding } from '@shared/core/encoding-detect'
import { splitChapters } from '@shared/core/chapter-split'

// TECH 的性能验收里有两条和 core 纯函数直接相关：
//   「2.5M 字的书，分章扫描 < 1s」、「导入 5MB / 2.5M 字 < 2s」。
// 这里把它们钉成回归测试。时间断言故意留了约三个数量级的余量（实测 2.2ms / 0.8ms），
// 目的是挡住「改成分段里再 indexOf 之类」导致的 O(n^2) 退化，而不是考核机器快慢。
const GENEROUS_BUDGET_MS = 2000

function makeNovel(chapters: number, paragraphsPerChapter: number, charsPerParagraph: number): string {
  const filler = '山川湖海风雨星辰晨昏四季草木花鸟鱼虫'.repeat(20)
  const lines: string[] = []
  for (let c = 1; c <= chapters; c += 1) {
    lines.push('第' + c + '章 测试章节' + c)
    for (let p = 0; p < paragraphsPerChapter; p += 1) {
      lines.push(filler.slice(0, charsPerParagraph))
    }
  }
  return lines.join('\n')
}

describe('大文件性能回归', () => {
  const novel = makeNovel(200, 60, 200)

  it('2.4M 字左右的书能在预算内完成编码探测与分章', () => {
    expect(novel.length).toBeGreaterThan(2_000_000)

    const bytes = new TextEncoder().encode(novel)
    const detectStart = performance.now()
    const detection = detectEncoding(bytes)
    const detectCost = performance.now() - detectStart

    const splitStart = performance.now()
    const result = splitChapters(novel)
    const splitCost = performance.now() - splitStart

    expect(detection.encoding).toBe('utf-8')
    expect(result.usedFallback).toBe(false)
    expect(result.chapters).toHaveLength(200)
    expect(detectCost).toBeLessThan(GENEROUS_BUDGET_MS)
    expect(splitCost).toBeLessThan(GENEROUS_BUDGET_MS)
  })
})
