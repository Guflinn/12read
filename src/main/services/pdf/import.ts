/**
 * PDF 提取器（0.4.0）：**只做有文字层的 PDF**。
 *
 * 与其它格式一样，产出的还是「连续正文 + 章节表 + UTF-16 偏移」，所以进度 / 书签 /
 * 划线 / 搜索 / 统计一行都不用改。差别在于 PDF 的正文是**从固定版面里抠出来的**：
 * 段落靠坐标判断，缩进与分栏不可靠，**不承诺排版保真**（产品口径见 CHANGELOG 0.4.0）。
 *
 * 三条边界：
 *  ① **扫描件不读**：一页里一个文字项都没有（正文其实是图片）→ 明确报「扫描件」，
 *     OCR 不在规划内；
 *  ② **加密 PDF 打不开**：给中文提示，不做也不打算做；
 *  ③ **章节**优先用 PDF 自带的目录（`/Outlines`），没有目录就**按页分章**（「第 N 页」）——
 *     比按字数硬切诚实，也与用户 2026-10-16 拍板的口径一致。
 *
 * pdfjs 走**动态 import**：它是 ESM 包，主进程是 CJS 产物，动态 import 是这两者之间
 * 最省事的桥；顺带让「没装 pdfjs 也能起应用」保持成立（只有真的导入 PDF 才加载它）。
 */
import type { Module as NodeModule } from 'node:module'
import { ImportError } from '../import-error'
import { canvasShimExports } from './canvas-shim'
import { pageToParagraphs, type PdfTextItem } from './layout'
import type { ChapterKind } from '@shared/types'

/** 我们用到的那一小块 pdfjs API（结构化类型，不依赖它自己的 .d.mts 解析）。 */
interface PdfjsTextContent {
  items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>
}
interface PdfjsPage {
  getTextContent(): Promise<PdfjsTextContent>
  cleanup?(): void
}
interface PdfjsOutlineItem {
  title: string
  dest: unknown
  items?: PdfjsOutlineItem[]
}
interface PdfjsDocument {
  numPages: number
  getPage(index: number): Promise<PdfjsPage>
  getMetadata(): Promise<{ info?: Record<string, unknown> }>
  getOutline(): Promise<PdfjsOutlineItem[] | null>
  getDestination(name: string): Promise<unknown[] | null>
  getPageIndex(ref: unknown): Promise<number>
  destroy(): Promise<void>
}
interface PdfjsModule {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfjsDocument> }
}

export interface PdfChapter {
  title: string
  startOffset: number
  charLength: number
  kind: ChapterKind
}

export interface PdfImportResult {
  text: string
  chapters: PdfChapter[]
  title: string | null
  author: string | null
  /** 抽到的文字项总数（诊断用：为 0 基本就是扫描件）。 */
  itemCount: number
  /** 章节是按目录切的还是按页切的（日志与测试用）。 */
  chapterSource: 'outline' | 'page'
}

/** 一页的文字项里，如果全是空白，就当这一页没有文字。 */
function toTextItems(content: PdfjsTextContent): PdfTextItem[] {
  const items: PdfTextItem[] = []
  for (const raw of content.items) {
    const str = typeof raw.str === 'string' ? raw.str : ''
    if (str.trim() === '') continue
    const transform = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0]
    const x = Number(transform[4] ?? 0)
    const y = Number(transform[5] ?? 0)
    items.push({
      str,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      width: Number(raw.width ?? 0),
      height: Math.abs(Number(raw.height ?? 0)) || Math.abs(Number(transform[3] ?? 0)) || 10
    })
  }
  return items
}

/**
 * 用**纯 JS 替身**顶掉 pdfjs 的 canvas 依赖（**必须在 import pdfjs 之前调用**）。
 *
 * pdfjs 在 Node 环境下**模块加载时**就会 `require('@napi-rs/canvas')`，拿它把
 * `DOMMatrix` / `ImageData` 装成全局变量，并且顶层就 `new DOMMatrix()` 建了个常量。
 * 那个包带来的 skia 原生模块在 Electron 里加载会**直接把进程打崩**：Windows 错误报告里是
 * `BEX64`、故障模块 `skia.win32-x64-msvc.node`、异常代码 `c0000005`（访问冲突），
 * 用户看到的就是「十二阅读 has stopped working」。
 *
 * 所以这里在 require 缓存里放一份 `canvas-shim`：pdfjs 会照常拿到 `DOMMatrix` / `ImageData`
 * （不再 warn，也不会去碰原生模块），文字抽取完全不受影响。解析不到这个包（打包后的应用
 * 里本来就没有）就什么都不做 —— pdfjs 那句 require 自己有 try/catch。
 */
function blockCanvasNative(): void {
  try {
    // 主进程与 worker 的产物都是 CJS，require 一定在；拿不到就跳过
    if (typeof require !== 'function' || require.cache === undefined) return
    const resolved = require.resolve('@napi-rs/canvas')
    require.cache[resolved] = {
      exports: canvasShimExports,
      loaded: true,
      id: resolved,
      filename: resolved,
      paths: []
    } as unknown as NodeModule
  } catch {
    // 没装 / 解析不到：交给 pdfjs 自己的 try/catch
  }
}

