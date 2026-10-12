/**
 * MOBI 的 HTML 预处理与分节（0.3.0）。
 *
 * 这三件事各自都短，但错了都是「真书静悄悄少正文」那一类的坑：
 * 空标签不自闭合 → 解析器把后面的正文挂进 `<img>` 底下；`recindex` 不改写 → 封面整张丢；
 * 分节错 → 章节表断档、按 slice 取章就丢字。
 */
import { describe, expect, it } from 'vitest'
import {
  RECINDEX_PREFIX,
  countFileposLinks,
  firstHeadingText,
  prepareMobiHtml,
  recindexOf,
  splitSections
} from '@main/services/mobi/html'

describe('prepareMobiHtml', () => {
  it('没有闭合的 HTML 空标签补上自闭合（否则后续正文会被挂到它底下）', () => {
    const out = prepareMobiHtml('<p>甲<br>乙<hr>丙</p>')
    expect(out).toBe('<p>甲<br/>乙<hr/>丙</p>')
  })

  it('已经自闭合的标签不动它', () => {
    expect(prepareMobiHtml('<p>甲<br/>乙</p>')).toBe('<p>甲<br/>乙</p>')
    expect(prepareMobiHtml('<mbp:pagebreak/>')).toBe('<mbp:pagebreak/>')
  })

  it('`<mbp:pagebreak>`（没斜杠的老写法）也要自闭合', () => {
    expect(prepareMobiHtml('甲<mbp:pagebreak>乙')).toBe('甲<mbp:pagebreak/>乙')
  })

  it('把 recindex 改写成提取器认得的 src（含前导零、单双引号、无引号）', () => {
    expect(prepareMobiHtml('<img recindex="00012"/>')).toBe(
      '<img src="@recindex:12" recindex="00012"/>'
    )
    expect(prepareMobiHtml("<img recindex='3' align='bottom'>")).toBe(
      "<img src=\"@recindex:3\" recindex='3' align='bottom'/>"
    )
    expect(prepareMobiHtml('<img recindex=7>')).toBe('<img src="@recindex:7" recindex=7/>')
  })

  it('已经有 src 的图片不动它（KF8 转换成 EPUB 再转回来的书里有）', () => {
    const html = '<img src="images/a.jpg"/>'
    expect(prepareMobiHtml(html)).toBe(html)
  })

  it('recindex 认不出（0 / 非数字）时不改写，免得生成坏引用', () => {
    expect(prepareMobiHtml('<img recindex="0"/>')).toBe('<img recindex="0"/>')
  })
})

describe('recindexOf', () => {
  it('只认自己的前缀', () => {
    expect(recindexOf(RECINDEX_PREFIX + '12')).toBe(12)
    expect(recindexOf('images/a.jpg')).toBeNull()
    expect(recindexOf(RECINDEX_PREFIX + 'x')).toBeNull()
  })
})

describe('splitSections', () => {
  it('按翻页标记切节，空节丢掉', () => {
    const html = '<div>甲</div><mbp:pagebreak/><div>乙</div><mbp:pagebreak/><mbp:pagebreak/><div>丙</div>'
    expect(splitSections(html)).toEqual(['<div>甲</div>', '<div>乙</div>', '<div>丙</div>'])
  })

  it('没有翻页标记时只有一节（上层会退回按标题切章）', () => {
    expect(splitSections('<div>甲</div><div>乙</div>')).toHaveLength(1)
  })
})

describe('firstHeadingText', () => {
  it('按文档顺序取第一个 h1..h6，不挑「级别更高的那个」', () => {
    expect(firstHeadingText('<div><h3>第三章</h3><h1>书名</h1></div>')).toBe('第三章')
  })

  it('保留命名空间前缀的写法也能认', () => {
    expect(firstHeadingText('<html:body><h2>卷上</h2></html:body>')).toBe('卷上')
  })

  it('没有标题标签就给 null，交给上层退回「第一段短文字」', () => {
    expect(firstHeadingText('<div><p>第一章 起风</p></div>')).toBeNull()
  })
})

describe('countFileposLinks', () => {
  it('数出 filepos 链接（用来认目录页）', () => {
    const toc = '<a filepos=0001>一</a><a filepos=0002>二</a><a filepos=0003>三</a>'
    expect(countFileposLinks(toc)).toBe(3)
    expect(countFileposLinks('<a filepos=0001>一</a>')).toBe(1)
  })
})
