import { beforeEach, describe, expect, it, vi } from 'vitest'

const { onHeadersReceived } = vi.hoisted(() => ({ onHeadersReceived: vi.fn() }))

vi.mock('electron', () => ({
  session: { defaultSession: { webRequest: { onHeadersReceived } } }
}))

import { PROD_CSP, installCsp } from '@main/csp'

type HeadersCallback = (result: { responseHeaders: Record<string, string[]> }) => void
type HeadersHandler = (
  details: { responseHeaders?: Record<string, string[]> },
  callback: HeadersCallback
) => void

describe('生产环境 CSP（TECH.md 4.2）', () => {
  beforeEach(() => {
    onHeadersReceived.mockReset()
  })

  it('dev 下不套用生产策略（Vite 需要 ws 与 inline 脚本）', () => {
    installCsp(true)
    expect(onHeadersReceived).not.toHaveBeenCalled()
  })

  it('装到 defaultSession 上，并保留原有响应头', () => {
    installCsp(false)
    expect(onHeadersReceived).toHaveBeenCalledTimes(1)
    const handler = onHeadersReceived.mock.calls[0]?.[0] as unknown as HeadersHandler
    expect(typeof handler).toBe('function')

    let seen: { responseHeaders: Record<string, string[]> } | null = null
    handler({ responseHeaders: { 'X-Trace': ['abc'] } }, (result) => {
      seen = result
    })

    const headers = seen as unknown as { responseHeaders: Record<string, string[]> }
    expect(headers.responseHeaders['Content-Security-Policy']).toEqual([PROD_CSP])
    expect(headers.responseHeaders['X-Trace']).toEqual(['abc'])
  })

  it('缺 responseHeaders 时也能给出策略（details 是 Electron 给的对象，不保证有该字段）', () => {
    installCsp(false)
    const handler = onHeadersReceived.mock.calls[0]?.[0] as unknown as HeadersHandler
    let seen: { responseHeaders: Record<string, string[]> } | null = null
    handler({}, (result) => {
      seen = result
    })
    const headers = seen as unknown as { responseHeaders: Record<string, string[]> }
    expect(headers.responseHeaders['Content-Security-Policy']).toEqual([PROD_CSP])
  })

  it('关键指令：只信自己、不许联网、不许 eval / object / form 外发', () => {
    expect(PROD_CSP).toContain("default-src 'self'")
    expect(PROD_CSP).toContain("script-src 'self'")
    expect(PROD_CSP).toContain("connect-src 'none'")
    expect(PROD_CSP).toContain("object-src 'none'")
    expect(PROD_CSP).toContain("form-action 'none'")
    expect(PROD_CSP).toContain("base-uri 'none'")
    // 阅读器要允许内联样式（字号/主题走 CSS 变量），但不允许 http(s) 远程资源
    expect(PROD_CSP).toContain("style-src 'self' 'unsafe-inline'")
    expect(PROD_CSP).not.toContain('unsafe-eval')
    expect(PROD_CSP).not.toContain('http')
  })
})
