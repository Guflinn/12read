import { describe, expect, it } from 'vitest'
import { STAT_IDLE_MS, STAT_REPORT_MS } from '@shared/core/stats'
import { createReadingClock, type ClockDeps } from '@/core/reading-clock'

interface Fake {
  deps: ClockDeps
  /** 时间往前走，但不触发定时器 */
  advance(ms: number): void
  /** 触发一次定时器回调 */
  fire(): void
  /** 模拟用户动作（键盘 / 指针 / 滚轮） */
  touch(): void
  setActive(on: boolean): void
  running(): boolean
  intervalMs(): number
  created(): number
  cleared(): number
}

/** 手写时钟：时间、可见性、定时器全在测试手里，不用等真实的 15 秒。 */
function makeFake(start = 1_000_000): Fake {
  let now = start
  let active = true
  let intervalId = 0
  let createdCount = 0
  let clearedCount = 0
  let handler: (() => void) | null = null
  let ms = 0
  let listeners: Array<() => void> = []
  return {
    deps: {
      now: () => now,
      active: () => active,
      onActivity: (fn) => {
        listeners.push(fn)
        return () => {
          listeners = listeners.filter((item) => item !== fn)
        }
      },
      setInterval: (fn, every): number => {
        handler = fn
        ms = every
        createdCount += 1
        intervalId += 1
        return intervalId
      },
      clearInterval: (): void => {
        clearedCount += 1
        handler = null
      }
    },
    advance: (step) => {
      now += step
    },
    fire: () => handler?.(),
    touch: () => {
      for (const fn of listeners) fn()
    },
    setActive: (on) => {
      active = on
    },
    running: () => handler !== null,
    intervalMs: () => ms,
    created: () => createdCount,
    cleared: () => clearedCount
  }
}

describe('createReadingClock', () => {
  it('按 15 秒的节拍注册，重复 start 只注册一次', () => {
    const fake = makeFake()
    const clock = createReadingClock(fake.deps, () => undefined)
    clock.start()
    clock.start()
    expect(fake.created()).toBe(1)
    expect(fake.intervalMs()).toBe(STAT_REPORT_MS)
    expect(fake.running()).toBe(true)
  })

  it('有活动又在看着，每拍记一段', () => {
    const fake = makeFake()
    const ticks: number[] = []
    const clock = createReadingClock(fake.deps, (report) => ticks.push(report))
    clock.start()
    fake.advance(STAT_REPORT_MS)
    fake.fire()
    fake.advance(STAT_REPORT_MS)
    fake.fire()
    expect(ticks).toEqual([STAT_REPORT_MS, STAT_REPORT_MS])
    clock.stop()
  })

  it('窗口不可见或者没有焦点就不计', () => {
    const fake = makeFake()
    const ticks: number[] = []
    const clock = createReadingClock(fake.deps, (report) => ticks.push(report))
    clock.start()
    fake.setActive(false)
    fake.advance(STAT_REPORT_MS)
    fake.fire()
    expect(ticks).toEqual([])
    fake.setActive(true)
    fake.advance(STAT_REPORT_MS)
    fake.fire()
    expect(ticks).toEqual([STAT_REPORT_MS])
    clock.stop()
  })

  it('超过 STAT_IDLE_MS 没有动作就不计，动一下又接着计', () => {
    const fake = makeFake()
    const ticks: number[] = []
    const clock = createReadingClock(fake.deps, (report) => ticks.push(report))
    clock.start()
    fake.advance(STAT_IDLE_MS + 1)
    fake.fire()
    expect(ticks).toEqual([])
    fake.touch()
    fake.advance(STAT_REPORT_MS)
    fake.fire()
    expect(ticks).toEqual([STAT_REPORT_MS])
    clock.stop()
  })

  it('刚好 STAT_IDLE_MS 还算在读', () => {
    const fake = makeFake()
    const ticks: number[] = []
    const clock = createReadingClock(fake.deps, (report) => ticks.push(report))
    clock.start()
    fake.advance(STAT_IDLE_MS)
    fake.fire()
    expect(ticks).toEqual([STAT_REPORT_MS])
    clock.stop()
  })

  it('stop 清掉定时器与活动订阅，再 start 还能继续计', () => {
    const fake = makeFake()
    const ticks: number[] = []
    const clock = createReadingClock(fake.deps, (report) => ticks.push(report))
    clock.start()
    clock.stop()
    expect(fake.cleared()).toBe(1)
    expect(fake.running()).toBe(false)
    clock.stop()
    expect(fake.cleared()).toBe(1)
    // 停了以后活动监听已经退订：touch 不该再找回来什么
    fake.touch()
    fake.advance(STAT_REPORT_MS)
    fake.fire()
    expect(ticks).toEqual([])
    clock.start()
    expect(fake.created()).toBe(2)
    fake.advance(STAT_REPORT_MS)
    fake.fire()
    expect(ticks).toEqual([STAT_REPORT_MS])
    clock.stop()
  })
})
