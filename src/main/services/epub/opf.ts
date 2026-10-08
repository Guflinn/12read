/**
 * OPF（书籍描述文件）解析（0.2.0 第 2 项）：metadata / manifest / spine。
 *
 * 这是 EPUB 的「目录表」，决定了阅读顺序（spine）与每一章对应哪个文件（manifest）。
 * 几个真实世界的坑，这里都按 lenient 处理：
 * - **HTML 实体**：metadata 里 `&amp;` 很常见，必须解（见 xml.ts）
 * - **href 是相对路径且写法五花八门**：`Text/ch1.xhtml`、`./Text/../Text/ch1.xhtml`、带 `%20`
 * - **spine 里可能有 `linear="no"`** 的项（封面、广告页）：默认顺序阅读时跳过
 * - **EPUB2 用 NCX、EPUB3 用 nav**：两个都认，返回给上层自己决定
 * - **manifest 里 idref 指向不存在的 id**：跳过那一条，不要整本失败
 */
import { dirOf, normalizePath } from './errors'
import {
  childrenNamed,
  firstChild,
  findDescendant,
  localName,
  parseXml,
  textOf,
  type XmlNode
} from './xml'

export interface OpfManifestItem {
  id: string
  /** 已归一化的包内路径。 */
  href: string
  mediaType: string
  /** EPUB3 的 properties（`nav` / `cover-image` / `svg` …）。 */
  properties: string[]
}

export interface OpfPackage {
  title: string | null
  author: string | null
  language: string | null
  /** 按 id 索引的 manifest。 */
  items: Map<string, OpfManifestItem>
  /** 阅读顺序（spine 的 idref；已跳过 linear="no" 与无效 idref）。 */
  spine: OpfManifestItem[]
  /** EPUB3 的导航文档（manifest 里 properties 含 nav 的那条）。 */
  navPath: string | null
  /** EPUB2 的 NCX 目录（spine 的 toc 属性，或 media-type 匹配的那条）。 */
  ncxPath: string | null
  /** OPF 所在目录，解析相对路径的基准。 */
  opfDir: string
  /**
   * 封面图的包内路径（0.2.0 起给书架用）。
   * 依次找：EPUB 3 的 `properties="cover-image"` → EPUB 2 的 `<meta name="cover" content="id"/>`
   * → 名字里带 cover 的图片。都没有就是 null（书架继续用生成的占位封面）。
   */
  coverPath: string | null
}

/** 解析 OPF 文本。`opfPath` 是它在包内的路径（用来算相对路径基准）。 */
export function parseOpf(source: string, opfPath: string): OpfPackage {
  const root = parseXml(source)
  const opfDir = dirOf(normalizePath('', opfPath))
  const pkg = root ? (localName(root.tag) === 'package' ? root : findDescendant(root, 'package')) : null
  if (!pkg) {
    return {
      title: null,
      author: null,
      language: null,
      items: new Map(),
      spine: [],
      navPath: null,
      ncxPath: null,
      opfDir,
      coverPath: null
    }
  }

  const metadata = firstChild(pkg, 'metadata')
  const manifestNode = firstChild(pkg, 'manifest')
  const spineNode = firstChild(pkg, 'spine')

  const items = new Map<string, OpfManifestItem>()
  for (const node of manifestNode ? childrenNamed(manifestNode, 'item') : []) {
    const id = node.attrs['id'] ?? ''
    const href = node.attrs['href'] ?? ''
    if (id === '' || href === '') continue
    items.set(id, {
      id,
      href: normalizePath(opfDir, href),
      mediaType: node.attrs['media-type'] ?? '',
      properties: (node.attrs['properties'] ?? '').split(/\s+/).filter((value) => value !== '')
    })
  }

  const spine: OpfManifestItem[] = []
  for (const node of spineNode ? childrenNamed(spineNode, 'itemref') : []) {
    // 封底/广告这类标记了 linear="no" 的，顺序阅读时不翻到
    if ((node.attrs['linear'] ?? '').toLowerCase() === 'no') continue
    const item = items.get(node.attrs['idref'] ?? '')
    if (item) spine.push(item)
  }

  const navItem = [...items.values()].find((item) => item.properties.includes('nav'))
  const tocId = spineNode?.attrs['toc'] ?? ''
  const ncxFromSpine = tocId === '' ? undefined : items.get(tocId)
  const ncxItem =
    ncxFromSpine ??
    [...items.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml')

  const coverPath = findCoverPath(metadata, items)

  return {
    coverPath,
    title: metadataText(metadata, 'title'),
    author: metadataText(metadata, 'creator'),
    language: metadataText(metadata, 'language'),
    items,
    spine,
    navPath: navItem ? navItem.href : null,
    ncxPath: ncxItem ? ncxItem.href : null,
    opfDir
  }
}

/**
 * 找封面图。三条线索按可靠度排：
 * ① EPUB 3 的 manifest `properties="cover-image"`
 * ② EPUB 2 的 `<meta name="cover" content="<manifest id>"/>`
 * ③ 名字里带 cover 的图片（`cover.jpg` / `images/cover.jpeg` 这种）
 */
function findCoverPath(
  metadata: XmlNode | null,
  items: Map<string, OpfManifestItem>
): string | null {
  const byProperty = [...items.values()].find((item) => item.properties.includes('cover-image'))
  if (byProperty) return byProperty.href

  if (metadata) {
    const meta = childrenNamed(metadata, 'meta').find(
      (node) => (node.attrs['name'] ?? '').toLowerCase() === 'cover'
    )
    const id = meta?.attrs['content'] ?? ''
    const item = id === '' ? undefined : items.get(id)
    if (item) return item.href
  }

  const byName = [...items.values()].find(
    (item) => item.mediaType.startsWith('image/') && /(^|[/_-])cover([/_.-]|$)/i.test(item.href)
  )
  return byName ? byName.href : null
}

/** 取 metadata 里某个字段的文本（`dc:` 前缀与否都认，取第一个非空的）。 */
function metadataText(metadata: ReturnType<typeof firstChild>, name: string): string | null {
  if (!metadata) return null
  for (const node of childrenNamed(metadata, name)) {
    const value = textOf(node)
    if (value !== '') return value
  }
  return null
}
