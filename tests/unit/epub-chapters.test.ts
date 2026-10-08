import { describe, expect, it } from 'vitest'
import { buildEpubContent, HUGE_CHAPTER_CHARS } from '@main/services/epub/chapters'
import { parseOpf, type OpfPackage } from '@main/services/epub/opf'
import { parseToc } from '@main/services/epub/toc'

/**
 * 目录解析 + 章节定位（0.2.0 第 3 步）。
 *
 * 最要紧的一条是**不变量**：章节表必须无缝、无重叠地覆盖整段正文 ——
 * 因为阅读器、书签、进度全按 `text.slice(start, start + length)` 取章，
 * 这里错一点，读者就会看到「前半段属于上一章」或者干脆丢字。
 */

/** 造一个包 + 一个 read 函数，模拟真实 EPUB 的取用方式。 */
function makeBook(
  opfXml: string,
  files: Record<string, string>
): { opf: OpfPackage; read: (href: string) => string | null } {
  const opf = parseOpf(opfXml, 'OEBPS/content.opf')
  return { opf, read: (href: string) => files[href] ?? null }
}

function assertCoversText(chapters: Array<{ startOffset: number; charLength: number }>, total: number) {
  let cursor = 0
  for (const chapter of chapters) {
    expect(chapter.startOffset).toBe(cursor)
    expect(chapter.charLength).toBeGreaterThan(0)
    cursor += chapter.charLength
  }
  expect(cursor).toBe(total)
}

