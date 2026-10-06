import { useEffect, useState } from 'react'
import {
  dayKey,
  dayParts,
  formatDuration,
  goalProgress,
  heatLevel,
  monthCells,
  monthKeyOf,
  shiftMonth
} from '@shared/core/stats'
import { READING_STAT_DAYS, type ReadingCalendar, type ReadingStats } from '@shared/types'
import { readerApi } from '@/core/api'
import { formatChars } from '@/core/reading'
import { useSettingsStore } from '@/store/settings'
import { Modal } from './Modal'

/** 日历表头：从周一开始（与 core/stats 的 monthCells 一致）。 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * 阅读统计（0.1.3 第 8 项；0.1.4 加每日目标与日历视图）：
 * 今天 / 累计 / 连续天数、最近两周柱状或整月日历、读得最多的书。
 * 数据只统计「窗口可见、人也没走开」的时间，见 core/reading-clock.ts。
 */
export function StatsSheet({
  open,
  onClose
}: {
  open: boolean
  onClose(): void
}): React.JSX.Element | null {
  const [stats, setStats] = useState<ReadingStats | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<'days' | 'calendar'>('days')
  const [month, setMonth] = useState(() => monthKeyOf(dayKey(new Date())))
  const [calendar, setCalendar] = useState<ReadingCalendar | null>(null)
  const dailyGoalMinutes = useSettingsStore((s) => s.settings.dailyGoalMinutes)

  const thisMonth = monthKeyOf(dayKey(new Date()))

  useEffect(() => {
    if (!open) return
    let alive = true
    setStats(null)
    setFailed(false)
    readerApi()
      .getReadingStats(READING_STAT_DAYS)
      .then((result) => {
        if (alive) setStats(result)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [open])

  // 日历只在这一栏真的被打开（或翻月）时才去取，省一次 IPC
  useEffect(() => {
    if (!open || view !== 'calendar') return
    let alive = true
    setCalendar(null)
    readerApi()
      .getReadingCalendar(month)
      .then((result) => {
        if (alive) setCalendar(result)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [open, view, month])

  if (!open) return null

  const maxMs = stats ? stats.days.reduce((max, day) => Math.max(max, day.ms), 0) : 0
  const goal = goalProgress(stats ? stats.todayMs : 0, dailyGoalMinutes)
  const monthMs = calendar ? calendar.days.reduce((sum, day) => sum + day.ms, 0) : 0
  const monthActiveDays = calendar ? calendar.days.filter((day) => day.ms > 0).length : 0

  return (
    <Modal
      title="阅读统计"
      confirmLabel="知道了"
      cancelLabel="关闭"
      onCancel={onClose}
      onConfirm={onClose}
    >
      <div id="stats-body">
        {failed ? (
          <p className="stats-empty" id="stats-empty">
            统计读不出来，等会儿再看一眼。
          </p>
        ) : !stats ? (
          <p className="stats-empty">正在统计…</p>
        ) : (
          <>
            <div className="stats-row">
              <div className="stats-cell">
                <span className="stats-num" id="stats-today">
                  {formatDuration(stats.todayMs)}
                </span>
                <span className="stats-cap">今天 · {formatChars(stats.todayChars)}</span>
                {goal.on ? (
                  <span className={goal.reached ? 'stats-goal on' : 'stats-goal'} id="stats-goal">
                    <span className="stats-goal-track">
                      <span className="stats-goal-fill" style={{ width: goal.percent + '%' }} />
                    </span>
                    {goal.reached ? '已达标' : goal.percent + '%'} · 目标 {dailyGoalMinutes} 分钟
                  </span>
                ) : null}
              </div>
              <div className="stats-cell">
                <span className="stats-num" id="stats-total">
                  {formatDuration(stats.totalMs)}
                </span>
                <span className="stats-cap">累计 · {formatChars(stats.totalChars)}</span>
              </div>
              <div className="stats-cell">
                <span className="stats-num" id="stats-streak">
                  {stats.streakDays} 天
                </span>
                <span className="stats-cap">连续阅读</span>
              </div>
            </div>

            <div className="stats-views">
              <button
                id="stats-view-days"
                className={view === 'days' ? 'pill on' : 'pill'}
                onClick={() => setView('days')}
              >
                最近 {stats.days.length} 天
              </button>
              <button
                id="stats-view-calendar"
                className={view === 'calendar' ? 'pill on' : 'pill'}
                onClick={() => setView('calendar')}
              >
                日历
              </button>
            </div>

            {view === 'days' ? (
              <div className="stats-bars" id="stats-bars">
                {stats.days.map((day) => {
                  const parts = dayParts(day.day)
                  const pct = maxMs > 0 ? Math.round((day.ms / maxMs) * 100) : 0
                  return (
                    <div
                      className="stats-bar"
                      key={day.day}
                      data-day={day.day}
                      title={day.day + ' · ' + formatDuration(day.ms) + ' · ' + formatChars(day.chars)}
                    >
                      <div className="stats-bar-track">
                        <div className="stats-bar-fill" style={{ height: pct + '%' }} />
                      </div>
                      <span className="stats-bar-day">
                        <span className="stats-day-m">{parts.m}</span>
                        <span className="stats-day-d">{parts.d}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div id="stats-calendar">
                <div className="stats-cal-head">
                  <button
                    id="cal-prev"
                    className="cal-arrow"
                    aria-label="上个月"
                    onClick={() => setMonth(shiftMonth(month, -1))}
                  >
                    ‹
                  </button>
                  <span id="cal-month">{month}</span>
                  <button
                    id="cal-next"
                    className="cal-arrow"
                    aria-label="下个月"
                    disabled={month >= thisMonth}
                    onClick={() => setMonth(shiftMonth(month, 1))}
                  >
                    ›
                  </button>
                </div>
                {!calendar ? (
                  <p className="stats-empty">正在统计…</p>
                ) : (
                  <>
                    <div className="stats-cal-week">
                      {WEEKDAYS.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                    <div className="stats-cal-grid" id="cal-grid">
                      {monthCells(calendar.month).map((cell, index) => {
                        const read =
                          cell.day === null
                            ? null
                            : (calendar.days.find((day) => day.day === cell.day) ?? null)
                        const level = read ? heatLevel(read.ms, calendar.maxMs) : 0
                        return (
                          <div
                            key={cell.day ?? 'blank-' + index}
                            className={cell.day === null ? 'stats-cal-cell blank' : 'stats-cal-cell'}
                            data-day={cell.day ?? undefined}
                            data-level={level}
                            title={
                              read && read.ms > 0
                                ? read.day + ' · ' + formatDuration(read.ms) + ' · ' + formatChars(read.chars)
                                : (cell.day ?? '')
                            }
                          >
                            {cell.date > 0 ? cell.date : ''}
                          </div>
                        )
                      })}
                    </div>
                    <p className="stats-cal-note" id="cal-note">
                      本月读了 {formatDuration(monthMs)} · {monthActiveDays} 天有记录
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="stats-h">读得最多的书</p>
            {stats.topBooks.length === 0 ? (
              <p className="stats-empty" id="stats-top-empty">
                还没有记录：读上几分钟就会出现在这里。
              </p>
            ) : (
              <ul className="stats-top" id="stats-top">
                {stats.topBooks.map((item) => (
                  <li key={item.bookId} data-book-id={item.bookId}>
                    <span className="stats-top-title">{item.title}</span>
                    <span className="stats-top-num">
                      {formatDuration(item.ms)} · {formatChars(item.chars)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
