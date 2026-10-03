import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from '@/core/throttle'

afterEach(() => {
  vi.useRealTimers()
})

describe('createThrottle', () => {
  it('窗口内多次请求只写一次', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const throttler = createThrottle(500, run)

    throttler.schedule()
    throttler.schedule()
    throttler.schedule()
    vi.advanceTimersByTime(499)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('持续滚动不会饿死写入：每个窗口都会落一次', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const throttler = createThrottle(500, run)

    throttler.schedule()
    vi.advanceTimersByTime(500)
    throttler.schedule()
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('flush 立刻写入，没有待写内容时什么都不做', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const throttler = createThrottle(500, run)

    throttler.flush()
    expect(run).not.toHaveBeenCalled()

    throttler.schedule()
    throttler.flush()
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('cancel 丢弃待写内容', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const throttler = createThrottle(500, run)

    throttler.schedule()
    throttler.cancel()
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
  })
})
