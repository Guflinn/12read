import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Progress } from '@shared/types'
import { UUID_V4_RE } from '@shared/core/ids'
import type { LibraryRepository } from '@main/db/library-repository'
import type { MetaRepository } from '@main/db/meta-repository'
import { deviceIdOf } from '@main/services/device-id'
import { SqlProgressStore } from '@main/services/progress-store'
import { SettingsStore } from '@main/services/settings-store'

/**
 * main 侧三个小仓储服务的单测：都只用仓储接口，不碰文件系统，
 * 所以这里用最小假实现把「读不到 / 坏数据 / 覆盖写」这些分支全部固定住。
 */

interface MetaHarness {
  repo: MetaRepository
  store: Map<string, string>
  set: ReturnType<typeof vi.fn>
}

function makeMetaHarness(seed: Record<string, string> = {}): MetaHarness {
  const store = new Map<string, string>(Object.entries(seed))
  const set = vi.fn((key: string, value: string): void => {
    store.set(key, value)
  })
  const get = vi.fn((key: string): string | null => store.get(key) ?? null)
  return { repo: { get, set } as unknown as MetaRepository, store, set }
}

function makeProgress(patch: Partial<Progress> = {}): Progress {
  return {
    bookId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    chapterIndex: 1,
    charOffset: 20,
    anchorBefore: '前',
    anchorAfter: '后',
    percent: 12.5,
    updatedAt: 999,
    deviceId: 'device-1',
    ...patch
  }
}

describe('deviceIdOf', () => {
  it('meta 里没有时生成 uuid v4 并落库', () => {
    const meta = makeMetaHarness()
    const id = deviceIdOf(meta.repo)
    expect(id).toMatch(UUID_V4_RE)
    expect(meta.store.get('device_id')).toBe(id)
    expect(meta.set).toHaveBeenCalledWith('device_id', id)
  })

  it('已有合法 id 时直接复用，不再写库', () => {
    const meta = makeMetaHarness({ device_id: 'existing-device' })
    expect(deviceIdOf(meta.repo)).toBe('existing-device')
    expect(meta.set).not.toHaveBeenCalled()
  })

  it('长度为边界值 120 时仍然复用', () => {
    const value = 'a'.repeat(120)
    const meta = makeMetaHarness({ device_id: value })
    expect(deviceIdOf(meta.repo)).toBe(value)
    expect(meta.set).not.toHaveBeenCalled()
  })

  it('空串或超长值都视为损坏，重新生成', () => {
    const meta = makeMetaHarness({ device_id: '' })
    const regenerated = deviceIdOf(meta.repo)
    expect(regenerated).toMatch(UUID_V4_RE)
    expect(meta.store.get('device_id')).toBe(regenerated)

    const tooLong = 'x'.repeat(121)
    meta.store.set('device_id', tooLong)
    const second = deviceIdOf(meta.repo)
    expect(second).toMatch(UUID_V4_RE)
    expect(second).not.toBe(tooLong)
  })
})

describe('SqlProgressStore', () => {
  it('get 直接透传仓储结果（含 null）', async () => {
    const progress = makeProgress()
    const getProgress = vi.fn((): Progress | null => progress)
    const repo = { getProgress } as unknown as LibraryRepository
    const store = new SqlProgressStore(repo)
    expect(await store.get(progress.bookId)).toBe(progress)

    getProgress.mockReturnValueOnce(null)
    expect(await store.get('没有这本')).toBeNull()
  })

  it('save 先写进度再推 last_opened_at，顺序不能反', async () => {
    const order: string[] = []
    const saveProgress = vi.fn((): void => {
      order.push('progress')
    })
    const touchBook = vi.fn((): void => {
      order.push('touch')
    })
    const repo = { saveProgress, touchBook } as unknown as LibraryRepository
    const store = new SqlProgressStore(repo)
    const progress = makeProgress()

    await store.save(progress)

    expect(saveProgress).toHaveBeenCalledWith(progress)
    expect(touchBook).toHaveBeenCalledWith(progress.bookId, progress.updatedAt)
    expect(order).toEqual(['progress', 'touch'])
  })
})

describe('SettingsStore（main 侧 meta 持久化）', () => {
  const KEY = 'reader_settings'

  it('没有记录时返回默认值，且是副本', () => {
    const meta = makeMetaHarness()
    const settings = new SettingsStore(meta.repo).get()
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings).not.toBe(DEFAULT_SETTINGS)
  })

  it('已有合法 JSON 时解析返回', () => {
    const stored = { fontSize: 21, lineHeight: 2.1, theme: 'night' as const, bold: true }
    const meta = makeMetaHarness({ [KEY]: JSON.stringify(stored) })
    expect(new SettingsStore(meta.repo).get()).toEqual(stored)
  })

  it('老版本存的设置没有 bold：补 false，其余照样保留', () => {
    const meta = makeMetaHarness({ [KEY]: JSON.stringify({ fontSize: 21, lineHeight: 2.1, theme: 'night' }) })
    expect(new SettingsStore(meta.repo).get()).toEqual({
      fontSize: 21,
      lineHeight: 2.1,
      theme: 'night',
      bold: false
    })
  })

  it('坏 JSON 不会把界面搞崩，回退默认', () => {
    const meta = makeMetaHarness({ [KEY]: '{不是 json' })
    expect(new SettingsStore(meta.repo).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('JSON 合法但 schema 不通过也回退默认', () => {
    const meta = makeMetaHarness({ [KEY]: JSON.stringify({ fontSize: 999, lineHeight: 1, theme: 'sepia' }) })
    expect(new SettingsStore(meta.repo).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('set 合法时写库并返回解析后的值', () => {
    const meta = makeMetaHarness()
    const next = { fontSize: 20, lineHeight: 2, theme: 'night' as const, bold: true }
    const returned = new SettingsStore(meta.repo).set(next)
    expect(returned).toEqual(next)
    expect(meta.set).toHaveBeenCalledWith(KEY, JSON.stringify(next))
  })

  it('set 非法时不动库，返回当前 get() 的结果', () => {
    const meta = makeMetaHarness({ [KEY]: JSON.stringify(DEFAULT_SETTINGS) })
    const returned = new SettingsStore(meta.repo).set({ fontSize: 5, lineHeight: 1, theme: 'night', bold: true })
    expect(returned).toEqual(DEFAULT_SETTINGS)
    expect(meta.set).not.toHaveBeenCalled()
  })
})
