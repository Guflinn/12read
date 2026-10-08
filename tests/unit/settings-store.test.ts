import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReaderApi } from '@shared/api'
import { DEFAULT_SETTINGS, type ReaderSettings } from '@shared/types'
import { setReaderApi } from '@/core/api'
import { useSettingsStore } from '@/store/settings'

function makeHarness(stored: ReaderSettings): { saveSettings: ReturnType<typeof vi.fn> } {
  const saveSettings = vi.fn(async (settings: ReaderSettings): Promise<ReaderSettings> => settings)
  const api = {
    getSettings: vi.fn(async () => stored),
    saveSettings
  } as unknown as ReaderApi
  setReaderApi(api)
  return { saveSettings }
}

beforeEach(() => {
  // 直接用真正的默认值，别在这里抄一份字面量 —— 默认一变（如 0.2.1 的 19→22）这里就会悄悄脱钩
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    ready: false
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('settings store', () => {
  it('读取时把越界设置拉回合法范围', async () => {
    makeHarness({
      fontSize: 99,
      lineHeight: 1.9,
      theme: 'sepia' as unknown as 'day',
      bold: true,
      fontFamily: 'heiti' as unknown as 'song',
      pageWidth: 'huge' as unknown as 'medium', dailyGoalMinutes: 0
    })
    await useSettingsStore.getState().load()
    const settings = useSettingsStore.getState().settings
    expect(settings.fontSize).toBe(32)
    expect(settings.theme).toBe('day')
    expect(settings.bold).toBe(true)
    expect(useSettingsStore.getState().ready).toBe(true)
  })

  it('缺 bold / 字体 / 栏宽的旧设置都补默认', async () => {
    makeHarness({
      fontSize: 19,
      lineHeight: 1.9,
      theme: 'day',
      bold: undefined as unknown as boolean,
      fontFamily: undefined as unknown as 'song',
      pageWidth: undefined as unknown as 'medium',
      dailyGoalMinutes: undefined as unknown as number
    })
    await useSettingsStore.getState().load()
    const settings = useSettingsStore.getState().settings
    expect(settings.bold).toBe(false)
    expect(settings.fontFamily).toBe('song')
    expect(settings.pageWidth).toBe('medium')
  })

  it('读取失败也标记 ready，不阻塞界面', async () => {
    const api = {
      getSettings: vi.fn(async () => {
        throw new Error('设置读不了')
      })
    } as unknown as ReaderApi
    setReaderApi(api)
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().ready).toBe(true)
    expect(useSettingsStore.getState().settings.fontSize).toBe(22)
  })

  it('apply 立刻生效并写回，字号被夹紧', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium', dailyGoalMinutes: 0 })
    useSettingsStore.getState().apply({ fontSize: 100 })
    expect(useSettingsStore.getState().settings.fontSize).toBe(32)

    await vi.waitFor(() => expect(harness.saveSettings).toHaveBeenCalledTimes(1))
    expect(harness.saveSettings.mock.calls[0]?.[0]).toEqual({
      fontSize: 32,
      lineHeight: 1.9,
      theme: 'day',
      bold: false,
      fontFamily: 'song',
      pageWidth: 'medium', dailyGoalMinutes: 0
    })
  })

  it('字体与栏宽立刻生效并写回，未知取值不会写进去', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium', dailyGoalMinutes: 0 })
    useSettingsStore.getState().apply({ fontFamily: 'kai', pageWidth: 'wide', dailyGoalMinutes: 0 })
    expect(useSettingsStore.getState().settings.fontFamily).toBe('kai')
    expect(useSettingsStore.getState().settings.pageWidth).toBe('wide')

    useSettingsStore.getState().apply({ fontFamily: 'comic' as unknown as 'song' })
    expect(useSettingsStore.getState().settings.fontFamily).toBe('song')

    await vi.waitFor(() => expect(harness.saveSettings).toHaveBeenCalled())
    expect(harness.saveSettings.mock.calls.at(-1)?.[0]).toMatchObject({ fontFamily: 'song', pageWidth: 'wide', dailyGoalMinutes: 0 })
  })

  it('每日目标：合法值立刻生效，越界与非法值被夹紧；没设时是 0', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium', dailyGoalMinutes: 0 })

    useSettingsStore.getState().apply({ dailyGoalMinutes: 30 })
    expect(useSettingsStore.getState().settings.dailyGoalMinutes).toBe(30)

    useSettingsStore.getState().apply({ dailyGoalMinutes: 9999 })
    expect(useSettingsStore.getState().settings.dailyGoalMinutes).toBe(600)

    useSettingsStore.getState().apply({ dailyGoalMinutes: -5 })
    expect(useSettingsStore.getState().settings.dailyGoalMinutes).toBe(0)

    useSettingsStore.getState().apply({ dailyGoalMinutes: Number.NaN })
    expect(useSettingsStore.getState().settings.dailyGoalMinutes).toBe(0)

    await vi.waitFor(() => expect(harness.saveSettings).toHaveBeenCalled())
    expect(harness.saveSettings.mock.calls.at(-1)?.[0]).toMatchObject({ dailyGoalMinutes: 0 })
  })

  it('加粗开关立刻生效并写回', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium', dailyGoalMinutes: 0 })
    useSettingsStore.getState().apply({ bold: true })
    expect(useSettingsStore.getState().settings.bold).toBe(true)

    await vi.waitFor(() => expect(harness.saveSettings).toHaveBeenCalledTimes(1))
    expect(harness.saveSettings.mock.calls[0]?.[0]).toMatchObject({ bold: true })
  })

  it('写回失败只记日志，不回滚内存里的设置', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const api = {
      saveSettings: vi.fn(async () => {
        throw new Error('写盘失败')
      })
    } as unknown as ReaderApi
    setReaderApi(api)

    useSettingsStore.getState().apply({ theme: 'night' })
    expect(useSettingsStore.getState().settings.theme).toBe('night')
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
  })
})
