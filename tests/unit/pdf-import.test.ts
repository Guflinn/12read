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

/**
 * 回归（0.4.0）：**别让 pdfjs 去碰 @napi-rs/canvas**。
 *
 * pdfjs 在 Node 环境下加载时会 require 它来 polyfill DOMMatrix；那个包带的 skia 原生模块
 * 在 Electron 里加载会直接把进程打崩（WER：BEX64 / 故障模块 skia.win32-x64-msvc.node /
 * 异常代码 c0000005），用户看到的是「十二阅读 has stopped working」。
 * `decodePdf` 会在 import pdfjs 之前把它挡掉 —— 这里用「加载过的模块清单」钉住这件事。
 */
describe('pdfjs 的 canvas 依赖被换成纯 JS 替身（0.4.0 的崩）', () => {
  it('抽完一本 PDF 之后，进程里一个原生模块都没被加载', async () => {
    await decodePdf(createPlainPdf())

    // skia.win32-x64-msvc.node 在 Electron 里加载会崩（BEX64 / c0000005），
    // 所以这条断言的意思是「pdfjs 没去碰任何 .node」
    const natives = Object.keys(require.cache).filter((path) => path.endsWith('.node'))
    expect(natives).toEqual([])
  })

  it('require 缓存里那条 @napi-rs/canvas 就是我们塞的替身', () => {
    const resolved = require.resolve('@napi-rs/canvas')
    const cached = require.cache[resolved]
    expect(cached).toBeDefined()
    // 不是真的那个包（真的那个 exports 里是 skia 的 createCanvas）
    expect(Object.keys(cached?.exports ?? {}).sort()).toEqual(['DOMMatrix', 'ImageData'])
  })

  it('替身能当 DOMMatrix 用：构造、相乘、平移、求逆都对', () => {
    const Matrix = (require.cache[require.resolve('@napi-rs/canvas')]?.exports as {
      DOMMatrix: new (init?: number[]) => {
        a: number
        b: number
        c: number
        d: number
        e: number
        f: number
        multiplySelf(other: unknown): unknown
        translateSelf(x: number, y: number): unknown
        invertSelf(): unknown
      }
    }).DOMMatrix

    expect(new Matrix()).toMatchObject({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    // 平移 (10, 20) 后原点上移 → e/f 变成 10/20
    const moved = new Matrix().translateSelf(10, 20)
    expect(moved).toMatchObject({ e: 10, f: 20 })
    // 2 倍缩放 × 平移：先缩放后平移（行向量约定）
    const scaled = new Matrix([2, 0, 0, 2, 0, 0]).translateSelf(3, 4)
    expect(scaled).toMatchObject({ a: 2, d: 2, e: 3, f: 4 })
    // 求逆：平移的逆是反向平移
    const inverse = new Matrix().translateSelf(5, -7).invertSelf()
    expect(inverse).toMatchObject({ a: 1, d: 1, e: -5, f: 7 })
  })
})
