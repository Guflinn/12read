import { settingsSchema } from '@shared/schema'
import { DEFAULT_SETTINGS, type ReaderSettings } from '@shared/types'
import type { MetaRepository } from '../db/meta-repository'

const SETTINGS_KEY = 'reader_settings'

/** 阅读设置存在 meta 表里，重启后仍然生效（MVP 3.4）。 */
export class SettingsStore {
  constructor(private readonly meta: MetaRepository) {}

  get(): ReaderSettings {
    const raw = this.meta.get(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    try {
      const parsed = settingsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    } catch {
      // 坏数据当作没设置过，绝不让设置读取把界面搞崩。
    }
    return { ...DEFAULT_SETTINGS }
  }

  set(settings: ReaderSettings): ReaderSettings {
    const parsed = settingsSchema.safeParse(settings)
    if (!parsed.success) return this.get()
    this.meta.set(SETTINGS_KEY, JSON.stringify(parsed.data))
    return parsed.data
  }
}
