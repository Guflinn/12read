import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNewerVersion, parseVersion, versionFromTag } from '@shared/core/update'
import { defaultUpdateDeps, UpdateService, type UpdateCheckDeps } from '@main/services/update'

/**
 * 检查更新（0.1.5）的单测。
 *
 * 更新提示最怕误报（白下一次）和静默失灵，所以这里把三类边界都钉住：
 * 版本号比较、远端响应畸形的各种样子、以及「任何失败都不许抛出」。
 */
const openExternal = vi.fn(async (_url: unknown): Promise<void> => undefined)
const netFetch = vi.fn()

vi.mock('electron', () => ({
  app: { getVersion: (): string => '0.1.5' },
  // 显式列出参数：单测里不需要 electron 的真实签名，但展开参数会让 tsc 报 tuple 错
  net: { fetch: (url: unknown, init?: unknown): unknown => netFetch(url, init) },
  shell: { openExternal: (url: unknown): unknown => openExternal(url) }
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function makeDeps(
  payload: unknown,
  current = '0.1.5'
): { deps: UpdateCheckDeps; fetchJson: ReturnType<typeof vi.fn> } {
  const fetchJson = vi.fn(async (): Promise<unknown> => payload)
  return {
    fetchJson,
    deps: {
      currentVersion: () => current,
      fetchJson,
      openExternal: async () => undefined
    }
  }
}

function release(version: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v' + version,
    html_url: 'https://github.com/Guflinn/12read/releases/tag/v' + version,
    published_at: '2026-10-07T04:00:00Z',
    ...extra
  }
}

describe('parseVersion', () => {
  it('吃 v 前缀、两段与三段、后缀', () => {
    expect(parseVersion('v0.1.5')).toEqual([0, 1, 5])
    expect(parseVersion('0.1.5')).toEqual([0, 1, 5])
    expect(parseVersion('1')).toEqual([1])
    expect(parseVersion('0.1.5-beta.1')).toEqual([0, 1, 5])
    expect(parseVersion('  v0.2  ')).toEqual([0, 2])
  })

  it('认不出来的一律给 null', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('v')).toBeNull()
    expect(parseVersion('abc')).toBeNull()
    expect(parseVersion('0.x.5')).toBeNull()
    expect(parseVersion('0.1.5.')).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('按数字段比较，不是按字符串', () => {
    expect(isNewerVersion('0.1.5', '0.1.6')).toBe(true)
    expect(isNewerVersion('0.1.5', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.1.5', '1.0.0')).toBe(true)
    // 字符串比较会把 '0.1.10' 判成比 '0.1.9' 小，这里必须为真
    expect(isNewerVersion('0.1.9', '0.1.10')).toBe(true)
    expect(isNewerVersion('0.9.9', '0.10.0')).toBe(true)
  })

  it('相等 / 更旧 / 段数不同都判为「不是新版」', () => {
    expect(isNewerVersion('0.1.5', '0.1.5')).toBe(false)
    expect(isNewerVersion('0.1.5', 'v0.1.5')).toBe(false)
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false)
    expect(isNewerVersion('0.1', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.1.5', '0.1')).toBe(false)
  })

  it('任一边解析不出来都判 false（宁可漏报也别误报）', () => {
    expect(isNewerVersion('0.1.5', '不是版本号')).toBe(false)
    expect(isNewerVersion('', '0.2.0')).toBe(false)
  })
})

describe('versionFromTag', () => {
  it('取出版本号；取不出来给空串', () => {
    expect(versionFromTag('v0.1.6')).toBe('0.1.6')
    expect(versionFromTag('0.2')).toBe('0.2')
    expect(versionFromTag('release-1')).toBe('')
  })
})

describe('UpdateService.check', () => {
  it('远端更新 → outcome=update，带版本号与下载页', async () => {
    const { deps } = makeDeps([release('0.1.6')])
    expect(await new UpdateService(deps).check()).toEqual({
      outcome: 'update',
      info: {
        version: '0.1.6',
        url: 'https://github.com/Guflinn/12read/releases/tag/v0.1.6',
        publishedAt: '2026-10-07T04:00:00Z'
      }
    })
  })

  it('同版本 / 更旧的远端版本 → latest（不提示）', async () => {
    expect((await new UpdateService(makeDeps([release('0.1.5')]).deps).check()).outcome).toBe('latest')
    expect((await new UpdateService(makeDeps([release('0.1.4')]).deps).check()).outcome).toBe('latest')
  })

  it('published_at 缺失时用 created_at 兜底，都没有就是 null', async () => {
    const withCreated = makeDeps([
      release('0.1.6', { published_at: undefined, created_at: '2026-10-06T00:00:00Z' })
    ])
    expect((await new UpdateService(withCreated.deps).check()).info?.publishedAt).toBe(
      '2026-10-06T00:00:00Z'
    )

    const withNothing = makeDeps([
      release('0.1.6', { published_at: undefined, created_at: undefined })
    ])
    expect((await new UpdateService(withNothing.deps).check()).info?.publishedAt).toBeNull()
  })

  it('远端只给一个对象（不是数组）也认', async () => {
    const { deps } = makeDeps(release('0.2.0'))
    expect((await new UpdateService(deps).check()).info?.version).toBe('0.2.0')
  })

  it('网络失败 / 响应畸形 / 空列表 → 一律 failed，且不抛异常', async () => {
    const boom = makeDeps(null)
    boom.fetchJson.mockRejectedValueOnce(new Error('没网'))
    expect((await new UpdateService(boom.deps).check()).outcome).toBe('failed')

    for (const payload of [null, {}, [], 'nope', [{}], [release('x')], [{ tag_name: 'v0.2.0' }]]) {
      const { deps } = makeDeps(payload)
      expect((await new UpdateService(deps).check()).outcome).toBe('failed')
    }
  })

  it('超时也算 failed（不能一直挂着）', async () => {
    vi.useFakeTimers()
    const fetchJson = vi.fn((): Promise<unknown> => new Promise(() => undefined))
    const service = new UpdateService({
      currentVersion: () => '0.1.5',
      fetchJson,
      openExternal: async () => undefined
    })
    const pending = service.check()
    await vi.advanceTimersByTimeAsync(11_000)
    expect((await pending).outcome).toBe('failed')
  })
})

describe('UpdateService.open', () => {
  it('只放 github 的 https 链接过去，别的忽略', async () => {
    const urls: string[] = []
    const service = new UpdateService({
      currentVersion: () => '0.1.5',
      fetchJson: async () => [],
      openExternal: async (url) => {
        urls.push(url)
      }
    })
    await service.open('https://github.com/Guflinn/12read/releases/tag/v0.1.6')
    await service.open('http://github.com/Guflinn/12read')
    await service.open('https://example.com/evil')
    expect(urls).toEqual(['https://github.com/Guflinn/12read/releases/tag/v0.1.6'])
  })
})

describe('defaultUpdateDeps', () => {
  it('版本取 app.getVersion、抓取走 net.fetch、外链走 shell', async () => {
    const deps = defaultUpdateDeps()
    expect(deps.currentVersion()).toBe('0.1.5')

    netFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ tag_name: 'v0.1.6' }] })
    expect(await deps.fetchJson('https://api.github.com/x')).toEqual([{ tag_name: 'v0.1.6' }])
    expect(String(netFetch.mock.calls[0]?.[0])).toBe('https://api.github.com/x')

    netFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
    await expect(deps.fetchJson('https://api.github.com/y')).rejects.toThrow('HTTP 403')

    await deps.openExternal('https://github.com/Guflinn/12read/releases')
    expect(openExternal).toHaveBeenCalledWith('https://github.com/Guflinn/12read/releases')
  })
})
