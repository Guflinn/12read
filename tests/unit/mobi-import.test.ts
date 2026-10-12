/**
 * MOBI 端到端提取（0.3.0）。
 *
 * 夹具从零造（见 tests/fixtures/mobi.ts），所以这里能断言到「正文一个字不差」——
 * 真书（白夜行）只用来手工核对，不进仓库（有版权）。
 *
 * 重点覆盖两类容易静默出错的地方：
 * ① 每块尾部的附加数据必须被切干净（否则正文里会散布二进制垃圾）；
 * ② 不支持的变体（DRM / KF8 / Huff）必须给中文人话，而不是抛一个英文栈。
 */
import { describe, expect, it } from 'vitest'
import { MobiError } from '@main/services/mobi/errors'
import { decodeMobi } from '@main/services/mobi/import'
import { DEFAULT_MOBI_HTML, FAKE_JPEG, createMobi, hasControlChars } from '../fixtures/mobi'

const EXPECTED_TEXT =
  '测试小书\n这是封面页。\n' +
  '第一章 起风\n风从山口进来，吹动了窗上的旧报纸。\n' +
  '第二章 落雨\n雨落在瓦上，声音密得像有人在低声说话。'

describe('decodeMobi：基本形状', () => {
  it('书名作者来自 EXTH，正文与章节对齐，封面落成 cover.jpg', () => {
    const book = decodeMobi(createMobi())

    expect(book.title).toBe('测试小书')
    expect(book.author).toBe('测试作者')
    expect(book.encoding).toBe('utf-8')
    expect(book.text).toBe(EXPECTED_TEXT)
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      '封面',
      '第一章 起风',
      '第二章 落雨'
    ])
    // 章节表必须无缝覆盖正文：按 slice 取章不能丢字
    for (const chapter of book.chapters) {
      expect(book.text.slice(chapter.startOffset, chapter.startOffset + chapter.charLength)).toBe(
        EXPECTED_TEXT.slice(chapter.startOffset, chapter.startOffset + chapter.charLength)
      )
    }
    expect([...book.blobs.keys()]).toEqual(['cover.jpg'])
    expect(book.blobs.get('cover.jpg')?.equals(FAKE_JPEG)).toBe(true)
  })

  it('没有封面时不留 cover 文件', () => {
    const book = decodeMobi(createMobi({ cover: null }))
    expect(book.blobs.size).toBe(0)
  })

  it('正文里的 recindex 图片落成 0001.jpg，并在正文里占一个 U+FFFC 占位', () => {
    const html =
      '<html><body><div align="center"><img recindex="00001"/></div>' +
      '<mbp:pagebreak/><div><h3>第一章</h3><p>正文。</p></div></body></html>'
    const book = decodeMobi(createMobi({ html }))

    expect(book.images).toHaveLength(1)
    expect(book.images[0]?.file).toBe('0001.jpg')
    expect(book.text[book.images[0]?.offset ?? -1]).toBe('\uFFFC')
    expect([...book.blobs.keys()].sort()).toEqual(['0001.jpg', 'cover.jpg'])
  })

  it('图片偏移是**全书坐标**（回归：曾经漏了平移，只有第一节的图落在正确位置）', () => {
    const html =
      '<html><body><div><img recindex="00001"/></div>' +
      '<mbp:pagebreak/><div><h3>第一章</h3><p>正文。</p>' +
      '<div><img recindex="00001"/></div></div></body></html>'
    const book = decodeMobi(createMobi({ html }))

    expect(book.images).toHaveLength(2)
    // 每一个图片偏移都必须正好落在正文里的占位符上
    for (const image of book.images) {
      expect(book.text[image.offset]).toBe('\uFFFC')
    }
    expect(book.images.map((image) => image.offset)).toEqual([
      book.text.indexOf('\uFFFC'),
      book.text.lastIndexOf('\uFFFC')
    ])
    // 第二个图必须落在第二章里（而不是被平移前的节内坐标）
    const second = book.chapters[1]
    expect(book.images[1]?.offset).toBeGreaterThanOrEqual(second?.startOffset ?? 0)
  })

  it('首页标题等于书名时改叫「封面」（否则目录里会多一条与书同名的怪项）', () => {
    const book = decodeMobi(createMobi())
    expect(book.chapters[0]?.title).toBe('封面')
    expect(book.chapters[1]?.title).toBe('第一章 起风')
  })

  it('整节只有图片时不把占位符当章名（首节叫封面，后面的叫插图）', () => {
    const html =
      '<html><body><div><img recindex="00001"/></div>' +
      '<mbp:pagebreak/><div><img recindex="00001"/></div>' +
      '<mbp:pagebreak/><div><h3>正文</h3><p>正文里有字。</p></div></body></html>'
    const book = decodeMobi(createMobi({ html }))
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['封面', '插图', '正文'])
  })
})

