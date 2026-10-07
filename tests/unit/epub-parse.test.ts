import { describe, expect, it } from 'vitest'
import { findOpfPath } from '@main/services/epub/ocf'
import { EpubError, dirOf, normalizePath } from '@main/services/epub/errors'
import { parseOpf } from '@main/services/epub/opf'
import { childrenNamed, localName, parseXml, textOf } from '@main/services/epub/xml'
import { openZip } from '@main/services/epub/zip-reader'
import { createZip } from '@main/services/zip-writer'

/**
 * EPUB 第 2 步（容器 + OPF）的单测。XML 解析器自己也是这一批写的，一起测。
 * 正例尽量照真实书的写法（含命名空间、相对路径、EPUB2/EPUB3 两种目录），
 * 负例是真实书里见过的坏样子（container 路径写错、idref 悬空、标签不闭合）。
 */

async function zipOf(files: Array<{ path: string; text: string }>) {
  const buffer = await createZip(
    files.map((file) => ({ path: file.path, data: Buffer.from(file.text, 'utf8') }))
  )
  return openZip(buffer)
}

describe('epub/xml.ts（手写 lenient XML）', () => {
  it('读得出元素树、属性与文本；单引号与无值属性都认', () => {
    const root = parseXml(`<a x="1" y='2' z><b>文字</b></a>`)
    expect(root?.tag).toBe('a')
    expect(root?.attrs).toEqual({ x: '1', y: '2', z: '' })
    expect(root?.children[0]?.tag).toBe('b')
    expect(root?.children[0]?.text).toBe('文字')
  })

  it('自闭合标签、注释、XML 声明、DOCTYPE（含内部子集）都能跳过', () => {
    const source = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html [ <!ENTITY x "y"> ]>
<!-- 注释里有 <假标签> -->
<root><img src="a.png"/><br/></root>`
    const root = parseXml(source)
    expect(root?.tag).toBe('root')
    expect(root?.children.map((child) => child.tag)).toEqual(['img', 'br'])
  })

  it('实体：命名 / 十进制 / 十六进制都解，认不出的原样留着', () => {
    const root = parseXml(`<t>A&amp;B &lt;x&gt; &#20320;&#x597D; &unknown; &nbsp;</t>`)
    expect(root?.text).toBe('A&B <x> 你好 &unknown; \u00a0')
  })

  it('CDATA 原样当文本，不再解实体', () => {
    const root = parseXml(`<t><![CDATA[a &amp; <b>]]></t>`)
    expect(root?.text).toBe('a &amp; <b>')
  })

  it('标签闭合对不上时尽力恢复，不整本失败', () => {
    const root = parseXml(`<a><b>一</a>`)
    expect(root?.tag).toBe('a')
    expect(root?.children[0]?.tag).toBe('b')
    expect(root?.children[0]?.text).toBe('一')
  })

  it('到结尾还没闭合的标签也算数', () => {
    const root = parseXml(`<a><b>文字`)
    expect(root?.children[0]?.tag).toBe('b')
    expect(root?.children[0]?.text).toBe('文字')
  })

  it('命名空间前缀原样留着，按本地名找时大小写不敏感', () => {
    const root = parseXml(`<package><metadata><dc:title>书名</dc:title></metadata></package>`)
    const metadata = root ? childrenNamed(root, 'metadata')[0] : undefined
    const title = metadata ? childrenNamed(metadata, 'Title')[0] : undefined
    expect(title?.tag).toBe('dc:title')
    expect(title ? textOf(title) : null).toBe('书名')
    expect(localName('dc:title')).toBe('title')
    expect(localName('title')).toBe('title')
  })

  it('textOf 把子孙文本拼起来并折叠空白', () => {
    const root = parseXml(`<t>\n  十二\n  <b>阅读</b>\n</t>`)
    expect(root ? textOf(root) : null).toBe('十二 阅读')
  })

  it('没有元素时返回 null', () => {
    expect(parseXml('只有文字没有标签')).toBeNull()
    expect(parseXml('')).toBeNull()
  })
})

