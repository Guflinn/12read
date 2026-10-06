import { parseWindowState, type WindowState } from '@shared/core/window-bounds'
import type { MetaRepository } from '../db/meta-repository'

const WINDOW_STATE_KEY = 'window_state'

/**
 * 窗口尺寸 / 位置存在 meta 表里 —— 与阅读设置同一张表、同一套机制，
 * 不新增数据文件（MVP.md 第 10 节「已排期：0.1.4」）。
 */
export class WindowStateStore {
  constructor(private readonly meta: MetaRepository) {}

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

  set(state: WindowState): void {
    this.meta.set(WINDOW_STATE_KEY, JSON.stringify(state))
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
