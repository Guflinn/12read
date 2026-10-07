import { session } from 'electron'

/**
 * 生产环境的硬性 CSP（TECH.md 4.2）。
 * dev 下 Vite 需要 ws 与 inline 脚本，不能套用同一份策略。
 */
export const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 内联图片走自定义协议（0.2.0）：reader-image://<bookId>/<文件>，只放行这一条
  "img-src 'self' data: reader-image:",
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
