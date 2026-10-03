import { describe, expect, it } from 'vitest'
import { ANCHOR_LENGTH, clampOffset, estimatePercent, makeAnchor, relocateOffset } from '@shared/core/anchor'

describe('进度锚点', () => {
  // 每个字都不重复，避免周期性文本让 lastIndexOf 命中更靠后的重复片段
  const text = Array.from({ length: 200 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('')

  it('取前后各 30 字', () => {
    const anchor = makeAnchor(text, 100)
    expect(anchor.before.length).toBe(ANCHOR_LENGTH)
    expect(anchor.after.length).toBe(ANCHOR_LENGTH)
    expect(text.slice(70, 100)).toBe(anchor.before)
    expect(text.slice(100, 130)).toBe(anchor.after)
  })

  it('开头与结尾处自动收窄', () => {
    expect(makeAnchor(text, 0).before).toBe('')
    expect(makeAnchor(text, 0).after.length).toBe(ANCHOR_LENGTH)
    expect(makeAnchor(text, text.length).after).toBe('')
    expect(makeAnchor(text, text.length).before.length).toBe(ANCHOR_LENGTH)
  })

  it('越界偏移会被夹紧，不抛异常', () => {
    expect(clampOffset(-5, 10)).toBe(0)
    expect(clampOffset(99, 10)).toBe(10)
    expect(clampOffset(Number.NaN, 10)).toBe(0)
    expect(clampOffset(3.7, 10)).toBe(3)
    expect(makeAnchor(text, 99999).after).toBe('')
  })

  it('四级降级：前后引文组合命中', () => {
    expect(relocateOffset(text, { charOffset: 0, anchorBefore: text.slice(70, 100), anchorAfter: text.slice(100, 130) })).toBe(100)
  })

  it('前后组合失配时退到后引文，再退到前引文', () => {
    expect(relocateOffset(text, { charOffset: 0, anchorBefore: '不存在的引文', anchorAfter: text.slice(40, 70) })).toBe(40)
    expect(relocateOffset(text, { charOffset: 0, anchorBefore: text.slice(70, 100), anchorAfter: '不存在的引文' })).toBe(100)
  })

  it('没有引文时夹紧 charOffset', () => {
    expect(relocateOffset(text, { charOffset: 55, anchorBefore: null, anchorAfter: null })).toBe(55)
    expect(relocateOffset(text, { charOffset: 99999, anchorBefore: null, anchorAfter: null })).toBe(text.length)
    expect(relocateOffset(text, { charOffset: -1, anchorBefore: null, anchorAfter: null })).toBe(0)
  })

  it('空字符串引文不会误命中', () => {
    expect(relocateOffset(text, { charOffset: 12, anchorBefore: '', anchorAfter: '' })).toBe(12)
  })

  it('百分比只在展示层计算并夹在 0..100', () => {
    expect(estimatePercent(1000, 0, 0)).toBe(0)
    expect(estimatePercent(1000, 0, 500)).toBe(50)
    expect(estimatePercent(1000, 500, 500)).toBe(100)
    expect(estimatePercent(1000, 0, 5000)).toBe(100)
    expect(estimatePercent(0, 0, 10)).toBe(0)
  })
})
