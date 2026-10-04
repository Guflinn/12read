import { useEffect, useState } from 'react'
import { formatDuration } from '@shared/core/stats'
import { READING_STAT_DAYS, type ReadingStats } from '@shared/types'
import { readerApi } from '@/core/api'
import { formatChars } from '@/core/reading'
import { Modal } from './Modal'

/** '2026-10-05' → '10-05'：柱子上只写得下月日。 */
function dayLabel(day: string): string {
  const parts = day.split('-')
  return parts.length === 3 ? parts[1] + '-' + parts[2] : day
}

/**
 * 阅读统计（0.1.3 第 8 项）：今天 / 累计 / 连续天数 / 最近两周每天的柱子 / 读得最多的书。
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

  if (!open) return null

  const maxMs = stats ? stats.days.reduce((max, day) => Math.max(max, day.ms), 0) : 0

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

            <p className="stats-h">最近 {stats.days.length} 天</p>
            <div className="stats-bars" id="stats-bars">
              {stats.days.map((day) => (
                <div
                  className="stats-bar"
                  key={day.day}
                  data-day={day.day}
                  title={day.day + ' · ' + formatDuration(day.ms) + ' · ' + formatChars(day.chars)}
                >
                  <div
                    className="stats-bar-fill"
                    style={{
                      height: maxMs > 0 ? Math.round((day.ms / maxMs) * 100) + '%' : '0%'
                    }}
                  />
                  <span className="stats-bar-day">{dayLabel(day.day)}</span>
                </div>
              ))}
            </div>

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
