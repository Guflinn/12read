import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeEpub } from '@main/services/epub/import'

/**
 * EPUB 导入（0.2.0 第 4/5 项）：夹具是**自有内容**的迷你 EPUB 3
 * （`tests/fixtures/mini.epub`：三章 + nav + 一张 PNG，CRC 正确、标准工具也能打开）。
 *
 * 它顺便补上了真书没覆盖的分支：**EPUB 3 的 nav.xhtml**（用户给的两本真书都是 NCX）。
 */
const FIXTURE = readFileSync(join(process.cwd(), 'tests/fixtures/mini.epub'))

describe('decodeEpub：自有夹具（EPUB 3）', () => {
  it('读出 OPF 里的书名与作者', () => {
    const book = decodeEpub(FIXTURE)
    expect(book.title).toBe('测试样书')
    expect(book.author).toBe('测试作者')
  })

  it('按 nav 切章：包含嵌套的第二层条目，偏移精确且无缝覆盖', () => {
    const book = decodeEpub(FIXTURE)
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章 起风',
      '第二章 落雨',
      '第二节 独行',
      '第三章 天晴'
    ])
    let cursor = 0
    for (const chapter of book.chapters) {
      expect(chapter.startOffset).toBe(cursor)
      expect(chapter.charLength).toBeGreaterThan(0)
      cursor += chapter.charLength
    }
    expect(cursor).toBe(book.text.length)
  })

  it('正文是纯文本：段落用 \\n 分隔、实体已解、图片是 U+FFFC 占位', () => {
    const book = decodeEpub(FIXTURE)
    expect(book.text).toContain('风从山口进来，把院子里的晾衣绳吹得笔直。')
    // `&amp;` 解开了
    expect(book.text).toContain('番茄&土豆的香味从厨房里飘出来，混在雨气里。')
    // 没有残留标签、没有空段
    expect(/<[a-zA-Z]/.test(book.text)).toBe(false)
    expect(book.text.split('\n').some((paragraph) => paragraph === '')).toBe(false)
    // 图片位置是占位符，alt 文字留在正文里
    expect(book.text).toContain('\uFFFC（雨中的巷口）')
  })

  it('图片：落盘清单给出「偏移 → 文件」，且字节能取到', () => {
    const book = decodeEpub(FIXTURE)
    expect(book.images).toHaveLength(1)
    const image = book.images[0]
    expect(image?.file).toBe('0001.png')
    expect(book.text[image?.offset ?? -1]).toBe('\uFFFC')
    const data = book.blobs.get('0001.png')
    // PNG 魔数
    expect(data?.subarray(0, 4).toString('hex')).toBe('89504e47')
  })

  it('解析不了的字节给中文错误，而不是抛原始异常', () => {
    // 太短 → 说文件太小；够长但没有 ZIP 结构 → 说找不到结尾记录
    expect(() => decodeEpub(Buffer.from('这不是 zip'))).toThrow(/文件太小/)
    expect(() => decodeEpub(Buffer.alloc(4096, 0x41))).toThrow(/找不到结尾记录/)
  })
})
