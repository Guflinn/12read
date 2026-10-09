import { describe, expect, it } from 'vitest'
import {
  annotationIdArgsSchema,
  bookIdSchema,
  bookmarkAddArgsSchema,
  cancelArgsSchema,
  highlightAddArgsSchema,
  importArgsSchema,
  mergeChapterArgsSchema,
  progressSchema,
  readChapterArgsSchema,
  redecodeArgsSchema,
  renameArgsSchema,
  renameChapterArgsSchema,
  searchArgsSchema,
  settingsSchema,
  statAddArgsSchema,
  statGetArgsSchema,
  statCalendarArgsSchema,
  statReadArgsSchema,
  updateOpenArgsSchema
} from '@shared/schema'
import { STAT_MAX_REPORT_CHARS, STAT_MAX_REPORT_MS } from '@shared/core/stats'

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
    // 0.2.2：UI 字号上限提到 56，schema 上限 60
    expect(settingsSchema.safeParse({ fontSize: 56, lineHeight: 1.9, theme: 'day' }).success).toBe(true)
    expect(settingsSchema.safeParse({ fontSize: 61, lineHeight: 1.9, theme: 'day' }).success).toBe(false)
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
    // 0.2.2 新增特大栏宽；'huge' 仍然是非法 key（别把新档位命名成它）
    expect(
      settingsSchema.safeParse({ fontSize: 19, lineHeight: 1.9, theme: 'day', pageWidth: 'xlarge' })
        .success
    ).toBe(true)
    expect(
      settingsSchema.safeParse({ fontSize: 19, lineHeight: 1.9, theme: 'day', pageWidth: 'huge' })
        .success
    ).toBe(false)
  })

  it('重解码入参接受自动检测与每种手动编码', () => {
    for (const encoding of ['auto', 'utf-8', 'gb18030', 'big5', 'utf-16le', 'utf-16be']) {
      expect(redecodeArgsSchema.safeParse({ bookId: VALID_ID, encoding }).success).toBe(true)
    }
  })

  it('改分章入参：改名去空白，合并接受正整数', () => {
    const renamed = renameChapterArgsSchema.safeParse({
      bookId: VALID_ID,
      index: 2,
      title: '  卷二 归途  '
    })
    expect(renamed.success).toBe(true)
    if (renamed.success) expect(renamed.data.title).toBe('卷二 归途')
    expect(mergeChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 0 }).success).toBe(true)
  })

  it('书签与划线入参：章内偏移接受 0，去掉不用的字段', () => {
    const bookmark = bookmarkAddArgsSchema.safeParse({
      bookId: VALID_ID,
      chapterIndex: 0,
      charOffset: 0,
      excerpt: '读到这儿'
    })
    expect(bookmark.success).toBe(true)
    const highlight = highlightAddArgsSchema.safeParse({
      bookId: VALID_ID,
      chapterIndex: 2,
      startOffset: 10,
      endOffset: 22,
      text: '被划下来的一行字'
    })
    expect(highlight.success).toBe(true)
    expect(annotationIdArgsSchema.safeParse({ id: 'k1' }).success).toBe(true)
  })

  it('搜索入参：本章与全书两种范围，关键词去掉首尾空白', () => {
    const parsed = searchArgsSchema.safeParse({
      bookId: VALID_ID,
      query: '  山川 湖海  ',
      scope: 'book',
      chapterIndex: 0
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.query).toBe('山川 湖海')
    expect(
      searchArgsSchema.safeParse({ bookId: VALID_ID, query: '山川', scope: 'chapter', chapterIndex: 3 })
        .success
    ).toBe(true)
    // 关键词长度上限 80：刚好 80 收，81 拒
    expect(
      searchArgsSchema.safeParse({
        bookId: VALID_ID,
        query: 'x'.repeat(80),
        scope: 'book',
        chapterIndex: 0
      }).success
    ).toBe(true)
  })

  it('更新入参（0.1.5 的 update:open）：只收 github.com 的 https 链接', () => {
    expect(
      updateOpenArgsSchema.safeParse({
        url: 'https://github.com/Guflinn/12read/releases/tag/v0.1.6'
      }).success
    ).toBe(true)
    for (const bad of [
      'http://github.com/Guflinn/12read', // 非 https
      'https://example.com/x', // 别的站
      'https://github.com.evil.com/x', // 仿冒域名
      'https://github.company.com/x',
      'file:///etc/passwd',
      ''
    ]) {
      expect(updateOpenArgsSchema.safeParse({ url: bad }).success).toBe(false)
    }
    expect(updateOpenArgsSchema.safeParse({}).success).toBe(false)
    expect(updateOpenArgsSchema.safeParse({ url: 123 }).success).toBe(false)
  })

  it('统计入参（0.1.4 的 stat:calendar）：月份必须是 YYYY-MM', () => {
    expect(statCalendarArgsSchema.safeParse({ month: '2026-10' }).success).toBe(true)
    expect(statCalendarArgsSchema.safeParse({ month: '2026-1' }).success).toBe(false)
    expect(statCalendarArgsSchema.safeParse({ month: '2026/10' }).success).toBe(false)
    expect(statCalendarArgsSchema.safeParse({ month: '202610' }).success).toBe(false)
    expect(statCalendarArgsSchema.safeParse({ month: 202610 }).success).toBe(false)
    expect(statCalendarArgsSchema.safeParse({}).success).toBe(false)
  })

  it('统计入参（0.1.4 的 stat:read）：位置与进章点接受 0 与上限', () => {
    expect(
      statReadArgsSchema.safeParse({
        bookId: VALID_ID,
        chapterIndex: 0,
        charOffset: 0,
        enteredAt: 0
      }).success
    ).toBe(true)
    expect(
      statReadArgsSchema.safeParse({
        bookId: VALID_ID,
        chapterIndex: 41,
        charOffset: STAT_MAX_REPORT_CHARS,
        enteredAt: STAT_MAX_REPORT_CHARS
      }).success
    ).toBe(true)
  })

  it('统计入参：时长与字数接受 0 与上限，天数在 1..90 之间', () => {
    expect(statAddArgsSchema.safeParse({ bookId: VALID_ID, ms: 0, chars: 0 }).success).toBe(true)
    expect(
      statAddArgsSchema.safeParse({
        bookId: VALID_ID,
        ms: STAT_MAX_REPORT_MS,
        chars: STAT_MAX_REPORT_CHARS
      }).success
    ).toBe(true)
    expect(statGetArgsSchema.safeParse({ days: 1 }).success).toBe(true)
    expect(statGetArgsSchema.safeParse({ days: 90 }).success).toBe(true)
  })

  it('缺字体与栏宽时补默认值（默认字体是思源宋）', () => {
    const parsed = settingsSchema.parse({ fontSize: 19, lineHeight: 1.9, theme: 'day' })
    expect(parsed.fontFamily).toBe('hanserif')
    expect(parsed.pageWidth).toBe('medium')
  })

  it('老设置的 song / hei / kai 归一化成打包字体，其余原样保留（0.2.1 第四轮）', () => {
    for (const [legacy, modern] of [
      ['song', 'hanserif'],
      ['hei', 'deng'],
      ['kai', 'wenkai'],
      ['fang', 'fang'],
      ['deng', 'deng'],
      ['wenkai', 'wenkai'],
      ['hanserif', 'hanserif']
    ] as const) {
      const parsed = settingsSchema.parse({
        fontSize: 19,
        lineHeight: 1.9,
        theme: 'day',
        fontFamily: legacy
      })
      expect(parsed.fontFamily, `${legacy} 应映射为 ${modern}`).toBe(modern)
    }
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
    // 0.2.1 新增打包字体 wenkai / hanserif 是合法 key
    expect(
      settingsSchema.safeParse({ fontSize: 19, lineHeight: 1.9, theme: 'day', fontFamily: 'wenkai' })
        .success
    ).toBe(true)
    expect(
      settingsSchema.safeParse({
        fontSize: 19,
        lineHeight: 1.9,
        theme: 'day',
        fontFamily: 'hanserif'
      }).success
    ).toBe(true)
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

  it('改分章入参：空标题、坏下标、小数下标都被拒', () => {
    expect(renameChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 0, title: '   ' }).success).toBe(
      false
    )
    expect(
      renameChapterArgsSchema.safeParse({ bookId: VALID_ID, index: -1, title: '序章' }).success
    ).toBe(false)
    expect(mergeChapterArgsSchema.safeParse({ bookId: VALID_ID, index: 1.5 }).success).toBe(false)
  })

  it('书签与划线入参：负偏移、空 id、空文字、超长摘录都被拒', () => {
    expect(
      bookmarkAddArgsSchema.safeParse({
        bookId: VALID_ID,
        chapterIndex: 0,
        charOffset: -1,
        excerpt: '摘要'
      }).success
    ).toBe(false)
    expect(
      bookmarkAddArgsSchema.safeParse({
        bookId: VALID_ID,
        chapterIndex: 0,
        charOffset: 1,
        excerpt: '长'.repeat(201)
      }).success
    ).toBe(false)
    expect(annotationIdArgsSchema.safeParse({ id: '' }).success).toBe(false)
    expect(
      highlightAddArgsSchema.safeParse({
        bookId: VALID_ID,
        chapterIndex: 0,
        startOffset: 1,
        endOffset: 2,
        text: ''
      }).success
    ).toBe(false)
    expect(
      highlightAddArgsSchema.safeParse({
        bookId: VALID_ID,
        chapterIndex: 0,
        startOffset: 1.5,
        endOffset: 2,
        text: '整数才行'
      }).success
    ).toBe(false)
    // 起止颠倒属于语义问题，schema 只管形状，交给 ipc 层报「划线范围不合法」
    expect(
      highlightAddArgsSchema.safeParse({
        bookId: VALID_ID,
        chapterIndex: 0,
        startOffset: 9,
        endOffset: 2,
        text: '反着选'
      }).success
    ).toBe(true)
  })

  it('搜索入参：空关键词、超长关键词、陌生范围与坏章号都被拒', () => {
    const base = { bookId: VALID_ID, query: '山川', scope: 'book', chapterIndex: 0 }
    expect(searchArgsSchema.safeParse({ ...base, query: '   ' }).success).toBe(false)
    expect(searchArgsSchema.safeParse({ ...base, query: 'x'.repeat(81) }).success).toBe(false)
    expect(searchArgsSchema.safeParse({ ...base, scope: 'all' }).success).toBe(false)
    expect(searchArgsSchema.safeParse({ ...base, scope: undefined }).success).toBe(false)
    expect(searchArgsSchema.safeParse({ ...base, chapterIndex: -1 }).success).toBe(false)
    expect(searchArgsSchema.safeParse({ ...base, chapterIndex: 1.5 }).success).toBe(false)
    expect(searchArgsSchema.safeParse({ ...base, chapterIndex: undefined }).success).toBe(false)
    expect(searchArgsSchema.safeParse({ ...base, bookId: 'not-a-uuid' }).success).toBe(false)
  })

  it('统计入参：负时长、超上限、小数与坏天数都被拒', () => {
    expect(statAddArgsSchema.safeParse({ bookId: VALID_ID, ms: -1, chars: 0 }).success).toBe(false)
    expect(statAddArgsSchema.safeParse({ bookId: VALID_ID, ms: 0, chars: -1 }).success).toBe(false)
    expect(statAddArgsSchema.safeParse({ bookId: VALID_ID, ms: 1.5, chars: 0 }).success).toBe(false)
    expect(
      statAddArgsSchema.safeParse({ bookId: VALID_ID, ms: STAT_MAX_REPORT_MS + 1, chars: 0 }).success
    ).toBe(false)
    expect(
      statAddArgsSchema.safeParse({ bookId: VALID_ID, ms: 0, chars: STAT_MAX_REPORT_CHARS + 1 }).success
    ).toBe(false)
    expect(statAddArgsSchema.safeParse({ bookId: VALID_ID, ms: 0 }).success).toBe(false)
    expect(statAddArgsSchema.safeParse({ bookId: 'not-a-uuid', ms: 0, chars: 0 }).success).toBe(false)
    expect(statGetArgsSchema.safeParse({ days: 0 }).success).toBe(false)
    expect(statGetArgsSchema.safeParse({ days: 91 }).success).toBe(false)
    expect(statGetArgsSchema.safeParse({ days: 1.5 }).success).toBe(false)
    expect(statGetArgsSchema.safeParse({}).success).toBe(false)
  })

  it('拒绝空 filePath 与空 taskId', () => {
    expect(importArgsSchema.safeParse({ filePath: '' }).success).toBe(false)
    expect(cancelArgsSchema.safeParse({ taskId: '' }).success).toBe(false)
  })
})