async function loadPdfjs(): Promise<PdfjsModule> {
  blockCanvasNative()
  try {
    // legacy 包是给非浏览器环境（Node / Electron 主进程 / worker_threads）准备的
    return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule
  } catch (cause) {
    throw new ImportError('io-error', 'PDF 解析库没能加载起来（安装包不完整？）', cause)
  }
}

/** pdfjs 的错误翻成中文人话。 */
function translatePdfError(cause: unknown): ImportError {
  const name = cause instanceof Error ? cause.name : ''
  if (name === 'PasswordException') {
    return new ImportError('decode-failed', '这份 PDF 有密码保护，打不开', cause)
  }
  if (name === 'InvalidPDFException') {
    return new ImportError('decode-failed', '这个文件不是有效的 PDF（或者已经损坏）', cause)
  }
  return new ImportError('decode-failed', '这个 PDF 读不了：' + (cause instanceof Error ? cause.message : String(cause)), cause)
}

function cleanMetadata(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' || text.length > 200 ? null : text
}

/** 目录项的 /Dest 指到第几页（0 起）；解析不出来给 null。 */
async function pageOfOutlineItem(document: PdfjsDocument, dest: unknown): Promise<number | null> {
  let target = dest
  try {
    if (typeof target === 'string') target = await document.getDestination(target)
    if (!Array.isArray(target) || target.length === 0) return null
    const index = await document.getPageIndex(target[0])
    return Number.isInteger(index) && index >= 0 ? index : null
  } catch {
    return null
  }
}

/** 没有目录：一页一章（「第 N 页」）。 */
function pageChapters(pages: Array<{ start: number; text: string }>, total: number): PdfChapter[] {
  return pages.map((page, index) => ({
    title: '第 ' + (index + 1) + ' 页',
    startOffset: page.start,
    charLength: (index + 1 < pages.length ? pages[index + 1].start : total) - page.start,
    kind: 'segment' as ChapterKind
  }))
}

export async function decodePdf(bytes: Buffer): Promise<PdfImportResult> {
  const pdfjs = await loadPdfjs()

  let document: PdfjsDocument
  try {
    document = await pdfjs.getDocument({
      // 传副本：pdfjs 会接管这块内存，别让它碰到外层的 Buffer
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      verbosity: 0
    }).promise
  } catch (cause) {
    throw translatePdfError(cause)
  }

  try {
    const pages: Array<{ start: number; text: string }> = []
    let text = ''
    let itemCount = 0

    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      const items = toTextItems(await page.getTextContent())
      itemCount += items.length
      const pageText = pageToParagraphs(items).join('\n')
      pages.push({ start: text.length, text: pageText })
      // 页与页之间恰好一个换行：章节表要靠它无缝覆盖全书
      text += number < document.numPages ? pageText + '\n' : pageText
      page.cleanup?.()
    }

    if (itemCount === 0 || text.trim().length === 0) {
      throw new ImportError(
        'binary',
        '这看起来是扫描件（整本没有文字层），读不了文字；扫描件要先用 OCR 转成文字版 PDF'
      )
    }

    const outline = await document.getOutline().catch(() => null)
    let chapters: PdfChapter[] = []
    let chapterSource: 'outline' | 'page' = 'page'

    if (outline !== null && outline.length >= 2) {
      const entries: Array<{ title: string; page: number }> = []
      for (const item of outline) {
        const page = await pageOfOutlineItem(document, item.dest)
        if (page === null) continue
        const title = item.title.replace(/\s+/g, ' ').trim()
        if (title === '') continue
        // 同一页上的多个目录项（比如「卷 + 章」）只留第一个，免得切出零长章节
        if (entries.some((entry) => entry.page === page)) continue
        entries.push({ title, page })
      }
      entries.sort((a, b) => a.page - b.page)

      if (entries.length >= 2) {
        chapterSource = 'outline'
        const firstPage = entries[0].page
        // 目录第一项之前的正文（封面、版权页）单独成「开篇」，一个字都不丢
        if (firstPage > 0 && pages[firstPage] !== undefined && pages[firstPage].start > 0) {
          chapters.push({
            title: '开篇',
            startOffset: 0,
            charLength: pages[firstPage].start,
            kind: 'segment'
          })
        }
        entries.forEach((entry, index) => {
          const start = pages[entry.page]?.start ?? 0
          const nextPage = index + 1 < entries.length ? entries[index + 1].page : pages.length
          const end = nextPage < pages.length ? pages[nextPage].start : text.length
          chapters.push({
            title: entry.title,
            startOffset: start,
            charLength: Math.max(0, end - start),
            kind: 'chapter'
          })
        })
        // 目录覆盖不到书末（目录项之外的页）时，剩下的文字挂到最后一章，保证无缝
        const last = chapters.at(-1)
        if (last !== undefined && last.startOffset + last.charLength < text.length) {
          last.charLength = text.length - last.startOffset
        }
      }
    }

    if (chapterSource === 'page') chapters = pageChapters(pages, text.length)

    const metadata = await document.getMetadata().catch(() => ({ info: undefined }))
    const info = (metadata.info ?? {}) as Record<string, unknown>

    return {
      text,
      chapters,
      title: cleanMetadata(info['Title']),
      author: cleanMetadata(info['Author']),
      itemCount,
      chapterSource
    }
  } finally {
    await document.destroy().catch(() => undefined)
  }
}
