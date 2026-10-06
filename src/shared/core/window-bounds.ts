/**
 * 窗口尺寸 / 位置的记忆与恢复（0.1.4）。
 *
 * 纯函数：**不 import Electron**。屏幕信息由调用方（main 侧的
 * `screen.getAllDisplays()`）以「工作区矩形数组」的形式传进来 —— 这样
 * 「外接显示器拔掉后存的坐标落在屏幕外」这类场景可以在单测里直接构造，
 * 不必真的插拔显示器（MVP.md 第 10 节「已排期：0.1.4」）。
 */

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  bounds: WindowBounds
  /** 关窗时是否处于最大化。 */
  maximized: boolean
}

/** 某块屏幕的工作区（Electron 的 `display.workArea`，已扣掉任务栏）。 */
export type DisplayWorkArea = WindowBounds

export const DEFAULT_WINDOW_WIDTH = 1180
export const DEFAULT_WINDOW_HEIGHT = 800
/** 必须与 window.ts 传给 BrowserWindow 的 minWidth / minHeight 一致。 */
export const MIN_WINDOW_WIDTH = 760
export const MIN_WINDOW_HEIGHT = 540

/**
 * 恢复时要求窗口与某块屏幕至少有这么大的重叠，否则算「落在屏幕外」。
 * 宽度取 120 是因为要让标题栏上的按钮还点得到；高度取 40 差不多是一个标题栏。
 */
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 40

/** 标题栏允许超出屏幕上边一点点，但不能整条被顶到屏幕外面（那样拖不回来）。 */
const TITLE_BAR_TOLERANCE = 8

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 解析存下来的窗口状态。meta 表里的 JSON 不信任：形状不对就当作没存过，
 * 绝不让一条坏数据把窗口搞到看不见（与 `SettingsStore.get()` 同一个态度）。
 */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const outer = raw as Record<string, unknown>
  const inner = outer['bounds']
  if (typeof inner !== 'object' || inner === null) return null
  const bounds = inner as Record<string, unknown>
  const { x, y, width, height } = bounds
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0) return null
  return { bounds: { x, y, width, height }, maximized: outer['maximized'] === true }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** 窗口是不是「这块屏幕用得上」：重叠够多，且标题栏没被顶到屏幕上边之外。 */
function isUsableOn(bounds: WindowBounds, area: DisplayWorkArea): boolean {
  const overlapWidth =
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  const overlapHeight =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  if (overlapWidth < MIN_VISIBLE_WIDTH || overlapHeight < MIN_VISIBLE_HEIGHT) return false
  return bounds.y >= area.y - TITLE_BAR_TOLERANCE
}

export interface ResolvedWindow {
  /**
   * 交给 BrowserWindow 的尺寸与位置。`x` / `y` 缺省表示不指定位置，
   * 由系统居中 —— 首次启动与「坐标失效回退」两种情况都走这里。
   */
  bounds: { x?: number; y?: number; width: number; height: number }
  maximized: boolean
}

function defaultResolved(maximized: boolean): ResolvedWindow {
  return {
    bounds: { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
    maximized
  }
}

/**
 * 决定这次开窗口用多大、放哪儿：
 *
 * 1. 没存过 / 存的数据坏了 → 默认尺寸，位置交给系统（居中）。
 * 2. 存过、位置也还在某块屏幕的可视范围内 → 原位恢复。
 * 3. 存过但坐标已失效（外接屏拔了、分辨率变小）→ 保留尺寸、位置交给系统居中，
 *    否则会出现「窗口打开了但看不见」。
 *
 * 尺寸一律夹到 [最小尺寸, 最大屏幕]：换了小屏之后，旧窗口不该比屏幕还大。
 */
export function resolveWindowBounds(
  state: WindowState | null,
  displays: DisplayWorkArea[]
): ResolvedWindow {
  if (!state) return defaultResolved(false)

  // 拿不到屏幕信息（理论上 Electron 至少给一块）就没法判定位置，只保尺寸与最大化。
  if (displays.length === 0) {
    return defaultResolved(state.maximized)
  }

  const biggest = displays.reduce((a, b) =>
    b.width * b.height > a.width * a.height ? b : a
  )
  const width = clamp(state.bounds.width, MIN_WINDOW_WIDTH, biggest.width)
  const height = clamp(state.bounds.height, MIN_WINDOW_HEIGHT, biggest.height)
  const candidate: WindowBounds = { x: state.bounds.x, y: state.bounds.y, width, height }

  if (!displays.some((area) => isUsableOn(candidate, area))) {
    return { bounds: { width, height }, maximized: state.maximized }
  }
  return { bounds: candidate, maximized: state.maximized }
}
