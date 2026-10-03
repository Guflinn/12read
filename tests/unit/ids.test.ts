import { describe, expect, it } from 'vitest'
import { UUID_V4_RE, isSafeBookId, newBookId } from '@shared/core/ids'

describe('bookId 校验', () => {
  it('接受 uuid v4', () => {
    expect(UUID_V4_RE.test('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true)
    expect(isSafeBookId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true)
  })

  it('拒绝非 v4、空串与路径穿越', () => {
    // 第三段以 1 开头 = uuid v1；第四段不以 8/9/a/b 开头也不是 v4
    expect(isSafeBookId('9c5b94b1-35ad-11d3-9a0c-0305e82c3301')).toBe(false)
    expect(isSafeBookId('9c5b94b1-35ad-41d3-1a0c-0305e82c3301')).toBe(false)
    expect(isSafeBookId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false)
    expect(isSafeBookId('')).toBe(false)
    expect(isSafeBookId('../etc/passwd')).toBe(false)
    expect(isSafeBookId(123)).toBe(false)
    expect(isSafeBookId(null)).toBe(false)
  })

  it('生成的 id 都是合法 v4 且互不相同', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 200; i += 1) ids.add(newBookId())
    expect(ids.size).toBe(200)
    for (const id of ids) expect(UUID_V4_RE.test(id)).toBe(true)
  })
})
