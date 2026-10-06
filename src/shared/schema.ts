import { z } from 'zod'
import { UUID_V4_RE } from '@shared/core/ids'
import { MANUAL_ENCODINGS, SEARCH_SCOPES } from '@shared/types'
import { SEARCH_MAX_QUERY_CHARS } from '@shared/core/search'
import { STAT_MAX_REPORT_CHARS, STAT_MAX_REPORT_MS } from '@shared/core/stats'

/** bookId 一律 uuid v4：同一个正则也用于 main 侧拼路径前的校验（TECH.md 4.2）。 */
export const bookIdSchema = z.string().regex(UUID_V4_RE, 'bookId 必须是 uuid v4')

export const chapterIndexSchema = z.number().int().min(0)

export const filePathSchema = z.string().min(1, 'filePath 不能为空')

/** IPC 入参用同一份 schema，preload 与 main 双侧校验（TECH.md 4.2）。 */
export const importArgsSchema = z.object({ filePath: filePathSchema })

export const getArgsSchema = z.object({ bookId: bookIdSchema })

export const emptyArgsSchema = z.undefined().or(z.null())

export const renameArgsSchema = z.object({
  bookId: bookIdSchema,
  title: z.string().trim().min(1, '书名不能为空').max(200)
})

/** 重新解码：编码由用户挑，auto 表示重新自动检测一遍。 */
export const redecodeArgsSchema = z.object({
  bookId: bookIdSchema,
  encoding: z.enum(MANUAL_ENCODINGS)
})

/** 搜索：scope=chapter 只扫这一章，=book 扫全书（沿用同一个字面量数组）。 */
export const searchArgsSchema = z.object({
  bookId: bookIdSchema,
  query: z.string().trim().min(1, '搜索关键词不能为空').max(SEARCH_MAX_QUERY_CHARS),
  scope: z.enum(SEARCH_SCOPES),
  chapterIndex: chapterIndexSchema
})

export const readChapterArgsSchema = z.object({
  bookId: bookIdSchema,
  index: chapterIndexSchema
})

/** 手动改分章：改名 / 与下一章合并。 */
export const renameChapterArgsSchema = z.object({
  bookId: bookIdSchema,
  index: chapterIndexSchema,
  title: z.string().trim().min(1, '章节标题不能为空').max(120)
})

export const mergeChapterArgsSchema = z.object({
  bookId: bookIdSchema,
  index: chapterIndexSchema
})

/** 书签与划线（0.1.3 第 6 项）：偏移语义与 progress 一致。 */
export const annotationIdArgsSchema = z.object({ id: z.string().min(1).max(64) })

export const bookmarkAddArgsSchema = z.object({
  bookId: bookIdSchema,
  chapterIndex: chapterIndexSchema,
  charOffset: z.number().int().min(0),
  excerpt: z.string().max(200)
})

export const highlightAddArgsSchema = z.object({
  bookId: bookIdSchema,
  chapterIndex: chapterIndexSchema,
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  text: z.string().min(1, '划线内容不能为空').max(2000)
})

/**
 * 阅读统计（0.1.3 第 8 项）：ms / chars 是「这一次上报的增量」，
 * 主进程按本地日期累加；上限只是防呆，别让坏时钟或假 API 灌进离谱数字。
 */
export const statAddArgsSchema = z.object({
  bookId: bookIdSchema,
  ms: z.number().int().min(0).max(STAT_MAX_REPORT_MS),
  chars: z.number().int().min(0).max(STAT_MAX_REPORT_CHARS)
})

/**
 * 阅读统计（0.1.4）：渲染层报「在这个位置停下读过」，字数算多少由主进程决定
 * （按 `reading_span` 里当天的水位线去重）。上限只是防呆。
 */
export const statReadArgsSchema = z.object({
  bookId: bookIdSchema,
  chapterIndex: chapterIndexSchema,
  charOffset: z.number().int().min(0).max(STAT_MAX_REPORT_CHARS),
  enteredAt: z.number().int().min(0).max(STAT_MAX_REPORT_CHARS)
})

export const statGetArgsSchema = z.object({
  days: z.number().int().min(1).max(90)
})

export const progressSchema = z.object({
  bookId: bookIdSchema,
  chapterIndex: chapterIndexSchema,
  charOffset: z.number().int().min(0),
  anchorBefore: z.string().max(120).nullable(),
  anchorAfter: z.string().max(120).nullable(),
  percent: z.number().min(0).max(100),
  updatedAt: z.number().int().min(0),
  deviceId: z.string().max(120).nullable()
})

export const cancelArgsSchema = z.object({ taskId: z.string().min(1) })

export const settingsSchema = z.object({
  fontSize: z.number().int().min(12).max(40),
  lineHeight: z.number().min(1.2).max(3),
  theme: z.enum(['day', 'night']),
  // 0.1.1 及更早存的设置里没有 bold：用 default 补上，别让整份设置回退成默认值
  bold: z.boolean().default(false),
  // 0.1.2 及更早没有字体与栏宽，同样补默认值
  fontFamily: z.enum(['song', 'hei', 'kai', 'fang', 'deng']).default('song'),
  pageWidth: z.enum(['narrow', 'medium', 'wide', 'full']).default('medium')
})

/** 导入进度是 main -> renderer 的推送，双侧同样校验。 */
export const IMPORT_STAGES = [
  'reading',
  'detecting',
  'decoding',
  'splitting',
  'storing',
  'done',
  'error'
] as const

export const importProgressSchema = z.object({
  taskId: z.string().min(1),
  filePath: z.string(),
  stage: z.enum(IMPORT_STAGES),
  ratio: z.number().min(0).max(1),
  message: z.string().optional()
})

export type ProgressInput = z.infer<typeof progressSchema>
export type SettingsInput = z.infer<typeof settingsSchema>
