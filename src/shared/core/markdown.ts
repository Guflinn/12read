import type { ChapterKind } from '../types'
import { splitChapters, type SplitResult } from './chapter-split'

/**
 * Markdown 的切章与标题处理（0.4.0）。
 *
 * 产品立场（与 EPUB / MOBI 一致）：**正文一个字都不改** —— 提取出来的 text 就是文件的
 * 原始字符流（含 `#`、`**` 这些标记），渲染时才把标记藏起来。这样进度 / 书签 / 划线 /
 * 搜索 / 统计这些「按 UTF-16 偏移定位」的东西全部照旧工作，一个新格式不会牵动它们。
 */

/** ATX 标题：`## 标题`（结尾的装饰性 `#` 一起吃掉）。最多 6 级。 */
const ATX_HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/

/** 围栏代码块的起止（``` 或 ~~~）。围栏里的 `#` 是代码，不是标题。 */
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/

export interface MarkdownHeading {
  /** 1–6。 */
  level: number
  /** 这一行在全文里的起始偏移（章就从这里开始，标题行留在章内）。 */
  offset: number
  /** 去掉 `#` 与行内标记之后的标题文字。 */
  title: string
}

/** 逐行扫 ATX 标题；围栏代码块内部一律跳过。 */
export function findMarkdownHeadings(text: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  let inFence = false
  let lineStart = 0

  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart)
    if (lineEnd === -1) lineEnd = text.length
    const line = text.slice(lineStart, lineEnd)

    if (FENCE_RE.test(line)) {
      inFence = !inFence
    } else if (!inFence) {
      const match = ATX_HEADING_RE.exec(line)
      if (match) {
        headings.push({
          level: match[1].length,
          offset: lineStart,
          title: stripInlineMarkdown(match[2])
        })
      }
    }

    if (lineEnd === text.length) break
    lineStart = lineEnd + 1
  }

  return headings
}

/**
 * 用哪一级标题切章：**从 1 级往下找第一个出现 ≥ 2 次的层级**。
 *
 * 为什么不是「见到 # 就切」：Markdown 笔记常常开头只有一个 `# 书名`（第 1 级），
 * 下面全是 `## 第 N 章`。只给一次的一级标题当章，会把整本书变成一章。
 * 全都没有（或都只出现一次）时返回 null，调用方退回 TXT 那套规则。
 */
export function pickChapterLevel(headings: readonly MarkdownHeading[]): number | null {
  for (let level = 1; level <= 6; level += 1) {
    if (headings.filter((heading) => heading.level === level).length >= 2) return level
  }
  return null
}

/**
 * Markdown 的切章入口，签名与 TXT 的 splitChapters 一致（都是 SplitResult），
 * 所以 decode-job 那边只需要换一个函数调用。
 */
export function splitMarkdownChapters(text: string): SplitResult {
  const headings = findMarkdownHeadings(text)
  const level = pickChapterLevel(headings)
  // 认不出标题结构：退回 TXT 规则（「第 N 章」正则 → 定长分段），至少不会只剩一章
  if (level === null) return splitChapters(text)

  const picked = headings.filter((heading) => heading.level === level)
  const chapters: SplitResult['chapters'] = []

  // 第一个标题之前的正文（常见是书名的 h1 + 前言）单独成「开篇」，一个字都不丢
  const prefaceEnd = picked[0].offset
  if (text.slice(0, prefaceEnd).trim().length > 0) {
    chapters.push({ title: '开篇', startOffset: 0, charLength: prefaceEnd, kind: 'segment' })
  }

  for (let i = 0; i < picked.length; i += 1) {
    const start = picked[i].offset
    const end = i + 1 < picked.length ? picked[i + 1].offset : text.length
    chapters.push({
      title: picked[i].title,
      startOffset: start,
      charLength: end - start,
      kind: 'chapter' as ChapterKind
    })
  }

  return { chapters, usedFallback: false, markerHits: picked.length }
}

/**
 * 去掉行内标记，只留纯文字（标题、目录、搜索上下文这些「显示用」的地方用它）。
 * **不能拿它当正文** —— 正文必须保留原始字符流，偏移才对得上。
 */
export function stripInlineMarkdown(text: string): string {
  // 先把 `\*` 这类转义收起来：不收起来的话，下面剥标记的正则会把它们当成真标记。
  // 占位符用私用区字符（PUA）而不是控制字符：正则在含 \u0000 的写法上会被 lint 拦，
  // 而 PUA 在正常文本里本来就不该出现。
  const OPEN = '\uE000'
  const CLOSE = '\uE001'
  const escaped: string[] = []
  const guarded = text.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, (_match, char: string) => {
    escaped.push(char)
    return OPEN + (escaped.length - 1) + CLOSE
  })

  const stripped = guarded
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片 → alt 文字
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接 → 链接文字
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')

  return stripped
    .replace(new RegExp(OPEN + '(\\d+)' + CLOSE, 'g'), (_match, index: string) => escaped[Number(index)] ?? '')
    .trim()
}
