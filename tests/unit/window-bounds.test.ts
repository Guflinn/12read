import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  parseWindowState,
  resolveWindowBounds,
  type DisplayWorkArea,
  type WindowState
} from '@shared/core/window-bounds'

/** 一块 1920×1080 的主屏（工作区已扣任务栏，这里从简）。 */
const MAIN: DisplayWorkArea = { x: 0, y: 0, width: 1920, height: 1080 }
/** 右侧第二块屏，坐标从 1920 起 —— 用来验「窗口在副屏上不算屏幕外」。 */
const SECOND: DisplayWorkArea = { x: 1920, y: 0, width: 1920, height: 1080 }

function state(patch: Partial<WindowState['bounds']> = {}, maximized = false): WindowState {
  return { bounds: { x: 100, y: 80, width: 1180, height: 800, ...patch }, maximized }
}

describe('parseWindowState', () => {
  it('形状正确时解析出 bounds 与 maximized', () => {
    const raw = { bounds: { x: 10, y: 20, width: 1200, height: 900 }, maximized: true }
    expect(parseWindowState(raw)).toEqual({
      bounds: { x: 10, y: 20, width: 1200, height: 900 },
      maximized: true
    })
  })

  it('maximized 只认布尔 true，别的值一律当 false', () => {
    const base = { bounds: { x: 0, y: 0, width: 800, height: 600 } }
    expect(parseWindowState({ ...base, maximized: 'yes' })?.maximized).toBe(false)
    expect(parseWindowState({ ...base })?.maximized).toBe(false)
    expect(parseWindowState({ ...base, maximized: 1 })?.maximized).toBe(false)
  })

  it('不是对象 / 缺 bounds / 字段类型不对 一律返回 null', () => {
    expect(parseWindowState(null)).toBeNull()
    expect(parseWindowState('window')).toBeNull()
    expect(parseWindowState(42)).toBeNull()
    expect(parseWindowState([])).toBeNull()
    expect(parseWindowState({})).toBeNull()
    expect(parseWindowState({ bounds: null })).toBeNull()
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 800 } })).toBeNull()
    expect(parseWindowState({ bounds: { x: '0', y: 0, width: 800, height: 600 } })).toBeNull()
    expect(parseWindowState({ bounds: { x: NaN, y: 0, width: 800, height: 600 } })).toBeNull()
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: Infinity, height: 600 } })).toBeNull()
  })

  it('宽或高不是正数时返回 null', () => {
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 0, height: 600 } })).toBeNull()
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 800, height: -10 } })).toBeNull()
  })
})

describe('resolveWindowBounds', () => {
  it('没存过：默认尺寸、不指定位置（交给系统居中）', () => {
    expect(resolveWindowBounds(null, [MAIN])).toEqual({
      bounds: { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
      maximized: false
    })
  })

  it('存过且位置还在屏内：原位恢复', () => {
    expect(resolveWindowBounds(state(), [MAIN])).toEqual({
      bounds: { x: 100, y: 80, width: 1180, height: 800 },
      maximized: false
    })
  })

  it('窗口在副屏上：算屏内，原位恢复（不能误判成屏幕外）', () => {
    const saved = state({ x: 2000, y: 60 })
    expect(resolveWindowBounds(saved, [MAIN, SECOND]).bounds).toEqual({
      x: 2000,
      y: 60,
      width: 1180,
      height: 800
    })
  })

  it('坐标落在所有屏幕之外（外接屏拔了）：丢位置、保尺寸、交给系统居中', () => {
    const saved = state({ x: 3000, y: 200 })
    expect(resolveWindowBounds(saved, [MAIN])).toEqual({
      bounds: { width: 1180, height: 800 },
      maximized: false
    })
  })

  it('只剩一条边露在屏内、重叠不足：也当屏幕外处理', () => {
    const saved = state({ x: 1900, y: 100 }) // 只有 20px 在屏内，抓不住标题栏
    expect(resolveWindowBounds(saved, [MAIN]).bounds).toEqual({ width: 1180, height: 800 })
  })

  it('标题栏被顶到屏幕上边之外：丢位置（否则拖不回来）', () => {
    const saved = state({ x: 200, y: -300 })
    expect(resolveWindowBounds(saved, [MAIN]).bounds).toEqual({ width: 1180, height: 800 })
  })

  it('标题栏只超出一点点（容差内）：仍然原位恢复', () => {
    const saved = state({ x: 200, y: -5 })
    expect(resolveWindowBounds(saved, [MAIN]).bounds).toEqual({
      x: 200,
      y: -5,
      width: 1180,
      height: 800
    })
  })

  it('尺寸小于最小：夹到最小尺寸', () => {
    const saved = state({ width: 400, height: 300 })
    expect(resolveWindowBounds(saved, [MAIN]).bounds).toEqual({
      x: 100,
      y: 80,
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT
    })
  })

  it('尺寸大于最大屏：夹到那块屏的尺寸', () => {
    const saved = state({ x: 0, y: 0, width: 3000, height: 2000 })
    expect(resolveWindowBounds(saved, [MAIN]).bounds).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('夹取上限取最大的一块屏（多屏时别被小屏压扁）', () => {
    const saved = state({ width: 2500, height: 1400, x: 0, y: 0 })
    const bigger: DisplayWorkArea = { x: 0, y: 0, width: 3840, height: 2160 }
    expect(resolveWindowBounds(saved, [MAIN, bigger]).bounds).toEqual({
      x: 0,
      y: 0,
      width: 2500,
      height: 1400
    })
  })

  it('最大化状态在原位恢复与回退两条路上都保留', () => {
    expect(resolveWindowBounds(state({}, true), [MAIN]).maximized).toBe(true)
    expect(resolveWindowBounds(state({ x: 9000 }, true), [MAIN]).maximized).toBe(true)
  })

  it('拿不到屏幕信息时：尺寸回默认，最大化仍保留', () => {
    expect(resolveWindowBounds(state({}, true), [])).toEqual({
      bounds: { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
      maximized: true
    })
  })
})
