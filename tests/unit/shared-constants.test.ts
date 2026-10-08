import { describe, expect, it } from 'vitest'
import {
  CHUNK_FIRST_RENDER_CHARS,
  CHUNK_THRESHOLD_CHARS,
  DEFAULT_SETTINGS,
  SLICE_MODE_BYTES
} from '@shared/types'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '@/core/reading'
import { PAGE_WIDTHS } from '@/core/typography'

describe('共享常量', () => {
  it('默认排版设置落在 schema 允许范围内', () => {
    expect(DEFAULT_SETTINGS.fontSize).toBeGreaterThanOrEqual(12)
    expect(DEFAULT_SETTINGS.fontSize).toBeLessThanOrEqual(40)
    expect(DEFAULT_SETTINGS.lineHeight).toBeGreaterThanOrEqual(1.2)
    expect(DEFAULT_SETTINGS.lineHeight).toBeLessThanOrEqual(3)
    expect(DEFAULT_SETTINGS.theme).toBe('day')
    expect(DEFAULT_SETTINGS.fontFamily).toBe('song')
    expect(DEFAULT_SETTINGS.pageWidth).toBe('medium')
  })

  it('字号 UI 上下限罩得住默认值（0.2.2 上限 56）', () => {
    expect(FONT_SIZE_MIN).toBeLessThanOrEqual(DEFAULT_SETTINGS.fontSize)
    expect(FONT_SIZE_MAX).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.fontSize)
    expect(FONT_SIZE_MAX).toBeGreaterThan(32) // 4K 下旧上限不够用，别再退回去
  })

  it('栏宽档位含特大档且宽度随档位递增', () => {
    const labels = PAGE_WIDTHS.map((item) => item.label)
    expect(labels).toContain('特大')
    const widths = PAGE_WIDTHS.map((item) => parseFloat(item.width))
    for (let i = 1; i < widths.length - 1; i += 1) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1])
    }
  })

  it('sliced 阈值是 32MB', () => {
    expect(SLICE_MODE_BYTES).toBe(32 * 1024 * 1024)
  })

  it('分块渲染首次渲染量小于阈值', () => {
    expect(CHUNK_FIRST_RENDER_CHARS).toBeLessThan(CHUNK_THRESHOLD_CHARS)
  })
})
