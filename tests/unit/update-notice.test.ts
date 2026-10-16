import { describe, expect, it } from 'vitest'
import { updateNoticeEnabled, updateNoticeText } from '@/core/updates'
import type { UpdateInfo, UpdateProgress } from '@shared/types'

const INFO: UpdateInfo = {
  version: '9.9.9',
  url: 'https://github.com/Guflinn/12read/releases/tag/v9.9.9',
  publishedAt: null
}

function progress(state: UpdateProgress['state'], percent: number | null = null): UpdateProgress {
  return { state, percent, version: '9.9.9' }
}

describe('书架更新胶囊的文案（0.4.0）', () => {
  it('还没开始下载：说「有新版本 · 更新」', () => {
    expect(updateNoticeText(INFO, null)).toBe('有新版本 v9.9.9 · 更新')
  })

  it('下载中显示百分比；拿不到百分比时不编一个 0%（那看着像卡住）', () => {
    expect(updateNoticeText(INFO, progress('downloading', 42))).toBe('正在下载更新 42%')
    expect(updateNoticeText(INFO, progress('downloading', null))).toBe('正在下载更新…')
    expect(updateNoticeText(INFO, progress('started'))).toBe('正在准备下载…')
  })

  it('下好了：说清点下去是重启', () => {
    expect(updateNoticeText(INFO, progress('ready'))).toBe('已下载 v9.9.9 · 重启并更新')
  })

  it('这个构建不支持应用内更新：退回「去下载」（老路）', () => {
    expect(updateNoticeText(INFO, progress('unsupported'))).toBe('有新版本 v9.9.9 · 去下载')
  })

  it('下载中禁用，免得点出第二次下载', () => {
    expect(updateNoticeEnabled(null)).toBe(true)
    expect(updateNoticeEnabled(progress('started'))).toBe(false)
    expect(updateNoticeEnabled(progress('downloading', 10))).toBe(false)
    expect(updateNoticeEnabled(progress('ready'))).toBe(true)
    expect(updateNoticeEnabled(progress('error'))).toBe(true)
  })
})
