import { app, net, shell } from 'electron'
import { isNewerVersion, versionFromTag } from '@shared/core/update'
import type { UpdateCheckResult } from '@shared/types'

/** GitHub API 要求带 User-Agent，否则 403。 */
const HEADERS = {
  accept: 'application/vnd.github+json',
  'user-agent': '12read-update-check'
}

/**
 * 默认的更新源：仓库的 Releases 列表（**`per_page=1` 取最新一条**）。
 *
 * 为什么不用 `/releases/latest`：那个接口**只认非 Pre-release**，而我们的发布一律勾
 * Pre-release（内测版），拿它会 404。用列表接口按创建时间倒序取第一条最稳。
 * 环境变量 `TWELVE_READ_UPDATE_FEED` 可以整体换掉这个地址（换成国内源 / 测试用）。
 */
const DEFAULT_FEED =
  process.env['TWELVE_READ_UPDATE_FEED'] ??
  'https://api.github.com/repos/Guflinn/12read/releases?per_page=1'

/** 检查更新的最慢等待：超时当作「这次没查到」，绝不拖着界面。 */
const TIMEOUT_MS = 10_000

export interface UpdateCheckDeps {
  /** 本机版本，默认取 app.getVersion()。 */
  currentVersion(): string
  /** 拉远端列表；注入是为了单测里不碰网络。 */
  fetchJson(url: string): Promise<unknown>
  /** 打开外链（下载页），默认交给系统浏览器。 */
  openExternal(url: string): Promise<void>
}

export function defaultUpdateDeps(): UpdateCheckDeps {
  return {
    currentVersion: () => app.getVersion(),
    fetchJson: async (url: string) => {
      // 走 Electron 自己的网络栈（Chromium）：它会自动跟系统代理走，
      // 所以用户开着代理工具时不用在这个应用里再配一遍（0.1.5 实测）。
      const response = await net.fetch(url, { headers: HEADERS })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return (await response.json()) as unknown
    },
    openExternal: (url: string) => shell.openExternal(url)
  }
}

/**
 * 检查更新（0.1.5）：**只提示，不下载、不安装**。
 *
 * 故意做得很小：一次 GET、比一下版本号、把「有没有新版 + 下载页地址」交给界面。
 * 任何一步出问题都返回 null（失败静默）—— 检查更新失败绝不是用户需要处理的事，
 * 尤其在没有代理、连不上 GitHub 的网络里。
 */
export class UpdateService {
  constructor(private readonly deps: UpdateCheckDeps = defaultUpdateDeps()) {}

  /**
   * 查一次远端。三态结果：
   * `update` 有新版本 / `latest` 已是最新 / `failed` 网络不通或响应看不懂。
   * 自动检查只认第一种；手动检查时三种都要给用户一句准话。
   */
  async check(): Promise<UpdateCheckResult> {
    let payload: unknown
    try {
      payload = await withTimeout(this.deps.fetchJson(DEFAULT_FEED), TIMEOUT_MS)
    } catch {
      return { outcome: 'failed', info: null }
    }

    const release = firstRelease(payload)
    if (!release) return { outcome: 'failed', info: null }

    const tag = typeof release['tag_name'] === 'string' ? release['tag_name'] : ''
    const version = versionFromTag(tag)
    const url = typeof release['html_url'] === 'string' ? release['html_url'] : ''
    if (version === '' || url === '') return { outcome: 'failed', info: null }
    if (!isNewerVersion(this.deps.currentVersion(), version)) {
      return { outcome: 'latest', info: null }
    }

    return {
      outcome: 'update',
      info: { version, url, publishedAt: readPublished(release) }
    }
  }

  /**
   * 打开下载页。地址虽然只可能是 `check()` 自己算出来的，这里仍然再验一次域名 ——
   * schema 那层只挡渲染层传来的形状，主进程这层是最后一道闸：
   * 这个应用平时不开任何外链，唯一放行的一条必须死死限定在 GitHub 上（TECH.md 4.2）。
   */
  async open(url: string): Promise<void> {
    if (!url.startsWith('https://github.com/')) return
    await this.deps.openExternal(url)
  }
}

function readPublished(release: Record<string, unknown>): string | null {
  const value = release['published_at'] ?? release['created_at']
  return typeof value === 'string' ? value : null
}

/** 列表接口取第一条；万一远端给了单个对象（换成别的源时）也认。 */
function firstRelease(payload: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(payload) ? payload[0] : payload
  if (typeof candidate !== 'object' || candidate === null) return null
  return candidate as Record<string, unknown>
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('检查更新超时')), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause: unknown) => {
        clearTimeout(timer)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    )
  })
}
