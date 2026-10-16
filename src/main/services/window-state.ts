import { parseWindowState, type WindowState } from '@shared/core/window-bounds'
import type { MetaRepository } from '../db/meta-repository'

const WINDOW_STATE_KEY = 'window_state'

/** 写窗口状态的结果：正常存下 / 跳过（书库已经关了）/ 失败（吞掉，只记账）。 */
export type WindowStateWriteResult = 'saved' | 'skipped' | 'failed'

/**
 * 窗口尺寸 / 位置存在 meta 表里 —— 与阅读设置同一张表、同一套机制，
 * 不新增数据文件（MVP.md 第 10 节「已排期：0.1.4」）。
 *
 * **写入必须 fail-soft**（0.4.0 修的坑）：这件事发生在 `BrowserWindow` 的 `close` 回调里，
 * 而还原备份会把数据库连接提前关掉（换完库文件就重启），于是关窗时那句 `prepare()`
 * 会抛 `The database connection is not open` —— 异常出在 Electron 的事件回调里，
 * 结果是弹「A JavaScript error occurred in the main process」，而且**把退出流程卡住**，
 * 用户点掉再关又弹一次。窗口记忆只是个顺手的便利，绝不能因为它不让人关窗：
 * 连接没了就跳过（return 'skipped'），真出别的错也吞掉（return 'failed'）。
 */
export class WindowStateStore {
  constructor(
    private readonly meta: MetaRepository,
    /** 书库连接还开着吗（默认当作开着，方便单测与老调用方）。 */
    private readonly isLibraryOpen: () => boolean = () => true,
    /** 出错时的记账口子（默认写控制台）。 */
    private readonly log: (message: string, cause?: unknown) => void = (message, cause) =>
      console.warn('[12read] ' + message, cause ?? '')
  ) {}

  /** 没存过或存的形状不对时返回 null，由调用方走默认尺寸。 */
  get(): WindowState | null {
    const raw = this.meta.get(WINDOW_STATE_KEY)
    if (!raw) return null
    try {
      return parseWindowState(JSON.parse(raw))
    } catch {
      // 坏数据当作没存过：窗口宁可回到默认尺寸，也不能因为一条脏记录开不出来。
      return null
    }
  }

  /** 存一份窗口状态；永不抛异常（见类注释）。 */
  set(state: WindowState): WindowStateWriteResult {
    if (!this.isLibraryOpen()) return 'skipped'
    try {
      this.meta.set(WINDOW_STATE_KEY, JSON.stringify(state))
      return 'saved'
    } catch (cause) {
      this.log('窗口状态没能存下来（不影响使用）', cause)
      return 'failed'
    }
  }
}

/** 只声明窗口需要的两个能力，单测可以传个假对象，不必起 Electron。 */
export interface WindowLike {
  getNormalBounds(): { x: number; y: number; width: number; height: number }
  isMaximized(): boolean
}

/**
 * 关窗前抓一份当前状态。
 * 用 `getNormalBounds()` 而不是 `getBounds()`：最大化时后者给的是铺满屏幕的尺寸，
 * 存下来就丢掉「还原之后该多大」了。
 */
export function captureWindowState(win: WindowLike): WindowState {
  return { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
}
