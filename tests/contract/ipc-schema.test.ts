import { describe, expect, it } from 'vitest'
import {
  bookIdSchema,
  cancelArgsSchema,
  importArgsSchema,
  mergeChapterArgsSchema,
  progressSchema,
  readChapterArgsSchema,
  redecodeArgsSchema,
  renameArgsSchema,
  renameChapterArgsSchema,
  settingsSchema,
  splitChapterArgsSchema
} from '@shared/schema'

const VALID_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('IPC 入参校验：合法用例', () => {
  it('接受 uuid v4 形状的 bookId', () => {
    expect(bookIdSchema.safeParse(VALID_ID).success).toBe(true)
  })

  it('重命名入参接受并去除首尾空白', () => {
    const r = renameArgsSchema.safeParse({ bookId: VALID_ID, title: '  长夜将明  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.title).toBe('长夜将明')
  })

  it('读章入参接受 0 与正整数', () => {
    expect(readChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 0 }).success).toBe(true)
    expect(readChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 12 }).success).toBe(true)
  })

  it('进度入参接受合法结构', () => {
    const r = progressSchema.safeParse({
      bookId: VALID_ID,
      chapterIndex: 3,
      charOffset: 120,
      anchorBefore: '前文引文',
      anchorAfter: null,
      percent: 12.5,
      updatedAt: 1_700_000_000_000,
      deviceId: null
    })
    expect(r.success).toBe(true)
  })

  it('设置入参接受边界值', () => {
    expect(settingsSchema.safeParse({ fontSize: 12, lineHeight: 1.2, theme: 'night' }).success).toBe(
      true
    )
    expect(settingsSchema.safeParse({ fontSize: 40, lineHeight: 3, theme: 'day' }).success).toBe(true)
    expect(
      settingsSchema.safeParse({
        fontSize: 19,
        lineHeight: 1.9,
        theme: 'day',
        bold: true,
        fontFamily: 'kai',
        pageWidth: 'full'
      }).success
    ).toBe(true)
  })

  it('重解码入参接受自动检测与每种手动编码', () => {
    for (const encoding of ['auto', 'utf-8', 'gb18030', 'big5', 'utf-16le', 'utf-16be']) {
      expect(redecodeArgsSchema.safeParse({ bookId: VALID_ID, encoding }).success).toBe(true)
    }
  })

  it('改分章入参：改名去空白，合并与拆分接受正整数', () => {
    const renamed = renameChapterArgsSchema.safeParse({
      bookId: VALID_ID,
      index: 2,
      title: '  卷二 归途  '
    })
    expect(renamed.success).toBe(true)
    if (renamed.success) expect(renamed.data.title).toBe('卷二 归途')
    expect(mergeChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 0 }).success).toBe(true)
    expect(splitChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 1, offset: 120 }).success).toBe(
      true
    )
  })

  it('缺字体与栏宽时补默认值', () => {
    const parsed = settingsSchema.parse({ fontSize: 19, lineHeight: 1.9, theme: 'day' })
    expect(parsed.fontFamily).toBe('song')
    expect(parsed.pageWidth).toBe('medium')
  })
})

describe('IPC 入参校验：非法用例', () => {
  it('拒绝非 uuid 的 bookId', () => {
    expect(bookIdSchema.safeParse('not-a-uuid').success).toBe(false)
    expect(bookIdSchema.safeParse('').success).toBe(false)
    expect(bookIdSchema.safeParse('../etc/passwd').success).toBe(false)
  })

  it('拒绝空书名', () => {
    expect(renameArgsSchema.safeParse({ bookId: VALID_ID, title: '   ' }).success).toBe(false)
  })

  it('拒绝负数或小数章节下标', () => {
    expect(readChapterArgsSchema.safeParse({ bookId: VALID_ID, index: -1 }).success).toBe(false)
    expect(readChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 1.5 }).success).toBe(false)
  })

  it('拒绝越界的排版设置', () => {
    expect(settingsSchema.safeParse({ fontSize: 99, lineHeight: 1.9, theme: 'day' }).success).toBe(
      false
    )
    expect(settingsSchema.safeParse({ fontSize: 19, lineHeight: 0.5, theme: 'day' }).success).toBe(
      false
    )
    expect(settingsSchema.safeParse({ fontSize: 19, lineHeight: 1.9, theme: 'sepia' }).success).toBe(
      false
    )
    expect(
      settingsSchema.safeParse({ fontSize: 19, lineHeight: 1.9, theme: 'day', fontFamily: 'comic' })
        .success
    ).toBe(false)
    expect(
      settingsSchema.safeParse({ fontSize: 19, lineHeight: 1.9, theme: 'day', pageWidth: 'huge' })
        .success
    ).toBe(false)
  })

  it('拒绝越界的进度值', () => {
    const bad = progressSchema.safeParse({
      bookId: VALID_ID,
      chapterIndex: 0,
      charOffset: 0,
      anchorBefore: null,
      anchorAfter: null,
      percent: 101,
      updatedAt: 0,
      deviceId: null
    })
    expect(bad.success).toBe(false)
  })

  it('拒绝重解码里不认识的编码与坏 bookId', () => {
    expect(redecodeArgsSchema.safeParse({ bookId: VALID_ID, encoding: 'shift-jis' }).success).toBe(false)
    expect(redecodeArgsSchema.safeParse({ bookId: VALID_ID }).success).toBe(false)
    expect(redecodeArgsSchema.safeParse({ bookId: 'nope', encoding: 'auto' }).success).toBe(false)
  })

  it('改分章入参：空标题、坏下标、章首拆分都被拒', () => {
    expect(renameChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 0, title: '   ' }).success).toBe(
      false
    )
    expect(
      renameChapterArgsSchema.safeParse({ bookId: VALID_ID, index: -1, title: '序章' }).success
    ).toBe(false)
    expect(mergeChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 1.5 }).success).toBe(false)
    expect(splitChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 0, offset: 0 }).success).toBe(
      false
    )
    expect(
      splitChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 0, offset: -3 }).success
    ).toBe(false)
  })

  it('拒绝空 filePath 与空 taskId', () => {
    expect(importArgsSchema.safeParse({ filePath: '' }).success).toBe(false)
    expect(cancelArgsSchema.safeParse({ taskId: '' }).success).toBe(false)
  })
})
