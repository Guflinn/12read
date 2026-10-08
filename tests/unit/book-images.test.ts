import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BookImagesService, IMAGE_SCHEME } from '@main/services/book-images'
import { bookDir, imagesDir } from '@main/services/layout'

/**
 * 内联图片的服务端（0.2.0 第 5 项）：清单读取 + 自定义协议解析。
 * 安全上只有一条硬要求：**协议只能取到书库内 images/ 里的文件**，任何越界都必须失败。
 */
const roots: string[] = []
const BOOK = '11111111-2222-3333-4444-555555555555'

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function makeRoot(withManifest = true, manifest?: string, files: Record<string, Buffer> = {}): string {
  const root = mkdtempSync(join(tmpdir(), '12read-images-'))
  roots.push(root)
  const dir = imagesDir(root, BOOK)
  mkdirSync(dir, { recursive: true })
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data)
  if (withManifest) {
    writeFileSync(
      join(bookDir(root, BOOK), 'images.json'),
      manifest ?? JSON.stringify({ images: [{ offset: 12, file: '0001.png' }] })
    )
  }
  return root
}

describe('BookImagesService.list', () => {
  it('读出清单并拼出自定义协议地址，按偏移排序', () => {
    const root = makeRoot(true, JSON.stringify({
      images: [
        { offset: 90, file: '0002.jpg' },
        { offset: 12, file: '0001.png' }
      ]
    }))
    expect(new BookImagesService(root).list(BOOK)).toEqual([
      { offset: 12, url: IMAGE_SCHEME + '://' + BOOK + '/0001.png' },
      { offset: 90, url: IMAGE_SCHEME + '://' + BOOK + '/0002.jpg' }
    ])
  })

  it('没有清单（TXT 书、或没图的 EPUB）给空数组', () => {
    const root = makeRoot(false)
    expect(new BookImagesService(root).list(BOOK)).toEqual([])
  })

  it('清单坏了也当没有图，不抛异常（派生数据不该把书卡住）', () => {
    expect(new BookImagesService(makeRoot(true, '{ 坏 json')).list(BOOK)).toEqual([])
    expect(new BookImagesService(makeRoot(true, '{"images":"nope"}')).list(BOOK)).toEqual([])
  })

  it('清单里的文件名不安全或形状不对时跳过那一条', () => {
    const root = makeRoot(true, JSON.stringify({
      images: [
        { offset: 1, file: '../../library.db' },
        { offset: 2, file: 'evil.exe' },
        { offset: 3 },
        { offset: '4', file: '0001.png' },
        { offset: 5, file: '0002.png' }
      ]
    }))
    expect(new BookImagesService(root).list(BOOK)).toEqual([
      { offset: 5, url: IMAGE_SCHEME + '://' + BOOK + '/0002.png' }
    ])
  })
})

describe('BookImagesService.coverUrl', () => {
  it('有 images/cover.* 就给地址（几种常见后缀都认）', () => {
    for (const name of ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp']) {
      const root = makeRoot(false, undefined, { [name]: Buffer.from([1]) })
      expect(new BookImagesService(root).coverUrl(BOOK)).toBe(IMAGE_SCHEME + '://' + BOOK + '/' + name)
    }
  })

  it('没有封面（TXT 书、或书里没找到封面）给 null', () => {
    expect(new BookImagesService(makeRoot(false)).coverUrl(BOOK)).toBeNull()
    // 只有正文图、没有 cover.* 时也算没有封面
    expect(new BookImagesService(makeRoot(false, undefined, { '0001.jpg': Buffer.from([1]) })).coverUrl(BOOK)).toBeNull()
  })
})

describe('BookImagesService.resolve', () => {
  it('取到图片字节并给出 MIME', () => {
    const root = makeRoot(true, undefined, { '0001.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
    const found = new BookImagesService(root).resolve(IMAGE_SCHEME + '://' + BOOK + '/0001.png')
    expect(found?.mime).toBe('image/png')
    expect(found?.data.length).toBe(4)
  })

  it('拒绝越界、未知协议、坏文件名与不存在的文件', () => {
    const root = makeRoot(true, undefined, { '0001.png': Buffer.from([1]) })
    const service = new BookImagesService(root)
    const cases = [
      IMAGE_SCHEME + '://' + BOOK + '/../../library.db', // 上跳
      IMAGE_SCHEME + '://' + BOOK + '/..%2F..%2Flibrary.db', // 编码过的上跳（文件名白名单直接拒）
      IMAGE_SCHEME + '://' + BOOK + '/run.exe', // 非图片扩展名
      IMAGE_SCHEME + '://' + 'not-a-uuid' + '/0001.png',
      IMAGE_SCHEME + '://' + BOOK, // 没有文件名
      'file:///etc/passwd',
      'https://example.com/x.png',
      IMAGE_SCHEME + '://' + BOOK + '/0009.png' // 文件不存在
    ]
    for (const url of cases) {
      expect(service.resolve(url)).toBeNull()
    }
  })

  it('跨书取图也做不到（书名 id 必须与目录一致）', () => {
    const root = makeRoot(true, undefined, { '0001.png': Buffer.from([1]) })
    const other = '99999999-8888-7777-6666-555555555555'
    expect(new BookImagesService(root).resolve(IMAGE_SCHEME + '://' + other + '/0001.png')).toBeNull()
  })
})
