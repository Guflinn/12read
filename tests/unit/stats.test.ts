import { describe, expect, it } from 'vitest'
import { dayKey, dayParts, fillDays, formatDuration, shiftDay, streakFromDays } from '@shared/core/stats'

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
