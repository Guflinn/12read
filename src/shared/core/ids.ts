/** bookId 一律 uuid v4（TECH.md 4.2）：它同时是磁盘目录名，必须先校验再拼路径。 */
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isSafeBookId(id: unknown): id is string {
  return typeof id === 'string' && UUID_V4_RE.test(id)
}

/** Web Crypto 在 Node 与 Chromium 里都是全局对象，不需要 import node:crypto。 */
export function newBookId(): string {
  return globalThis.crypto.randomUUID()
}
