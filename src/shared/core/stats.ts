import type { ReadingDay } from '../types'

/** 上报节拍：每 15 秒问一次「刚才在读吗」（0.1.3 第 8 项）。 */
export const STAT_REPORT_MS = 15_000

/** 超过这么久没有任何动作就当作人不在（去倒水、睡着、挂机）。 */
export const STAT_IDLE_MS = 60_000

/** 单次位移超过这个字数就不算「读」，只当作跳转（点书签、拖滚动条、跳章）。 */
export const STAT_MAX_STEP_CHARS = 5_000

/** 停下来这么久才算「读了一会儿」：滑动期间一直在重置（0.1.4 起用它决定字数怎么记）。 */
export const STAT_READ_PAUSE_MS = 2_000

/** 停留上报的最小位移：不到这个字数就不必再报一次（主进程算出来也会是 0）。 */
export const STAT_MIN_REPORT_CHARS = 20

/**
 * 「读到的位置」→ 这次该记多少新字数（0.1.4）。
 *
 * `mark` 是**这一天在这一章读到过的最远偏移**（高水位线，存在 `reading_span` 表），
 * 于是同一段文字当天只会记一次：来回刷、往回翻都不重复计。
 * 返回 0 有三种情况，都表示「不算新读的字」：
 *   1. 没前进（`offset <= mark`）—— 在读过的范围里来回；
 *   2. 一步跨得太远（`> STAT_MAX_STEP_CHARS`）—— 那是跳转/拖滚动条，不是读；
 *   3. 位移为 0。
 */
export function charsReadStep(mark: number, offset: number): number {
  const from = Number.isFinite(mark) ? mark : 0
  const to = Number.isFinite(offset) ? offset : 0
  const delta = to - from
  if (delta <= 0 || delta > STAT_MAX_STEP_CHARS) return 0
  return Math.trunc(delta)
}

/** 单次上报的上限：防呆，别让时钟被改或假 API 灌进离谱数字。 */
export const STAT_MAX_REPORT_MS = 6 * 60 * 60 * 1000
export const STAT_MAX_REPORT_CHARS = 10_000_000

function pad2(value: number): string {
  return value < 10 ? '0' + value : String(value)
}

/** 本地时区的 YYYY-MM-DD：统计说的是「这一天读了多久」，所以跟日历走，不用 UTC。 */
export function dayKey(date: Date): string {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

/** 每日目标的上限（分钟）；0 表示没设目标。 */
export const STAT_GOAL_MAX_MINUTES = 600

/**
 * 每日目标的进度（0.1.4）：`on` = 设了目标，`reached` = 今天读到量了，
 * `percent` 夹在 0..100，给进度条用。目标为 0 或负数时一律当作「没设」。
 */
export function goalProgress(
  ms: number,
  goalMinutes: number
): { on: boolean; reached: boolean; percent: number } {
  const goal = Number.isFinite(goalMinutes) ? Math.trunc(goalMinutes) : 0
  if (goal <= 0) return { on: false, reached: false, percent: 0 }
  const spent = Number.isFinite(ms) && ms > 0 ? ms : 0
  const target = goal * 60_000
  return {
    on: true,
    reached: spent >= target,
    percent: Math.min(100, Math.round((spent / target) * 100))
  }
}

/**
 * 书架上那行「今天已读 …」的文案（0.1.4）。
 * 没读又没设目标时返回空串 —— 那种情况下这行没有信息量，不显示。
 */
export function todayReadText(ms: number, goalMinutes: number): string {
  const spent = Number.isFinite(ms) && ms > 0 ? ms : 0
  const goal = goalProgress(spent, goalMinutes)
  if (!goal.on) {
    return spent > 0 ? '今天已读 ' + formatDuration(spent) : ''
  }
  if (spent <= 0) return '今天还没开始读 · 目标 ' + goalMinutes + ' 分钟'
  const minutes = Math.floor(spent / 60_000)
  const base = '今天已读 ' + minutes + ' / ' + goalMinutes + ' 分钟'
  return goal.reached ? base + ' · 已达标' : base
}

/**
 * 日历格子的色阶（0 = 没读，1..4 由浅到深）：按当天时长相对当月峰值分档。
 * 当月没有任何记录时全为 0，格子就不上色。
 */
export function heatLevel(ms: number, maxMs: number): 0 | 1 | 2 | 3 | 4 {
  const spent = Number.isFinite(ms) && ms > 0 ? ms : 0
  const peak = Number.isFinite(maxMs) ? maxMs : 0
  if (spent <= 0 || peak <= 0) return 0
  const ratio = spent / peak
  if (ratio >= 0.75) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.25) return 2
  return 1
}

