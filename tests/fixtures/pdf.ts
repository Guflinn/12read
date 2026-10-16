/**
 * 极简 PDF 夹具（0.4.0）：在内存里现造一个**有文字层**的最小 PDF。
 *
 * 仓库里不放二进制书籍（版权 + 体积），所以和 MOBI 的夹具一样现造。
 * 用 Type1 的 Helvetica（PDF 内置字体，不需要嵌入字体文件），所以正文只能是 ASCII ——
 * 中文 PDF 的排版逻辑改用「合成文字项」在单测里测（见 tests/unit/pdf-layout.test.ts），
 * 这里只负责把**真实的 PDF 解析链路**（pdfjs 读字节 → 文字项 → 段落 → 章节）跑通。
 */
export interface PdfLineSpec {
  text: string
  /** 左下角坐标（PDF 坐标，原点在左下角）。 */
  x: number
  y: number
  size?: number
}

export interface PdfPageSpec {
  lines: PdfLineSpec[]
}

export interface PdfOutlineSpec {
  title: string
  /** 从 1 开始的页码。 */
  page: number
  /** 层级：1 是顶层。夹具只做两层。 */
  depth?: number
}

export interface PdfSpec {
  pages?: PdfPageSpec[]
  title?: string
  author?: string
  outline?: PdfOutlineSpec[]
}

/**
 * PDF 字符串字面量：纯 ASCII 用 `(...)`，含非 ASCII 的（中文书名、目录标题）
 * 用 UTF-16BE 的十六进制写法 `<FEFF...>` —— 这也是真实 PDF 里 CJK 的正常存法。
 */
function pdfString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) {
    return '(' + text.replace(/[\\()]/g, (char) => '\\' + char) + ')'
  }
  const utf16be = Buffer.from(text, 'utf16le')
  for (let i = 0; i + 1 < utf16be.length; i += 2) {
    const low = utf16be[i]
    utf16be[i] = utf16be[i + 1]
    utf16be[i + 1] = low
  }
  return '<FEFF' + utf16be.toString('hex').toUpperCase() + '>'
}

const esc = (text: string): string => text.replace(/[\\()]/g, (char) => '\\' + char)

