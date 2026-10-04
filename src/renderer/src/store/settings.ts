import { create } from 'zustand'
import { DEFAULT_SETTINGS, type ReaderSettings } from '@shared/types'
import { readerApi } from '@/core/api'
import { clampFontSize } from '@/core/reading'
import { isFontFamilyKey, isPageWidthKey } from '@/core/typography'

interface SettingsState {
  settings: ReaderSettings
  ready: boolean
  load(): Promise<void>
  apply(patch: Partial<ReaderSettings>): void
}

function normalize(next: ReaderSettings): ReaderSettings {
  return {
    fontSize: clampFontSize(next.fontSize),
    lineHeight: Number.isFinite(next.lineHeight) ? next.lineHeight : DEFAULT_SETTINGS.lineHeight,
    theme: next.theme === 'night' ? 'night' : 'day',
    bold: next.bold === true,
    fontFamily: isFontFamilyKey(next.fontFamily) ? next.fontFamily : DEFAULT_SETTINGS.fontFamily,
    pageWidth: isPageWidthKey(next.pageWidth) ? next.pageWidth : DEFAULT_SETTINGS.pageWidth
  }
}

/** 阅读设置：内存里立刻生效，落盘是尽力而为（失败只提示，不打断阅读）。 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  ready: false,

  async load(): Promise<void> {
    try {
      const settings = await readerApi().getSettings()
      set({ settings: normalize(settings), ready: true })
    } catch (cause) {
      console.error('[12read] 读取设置失败', cause)
      set({ ready: true })
    }
  },

  apply(patch: Partial<ReaderSettings>): void {
    const next = normalize({ ...get().settings, ...patch })
    set({ settings: next })
    void readerApi()
      .saveSettings(next)
      .catch((cause: unknown) => {
        console.error('[12read] 保存设置失败', cause)
      })
  }
}))
