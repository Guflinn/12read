import { z } from 'zod'
import { UUID_V4_RE } from '@shared/core/ids'

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

export const readChapterArgsSchema = z.object({
  bookId: bookIdSchema,
  index: chapterIndexSchema
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
