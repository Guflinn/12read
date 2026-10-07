/**
 * 「检查更新」的纯逻辑（0.1.5）。
 *
 * 只做一件事：把「本机版本」和「远端最新 Release 的 tag」比大小。
 * 网络、GitHub API、打开下载页都在主进程的 `UpdateService` 里，
 * 这里保持纯函数是为了把边界情况（v 前缀、两段/四段版本号、乱字符、相等）
 * 全部钉在单测里 —— 更新提示一旦误报，比没有这个功能还烦人。
 */

/** 'v0.1.5' / '0.1.5' / '0.1.5-beta.1' → [0, 1, 5]；解析不出来返回 null。 */
export function parseVersion(value: string): number[] | null {
  const cleaned = value.trim().replace(/^[vV]/, '')
  // 只取开头那段数字与点：后面的 -beta.1 / +build 之类不参与比较
  const head = cleaned.split(/[-+]/)[0] ?? ''
  if (!head) return null
  const parts = head.split('.')
  const numbers: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    numbers.push(Number(part))
  }
  return numbers.length > 0 ? numbers : null
}

/**
 * 远端是不是比本机新。相等、更旧、任何一边解析不出来都返回 false
 * —— 宁可漏报也不要误报（误报会让人白下载一次）。
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parseVersion(current)
  const b = parseVersion(latest)
  if (!a || !b) return false
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (right > left) return true
    if (right < left) return false
  }
  return false
}

/** 从 Release 的 tag 名取出版本号：'v0.1.5' → '0.1.5'；取不出来返回空串。 */
export function versionFromTag(tag: string): string {
  const parsed = parseVersion(tag)
  return parsed ? parsed.join('.') : ''
}
