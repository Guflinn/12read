export interface Throttler {
  /** 请求一次写入；节流窗口内只会真正写一次。 */
  schedule(): void
  /** 立刻写入（切章、失焦、退出前调用）。 */
  flush(): void
  cancel(): void
}

/**
 * 尾随节流：滚动时最多每 waitMs 落一次盘（TECH.md 6.3）。
 * 用 pending 标记而不是每次都重置计时器，保证持续滚动也会按时写入。
 */
export function createThrottle(waitMs: number, run: () => void): Throttler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  const fire = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    pending = false
    run()
  }

  return {
    schedule(): void {
      pending = true
      if (timer === null) timer = setTimeout(fire, waitMs)
    },
    flush(): void {
      fire()
    },
    cancel(): void {
      pending = false
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
