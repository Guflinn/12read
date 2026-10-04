import { describe, expect, it } from 'vitest'
import { MANUAL_ENCODINGS } from '@shared/types'
import { ENCODING_CHOICES } from '@/core/encoding-choices'

describe('重新解码的编码选项', () => {
  it('每一项都对应一个 ManualEncoding，且不重复', () => {
    const values = ENCODING_CHOICES.map((choice) => choice.value)
    expect(new Set(values).size).toBe(values.length)
    for (const value of values) {
      expect(MANUAL_ENCODINGS).toContain(value)
    }
  })

  it('自动检测排第一，big5 也给了入口', () => {
    expect(ENCODING_CHOICES[0].value).toBe('auto')
    expect(ENCODING_CHOICES.map((choice) => choice.value)).toEqual([...MANUAL_ENCODINGS])
  })

  it('每一行都有中文标签与说明', () => {
    for (const choice of ENCODING_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0)
      expect(choice.hint.length).toBeGreaterThan(0)
    }
  })
})
