/**
 * 应用内更新（0.4.0）：检查 → 下载（带进度）→ 重启并安装。
 *
 * 走 `electron-updater`（2026-10-16 用户拍板），因为它能直接用打包时生成的
 * `latest.yml` 与 `.blockmap`：**差量更新**（平时只下几 MB，而不是整个 130MB 安装包），
 * 也能校验 sha512 与（有证书时的）签名。
 *
 * 三道前提，缺一条就走「去下载」（退回 0.1.5 的老路）：
 *   ① **必须是打包后的安装版** —— 开发环境没有 `app-update.yml`（由 electron-builder 按
 *      `publish` 配置生成），`checkForUpdates()` 直接报错；
 *   ② **免安装版（portable）不支持** —— 它是自解压到临时目录跑的，没有可替换的安装位置
 *      （electron-builder 会用 `PORTABLE_EXECUTABLE_DIR` 标记这种构建）；
 *   ③ 远端 Release 里得真有 `latest.yml` 与对的 exe（0.4.0 之前的 Release 没有，
 *      但那些版本的客户端里也还没有这个功能，所以不影响）。
 *
 * 依赖注入只为可测性：单测塞一个假的 updater 就能走完「开始下载 → 进度 → 就绪」，
 * 不需要真的 Electron、更不需要真的网络。
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateProgress } from '@shared/types'

/** electron-updater 里我们用到的那一小块（结构化类型，方便在单测里替身）。 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  logger: unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
  checkForUpdates(): Promise<{ updateInfo?: { version?: string } } | null | undefined>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdaterDeps {
  /** 这个构建能不能应用内更新（见文件头的三道前提）。 */
  available(): boolean
  /** 取 electron-updater 实例（已配好 autoDownload=false / allowPrerelease=true）。 */
  create(): AutoUpdaterLike
  /** 本机版本号，用来判断远端是不是真的更新。 */
  currentVersion(): string
  log(message: string, cause?: unknown): void
}

const UNSUPPORTED_MESSAGE = '这个版本不支持应用内更新（免安装版 / 开发环境），请用「去下载」自己换新版'

export class UpdaterService {
  private listener: ((progress: UpdateProgress) => void) | null = null
  private state: UpdateProgress | null = null
  private updater: AutoUpdaterLike | null = null
  private wired = false

  constructor(private readonly deps: UpdaterDeps) {}

  /** 界面订阅进度（只有一个界面，单播足够）。 */
  onProgress(listener: (progress: UpdateProgress) => void): void {
    this.listener = listener
    // 订阅时把当前状态补发一次：界面刷新后不该丢掉「已经下好了」这件事
    if (this.state !== null) listener(this.state)
  }

  available(): boolean {
    try {
      return this.deps.available()
    } catch {
      return false
    }
  }

  /** 当前状态（没开始过就是 null）。 */
  current(): UpdateProgress | null {
    return this.state
  }

  /**
   * 开始下载。返回「此刻的状态」；后续变化走 onProgress。
   * 已经在下载 / 已经下好时直接返回当前状态，不会重复下一次。
   */
  async startDownload(): Promise<UpdateProgress> {
    if (this.state !== null && (this.state.state === 'downloading' || this.state.state === 'ready')) {
      return this.state
    }
    if (!this.available()) return this.publish({ state: 'unsupported', percent: null, version: null, message: UNSUPPORTED_MESSAGE })

    const updater = this.instance()
    this.publish({ state: 'started', percent: null, version: null })

    let version: string | null = null
    try {
      const result = await updater.checkForUpdates()
      version = result?.updateInfo?.version ?? null
      if (version === null) {
        return this.publish({ state: 'error', percent: null, version: null, message: '没查到可用的更新' })
      }
      if (version === this.deps.currentVersion()) {
        return this.publish({ state: 'error', percent: null, version, message: '已经是最新版本了' })
      }
      await updater.downloadUpdate()
    } catch (cause) {
      this.deps.log('下载更新失败', cause)
      return this.publish({
        state: 'error',
        percent: null,
        version,
        message: '下载更新失败：' + describe(cause)
      })
    }

    return this.publish({ state: 'ready', percent: 100, version })
  }

  /** 重启并安装（已经下好才有意义）。 */
  install(): void {
    if (!this.available()) throw new Error(UNSUPPORTED_MESSAGE)
    if (this.state?.state !== 'ready') throw new Error('更新还没下载完成')
    this.instance().quitAndInstall()
  }

  /** 惰性建实例：不点更新就不碰 electron-updater，启动时零开销。 */
  private instance(): AutoUpdaterLike {
    if (this.updater === null) this.updater = this.deps.create()
    if (!this.wired) {
      const updater = this.updater
      updater.on('download-progress', (...args: unknown[]) => {
        const info = (args[0] ?? {}) as { percent?: unknown }
        const percent = typeof info.percent === 'number' && Number.isFinite(info.percent) ? Math.round(info.percent) : null
        this.publish({ state: 'downloading', percent, version: this.state?.version ?? null })
      })
      updater.on('update-downloaded', (...args: unknown[]) => {
        const info = (args[0] ?? {}) as { version?: unknown }
        const version = typeof info.version === 'string' ? info.version : (this.state?.version ?? null)
        this.publish({ state: 'ready', percent: 100, version })
      })
      updater.on('error', (cause: unknown) => {
        this.deps.log('更新出错', cause)
        this.publish({
          state: 'error',
          percent: null,
          version: this.state?.version ?? null,
          message: '更新出错：' + describe(cause)
        })
      })
      this.wired = true
    }
    return this.updater
  }

  private publish(progress: UpdateProgress): UpdateProgress {
    this.state = progress
    this.listener?.(progress)
    return progress
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return typeof cause === 'string' ? cause : String(cause)
}

/**
 * 生产环境的依赖：只在**打包后的安装版**上可用。
 * `allowPrerelease = true` 是必须的 —— 我们 0.x 阶段的 Release 一律勾 Pre-release，
 * 不打开这个开关，electron-updater 会把它们全部忽略掉。
 */
export function defaultUpdaterDeps(): UpdaterDeps {
  return {
    available: () => {
      if (!app.isPackaged) return false
      // 免安装版是自解压到临时目录跑的，没有可替换的安装位置
      return process.env['PORTABLE_EXECUTABLE_DIR'] === undefined
    },
    create: () => {
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      // 我们 0.x 阶段的 Release 一律勾 Pre-release，不开这个开关会被全部忽略
      autoUpdater.allowPrerelease = true
      autoUpdater.logger = null
      return autoUpdater as unknown as AutoUpdaterLike
    },
    currentVersion: () => app.getVersion(),
    log: (message, cause) => console.warn('[12read] ' + message, cause ?? '')
  }
}
