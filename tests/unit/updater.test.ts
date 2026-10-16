import { describe, expect, it } from 'vitest'
import { UpdaterService, type AutoUpdaterLike, type UpdaterDeps } from '@main/services/updater'
import type { UpdateProgress } from '@shared/types'

/**
 * 应用内更新（0.4.0）：走 electron-updater，但这一层只认自己 DTO。
 * 单测里塞一个假的 updater，就能把「不支持 / 查不到 / 下好了 / 出错」四条路走完，
 * 不需要真的 Electron，也不需要真的网络。
 */
function fakeUpdater(overrides: Partial<AutoUpdaterLike> = {}): AutoUpdaterLike & {
  listeners: Map<string, ((...args: unknown[]) => void)[]>
  downloaded: number
  installed: number
} {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    logger: null,
    listeners,
    downloaded: 0,
    installed: 0,
    on(event: string, listener: (...args: unknown[]) => void): void {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
    },
    checkForUpdates: async (): Promise<{ updateInfo?: { version?: string } }> => ({
      updateInfo: { version: '9.9.9' }
    }),
    downloadUpdate: async function (this: { downloaded: number }): Promise<void> {
      this.downloaded += 1
    },
    quitAndInstall(): void {
      updater.installed += 1
    },
    ...overrides
  }
  return updater as AutoUpdaterLike & {
    listeners: Map<string, ((...args: unknown[]) => void)[]>
    downloaded: number
    installed: number
  }
}

function deps(updater: AutoUpdaterLike, available = true): UpdaterDeps & { logs: string[] } {
  const logs: string[] = []
  return {
    logs,
    available: () => available,
    create: () => updater,
    currentVersion: () => '0.4.0',
    log: (message) => logs.push(message)
  }
}

function emit(updater: { listeners: Map<string, ((...args: unknown[]) => void)[]> }, event: string, payload: unknown): void {
  for (const listener of updater.listeners.get(event) ?? []) listener(payload)
}

describe('UpdaterService：构建不支持时老实说不支持', () => {
  it('免安装版 / 开发环境：返回 unsupported，并把原因说清楚', async () => {
    const updater = fakeUpdater()
    const service = new UpdaterService(deps(updater, false))

    const progress = await service.startDownload()

    expect(progress.state).toBe('unsupported')
    expect(progress.message).toContain('免安装版')
    // 一次都不该碰 electron-updater
    expect(updater.downloaded).toBe(0)
  })

  it('不支持时点「重启并安装」直接抛错（界面据此提示）', () => {
    const service = new UpdaterService(deps(fakeUpdater(), false))
    expect(() => service.install()).toThrow(/不支持应用内更新/)
  })
})

describe('UpdaterService：下载与安装', () => {
  it('查到新版 → 下载 → ready；install 调 quitAndInstall', async () => {
    const updater = fakeUpdater()
    const service = new UpdaterService(deps(updater))
    const seen: UpdateProgress[] = []
    service.onProgress((progress) => seen.push(progress))

    const result = await service.startDownload()

    expect(result.state).toBe('ready')
    expect(result.version).toBe('9.9.9')
    expect(updater.downloaded).toBe(1)
    expect(seen.map((item) => item.state)).toEqual(['started', 'ready'])

    service.install()
    expect(updater.installed).toBe(1)
  })

  it('下载中的进度事件映射成 downloading，百分比取整', async () => {
    const updater = fakeUpdater()
    const service = new UpdaterService(deps(updater))
    const seen: UpdateProgress[] = []
    service.onProgress((progress) => seen.push(progress))

    // 先拿到版本号（真实流程里 checkForUpdates 先跑）
    const pending = service.startDownload()
    emit(updater, 'download-progress', { percent: 41.6 })
    await pending

    const downloading = seen.find((item) => item.state === 'downloading')
    expect(downloading?.percent).toBe(42)

    // 百分比拿不到时不能编一个 0 出来（那看起来像卡住）
    emit(updater, 'download-progress', { percent: 'unknown' })
    const last = seen.filter((item) => item.state === 'downloading').at(-1)
    expect(last?.percent).toBeNull()
  })

  it('已经在下载 / 已经下好时不会重复下一次', async () => {
    const updater = fakeUpdater()
    const service = new UpdaterService(deps(updater))

    await service.startDownload()
    const again = await service.startDownload()

    expect(again.state).toBe('ready')
    expect(updater.downloaded).toBe(1)
  })

  it('远端没有比本机新的版本：给 error 而不是假装下载', async () => {
    const updater = fakeUpdater({
      checkForUpdates: async () => ({ updateInfo: { version: '0.4.0' } })
    })
    const service = new UpdaterService(deps(updater))

    const progress = await service.startDownload()

    expect(progress.state).toBe('error')
    expect(progress.message).toContain('最新版本')
    expect(updater.downloaded).toBe(0)
  })

  it('查不到更新（远端没有 latest.yml 之类）：error + 中文说明', async () => {
    const updater = fakeUpdater({ checkForUpdates: async () => null })
    const service = new UpdaterService(deps(updater))

    const progress = await service.startDownload()

    expect(progress.state).toBe('error')
    expect(progress.message).toBe('没查到可用的更新')
  })

  it('下载抛错：error，且把原因写进 message 与日志', async () => {
    const updater = fakeUpdater({
      downloadUpdate: async () => {
        throw new Error('网络断了')
      }
    })
    const logDeps = deps(updater)
    const service = new UpdaterService(logDeps)

    const progress = await service.startDownload()

    expect(progress.state).toBe('error')
    expect(progress.message).toContain('网络断了')
    expect(logDeps.logs).toContain('下载更新失败')
  })

  it('还没下好就点安装：拒绝（不许把半截更新装上去）', () => {
    const service = new UpdaterService(deps(fakeUpdater()))
    expect(() => service.install()).toThrow(/还没下载完成/)
  })

  it('updater 自己的 error 事件也会变成一条 error 进度', async () => {
    const updater = fakeUpdater()
    const service = new UpdaterService(deps(updater))
    const seen: UpdateProgress[] = []
    service.onProgress((progress) => seen.push(progress))

    await service.startDownload()
    emit(updater, 'error', new Error('sha512 校验不过'))

    expect(seen.at(-1)).toMatchObject({ state: 'error' })
    expect(seen.at(-1)?.message).toContain('sha512')
  })

  it('后订阅的界面能立刻拿到当前状态（刷新后不丢「已经下好了」）', async () => {
    const updater = fakeUpdater()
    const service = new UpdaterService(deps(updater))
    await service.startDownload()

    const seen: UpdateProgress[] = []
    service.onProgress((progress) => seen.push(progress))

    expect(seen).toHaveLength(1)
    expect(seen[0].state).toBe('ready')
  })
})
