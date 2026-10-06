import { describe, expect, it } from 'vitest'
import {
  charsReadStep,
  dayKey,
  dayParts,
  daysInMonth,
  fillDays,
  formatDuration,
  goalProgress,
  heatLevel,
  monthCells,
  monthKeyOf,
  shiftDay,
  shiftMonth,
  STAT_MAX_STEP_CHARS,
  streakFromDays,
  todayReadText
} from '@shared/core/stats'

describe('dayKey', () => {
  it('按本地时区给出 YYYY-MM-DD 并补零', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('shiftDay', () => {
  it('前后移几天，跨月跨年都对', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2026-10-05', 0)).toBe('2026-10-05')
  })

  it('闰年二月也算得对', () => {
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('解析不出来就原样返回，不抛', () => {
    expect(shiftDay('', -1)).toBe('')
    expect(shiftDay('2026-xx-01', -1)).toBe('2026-xx-01')
  })
})

describe('fillDays', () => {
  it('补成以 endDay 结尾的连续若干天，缺的补 0', () => {
    const days = fillDays([{ day: '2026-10-03', ms: 5, chars: 1 }], '2026-10-05', 3)
    expect(days.map((day) => day.day)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05'])
    expect(days[0]).toEqual({ day: '2026-10-03', ms: 5, chars: 1 })
    expect(days[1]).toEqual({ day: '2026-10-04', ms: 0, chars: 0 })
    expect(days[2]).toEqual({ day: '2026-10-05', ms: 0, chars: 0 })
  })

  it('count 不是正数就给空数组', () => {
    expect(fillDays([], '2026-10-05', 0)).toEqual([])
    expect(fillDays([], '2026-10-05', -3)).toEqual([])
  })

  it('范围外的行不进结果', () => {
    const days = fillDays(
      [
        { day: '2026-09-01', ms: 999, chars: 9 },
        { day: '2026-10-05', ms: 1, chars: 1 }
      ],
      '2026-10-05',
      2
    )
    expect(days).toEqual([
      { day: '2026-10-04', ms: 0, chars: 0 },
      { day: '2026-10-05', ms: 1, chars: 1 }
    ])
  })
})

describe('streakFromDays', () => {
  it('今天读过就从今天往前数', () => {
    expect(streakFromDays(['2026-10-05', '2026-10-04', '2026-10-03'], '2026-10-05')).toBe(3)
  })

  it('今天还没读，就从昨天数，昨天之前的连续不打断', () => {
    expect(streakFromDays(['2026-10-04', '2026-10-03'], '2026-10-05')).toBe(2)
  })

  it('今天和昨天都没读就是 0', () => {
    expect(streakFromDays(['2026-10-01', '2026-09-30'], '2026-10-05')).toBe(0)
    expect(streakFromDays([], '2026-10-05')).toBe(0)
  })

  it('中间断了只算最近这一段', () => {
    expect(streakFromDays(['2026-10-05', '2026-10-04', '2026-10-02', '2026-10-01'], '2026-10-05')).toBe(2)
  })
})

describe('formatDuration', () => {
  it('分 / 小时 / 小时加分的写法', () => {
    expect(formatDuration(60_000)).toBe('1 分钟')
    expect(formatDuration(59_999)).toBe('0 分钟')
    expect(formatDuration(60 * 60_000)).toBe('1 小时')
    expect(formatDuration(60 * 60_000 + 25 * 60_000)).toBe('1 小时 25 分')
    expect(formatDuration(3 * 60 * 60_000)).toBe('3 小时')
  })

  it('0、负数、非数字都当 0', () => {
    expect(formatDuration(0)).toBe('0 分钟')
    expect(formatDuration(-1)).toBe('0 分钟')
    expect(formatDuration(Number.NaN)).toBe('0 分钟')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0 分钟')
  })
})

describe('dayParts', () => {
  it('把 YYYY-MM-DD 拆成月、日两段（柱下标签只有 ~20px，横排会压字）', () => {
    expect(dayParts('2026-10-05')).toEqual({ m: '10', d: '05' })
    expect(dayParts('2026-01-31')).toEqual({ m: '01', d: '31' })
  })

  it('跨月的首尾也拆得对（9 月末到 10 月初这一段）', () => {
    expect(dayParts('2026-09-28')).toEqual({ m: '09', d: '28' })
    expect(dayParts('2026-10-01')).toEqual({ m: '10', d: '01' })
  })

  it('解析不出来就整串放月那行、日留空，不抛', () => {
    expect(dayParts('')).toEqual({ m: '', d: '' })
    expect(dayParts('2026-10')).toEqual({ m: '2026-10', d: '' })
    expect(dayParts('乱码')).toEqual({ m: '乱码', d: '' })
  })
})

/**
 * charsReadStep（0.1.4）：主进程算字数的唯一规则 ——
 * 只有「超出当天水位线、且不是一步跨太远」的那一段才算新读的字。
 */
describe('charsReadStep', () => {
  it('正常前进：记增量', () => {
    expect(charsReadStep(0, 500)).toBe(500)
    expect(charsReadStep(500, 800)).toBe(300)
  })

  it('没前进（来回刷、往回翻、原地不动）：一律 0', () => {
    expect(charsReadStep(500, 500)).toBe(0)
    expect(charsReadStep(500, 100)).toBe(0)
    expect(charsReadStep(500, 0)).toBe(0)
  })

  it('一步跨太远（拖滚动条 / 跳转）：不算读', () => {
    expect(charsReadStep(0, STAT_MAX_STEP_CHARS + 1)).toBe(0)
    expect(charsReadStep(0, 200_000)).toBe(0)
    // 正好等于上限仍算读（边界）
    expect(charsReadStep(0, STAT_MAX_STEP_CHARS)).toBe(STAT_MAX_STEP_CHARS)
  })

  it('水位线或偏移是非数字时按 0 处理，不抛异常', () => {
    expect(charsReadStep(Number.NaN, 300)).toBe(300)
    expect(charsReadStep(0, Number.POSITIVE_INFINITY)).toBe(0)
    expect(charsReadStep(100, Number.NaN)).toBe(0)
  })
})

/**
 * 0.1.4 新增：每日目标、书架文案、日历格子与色阶。
 * 这几条都是纯函数，界面只是把它们的结果摆出来。
 */
describe('goalProgress', () => {
  it('没设目标（0 或负数）时一律当作关闭', () => {
    expect(goalProgress(0, 0)).toEqual({ on: false, reached: false, percent: 0 })
    expect(goalProgress(999_999, 0).on).toBe(false)
    expect(goalProgress(999_999, -30).on).toBe(false)
  })

  it('按分钟算进度并夹到 0..100', () => {
    expect(goalProgress(0, 30)).toEqual({ on: true, reached: false, percent: 0 })
    expect(goalProgress(15 * 60_000, 30).percent).toBe(50)
    expect(goalProgress(30 * 60_000, 30)).toEqual({ on: true, reached: true, percent: 100 })
    // 超了也只到 100
    expect(goalProgress(90 * 60_000, 30).percent).toBe(100)
  })

  it('时长是坏值时当 0 处理，不抛异常', () => {
    expect(goalProgress(Number.NaN, 30).percent).toBe(0)
    expect(goalProgress(-5000, 30).reached).toBe(false)
  })
})

describe('todayReadText', () => {
  it('没读又没设目标：返回空串（那行不显示）', () => {
    expect(todayReadText(0, 0)).toBe('')
  })

  it('没设目标但今天读了：只说读了多久', () => {
    expect(todayReadText(25 * 60_000, 0)).toBe('今天已读 25 分钟')
  })

  it('设了目标：显示进度，达标加「已达标」', () => {
    expect(todayReadText(12 * 60_000, 30)).toBe('今天已读 12 / 30 分钟')
    expect(todayReadText(30 * 60_000, 30)).toBe('今天已读 30 / 30 分钟 · 已达标')
    expect(todayReadText(45 * 60_000, 30)).toBe('今天已读 45 / 30 分钟 · 已达标')
  })

  it('设了目标但今天还没读：给一句提醒', () => {
    expect(todayReadText(0, 30)).toBe('今天还没开始读 · 目标 30 分钟')
  })
})

describe('heatLevel', () => {
  it('没读或当月没有峰值时是 0（不上色）', () => {
    expect(heatLevel(0, 3600_000)).toBe(0)
    expect(heatLevel(60_000, 0)).toBe(0)
    expect(heatLevel(Number.NaN, 100)).toBe(0)
  })

  it('按占峰值的比例分四档', () => {
    expect(heatLevel(100, 1000)).toBe(1)
    expect(heatLevel(250, 1000)).toBe(2)
    expect(heatLevel(500, 1000)).toBe(3)
    expect(heatLevel(750, 1000)).toBe(4)
    expect(heatLevel(1000, 1000)).toBe(4)
  })
})

describe('monthKeyOf / daysInMonth / shiftMonth', () => {
  it('从日期取月份键，格式不对给空串', () => {
    expect(monthKeyOf('2026-10-07')).toBe('2026-10')
    expect(monthKeyOf('2026-1-7')).toBe('')
    expect(monthKeyOf('乱七八糟')).toBe('')
  })

  it('每月天数，闰年二月也对', () => {
    expect(daysInMonth('2026-10')).toBe(31)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-13')).toBe(0)
  })

  it('月份前后移，跨年对', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-10', -13)).toBe('2025-09')
    expect(shiftMonth('坏月份', 1)).toBe('坏月份')
  })
})

describe('monthCells', () => {
  it('从周一开始排，前面补白格，最后补满整周', () => {
    // 2026-10-01 是周四 → 前面补周一/二/三三格
    const cells = monthCells('2026-10')
    expect(cells.slice(0, 3).every((cell) => cell.day === null)).toBe(true)
    expect(cells[3]).toEqual({ day: '2026-10-01', date: 1 })
    expect(cells).toHaveLength(31 + 3 + 1) // 31 天 + 前 3 格 + 最后补 1 格凑满 5 周
    expect(cells.length % 7).toBe(0)
    expect(cells.at(-1)?.day).toBeNull()
  })

  it('整月天数与日号都对', () => {
    const days = monthCells('2026-02').filter((cell) => cell.day !== null)
    expect(days).toHaveLength(28)
    expect(days.at(-1)).toEqual({ day: '2026-02-28', date: 28 })
  })

  it('月份格式不对给空数组', () => {
    expect(monthCells('2026/10')).toEqual([])
    expect(monthCells('2026-13')).toEqual([])
  })
})
