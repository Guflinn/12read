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
  it('主题写到 <html> 而不是内层 .app，并同步 --fs / --lh / --ls / --weight / --bold-shadow / --font-body / --page-w', () => {
    const root = fakeRoot()

    applyTheme(
      { fontSize: 22, lineHeight: 2.25, letterSpacing: 0.05, theme: 'night', bold: true, fontFamily: 'wenkai', pageWidth: 'wide', dailyGoalMinutes: 0 },
      root
    )

    // 挂在 <html> 上，body 的 background/color 才能取到夜间变量（花屏修复的关键）
    expect(root.dataset.theme).toBe('night')
    expect(root.style.props.get('--fs')).toBe('22px')
    expect(root.style.props.get('--lh')).toBe('2.25')
    expect(root.style.props.get('--ls')).toBe('0.05em')
    // 加粗 = 四方向「整设备像素」的字形副本（不是描边：描边是半透明环，会让宋体的细横发虚）
    expect(root.style.props.get('--bold-shadow')).toContain('currentColor')
    expect(root.style.props.get('--font-body')).toContain('LXGW WenKai')
    expect(root.style.props.get('--page-w')).toBe('52rem')
  })

  it('加粗阴影的偏移必须是整数个设备像素（小数偏移 = 副本边缘半透明 = 又会发虚）', () => {
    const root = fakeRoot()
    const expectNumericOffsets = (shadow: string, dpr: number): void => {
      const offsets = [...shadow.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
      // 四个方向各一份
      expect(offsets).toHaveLength(4)
      for (const offset of offsets) {
        // 偏移 × DPR 必须约等于 1（= 整数 1 个设备像素）
        expect(Math.abs(offset * dpr - 1)).toBeLessThan(0.01)
      }
    }
    applyTheme({ ...DEFAULT_SETTINGS, bold: true }, root, 1.5)
    const shadow = root.style.props.get('--bold-shadow') ?? ''
    expect(shadow.split(',')).toHaveLength(4)
    expectNumericOffsets(shadow, 1.5)
    // 100% 缩放（DPR 1）时偏移正好是 1px；200% 时是 0.5px
    applyTheme({ ...DEFAULT_SETTINGS, bold: true }, root, 1)
    expectNumericOffsets(root.style.props.get('--bold-shadow') ?? '', 1)
    applyTheme({ ...DEFAULT_SETTINGS, bold: true }, root, 2)
    expectNumericOffsets(root.style.props.get('--bold-shadow') ?? '', 2)
  })

  it('不加粗时 --bold-shadow 回 none，切换加粗不影响主题属性', () => {
    const root = fakeRoot()
    applyTheme({ ...DEFAULT_SETTINGS, bold: true }, root)
    expect(root.style.props.get('--bold-shadow')).not.toBe('none')

    applyTheme({ ...DEFAULT_SETTINGS, bold: false }, root)
    expect(root.style.props.get('--bold-shadow')).toBe('none')
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