describe('decodeMobi：每块尾部的附加数据', () => {
  it('块被附加数据撑长时按 recordSize / textLength 切干净（正文一个字不差）', () => {
    const book = decodeMobi(
      createMobi({ recordSize: 64, trailingBytes: 96, extraDataFlags: 0x02 })
    )
    expect(book.text).toBe(EXPECTED_TEXT)
    expect(hasControlChars(book.text)).toBe(false)
  })

  it('不压缩（compression = 1）的书照样解', () => {
    const book = decodeMobi(createMobi({ compression: 1 }))
    expect(book.text).toBe(EXPECTED_TEXT)
  })
})

describe('decodeMobi：章节兜底', () => {
  it('没有翻页标记时退回 TXT 那套「第 N 章」切章', () => {
    const html =
      '<html><body><p>第一章 起风</p><p>风从山口进来。</p>' +
      '<p>第二章 落雨</p><p>雨落在瓦上。</p></body></html>'
    const book = decodeMobi(createMobi({ html }))
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 起风', '第二章 落雨'])
    expect(book.chapters[0]?.startOffset).toBe(0)
  })

  it('连「第 N 章」都没有时整本一章「正文」', () => {
    const html = '<html><body><p>只有一段话，没有任何章节标记。</p></body></html>'
    const book = decodeMobi(createMobi({ html }))
    expect(book.chapters).toEqual([
      { title: '正文', startOffset: 0, charLength: book.text.length, kind: 'chapter' }
    ])
  })

  it('提取不到文字（纯图片书）时给中文提示', () => {
    const html = '<html><body><div><img recindex="00001"/></div></body></html>'
    expect(() => decodeMobi(createMobi({ html }))).toThrow(/提取不到文字/)
  })
})

describe('decodeMobi：不支持的变体给中文人话', () => {
  it('DRM 加密', () => {
    expect(() => decodeMobi(createMobi({ encryption: 2 }))).toThrow(/版权保护/)
  })

  it('KF8（AZW3）', () => {
    expect(() => decodeMobi(createMobi({ version: 8 }))).toThrow(/KF8/)
  })

  it('Huff/CDic 压缩', () => {
    expect(() => decodeMobi(createMobi({ compression: 17480 }))).toThrow(/Huff\/CDic/)
  })

  it('认不出的压缩方式', () => {
    expect(() => decodeMobi(createMobi({ compression: 9 }))).toThrow(MobiError)
    expect(() => decodeMobi(createMobi({ compression: 9 }))).toThrow(/压缩方式认不出来/)
  })

  it('不是 MOBI（扩展名骗人）时报「没有 MOBI 头」', () => {
    const bytes = createMobi()
    bytes.write('XXXX', bytes.readUInt32BE(78) + 16, 'latin1')
    expect(() => decodeMobi(bytes)).toThrow(/没有 MOBI 头/)
  })

  it('默认夹具本身是能解的（避免上面几条把「能解」也一起证伪）', () => {
    expect(() => decodeMobi(createMobi())).not.toThrow()
    expect(DEFAULT_MOBI_HTML).toContain('mbp:pagebreak')
  })
})
