import { create } from 'zustand'
import { STAT_GOAL_MAX_MINUTES } from '@shared/core/stats'
import { DEFAULT_SETTINGS, type BoldLevel, type ReaderSettings } from '@shared/types'
import { readerApi } from '@/core/api'
import { clampFontSize, clampLineHeight, clampLetterSpacing } from '@/core/reading'
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
    lineHeight: clampLineHeight(next.lineHeight),
    letterSpacing: clampLetterSpacing(next.letterSpacing),
    theme: next.theme === 'night' ? 'night' : 'day',
    bold: clampBold(next.bold),
    fontFamily: isFontFamilyKey(next.fontFamily) ? next.fontFamily : DEFAULT_SETTINGS.fontFamily,
    pageWidth: isPageWidthKey(next.pageWidth) ? next.pageWidth : DEFAULT_SETTINGS.pageWidth,
    dailyGoalMinutes: clampGoal(next.dailyGoalMinutes)
  }
}

/** 每日目标夹到 0..STAT_GOAL_MAX_MINUTES；0 表示关闭，非数字回默认。 */
function clampGoal(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.dailyGoalMinutes
  return Math.min(STAT_GOAL_MAX_MINUTES, Math.max(0, Math.trunc(value)))
}

/** 加粗档位只允许 0 / 1 / 2；历史上存过的布尔（true/false）在这里也兜一层。 */
function clampBold(value: unknown): BoldLevel {
  if (value === true) return 1
  if (value === false) return 0
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.bold
  return Math.min(2, Math.max(0, Math.trunc(value))) as BoldLevel
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
