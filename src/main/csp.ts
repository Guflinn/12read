import { session } from 'electron'

/**
 * 生产环境的硬性 CSP（TECH.md 4.2）。
 * dev 下 Vite 需要 ws 与 inline 脚本，不能套用同一份策略。
 */
export const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export function installCsp(isDev: boolean): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PROD_CSP]
      }
    })
  })
}
