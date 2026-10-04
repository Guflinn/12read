import { STAT_IDLE_MS, STAT_REPORT_MS } from '@shared/core/stats'

/** 时钟要用的外部世界：全部注入，node 里也能直接测（tests/unit/reading-clock.test.ts）。 */
export interface ClockDeps {
  now(): number
  /** 窗口可见且有焦点才算在读。 */
  active(): boolean
  /** 订阅用户动作（键盘 / 指针 / 滚轮），返回取消订阅函数。 */
  onActivity(handler: () => void): () => void
  setInterval(handler: () => void, ms: number): number
  clearInterval(handle: number): void
}

export interface ReadingClock {
  start(): void
  stop(): void
}

/**
 * 阅读计时（0.1.3 第 8 项）：每 STAT_REPORT_MS 问一次「刚才这段算不算在读」，
 * 算就把这一段时长交给 onTick。窗口藏起来，或者 STAT_IDLE_MS 内没有任何动作
 * （去倒水、睡着、挂机），这一段就不计。真正落库由调用方在 onTick 里做。
 */
export function createReadingClock(deps: ClockDeps, onTick: (ms: number) => void): ReadingClock {
  let handle: number | null = null
  let lastActivity = 0
  let offActivity: (() => void) | null = null

  return {
    start(): void {
      if (handle !== null) return
      lastActivity = deps.now()
      offActivity = deps.onActivity(() => {
        lastActivity = deps.now()
      })
      handle = deps.setInterval(() => {
        if (!deps.active()) return
        if (deps.now() - lastActivity > STAT_IDLE_MS) return
        onTick(STAT_REPORT_MS)
      }, STAT_REPORT_MS)
    },
    stop(): void {
      if (handle !== null) deps.clearInterval(handle)
      handle = null
      if (offActivity) offActivity()
      offActivity = null
    }
  }
}

interface BrowserGlobals {
  document?: { visibilityState: string; hasFocus(): boolean }
  window?: {
    addEventListener(name: string, handler: () => void, options?: { passive: boolean }): void
    removeEventListener(name: string, handler: () => void): void
    setInterval(handler: () => void, ms: number): number
    clearInterval(handle: number): void
  }
}

interface TimerGlobals {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

/**
 * 浏览器里的默认依赖。这里刻意不写 document / window 的字面量类型：
 * tests/unit 会间接 import 这个文件，而 tsconfig.node.json 的 lib 里没有 DOM。
 */
export function browserClockDeps(): ClockDeps {
  const globals = globalThis as BrowserGlobals
  const timers = (): TimerGlobals => globalThis as unknown as TimerGlobals
  return {
    now: () => Date.now(),
    active: () => {
      const doc = globals.document
      if (!doc) return true
      return doc.visibilityState === 'visible' && doc.hasFocus()
    },
    onActivity: (handler) => {
      const win = globals.window
      if (!win) return () => undefined
      const events = ['keydown', 'pointerdown', 'wheel']
      for (const name of events) win.addEventListener(name, handler, { passive: true })
      return () => {
        for (const name of events) win.removeEventListener(name, handler)
      }
    },
    setInterval: (handler, ms) => {
      const win = globals.window
      if (win) return win.setInterval(handler, ms)
      return timers().setInterval(handler, ms) as number
    },
    clearInterval: (handle) => {
      const win = globals.window
      if (win) {
        win.clearInterval(handle)
        return
      }
      timers().clearInterval(handle)
    }
  }
}
