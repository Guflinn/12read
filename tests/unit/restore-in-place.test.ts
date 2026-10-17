import { describe, expect, it, vi } from 'vitest'
import type { RestoreResult } from '@shared/types'
import { RestoreError } from '@main/services/restore'
import { restoreInPlace, type RestoreInPlaceDeps } from '@main/services/restore-in-place'

const RESULT: RestoreResult = {
  path: 'D:\\备份\\12read.zip',
  books: 2,
  sources: 2,
  restoredAt: '2026-10-17T00:00:00.000Z',
  exportedAt: null,
  schemaVersion: 5,
  undoDir: 'D:\\数据\\restore-undo-20261017-080000'
}

type Deps = RestoreInPlaceDeps

function makeDeps(overrides?: Partial<Deps>): Deps & {
  cancelImports: ReturnType<typeof vi.fn>
  swap: ReturnType<typeof vi.fn>
  isDbOpen: ReturnType<typeof vi.fn>
  reopen: ReturnType<typeof vi.fn>
} {
  const deps = {
    cancelImports: vi.fn(),
    swap: vi.fn(async (_zipPath: string): Promise<RestoreResult> => RESULT),
    isDbOpen: vi.fn((): boolean => false),
    reopen: vi.fn(async (): Promise<void> => undefined)
  }
  return { ...deps, ...overrides } as Deps & typeof deps
}

describe('还原编排（不退出的原地还原，1.0.1）', () => {
  it('主流程：换库成功 → 原地重开 → 返回报告', async () => {
    const deps = makeDeps()
    const result = await restoreInPlace(deps, 'D:\\备份\\12read.zip')
    expect(result).toEqual(RESULT)
    expect(deps.cancelImports).toHaveBeenCalledTimes(1)
    expect(deps.swap).toHaveBeenCalledWith('D:\\备份\\12read.zip')
    expect(deps.reopen).toHaveBeenCalledTimes(1)
  })

  it('校验类失败（连接没关过）：原样抛错，不重开、应用安然无恙', async () => {
    const deps = makeDeps({
      isDbOpen: vi.fn((): boolean => true),
      swap: vi.fn(async () => {
        throw new RestoreError('这个包不是十二阅读导出的备份', false)
      })
    })
    await expect(restoreInPlace(deps, 'x.zip')).rejects.toThrow('这个包不是十二阅读导出的备份')
    expect(deps.reopen).not.toHaveBeenCalled()
  })

  it('换库失败已回滚（closed）：重开旧库后把错误转成普通失败（不再要求重启）', async () => {
    const deps = makeDeps({
      swap: vi.fn(async () => {
        throw new RestoreError('还原失败，已经退回原来的书库：磁盘忙', true)
      })
    })
    await expect(restoreInPlace(deps, 'x.zip')).rejects.toThrow(RestoreError)
    await expect(restoreInPlace(deps, 'x.zip')).rejects.toMatchObject({ closed: false })
    // 两次调用各重开一次
    expect(deps.reopen).toHaveBeenCalledTimes(2)
  })

  it('重开失败（主流程）：抛 closed=true，由 ipc 弹窗并兜底重启', async () => {
    const deps = makeDeps({
      reopen: vi.fn(async () => {
        throw new Error('数据库文件损坏')
      })
    })
    await expect(restoreInPlace(deps, 'x.zip')).rejects.toMatchObject({
      closed: true,
      message: expect.stringContaining('还原已完成，但重新加载书库失败')
    })
  })

  it('重开失败（回滚路径）：同样抛 closed=true，话术说明书库已退回', async () => {
    const deps = makeDeps({
      swap: vi.fn(async () => {
        throw new RestoreError('还原失败，已经退回原来的书库：磁盘忙', true)
      }),
      reopen: vi.fn(async () => {
        throw new Error('还是打不开')
      })
    })
    await expect(restoreInPlace(deps, 'x.zip')).rejects.toMatchObject({
      closed: true,
      message: expect.stringContaining('还原失败，书库已经退回原样')
    })
  })
})
