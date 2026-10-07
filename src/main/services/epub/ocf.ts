/**
 * EPUB 的容器层（OCF，0.2.0 第 2 项）：从 ZIP 里找到「书籍描述文件」（OPF）的路径。
 *
 * 规范说得很死：`META-INF/container.xml` 里的 `<rootfile full-path="...">`。
 * 但真实书里见过：container.xml 缺失、rootfile 路径写错、OPF 藏在奇怪的地方 ——
 * 所以这里**先按规范找，找不到再按内容兜底**（扫包内第一个 `.opf`），
 * 全都不行才报错。宁可多试一步，也别让用户看到「打不开」。
 */
import { normalizePath, EpubError } from './errors'
import { parseXml, allDescendants } from './xml'
import type { ZipArchive } from './zip-reader'

const CONTAINER_PATH = 'META-INF/container.xml'
const OPF_MEDIA_TYPE = 'application/oebps-package+xml'

/** 找到 OPF 的包内路径（已归一化）。找不到就抛 EpubError。 */
export function findOpfPath(zip: ZipArchive): string {
  const container = zip.readText(CONTAINER_PATH)
  if (container !== null) {
    const fromContainer = readRootfilePath(container)
    if (fromContainer !== null && zip.has(fromContainer)) return fromContainer
    // 路径写错或那条文件不在包里：不急着报错，先看兜底扫描能不能救回来
  }

  const guessed = zip.names.find(
    (name) => name.toLowerCase().endsWith('.opf') && !name.endsWith('/')
  )
  if (guessed !== undefined) return normalizePath('', guessed)

  throw new EpubError('这个 EPUB 里找不到书籍描述文件（container.xml / .opf），文件可能不完整')
}

/** 从 container.xml 里取 rootfile 的 full-path；优先 media-type 匹配的那条。 */
function readRootfilePath(source: string): string | null {
  const root = parseXml(source)
  if (!root) return null

  const rootfiles = allDescendants(root, 'rootfile')
  if (rootfiles.length === 0) return null

  const preferred =
    rootfiles.find((node) => (node.attrs['media-type'] ?? '') === OPF_MEDIA_TYPE) ?? rootfiles[0]
  const fullPath = preferred?.attrs['full-path']
  if (fullPath === undefined || fullPath.trim() === '') return null
  return normalizePath('', fullPath.trim())
}