describe('epub/toc.ts', () => {
  it('读 EPUB 3 的 nav：层级来自 ol 嵌套，且只认 toc 那个 nav', () => {
    const nav = `<html><body>
      <nav epub:type="landmarks"><ol><li><a href="cover.xhtml">封面</a></li></ol></nav>
      <nav epub:type="toc"><ol>
        <li><a href="ch1.xhtml">第一章</a>
          <ol><li><a href="ch1.xhtml#s1">第一节</a></li></ol>
        </li>
        <li><a href="ch2.xhtml">第二章</a></li>
      </ol></nav>
    </body></html>`
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
         <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine><itemref idref="c1"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const entries = parseToc(opf, (href) => (href === 'OEBPS/nav.xhtml' ? nav : null))
    expect(entries.map((entry) => [entry.title, entry.path, entry.fragment, entry.depth])).toEqual([
      ['第一章', 'OEBPS/ch1.xhtml', '', 1],
      ['第一节', 'OEBPS/ch1.xhtml', 's1', 2],
      ['第二章', 'OEBPS/ch2.xhtml', '', 1]
    ])
  })

  it('没有 nav 时退 NCX，层级来自 navPoint 嵌套', () => {
    const ncx = `<ncx><navMap>
      <navPoint><navLabel><text>上册</text></navLabel><content src="a.xhtml"/>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml#c1"/></navPoint>
      </navPoint>
    </navMap></ncx>`
    const opf = parseOpf(
      `<package><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
       <spine toc="ncx"><itemref idref="ncx"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const entries = parseToc(opf, (href) => (href === 'OEBPS/toc.ncx' ? ncx : null))
    expect(entries.map((entry) => [entry.title, entry.depth, entry.fragment])).toEqual([
      ['上册', 1, ''],
      ['第一章', 2, 'c1']
    ])
  })

  it('两种目录都没有：返回空数组（由章节定位那边兜底）', () => {
    const opf = parseOpf('<package><spine/></package>', 'content.opf')
    expect(parseToc(opf, () => null)).toEqual([])
  })
})

describe('epub/chapters.ts：一个文件一章（干净形态）', () => {
  const opfXml = `<package><metadata><dc:title>样书</dc:title></metadata>
    <manifest>
      <item id="n" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="c1" href="Text/c1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="Text/c2.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`

  it('按目录落点切章，偏移精确、无缝覆盖', () => {
    const files = {
      'OEBPS/nav.xhtml': `<nav epub:type="toc"><ol>
        <li><a href="Text/c1.xhtml">第一章 起点</a></li>
        <li><a href="Text/c2.xhtml">第二章 终点</a></li>
      </ol></nav>`,
      'OEBPS/Text/c1.xhtml': '<h1>第一章 起点</h1><p>甲</p><p>乙</p>',
      'OEBPS/Text/c2.xhtml': '<h1>第二章 终点</h1><p>丙</p>'
    }
    const { opf, read } = makeBook(opfXml, files)
    const { text, chapters } = buildEpubContent(opf, read)

    expect(text).toBe('第一章 起点\n甲\n乙\n第二章 终点\n丙')
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章 起点', '第二章 终点'])
    assertCoversText(chapters, text.length)
  })

  it('目录漏了开头的正文时补一个「开篇」', () => {
    const files = {
      'OEBPS/nav.xhtml': `<nav epub:type="toc"><ol><li><a href="Text/c2.xhtml">第二章</a></li></ol></nav>`,
      'OEBPS/Text/c1.xhtml': '<p>版权页</p><p>目录页</p>',
      'OEBPS/Text/c2.xhtml': '<h1>第二章</h1><p>丙</p>'
    }
    const { opf, read } = makeBook(opfXml, files)
    const { text, chapters } = buildEpubContent(opf, read)
    expect(chapters[0]?.title).toBe('开篇')
    expect(chapters[0]?.kind).toBe('segment')
    expect(chapters.map((chapter) => chapter.title)).toEqual(['开篇', '第二章'])
    assertCoversText(chapters, text.length)
  })
})

describe('epub/chapters.ts：一个文件多章（老式形态，靠标题找位置）', () => {
  const opfXml = `<package><manifest>
      <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="c1" href="text00000.html" media-type="application/xhtml+xml"/>
    </manifest>
    <spine toc="n"><itemref idref="c1"/></spine></package>`

  it('多条目录指向同一文件且无 #片段：按标题在正文里定位', () => {
    const ncx = `<ncx><navMap>
      <navPoint><navLabel><text>第一章 飞刀与快剑</text></navLabel><content src="text00000.html"/></navPoint>
      <navPoint><navLabel><text>第二章 海内存知己</text></navLabel><content src="text00000.html"/></navPoint>
    </navMap></ncx>`
    // 注意：正文里用的是全角空格，目录里是半角 —— 去空白后必须能匹配上
    const chapter = `<div>
      <p><b>第一章\u3000飞刀与快剑</b></p><p>甲</p><p>乙</p>
      <p><b>第二章\u3000海内存知己</b></p><p>丙</p>
    </div>`
    const { opf, read } = makeBook(opfXml, {
      'OEBPS/toc.ncx': ncx,
      'OEBPS/text00000.html': chapter
    })
    const { text, chapters } = buildEpubContent(opf, read)

    expect(chapters.map((chapterItem) => chapterItem.title)).toEqual([
      '第一章 飞刀与快剑',
      '第二章 海内存知己'
    ])
    expect(chapters[0]?.startOffset).toBe(0)
    expect(text.slice(chapters[1]?.startOffset ?? 0, (chapters[1]?.startOffset ?? 0) + 6)).toContain(
      '第二章'
    )
    assertCoversText(chapters, text.length)
  })

  it('按 #片段（元素 id）定位，比标题匹配更优先', () => {
    const nav = `<nav epub:type="toc"><ol>
      <li><a href="one.xhtml#part2">第二部</a></li>
    </ol></nav>`
    const files: Record<string, string> = {
      'OEBPS/nav.xhtml': nav,
      'OEBPS/one.xhtml': '<p id="part1">第一部</p><p>甲</p><p id="part2">第二部</p><p>乙</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
         <item id="c" href="one.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine><itemref idref="c"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { text, chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['开篇', '第二部'])
    expect(text.slice(chapters[1]?.startOffset ?? 0).startsWith('第二部')).toBe(true)
    assertCoversText(chapters, text.length)
  })
})

describe('epub/chapters.ts：目录不可靠时靠标题救回来（真书上实测到的坑）', () => {
  it('目录把某一章指到了错误的文件，也要靠全局标题索引找回来', () => {
    // 《多情剑客无情剑》实测：NCX 把第五～七章指到了下一个文件，正文里却在上一个文件。
    // 只信目录的文件映射，就会整章丢掉（90 章只剩 53 章）。
    const files: Record<string, string> = {
      'OEBPS/toc.ncx': `<ncx><navMap>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/></navPoint>
        <navPoint><navLabel><text>第二章</text></navLabel><content src="b.xhtml"/></navPoint>
        <navPoint><navLabel><text>第三章</text></navLabel><content src="b.xhtml"/></navPoint>
      </navMap></ncx>`,
      // 第二章其实在 a.xhtml 里（目录写错了），第三章才在 b.xhtml
      'OEBPS/a.xhtml': '<p>第一章</p><p>甲</p><p>第二章</p><p>乙</p>',
      'OEBPS/b.xhtml': '<p>第三章</p><p>丙</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
         <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="a"/><itemref idref="b"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { text, chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章', '第三章'])
    // 第二章必须落在 a.xhtml 里的那个位置，而不是被塞到 b.xhtml 开头
    const second = chapters[1]
    expect(text.slice(second?.startOffset ?? 0, (second?.startOffset ?? 0) + 3)).toBe('第二章')
    assertCoversText(chapters, text.length)
  })

  it('目录给出的标题在正文里完全找不到时，宁可跳过也不乱塞', () => {
    const files: Record<string, string> = {
      'OEBPS/toc.ncx': `<ncx><navMap>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/></navPoint>
        <navPoint><navLabel><text>查无此章</text></navLabel><content src="a.xhtml"/></navPoint>
      </navMap></ncx>`,
      'OEBPS/a.xhtml': '<p>第一章</p><p>正文</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="a"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { text, chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章'])
    assertCoversText(chapters, text.length)
  })

  it('目录给了真标题的章再长也不切碎（超长切分只用于没有目录的兜底）', () => {
    const longBody = Array.from({ length: 30 }, (_v, i) => '<p>' + '正文'.repeat(30) + i + '</p>').join('')
    const files: Record<string, string> = {
      'OEBPS/toc.ncx': `<ncx><navMap>
        <navPoint><navLabel><text>第一章 很长</text></navLabel><content src="a.xhtml"/></navPoint>
      </navMap></ncx>`,
      'OEBPS/a.xhtml': '<p>第一章 很长</p>' + longBody
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="a"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章 很长'])
  })
})

describe('epub/chapters.ts：目录层级与垃圾项过滤', () => {
  it('取到第 3 层：小节（一 / 二 / 三）保留，并记住它属于哪一章', () => {
    const ncx = `<ncx><navMap>
      <navPoint><navLabel><text>第一部</text></navLabel><content src="a.xhtml"/>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/>
          <navPoint><navLabel><text>一</text></navLabel><content src="a.xhtml"/></navPoint>
        </navPoint>
      </navPoint>
    </navMap></ncx>`
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="c" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="c"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { chapters } = buildEpubContent(opf, (href) =>
      href === 'OEBPS/toc.ncx'
        ? ncx
        : '<p>第一部</p><p>第一章</p><p>一</p><p>正文</p>'
    )
    // 用户 2026-10-08：那些「一 / 二 / 三」是**小节**，不是页码 —— 要留下并挂到章上。
    // 同时：这里的「第一章」只有两个字（标题页），被并进了它自己的小节，
    // 所以章这一行不再单独占页，标题落在小节正文开头。
    expect(chapters.map((chapter) => [chapter.title, chapter.parentTitle])).toEqual([
      ['第一部', '第一部'],
      ['一', '第一章']
    ])
  })

  it('章自己有正文时不并页（只有「标题页」那种才并）', () => {
    const ncx = `<ncx><navMap>
      <navPoint><navLabel><text>第一部</text></navLabel><content src="a.xhtml"/>
        <navPoint><navLabel><text>第一章 很长的一章</text></navLabel><content src="a.xhtml"/>
          <navPoint><navLabel><text>一</text></navLabel><content src="a.xhtml"/></navPoint>
        </navPoint>
      </navPoint>
    </navMap></ncx>`
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="a"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const body = '正文'.repeat(40)
    const { chapters } = buildEpubContent(opf, (href) =>
      href === 'OEBPS/toc.ncx'
        ? ncx
        : '<p>第一部</p><p>第一章 很长的一章</p><p>' + body + '</p><p>一</p><p>乙</p>'
    )
    // 章自己有一大段正文 → 保留成独立一章；小节仍然挂在它下面
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一部', '第一章 很长的一章', '一'])
    expect(chapters[2]?.parentTitle).toBe('第一章 很长的一章')
  })

  it('更深一层（第 4 层）不取；纯数字标题也照常保留', () => {
    const files: Record<string, string> = {
      'OEBPS/nav.xhtml': `<nav epub:type="toc"><ol>
        <li><a href="a.xhtml">第一章</a></li>
        <li><a href="a.xhtml">12</a></li>
        <li><a href="a.xhtml">一、二</a></li>
      </ol></nav>`,
      'OEBPS/a.xhtml': '<p>第一章</p><p>12</p><p>一、二</p><p>正文</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
         <item id="c" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine><itemref idref="c"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章', '12', '一、二'])
  })

  it('同一个落点的多条目录只留最后一条（更具体的那条）', () => {
    const files: Record<string, string> = {
      'OEBPS/nav.xhtml': `<nav epub:type="toc"><ol>
        <li><a href="book.xhtml">红高粱家族</a>
          <ol><li><a href="book.xhtml">卷首语</a></li></ol>
        </li>
        <li><a href="book.xhtml">第一章</a></li>
      </ol></nav>`,
      'OEBPS/book.xhtml': '<p>卷首语</p><p>第一章</p><p>正文</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
         <item id="c" href="book.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine><itemref idref="c"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['卷首语', '第一章'])
  })
})

describe('epub/chapters.ts：合集分组（0.2.0）', () => {
  it('目录顶层是卷名时，把卷名挂到该卷的章上（跨卷自动换组）', () => {
    const files: Record<string, string> = {
      'OEBPS/toc.ncx': `<ncx><navMap>
        <navPoint><navLabel><text>甲集</text></navLabel><content src="a.xhtml"/>
          <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/></navPoint>
          <navPoint><navLabel><text>第二章</text></navLabel><content src="a.xhtml"/></navPoint>
        </navPoint>
        <navPoint><navLabel><text>乙集</text></navLabel><content src="b.xhtml"/>
          <navPoint><navLabel><text>第一章</text></navLabel><content src="b.xhtml"/></navPoint>
        </navPoint>
      </navMap></ncx>`,
      'OEBPS/a.xhtml': '<p>甲集</p><p>第一章</p><p>甲一</p><p>第二章</p><p>甲二</p>',
      'OEBPS/b.xhtml': '<p>乙集</p><p>第一章</p><p>乙一</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
         <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="a"/><itemref idref="b"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { text, chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => [chapter.groupTitle, chapter.title])).toEqual([
      ['甲集', '甲集'],
      ['甲集', '第一章'],
      ['甲集', '第二章'],
      ['乙集', '乙集'],
      ['乙集', '第一章']
    ])
    assertCoversText(chapters, text.length)
  })

  it('普通书（目录是平的）不给分组，行为与以前完全一致', () => {
    const files: Record<string, string> = {
      'OEBPS/toc.ncx': `<ncx><navMap>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/></navPoint>
        <navPoint><navLabel><text>第二章</text></navLabel><content src="a.xhtml"/></navPoint>
      </navMap></ncx>`,
      'OEBPS/a.xhtml': '<p>第一章</p><p>甲</p><p>第二章</p><p>乙</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="a"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.every((chapter) => chapter.groupTitle === null)).toBe(true)
  })

  it('标题在正文里找不到、但那一页没有文字（封面 / 纯插图页）→ 落点定在文件开头，不丢', () => {
    const files: Record<string, string> = {
      'OEBPS/toc.ncx': `<ncx><navMap>
        <navPoint><navLabel><text>封面</text></navLabel><content src="cover.xhtml"/></navPoint>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/></navPoint>
      </navMap></ncx>`,
      // 封面页：标题只在 <head><title> 里（提取时会跳过），正文只有一张图
      'OEBPS/cover.xhtml': '<html><head><title>封面</title></head><body><img src="c.png"/></body></html>',
      'OEBPS/a.xhtml': '<p>第一章</p><p>甲</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="c" href="cover.xhtml" media-type="application/xhtml+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="c"/><itemref idref="a"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { text, chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['封面', '第一章'])
    expect(chapters[0]?.startOffset).toBe(0)
    assertCoversText(chapters, text.length)
  })

  it('有正文但标题对不上的条目仍然跳过（不硬塞），封面兜底不会误伤', () => {
    const files: Record<string, string> = {
      'OEBPS/toc.ncx': `<ncx><navMap>
        <navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/></navPoint>
        <navPoint><navLabel><text>目录里瞎写的标题</text></navLabel><content src="a.xhtml"/></navPoint>
      </navMap></ncx>`,
      'OEBPS/a.xhtml': '<p>第一章</p><p>甲</p><p>乙</p>'
    }
    const opf = parseOpf(
      `<package><manifest>
         <item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine toc="n"><itemref idref="a"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const { text, chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章'])
    assertCoversText(chapters, text.length)
  })
})

describe('epub/chapters.ts：兜底', () => {
  it('完全没有目录：一个 spine 文件一章，短首行当章名', () => {
    const opf = parseOpf(
      `<package><manifest>
         <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
         <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
       </manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const files: Record<string, string> = {
      'OEBPS/a.xhtml': '<h1>甲章</h1><p>正文一</p>',
      'OEBPS/b.xhtml': '<p>' + '很长的第一行'.repeat(20) + '</p>'
    }
    const { text, chapters } = buildEpubContent(opf, (href) => files[href] ?? null)
    expect(chapters[0]?.title).toBe('甲章')
    expect(chapters[1]?.title).toBe('第 2 节') // 首行太长，不用它当章名
    assertCoversText(chapters, text.length)
  })

  it('没有目录且单章过大（整本一个文件）：退回 TXT 的切章规则', () => {
    const opf = parseOpf(
      `<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
       <spine><itemref idref="a"/></spine></package>`,
      'OEBPS/content.opf'
    )
    const body = Array.from({ length: 400 }, (_v, i) => `<p>第 ${i + 1} 段正文，凑字数用的。</p>`).join('')
    const { text, chapters } = buildEpubContent(opf, () => '<p>' + '第一章' + '</p>' + body)
    expect(text.length).toBeGreaterThan(0)
    // 单章过大时会被切开（正则不中 → 定长分段），但绝不能丢字
    assertCoversText(chapters, text.length)
    if (text.length > HUGE_CHAPTER_CHARS) expect(chapters.length).toBeGreaterThan(1)
  })
})
