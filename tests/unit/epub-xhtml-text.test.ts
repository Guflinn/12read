import { describe, expect, it } from 'vitest'
import { extractXhtmlText, IMAGE_PLACEHOLDER } from '@main/services/epub/xhtml-text'

/**
 * XHTML → 纯文本（0.2.0 第 3 项）。
 * 断言的核心是**形状**：段落之间恰好一个 \n、没有空段、没有首尾空行 ——
 * 因为下游（段落渲染 / 锚点 / 书签 / 搜索）全都按这个形状解析。
 */
describe('extractXhtmlText：段落形状', () => {
  it('块级元素切段，每段之间恰好一个 \\n，无空段', () => {
    const { text } = extractXhtmlText('<body><p>一</p><p>二</p><div>三</div></body>', '')
    expect(text).toBe('一\n二\n三')
  })

  it('行内标签不断段，只是把文字接起来', () => {
    const { text } = extractXhtmlText(
      '<p>甲<span class="x">乙</span><b>丙</b><font size="4">丁</font></p>',
      ''
    )
    expect(text).toBe('甲乙丙丁')
  })

  it('老式表现型标记（Mobi 转 EPUB 的典型写法）只剩文字，排版属性全丢', () => {
    const xhtml = `<div>
      <p height="1em" width="0pt" align="center"><font size="4"><b>第一章 飞刀与快剑</b></font></p>
      <p height="1em" width="2em" align="justify">正文第一段。</p>
      <p height="1em" width="2em" align="justify">正文第二段。</p>
    </div>`
    expect(extractXhtmlText(xhtml, '').text).toBe('第一章 飞刀与快剑\n正文第一段。\n正文第二段。')
  })

  it('<br> 断段；空段落与纯空白段落被丢掉', () => {
    const { text } = extractXhtmlText(
      '<p>一<br/>二</p><p>   </p><p></p><div>\n\n</div><p>三</p>',
      ''
    )
    expect(text).toBe('一\n二\n三')
  })

  it('首尾空白与多余空白被压掉，NBSP 当普通空格，零宽字符丢掉', () => {
    const { text } = extractXhtmlText(
      '<p>\n   前\u00a0\u00a0后   </p>\n<p>甲\u200b乙\ufeff丙</p>',
      ''
    )
    expect(text).toBe('前 后\n甲乙丙')
  })

  it('脚本、样式、文档头与日文注音都被跳过', () => {
    const xhtml = `<html><head><title>不该出现</title><style>p{color:red}</style></head>
      <body><script>var a=1</script><p>正文</p><ruby>漢<rt>かん</rt></ruby></body></html>`
    expect(extractXhtmlText(xhtml, '').text).toBe('正文\n漢')
  })

  it('实体在 XML 那层就解开了，这里拿到的就是普通字符', () => {
    const { text } = extractXhtmlText('<p>番茄&amp;土豆 &lt;好吃&gt; &#20320;</p>', '')
    expect(text).toBe('番茄&土豆 <好吃> 你')
  })

  it('空 XHTML / 只有标签没有文字：给空串而不是抛错', () => {
    expect(extractXhtmlText('', '').text).toBe('')
    expect(extractXhtmlText('<html><body><p></p></body></html>', '').text).toBe('')
    expect(extractXhtmlText('没有标签的纯文字', '').text).toBe('没有标签的纯文字')
  })
})

describe('extractXhtmlText：图片占位（U+FFFC）', () => {
  it('图片落一个占位符，alt 像人话就附在后面', () => {
    const { text, images } = extractXhtmlText(
      '<p>前<img src="images/1.png" alt="一只猫"/>后</p>',
      'OEBPS'
    )
    expect(text).toBe('前' + IMAGE_PLACEHOLDER + '（一只猫）后')
    expect(images).toEqual([{ src: 'OEBPS/images/1.png', offset: 1 }])
  })

  it('alt 是文件名或纯数字就不当正文', () => {
    for (const alt of ['image1.jpg', 'IMG_0123', '图1', '  42  ']) {
      const { text } = extractXhtmlText(`<p><img src="a.png" alt="${alt}"/></p>`, '')
      expect(text).toBe(IMAGE_PLACEHOLDER)
    }
  })

  it('没有 alt 就只有占位符', () => {
    const { text } = extractXhtmlText('<p><img src="a.png"/></p>', '')
    expect(text).toBe(IMAGE_PLACEHOLDER)
  })

  it('相对路径按本章所在目录归一化（含 ../ 与 %20）', () => {
    const { images } = extractXhtmlText(
      '<p><img src="../images/第%201.png"/></p>',
      'OEBPS/Text'
    )
    expect(images[0]?.src).toBe('OEBPS/images/第 1.png')
  })

  it('SVG 整块当一个图，内部路径数据不会被读成正文', () => {
    const { text } = extractXhtmlText(
      '<p>前</p><svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/><text>不该出现</text></svg>',
      ''
    )
    expect(text).toBe('前\n' + IMAGE_PLACEHOLDER)
  })

  it('占位符偏移是「在整章文本里的下标」，跨段也算得对', () => {
    const { text, images } = extractXhtmlText(
      '<p>第一段</p><p>图案<img src="b.png"/>之后</p>',
      ''
    )
    // 第一段 3 字 + \n = 4，第二段里「图案」占 2 → 占位符在下标 6
    expect(images[0]?.offset).toBe(6)
    expect(text[6]).toBe(IMAGE_PLACEHOLDER)
  })

  it('同一段里多张图，偏移各自正确', () => {
    const { text, images } = extractXhtmlText('<p><img src="a.png"/><img src="b.png"/></p>', '')
    expect(images.map((image) => image.offset)).toEqual([0, 1])
    expect(text).toBe(IMAGE_PLACEHOLDER + IMAGE_PLACEHOLDER)
  })
})
