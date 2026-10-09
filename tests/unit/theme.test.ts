import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { applyTheme, type ThemeRoot } from '@/core/theme'

interface FakeRoot extends ThemeRoot {
  dataset: { theme?: string }
  style: { props: Map<string, string>; setProperty(name: string, value: string): void }
}

function fakeRoot(): FakeRoot {
  const props = new Map<string, string>()
  return {
    dataset: {},
    style: {
      props,
      setProperty(name: string, value: string): void {
        props.set(name, value)
      }
    }
  }
}

describe('applyTheme', () => {
  it('主题写到 <html> 而不是内层 .app，并同步 --fs / --lh / --stroke / --font-body / --page-w', () => {
    const root = fakeRoot()

    applyTheme(
      { fontSize: 22, lineHeight: 2.25, theme: 'night', bold: true, fontFamily: 'wenkai', pageWidth: 'wide', dailyGoalMinutes: 0 },
      root
    )

    // 挂在 <html> 上，body 的 background/color 才能取到夜间变量（花屏修复的关键）
    expect(root.dataset.theme).toBe('night')
    expect(root.style.props.get('--fs')).toBe('22px')
    expect(root.style.props.get('--lh')).toBe('2.25')
    // 加粗 = 0.35px 细描边（不是合成粗体 —— 那会把无粗体文件的字体挤成一团）
    expect(root.style.props.get('--stroke')).toBe('0.35px')
    expect(root.style.props.get('--font-body')).toContain('LXGW WenKai')
    expect(root.style.props.get('--page-w')).toBe('52rem')
  })

  it('不加粗时 --stroke 回 0px，切换加粗不影响主题属性', () => {
    const root = fakeRoot()
    applyTheme({ ...DEFAULT_SETTINGS, bold: true }, root)
    expect(root.style.props.get('--stroke')).toBe('0.35px')

    applyTheme({ ...DEFAULT_SETTINGS, bold: false }, root)
    expect(root.style.props.get('--stroke')).toBe('0px')
    expect(root.dataset.theme).toBe('day')
  })

  it('字体与栏宽跟着设置走，未知取值回退默认（默认栈是经典宋体）', () => {
    const root = fakeRoot()
    applyTheme({ ...DEFAULT_SETTINGS, fontFamily: 'fang' as const, pageWidth: 'narrow' as const, dailyGoalMinutes: 0 }, root)
    expect(root.style.props.get('--font-body')).toContain('FangSong')
    expect(root.style.props.get('--page-w')).toBe('30rem')

    applyTheme({ ...DEFAULT_SETTINGS, fontFamily: 'comic' as never, pageWidth: 'huge' as never, dailyGoalMinutes: 0 }, root)
    expect(root.style.props.get('--font-body')).toContain('SimSun')
    expect(root.style.props.get('--page-w')).toBe('40rem')
  })

  it('主题没变时不重写 data-theme，改字号不触发无谓的主题属性变更', () => {
    const root = fakeRoot()
    applyTheme(DEFAULT_SETTINGS, root)
    expect(root.dataset.theme).toBe('day')

    let writes = 0
    Object.defineProperty(root.dataset, 'theme', {
      get: () => 'day',
      set: () => {
        writes += 1
      }
    })

    applyTheme({ ...DEFAULT_SETTINGS, fontSize: 25 }, root)

    expect(writes).toBe(0)
    expect(root.style.props.get('--fs')).toBe('25px')
  })
})
