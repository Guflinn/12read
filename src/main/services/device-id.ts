import type { MetaRepository } from '../db/meta-repository'

const DEVICE_ID_KEY = 'device_id'

/**
 * 本机设备 id：第一次启动生成并写进 meta，之后固定不变。
 * 进度从第一天就带上它，将来做同步时不用改数据模型（TECH.md 6.1）。
 */
export function deviceIdOf(meta: MetaRepository): string {
  const existing = meta.get(DEVICE_ID_KEY)
  if (existing && existing.length > 0 && existing.length <= 120) return existing
  const created = globalThis.crypto.randomUUID()
  meta.set(DEVICE_ID_KEY, created)
  return created
}
