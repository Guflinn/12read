/**
 * EPUB 内联图片的服务端（0.2.0 第 5 项）。
 *
 * 两件事：
 * 1. `list(bookId)`：读 `books/<id>/images.json`，把「正文偏移 → 图片 URL」交给渲染层；
 * 2. `resolve(url)`：自定义协议 `reader-image://<bookId>/<文件名>` 的落地实现 ——
 *    只允许访问 `books/<bookId>/images/` 里的文件（路径必须落在书库内，TECH.md 10）。
 *
 * 为什么走自定义协议而不是 data: URL：图片可能有几百 KB、几十张，塞进清单会让每次
 * 打开书都传一遍 base64；协议方式下浏览器自己按需取、还能缓存（立项 2026-10-06 拍板）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { BookImage } from '@shared/types'
import { assertInside, bookDir, imagesManifestPath } from './layout'

/** 自定义协议名（CSP 的 img-src 里要放行它）。 */
export const IMAGE_SCHEME = 'reader-image'

interface Manifest {
  images?: Array<{ offset?: unknown; file?: unknown }>
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bin: 'application/octet-stream'
}

export class BookImagesService {
  constructor(private readonly root: string) {}

  /** 这本书的图片清单（偏移已排序）。没有清单就返回空数组（TXT、或没图的 EPUB）。 */
  list(bookId: string): BookImage[] {
    const manifestPath = imagesManifestPath(this.root, bookId)
    if (!existsSync(manifestPath)) return []
    let parsed: Manifest
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
    } catch {
      // 清单坏了就当没有图：正文照常能读，不该为派生数据把书卡住
      return []
    }
    const entries = Array.isArray(parsed.images) ? parsed.images : []
    const images: BookImage[] = []
    for (const entry of entries) {
      const offset = typeof entry.offset === 'number' ? entry.offset : null
      const file = typeof entry.file === 'string' ? entry.file : null
      if (offset === null || file === null || !isSafeFileName(file)) continue
      images.push({ offset, url: IMAGE_SCHEME + '://' + bookId + '/' + file })
    }
    return images.sort((left, right) => left.offset - right.offset)
  }

  /** 协议请求 → 文件字节；任何越界 / 不存在都返回 null（上层回 404）。 */
  resolve(url: string): { data: Buffer; mime: string } | null {
    const parsed = parseImageUrl(url)
    if (!parsed) return null
    const path = join(bookDir(this.root, parsed.bookId), 'images', parsed.file)
    try {
      assertInside(bookDir(this.root, parsed.bookId), path)
    } catch {
      return null
    }
    if (!existsSync(path)) return null
    try {
      return { data: readFileSync(path), mime: MIME[extname(parsed.file).slice(1).toLowerCase()] ?? 'application/octet-stream' }
    } catch {
      return null
    }
  }
}

/** 文件名只允许「安全字符 + 已知扩展名」，杜绝 `../` 之类。 */
function isSafeFileName(file: string): boolean {
  return /^[0-9a-zA-Z_-]+\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|bin)$/.test(file)
}

const BOOK_ID_RE = /^[0-9a-fA-F-]{36}$/

function parseImageUrl(url: string): { bookId: string; file: string } | null {
  const prefix = IMAGE_SCHEME + '://'
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  const at = rest.indexOf('/')
  if (at <= 0) return null
  const bookId = rest.slice(0, at)
  // 查询串/片段一律不考虑
  const file = rest.slice(at + 1).split(/[?#]/)[0] ?? ''
  if (!BOOK_ID_RE.test(bookId) || !isSafeFileName(file)) return null
  return { bookId, file }
}
