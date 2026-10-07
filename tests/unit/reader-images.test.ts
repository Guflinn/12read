import { describe, expect, it } from 'vitest'
import {
  chapterImages,
  IMAGE_PLACEHOLDER,
  placeholderAsText,
  splitByImages
} from '@/core/images'
import type { BookImage } from '@shared/types'

/**
 * 阅读器里的图片切片（0.2.0 第 5 项）。两条关键约束：
 * 1. **偏移必须换对坐标**：清单是全书偏移，段落偏移是章内偏移，减错一次图就跑到别的章；
 * 2. **文字一个字都不能丢**：没有对应图片的占位符只忽略那个字符，前后文字照常拼接。
 */
const images: BookImage[] = [
  { offset: 100, url: 'reader-image://book/0001.png' },
  { offset: 150, url: 'reader-image://book/0002.jpg' },
  { offset: 999, url: 'reader-image://book/0003.png' }
]

describe('chapterImages', () => {
  it('只挑本章范围内的图，并换算成章内偏移', () => {
    expect(chapterImages(images, 100, 60)).toEqual([
      { offset: 0, url: 'reader-image://book/0001.png' },
      { offset: 50, url: 'reader-image://book/0002.jpg' }
    ])
  })

  it('章边界：起点包含、终点不包含', () => {
    // [150, 160)：正好等于起点的算本章
    expect(chapterImages(images, 150, 10).map((image) => image.offset)).toEqual([0])
    // [40, 110)：偏移 100 的图落在章内 → 60
    expect(chapterImages(images, 40, 70).map((image) => image.offset)).toEqual([60])
    // 终点不含：偏移 100 正好是 [40, 100) 的终点 → 不算
    expect(chapterImages(images, 40, 60).map((image) => image.offset)).toEqual([])
    expect(chapterImages(images, 200, 100)).toEqual([])
  })

  it('空清单给空结果（TXT 书走的就是这条路）', () => {
    expect(chapterImages([], 0, 1000)).toEqual([])
  })
})

describe('splitByImages', () => {
  const map = new Map<number, string>([
    [5, 'reader-image://book/0001.png'],
    [20, 'reader-image://book/0002.jpg']
  ])

  it('没有占位符时原样成一段文字', () => {
    expect(splitByImages('甲乙丙', 0, map)).toEqual([{ kind: 'text', text: '甲乙丙', start: 0 }])
    expect(splitByImages('', 0, map)).toEqual([])
  })

  it('把占位符切成图片片段，前后文字各自的 start 正确', () => {
    // 这张表按「占位符在段落里的下标」建：2 与 4
    const inParagraph = new Map<number, string>([
      [2, 'reader-image://book/0001.png'],
      [4, 'reader-image://book/0002.jpg']
    ])
    const text = '前文' + IMAGE_PLACEHOLDER + '中' + IMAGE_PLACEHOLDER + '后'
    const pieces = splitByImages(text, 0, inParagraph)
    expect(pieces).toEqual([
      { kind: 'text', text: '前文', start: 0 },
      { kind: 'image', url: 'reader-image://book/0001.png', at: 2 },
      { kind: 'text', text: '中', start: 3 },
      { kind: 'image', url: 'reader-image://book/0002.jpg', at: 4 },
      { kind: 'text', text: '后', start: 5 }
    ])
  })

  it('段落在章中间时，图片按「段落偏移 + 段内下标」查表', () => {
    const text = '甲' + IMAGE_PLACEHOLDER + '乙'
    const pieces = splitByImages(text, 4, map)
    expect(pieces[1]).toEqual({ kind: 'image', url: 'reader-image://book/0001.png', at: 1 })
  })

  it('找不到对应图片的占位符给 url: null（渲染时忽略，文字不丢）', () => {
    const text = '甲' + IMAGE_PLACEHOLDER + '乙'
    const pieces = splitByImages(text, 0, new Map())
    expect(pieces).toEqual([
      { kind: 'text', text: '甲', start: 0 },
      { kind: 'image', url: null, at: 1 },
      { kind: 'text', text: '乙', start: 2 }
    ])
  })

  it('整段就是一张图时没有文字片段', () => {
    expect(splitByImages(IMAGE_PLACEHOLDER, 5, map)).toEqual([
      { kind: 'image', url: 'reader-image://book/0001.png', at: 0 }
    ])
  })
})

describe('placeholderAsText', () => {
  it('搜索上下文里的占位符显示成 [图]', () => {
    expect(placeholderAsText('前' + IMAGE_PLACEHOLDER + '后')).toBe('前[图]后')
    expect(placeholderAsText('没有图')).toBe('没有图')
  })
})
