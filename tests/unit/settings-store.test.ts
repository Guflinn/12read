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
    settings: { fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium' },
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
      pageWidth: 'huge' as unknown as 'medium'
    })
    await useSettingsStore.getState().load()
    const settings = useSettingsStore.getState().settings
    expect(settings.fontSize).toBe(27)
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
      pageWidth: undefined as unknown as 'medium'
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
    expect(useSettingsStore.getState().settings.fontSize).toBe(19)
  })

  it('apply 立刻生效并写回，字号被夹紧', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium' })
    useSettingsStore.getState().apply({ fontSize: 100 })
    expect(useSettingsStore.getState().settings.fontSize).toBe(27)

    await vi.waitFor(() => expect(harness.saveSettings).toHaveBeenCalledTimes(1))
    expect(harness.saveSettings.mock.calls[0]?.[0]).toEqual({
      fontSize: 27,
      lineHeight: 1.9,
      theme: 'day',
      bold: false,
      fontFamily: 'song',
      pageWidth: 'medium'
    })
  })

  it('字体与栏宽立刻生效并写回，未知取值不会写进去', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium' })
    useSettingsStore.getState().apply({ fontFamily: 'kai', pageWidth: 'wide' })
    expect(useSettingsStore.getState().settings.fontFamily).toBe('kai')
    expect(useSettingsStore.getState().settings.pageWidth).toBe('wide')

    useSettingsStore.getState().apply({ fontFamily: 'comic' as unknown as 'song' })
    expect(useSettingsStore.getState().settings.fontFamily).toBe('song')

    await vi.waitFor(() => expect(harness.saveSettings).toHaveBeenCalled())
    expect(harness.saveSettings.mock.calls.at(-1)?.[0]).toMatchObject({ fontFamily: 'song', pageWidth: 'wide' })
  })

  it('加粗开关立刻生效并写回', async () => {
    const harness = makeHarness({ fontSize: 19, lineHeight: 1.9, theme: 'day', bold: false, fontFamily: 'song', pageWidth: 'medium' })
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
