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
      { fontSize: 22, lineHeight: 2.25, letterSpacing: 0.05, theme: 'night', bold: 1, fontFamily: 'wenkai', pageWidth: 'wide', dailyGoalMinutes: 0 },
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

  it('加粗阴影的偏移必须是整数个屏幕像素（小数偏移 = 副本边缘半透明 = 又会发虚）', () => {
    const root = fakeRoot()
    const shadowOf = (): string => root.style.props.get('--bold-shadow') ?? ''
    const offsetsOf = (): number[] =>
      [...shadowOf().matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))

    // 轻（1）= 只横向一份：竖画加粗、横画不动
    applyTheme({ ...DEFAULT_SETTINGS, bold: 1 }, root, 1.5)
    expect(offsetsOf()).toHaveLength(1)
    // 中（2）= 四方向各一份
    applyTheme({ ...DEFAULT_SETTINGS, bold: 2 }, root, 1.5)
    expect(shadowOf().split(',')).toHaveLength(4)

    // 三种缩放 × 两个档位：偏移都必须落在整数屏幕像素上（偏移 × DPR ≈ 1）
    for (const dpr of [1, 1.5, 2]) {
      for (const level of [1, 2] as const) {
        applyTheme({ ...DEFAULT_SETTINGS, bold: level }, root, dpr)
        const offsets = offsetsOf()
        expect(offsets).toHaveLength(level === 1 ? 1 : 4)
        for (const offset of offsets) expect(Math.abs(offset * dpr - 1)).toBeLessThan(0.01)
      }
    }
    // 100% 缩放时偏移正好 1px，200% 时是 0.5px
    applyTheme({ ...DEFAULT_SETTINGS, bold: 1 }, root, 1)
    expect(shadowOf()).toContain('1.0000px 0 0')
    applyTheme({ ...DEFAULT_SETTINGS, bold: 1 }, root, 2)
    expect(shadowOf()).toContain('0.5000px 0 0')
  })

  it('不加粗（档位 0）时 --bold-shadow 回 none，切换档位不影响主题属性', () => {
    const root = fakeRoot()
    applyTheme({ ...DEFAULT_SETTINGS, bold: 1 }, root)
    expect(root.style.props.get('--bold-shadow')).not.toBe('none')

    applyTheme({ ...DEFAULT_SETTINGS, bold: 0 }, root)
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
