import { describe, expect, it } from 'vitest'
import {
  CHUNK_FIRST_RENDER_CHARS,
  CHUNK_THRESHOLD_CHARS,
  DEFAULT_SETTINGS,
  SLICE_MODE_BYTES
} from '@shared/types'

describe('共享常量', () => {
  it('默认排版设置落在 schema 允许范围内', () => {
    expect(DEFAULT_SETTINGS.fontSize).toBeGreaterThanOrEqual(12)
    expect(DEFAULT_SETTINGS.fontSize).toBeLessThanOrEqual(40)
    expect(DEFAULT_SETTINGS.lineHeight).toBeGreaterThanOrEqual(1.2)
    expect(DEFAULT_SETTINGS.lineHeight).toBeLessThanOrEqual(3)
    expect(DEFAULT_SETTINGS.theme).toBe('day')
  })

  it('sliced 阈值是 32MB', () => {
    expect(SLICE_MODE_BYTES).toBe(32 * 1024 * 1024)
  })

  it('分块渲染首次渲染量小于阈值', () => {
    expect(CHUNK_FIRST_RENDER_CHARS).toBeLessThan(CHUNK_THRESHOLD_CHARS)
  })
})