describe('epub/errors.ts（路径归一化）', () => {
  it('解 %xx、去 #片段、算掉 ./ 与 ../', () => {
    expect(normalizePath('OEBPS', 'Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml')
    expect(normalizePath('OEBPS', './Text/../Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml')
    expect(normalizePath('OEBPS', 'Text/ch%201.xhtml')).toBe('OEBPS/Text/ch 1.xhtml')
    expect(normalizePath('OEBPS', '../ch1.xhtml')).toBe('ch1.xhtml')
    expect(normalizePath('', '/OEBPS/ch1.xhtml')).toBe('OEBPS/ch1.xhtml')
    expect(normalizePath('OEBPS', 'ch1.xhtml#section2')).toBe('OEBPS/ch1.xhtml')
  })

  it('坏转义不炸，按原样用', () => {
    expect(normalizePath('OEBPS', 'Text/ch%E0%A4.xhtml')).toBe('OEBPS/Text/ch%E0%A4.xhtml')
  })

  it('取目录', () => {
    expect(dirOf('OEBPS/content.opf')).toBe('OEBPS')
    expect(dirOf('content.opf')).toBe('')
  })
})

describe('epub/ocf.ts（找 OPF）', () => {
  const container = (fullPath: string, mediaType = 'application/oebps-package+xml'): string =>
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${fullPath}" media-type="${mediaType}"/>
  </rootfiles>
</container>`

  it('按 container.xml 里的 rootfile 找到 OPF', async () => {
    const zip = await zipOf([
      { path: 'META-INF/container.xml', text: container('OEBPS/content.opf') },
      { path: 'OEBPS/content.opf', text: '<package/>' }
    ])
    expect(findOpfPath(zip)).toBe('OEBPS/content.opf')
  })

  it('多条 rootfile 时挑 media-type 匹配的那条', async () => {
    const zip = await zipOf([
      {
        path: 'META-INF/container.xml',
        text: `<container><rootfiles>
          <rootfile full-path="other.xml" media-type="text/plain"/>
          <rootfile full-path="book/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles></container>`
      },
      { path: 'book/content.opf', text: '<package/>' }
    ])
    expect(findOpfPath(zip)).toBe('book/content.opf')
  })

  it('container.xml 缺失时兜底扫包内第一个 .opf', async () => {
    const zip = await zipOf([{ path: 'OEBPS/package.opf', text: '<package/>' }])
    expect(findOpfPath(zip)).toBe('OEBPS/package.opf')
  })

  it('container.xml 里的路径写错（文件不在包里）也能兜底救回来', async () => {
    const zip = await zipOf([
      { path: 'META-INF/container.xml', text: container('OEBPS/错的.opf') },
      { path: 'OEBPS/真身.opf', text: '<package/>' }
    ])
    expect(findOpfPath(zip)).toBe('OEBPS/真身.opf')
  })

  it('包里根本没有 .opf：给中文错误', async () => {
    const zip = await zipOf([{ path: 'mimetype', text: 'application/epub+zip' }])
    expect(() => findOpfPath(zip)).toThrow(EpubError)
    expect(() => findOpfPath(zip)).toThrow(/找不到书籍描述文件/)
  })
})

describe('epub/opf.ts（metadata / manifest / spine）', () => {
  const epub3 = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>十二楼</dc:title>
    <dc:creator>李渔</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="./Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/../Text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="images/1.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="cover" linear="no"/>
    <itemref idref="不存在"/>
  </spine>
</package>`

  it('读 metadata、按 spine 顺序给出章节项、认 EPUB3 的 nav', () => {
    const book = parseOpf(epub3, 'OEBPS/content.opf')
    expect(book.title).toBe('十二楼')
    expect(book.author).toBe('李渔')
    expect(book.language).toBe('zh-CN')
    expect(book.spine.map((item) => item.href)).toEqual([
      'OEBPS/Text/ch1.xhtml',
      'OEBPS/Text/ch2.xhtml'
    ])
    expect(book.navPath).toBe('OEBPS/nav.xhtml')
    expect(book.ncxPath).toBeNull()
    expect(book.opfDir).toBe('OEBPS')
    expect(book.items.get('img')?.mediaType).toBe('image/png')
  })

  it('EPUB2：从 spine 的 toc 属性找 NCX；没有 nav 时 navPath 为 null', () => {
    const epub2 = `<package version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>旧书</dc:title></metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>`
    const book = parseOpf(epub2, 'content.opf')
    expect(book.title).toBe('旧书')
    expect(book.ncxPath).toBe('toc.ncx')
    expect(book.navPath).toBeNull()
    expect(book.spine.map((item) => item.href)).toEqual(['ch1.xhtml'])
  })

  it('OPF 被多包了一层、或有坏标签也能读出 spine', () => {
    const wrapped = `<wrapper><package><manifest>
        <item id="a" href="a.xhtml" media-type="application/xhtml+xml">
      </manifest><spine><itemref idref="a"/></spine></package></wrapper>`
    expect(parseOpf(wrapped, 'OEBPS/content.opf').spine.map((i) => i.href)).toEqual([
      'OEBPS/a.xhtml'
    ])
  })

  it('空 OPF / 没 metadata：返回空壳而不是抛错（上层再决定怎么兜底）', () => {
    const empty = parseOpf('<package/>', 'content.opf')
    expect(empty.title).toBeNull()
    expect(empty.author).toBeNull()
    expect(empty.spine).toEqual([])
    expect(parseOpf('', 'content.opf').spine).toEqual([])
  })

  it('metadata 里的实体会被解开（书名带 & 的书很常见）', () => {
    const book = parseOpf(
      `<package><metadata><dc:title>番茄&amp;土豆</dc:title></metadata></package>`,
      'content.opf'
    )
    expect(book.title).toBe('番茄&土豆')
  })

  it('spine 为空但 manifest 有正文时，spine 就是空数组（由上层决定兜底策略）', () => {
    const book = parseOpf(
      `<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>`,
      'content.opf'
    )
    expect(book.spine).toEqual([])
    expect(book.items.size).toBe(1)
  })
})