export function createPdf(spec: PdfSpec = {}): Buffer {
  const pages = spec.pages ?? [{ lines: [{ text: 'Chapter 1', x: 72, y: 700, size: 20 }] }]
  const outline = spec.outline ?? []

  const objects: string[] = []
  const add = (body: string): number => {
    objects.push(body)
    return objects.length
  }

  const catalogId = add('') // 占位，后面回填
  const pagesId = add('')
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const infoId = add(
    '<< /Producer (12read test fixture)' +
      (spec.title ? ' /Title ' + pdfString(spec.title) : '') +
      (spec.author ? ' /Author ' + pdfString(spec.author) : '') +
      ' >>'
  )
  const outlineId = outline.length > 0 ? add('') : null

  // 每页一组：Page 对象 + 内容流；先记下 id，好让目录项指回来
  const pageIds: number[] = []
  const pageObjectIds: Array<{ pageId: number; contentId: number }> = pages.map((page) => {
    void page
    const contentId = add('') // 内容流占位，等拿到 pageId 之后再填（顺序无所谓，PDF 允许前向引用）
    const pageId = add('')
    pageIds.push(pageId)
    return { pageId, contentId }
  })

  pages.forEach((page, index) => {
    const { pageId, contentId } = pageObjectIds[index]
    const stream = page.lines
      .map((line) => {
        const size = line.size ?? 12
        return 'BT /F1 ' + size + ' Tf ' + line.x + ' ' + line.y + ' Td (' + esc(line.text) + ') Tj ET'
      })
      .join('\n')
    objects[contentId - 1] = '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream'
    objects[pageId - 1] =
      '<< /Type /Page /Parent ' +
      pagesId +
      ' 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' +
      fontId +
      ' 0 R >> >> /Contents ' +
      contentId +
      ' 0 R >>'
  })

  // 目录（/Outlines）：顶层项各自 /Dest 指到某一页
  const outlineItemIds: number[] = []
  if (outlineId !== null) {
    // 先把每个顶层项的对象号占出来，才能互相串 Next / Prev
    const tops = outline.filter((item) => (item.depth ?? 1) === 1)
    for (let i = 0; i < tops.length; i += 1) outlineItemIds.push(add(''))
    tops.forEach((item, index) => {
      const id = outlineItemIds[index]
      const pageRef = pageIds[Math.min(item.page, pageIds.length) - 1] ?? pageIds[0]
      const next = index + 1 < outlineItemIds.length ? ' /Next ' + outlineItemIds[index + 1] + ' 0 R' : ''
      const prev = index > 0 ? ' /Prev ' + outlineItemIds[index - 1] + ' 0 R' : ''
      objects[id - 1] =
        '<< /Title ' +
        pdfString(item.title) +
        ' /Parent ' +
        outlineId +
        ' 0 R' +
        prev +
        next +
        ' /Dest [' +
        pageRef +
        ' 0 R /Fit] >>'
    })
    objects[outlineId - 1] =
      '<< /Type /Outlines /First ' +
      outlineItemIds[0] +
      ' 0 R /Last ' +
      outlineItemIds[outlineItemIds.length - 1] +
      ' 0 R /Count ' +
      outlineItemIds.length +
      ' >>'
  }

  objects[catalogId - 1] =
    '<< /Type /Catalog /Pages ' +
    pagesId +
    ' 0 R' +
    (outlineId === null ? '' : ' /Outlines ' + outlineId + ' 0 R /PageMode /UseOutlines') +
    ' >>'
  objects[pagesId - 1] =
    '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>'

  // 序列化 + xref（偏移按字节算；上面全用 latin1 里的单字节字符，字符数即字节数）
  let out = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += index + 1 + ' 0 obj\n' + body + '\nendobj\n'
  })
  const xrefStart = out.length
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
  for (const offset of offsets) out += String(offset).padStart(10, '0') + ' 00000 n \n'
  out +=
    'trailer\n<< /Size ' +
    (objects.length + 1) +
    ' /Root ' +
    catalogId +
    ' 0 R /Info ' +
    infoId +
    ' 0 R >>\nstartxref\n' +
    xrefStart +
    '\n%%EOF\n'

  return Buffer.from(out, 'latin1')
}

/** 一个三页、带目录的样张（e2e 与单测共用）。 */
export function createOutlinedPdf(): Buffer {
  return createPdf({
    title: '样张',
    author: '测试作者',
    outline: [
      { title: 'Chapter 1 起风', page: 1 },
      { title: 'Chapter 2 落雨', page: 3 }
    ],
    pages: [
      {
        lines: [
          { text: 'Chapter 1', x: 72, y: 720, size: 20 },
          { text: 'The wind came down from the pass that', x: 72, y: 660 },
          { text: 'morning, and the door would not stay shut.', x: 72, y: 640 },
          { text: 'A second paragraph starts here.', x: 72, y: 590 }
        ]
      },
      {
        lines: [
          // 第二行明显更短 → 只是换行，不是新段落（用来验证「跨行接句」）
          { text: 'It kept blowing all afternoon, harder', x: 72, y: 660 },
          { text: 'and harder.', x: 72, y: 640 }
        ]
      },
      {
        lines: [
          { text: 'Chapter 2', x: 72, y: 720, size: 20 },
          { text: 'Rain fell on the roof tiles and', x: 72, y: 660 },
          { text: 'nobody went outside that night.', x: 72, y: 640 }
        ]
      }
    ]
  })
}

/** 没有目录的 PDF：只能按页切章。 */
export function createPlainPdf(): Buffer {
  return createPdf({
    pages: [
      { lines: [{ text: 'Only page one has words.', x: 72, y: 660 }] },
      { lines: [{ text: 'Only page two has words.', x: 72, y: 660 }] }
    ]
  })
}

/**
 * 「扫描件」：一页里一个文字项都没有（真实的扫描件就是这样，正文是图片）。
 * 页面对象照旧，只是内容流是空的。
 */
export function createScannedPdf(): Buffer {
  return createPdf({ pages: [{ lines: [] }, { lines: [] }] })
}
