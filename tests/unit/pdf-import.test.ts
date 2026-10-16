import { describe, expect, it } from 'vitest'
import { ImportError } from '@main/services/import-error'
import { decodePdf } from '@main/services/pdf/import'
import { createOutlinedPdf, createPdf, createPlainPdf, createScannedPdf } from '../fixtures/pdf'

/**
 * PDF 提取器（0.4.0）的真实解析链路：现造的 PDF 字节 → pdfjs → 文字项 → 段落 → 章节。
 * 夹具是**有文字层的最小 PDF**（内置 Helvetica，纯 ASCII），仓库里不放任何二进制书籍。
 */
describe('decodePdf：有目录的 PDF', () => {
  it('按 /Outlines 切章，章节表无缝覆盖全文', async () => {
    const result = await decodePdf(createOutlinedPdf())

    expect(result.chapterSource).toBe('outline')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['Chapter 1 起风', 'Chapter 2 落雨'])
    expect(result.chapters.every((chapter) => chapter.kind === 'chapter')).toBe(true)

    // 章节首尾相接、合起来正好覆盖全文（偏移体系的老规矩）
    expect(result.chapters[0].startOffset).toBe(0)
    for (let i = 0; i < result.chapters.length; i += 1) {
      const end = result.chapters[i].startOffset + result.chapters[i].charLength
      expect(end).toBe(
        i + 1 < result.chapters.length ? result.chapters[i + 1].startOffset : result.text.length
      )
    }
  })

  it('书名与作者取自 PDF 元数据', async () => {
    const result = await decodePdf(createOutlinedPdf())

    expect(result.title).toBe('样张')
    expect(result.author).toBe('测试作者')
  })

  it('文字都在，跨行的句子接得上（英文补空格）', async () => {
    const result = await decodePdf(createOutlinedPdf())

    expect(result.text).toContain('The wind came down from the pass that')
    expect(result.text).toContain('A second paragraph starts here.')
    // 第二页那两行：短行只是换行，要接成一句
    expect(result.text).toContain('It kept blowing all afternoon, harder and harder.')
    expect(result.text).toContain('Rain fell on the roof tiles')
    expect(result.itemCount).toBeGreaterThan(5)
  })

  it('目录只覆盖前面几页时，剩下的文字挂到最后一章，一个字都不丢', async () => {
    // 目录两项都指向第 1 页 → 去重后只剩一项，退按页分章
    const duplicated = createPdf({
      outline: [
        { title: 'A', page: 1 },
        { title: 'B', page: 1 }
      ],
      pages: [
        { lines: [{ text: 'page one', x: 72, y: 660 }] },
        { lines: [{ text: 'page two', x: 72, y: 660 }] }
      ]
    })

    const result = await decodePdf(duplicated)
    expect(result.chapterSource).toBe('page')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['第 1 页', '第 2 页'])
  })
})

describe('decodePdf：没有目录的 PDF', () => {
  it('按页分章（「第 N 页」），kind 标成分段', async () => {
    const result = await decodePdf(createPlainPdf())

    expect(result.chapterSource).toBe('page')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['第 1 页', '第 2 页'])
    expect(result.chapters.map((chapter) => chapter.kind)).toEqual(['segment', 'segment'])
    expect(result.text).toContain('Only page one has words.')
    expect(result.text).toContain('Only page two has words.')
  })

  it('元数据里没有书名作者时给 null（调用方退回文件名）', async () => {
    const result = await decodePdf(createPlainPdf())
    expect(result.title).toBeNull()
    expect(result.author).toBeNull()
  })
})

describe('decodePdf：读不了的情况都要给中文人话', () => {
  it('扫描件（整本没有文字层）：明确说扫描件，并给 OCR 的建议', async () => {
    await expect(decodePdf(createScannedPdf())).rejects.toThrow(/扫描件/)
  })

  it('不是 PDF 的文件：给中文错误而不是崩掉', async () => {
    const bogus = Buffer.from('这根本不是 PDF，只是一段文字', 'utf8')
    const error = await decodePdf(bogus).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ImportError)
    expect((error as Error).message).toMatch(/PDF/)
  })
})
