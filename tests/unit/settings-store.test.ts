import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReaderApi } from '@shared/api'
import type { ReaderSettings } from '@shared/types'
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
  useSettingsStore.setState({
    settings: { fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false },
    ready: false
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('settings store', () => {
  it('读取时把越界设置拉回合法范围', async () => {
    makeHarness({ fontSize: 99, lineHeight: 1.9, theme: 'sepia' as unknown as 'day', bold: true })
    await useSettingsStore.getState().load()
    const settings = useSettingsStore.getState().settings
    expect(settings.fontSize).toBe(27)
    expect(settings.theme).toBe('day')
    expect(settings.bold).toBe(true)
    expect(useSettingsStore.getState().ready).toBe(true)
  })

  it('缺 bold 的旧设置当成不加粗', async () => {
    makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: undefined as unknown as boolean })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().settings.bold).toBe(false)
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
    expect(useSettingsStore.getState().settings.fontSize).toBe(19)
  })

  it('apply 立刻生效并写回，字号被夹紧', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false })
    useSettingsStore.getState().apply({ fontSize: 100 })
    expect(useSettingsStore.getState().settings.fontSize).toBe(27)

    await vi.waitFor(() => expect(harness.saveSettings).toHaveBeenCalledTimes(1))
    expect(harness.saveSettings.mock.calls[0]?.[0]).toEqual({
      fontSize: 27,
      lineHeight: 1.9,
      theme: 'day',
      bold: false
    })
  })

  it('加粗开关立刻生效并写回', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false })
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