/** 'YYYY-MM-DD' → 'YYYY-MM'；解析不出来返回空串。 */
export function monthKeyOf(day: string): string {
  const parts = day.split('-')
  if (parts.length < 2) return ''
  return /^\d{4}$/.test(parts[0] ?? '') && /^\d{2}$/.test(parts[1] ?? '')
    ? (parts[0] as string) + '-' + (parts[1] as string)
    : ''
}

function parseMonth(month: string): { year: number; mon: number } | null {
  const parts = month.split('-')
  const year = Number(parts[0])
  const mon = Number(parts[1])
  if (!Number.isInteger(year) || !Number.isInteger(mon)) return null
  if (mon < 1 || mon > 12) return null
  if (year < 1970 || year > 9999) return null
  return { year, mon }
}

/** 这个月有多少天（28..31）；月份格式不对返回 0。 */
export function daysInMonth(month: string): number {
  const parsed = parseMonth(month)
  if (!parsed) return 0
  return new Date(parsed.year, parsed.mon, 0).getDate()
}

/** 月份整体前后移几个月（日历翻页用）；月份格式不对原样返回。 */
export function shiftMonth(month: string, delta: number): string {
  const parsed = parseMonth(month)
  if (!parsed) return month
  const shifted = new Date(parsed.year, parsed.mon - 1 + Math.trunc(delta), 1)
  if (Number.isNaN(shifted.getTime())) return month
  return shifted.getFullYear() + '-' + pad2(shifted.getMonth() + 1)
}

/** 日历里的一格：`day` 为 null 表示补白（这个月之外的格子）。 */
export interface MonthCell {
  day: string | null
  /** 日号；补白格为 0。 */
  date: number
}

/**
 * 排一个月的日历格子：**从周一开始**（中文习惯），第一周之前补白格，
 * 最后补到整周。返回长度是 7 的倍数，UI 直接用 7 列网格铺。
 */
export function monthCells(month: string): MonthCell[] {
  const parsed = parseMonth(month)
  if (!parsed) return []
  const total = daysInMonth(month)
  // getDay(): 0=周日。表格周一开头，所以把周日挪到最后：周一=0 … 周日=6
  const lead = (new Date(parsed.year, parsed.mon - 1, 1).getDay() + 6) % 7
  const cells: MonthCell[] = []
  for (let i = 0; i < lead; i += 1) cells.push({ day: null, date: 0 })
  for (let date = 1; date <= total; date += 1) {
    cells.push({ day: month + '-' + pad2(date), date })
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, date: 0 })
  return cells
}

/** 日期字符串整体前后移几天，用于补缺口和算连续天数。解析不出来就原样返回。 */
export function shiftDay(day: string, delta: number): string {
  const parts = day.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const date = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) return day
  const shifted = new Date(year, month - 1, date)
  if (Number.isNaN(shifted.getTime())) return day
  shifted.setDate(shifted.getDate() + delta)
  return dayKey(shifted)
}

/** 把稀疏的每日统计补成连续 count 天（末尾是 endDay），没记录的补 0。 */
export function fillDays(rows: ReadingDay[], endDay: string, count: number): ReadingDay[] {
  const wanted = Math.max(0, Math.trunc(count))
  const byDay = new Map<string, ReadingDay>()
  for (const row of rows) byDay.set(row.day, row)
  const out: ReadingDay[] = []
  for (let back = wanted - 1; back >= 0; back -= 1) {
    const day = shiftDay(endDay, -back)
    const found = byDay.get(day)
    out.push({ day, ms: found?.ms ?? 0, chars: found?.chars ?? 0 })
  }
  return out
}

/** 连续读了几天：今天读过就从今天数，今天还没读就从昨天往前数（不打断昨天之前的连续）。 */
export function streakFromDays(days: string[], today: string): number {
  const seen = new Set(days)
  let cursor = seen.has(today) ? today : shiftDay(today, -1)
  let streak = 0
  while (seen.has(cursor)) {
    streak += 1
    cursor = shiftDay(cursor, -1)
  }
  return streak
}

/** 'N 分钟' / 'N 小时' / 'N 小时 M 分'；负数与非数字当 0。 */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : 0
  const minutes = Math.floor(total / 60_000)
  if (minutes < 60) return minutes + ' 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? hours + ' 小时' : hours + ' 小时 ' + rest + ' 分'
}

/**
 * 'YYYY-MM-DD' → { m: 'MM', d: 'DD' }，给统计柱下方的轴标签用。
 * 弹窗只有 380px 宽、14 根柱子分摊下来每列 ~20px，'09-28' 横排要 ~30px 必然压字，
 * 所以拆成上下两行（各 ~12px）。解析不出来就整串塞进月那行，日留空。
 */
export function dayParts(day: string): { m: string; d: string } {
  const parts = day.split('-')
  if (parts.length !== 3) return { m: day, d: '' }
  return { m: parts[1], d: parts[2] }
}
