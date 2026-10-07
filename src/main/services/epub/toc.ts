/**
 * 目录解析（0.2.0 第 3 步）：把 EPUB 3 的 `nav.xhtml` 与 EPUB 2 的 NCX 读成**同一个形状**。
 *
 * 两种目录的差别只是「从哪个文件、什么标签里读」：
 * - EPUB 3：`nav.xhtml` 里 `<nav epub:type="toc">` 下的 `<ol><li><a href>`，层级就是 `<ol>` 的嵌套
 * - EPUB 2：`toc.ncx` 里 `navMap > navPoint > navLabel > text` + `<content src>`，层级就是 `navPoint` 嵌套
 *
 * 归一化之后，章节定位（chapters.ts）就不用再管是哪种了 —— 这也是「接口留好、不堵死」的落地。
 */
import { dirOf, normalizePath } from './errors'
import type { OpfPackage } from './opf'
import { childrenNamed, allDescendants, localName, parseXml, textOf, type XmlNode } from './xml'

export interface TocEntry {
  title: string
  /** 目标文件在包内的路径（已归一化，不含 `#片段`）。 */
  path: string
  /** href 里的片段（`#id`）；没有就是空串。 */
  fragment: string
  /** 层级，从 1 开始（顶层 = 1）。 */
  depth: number
}

/** 读目录。nav 优先（EPUB 3），退 NCX（EPUB 2）；都没有就返回空数组。 */
export function parseToc(opf: OpfPackage, read: (href: string) => string | null): TocEntry[] {
  if (opf.navPath) {
    const source = read(opf.navPath)
    if (source !== null) {
      const entries = readNav(source, dirOf(opf.navPath))
      if (entries.length > 0) return entries
    }
  }
  if (opf.ncxPath) {
    const source = read(opf.ncxPath)
    if (source !== null) return readNcx(source, dirOf(opf.ncxPath))
  }
  return []
}

/** href → 路径 + 片段。`Text/ch1.xhtml#p3` → `{ path: 'OEBPS/Text/ch1.xhtml', fragment: 'p3' }`。 */
function splitHref(baseDir: string, href: string): { path: string; fragment: string } {
  const raw = href.trim()
  if (raw === '') return { path: '', fragment: '' }
  const at = raw.indexOf('#')
  const withoutFragment = at < 0 ? raw : raw.slice(0, at)
  const fragment = at < 0 ? '' : raw.slice(at + 1)
  if (withoutFragment === '') return { path: '', fragment: decodeFragment(fragment) }
  return { path: normalizePath(baseDir, withoutFragment), fragment: decodeFragment(fragment) }
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

/** EPUB 3 的 nav.xhtml：优先 `epub:type="toc"` 的那个 nav，没有就用第一个 nav。 */
function readNav(source: string, baseDir: string): TocEntry[] {
  const root = parseXml(source)
  if (!root) return []
  const navs = allDescendants(root, 'nav')
  const toc =
    navs.find((nav) => (nav.attrs['epub:type'] ?? nav.attrs['type'] ?? '').includes('toc')) ??
    navs[0]
  if (!toc) return []

  const entries: TocEntry[] = []
  const walkList = (list: XmlNode, depth: number): void => {
    for (const item of childrenNamed(list, 'li')) {
      const anchor = directChild(item, 'a')
      if (anchor) {
        const href = anchor.attrs['href'] ?? ''
        const title = textOf(anchor)
        const { path, fragment } = splitHref(baseDir, href)
        if (title !== '' && path !== '') entries.push({ title, path, fragment, depth })
      }
      // 嵌套的子列表：层级 +1
      const nested = directChild(item, 'ol') ?? directChild(item, 'ul')
      if (nested) walkList(nested, depth + 1)
    }
  }
  const firstList = directChild(toc, 'ol') ?? directChild(toc, 'ul')
  if (firstList) walkList(firstList, 1)
  return entries
}

/** 只在直接子节点里找（目录结构里 `li > a`，别把嵌套子列表里的 a 也算上）。 */
function directChild(node: XmlNode, name: string): XmlNode | null {
  const wanted = name.toLowerCase()
  return node.children.find((child) => localName(child.tag).toLowerCase() === wanted) ?? null
}

/** EPUB 2 的 NCX：navMap 下的 navPoint 递归，`navLabel/text` 是标题、`content@src` 是目标。 */
function readNcx(source: string, baseDir: string): TocEntry[] {
  const root = parseXml(source)
  if (!root) return []
  const map = allDescendants(root, 'navMap')[0]
  const points = map ? childrenNamed(map, 'navPoint') : allDescendants(root, 'navPoint')
  const entries: TocEntry[] = []

  const walk = (point: XmlNode, depth: number): void => {
    const label = directChild(point, 'navLabel')
    const title = label ? textOf(label) : ''
    const content = directChild(point, 'content')
    const { path, fragment } = splitHref(baseDir, content?.attrs['src'] ?? '')
    if (title !== '' && path !== '') entries.push({ title, path, fragment, depth })
    for (const child of childrenNamed(point, 'navPoint')) walk(child, depth + 1)
  }
  for (const point of points) walk(point, 1)
  return entries
}
