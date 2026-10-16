import { describe, expect, it } from 'vitest'
import {
  groupLines,
  pageToParagraphs,
  paragraphsFromLines,
  type PdfTextItem
} from '@main/services/pdf/layout'

/**
 * PDF 的排版还原（0.4.0）：PDF 没有段落，只能靠坐标猜。
 * 这里用**合成文字项**把中文 / 英文、缩进、短行、行距这几种情况钉住 ——
 * 真实 PDF 的解析链路另有 pdf-import.test.ts 用现造的 PDF 覆盖。
 */
function item(str: string, x: number, y: number, width: number, height = 12): PdfTextItem {
  return { str, x, y, width, height }
}

describe('PDF 行的归堆（groupLines）', () => {
  it('同一行的多个文字项按 x 排好，拉丁文之间按间隙补空格', () => {
    const lines = groupLines([item('world.', 110, 700, 36), item('Hello', 72, 700, 30)])

    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hello world.')
    expect(lines[0].x).toBe(72)
    expect(lines[0].right).toBe(146)
  })

  it('中文之间不补空格（PDF 里中文往往是逐字给的）', () => {
    const lines = groupLines([item('你好，', 72, 700, 24), item('世界。', 96, 700, 24)])
    expect(lines[0].text).toBe('你好，世界。')
  })

  it('y 差得够远就是两行，行序从上到下', () => {
    const lines = groupLines([item('下面那行', 72, 680, 48), item('上面那行', 72, 700, 48)])
    expect(lines.map((line) => line.text)).toEqual(['上面那行', '下面那行'])
  })

  it('空白文字项直接丢掉，不留空行', () => {
    expect(groupLines([item('   ', 72, 700, 10), item('有字', 72, 680, 24)])).toHaveLength(1)
  })
})

describe('PDF 的行 → 段落（paragraphsFromLines）', () => {
  it('排到右边距的行被接起来；中文不凭空加空格', () => {
    const lines = groupLines([
      item('他推开门，', 72, 700, 120),
      item('屋里的灯还亮着。', 72, 688, 120)
    ])

    expect(paragraphsFromLines(lines)).toEqual(['他推开门，屋里的灯还亮着。'])
  })

  it('英文跨行接句要补一个空格', () => {
    const lines = groupLines([
      item('the wind came down', 72, 700, 200),
      item('from the pass', 72, 688, 200)
    ])

    expect(paragraphsFromLines(lines)).toEqual(['the wind came down from the pass'])
  })

  it('上一行是短行 → 这里是新段落', () => {
    const lines = groupLines([
      item('aaaaaaaa bbbbbbbb cccccccc dddddddd', 72, 700, 200),
      item('这一行很短。', 72, 688, 40),
      item('aaaaaaaa bbbbbbbb cccccccc dddddddd', 72, 676, 200)
    ])

    expect(paragraphsFromLines(lines)).toEqual([
      // 中文接在拉丁文后面也不加空格（中文排版本来就不加）
      'aaaaaaaa bbbbbbbb cccccccc dddddddd这一行很短。',
      'aaaaaaaa bbbbbbbb cccccccc dddddddd'
    ])
  })

  it('首行缩进 → 新段落（中文书最常用的信号）', () => {
    const lines = groupLines([
      item('第一段排到右边距了，这里收尾。', 72, 700, 200),
      item('　　第二段有缩进，应该是新段落。', 96, 688, 200)
    ])

    expect(paragraphsFromLines(lines)).toHaveLength(2)
  })

  it('行间距明显变大 → 新段落', () => {
    const lines = groupLines([
      item('上一段。', 72, 700, 200),
      item('下一段。', 72, 650, 200)
    ])

    expect(paragraphsFromLines(lines)).toEqual(['上一段。', '下一段。'])
  })

  it('一页里一个文字项都没有：不给空气段', () => {
    expect(pageToParagraphs([])).toEqual([])
  })
})
