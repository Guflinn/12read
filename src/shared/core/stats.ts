import type { ReadingDay } from '../types'

/** 上报节拍：每 15 秒问一次「刚才在读吗」（0.1.3 第 8 项）。 */
export const STAT_REPORT_MS = 15_000

/** 超过这么久没有任何动作就当作人不在（去倒水、睡着、挂机）。 */
export const STAT_IDLE_MS = 60_000

/** 单次位移超过这个字数就不算「读」，只当作跳转（点书签、拖滚动条、跳章）。 */
export const STAT_MAX_STEP_CHARS = 5_000

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
