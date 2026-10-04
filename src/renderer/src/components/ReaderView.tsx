import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { offsetForScrollTop, scrollTopForOffset, splitParagraphs } from '@/core/paragraphs'
import { chapterLabel, progressLabel } from '@/core/reading'
import { useReaderStore } from '@/store/reader'
import { useSettingsStore } from '@/store/settings'
import { SettingsSheet } from './SettingsSheet'
import { TocDrawer } from './TocDrawer'

/** 段落位置允许的漂移（px）：小于一行就不纠正，免得滚动时自己抖。 */
const DRIFT_TOLERANCE_PX = 4
/** 分块渲染的大章节，滚到离底部这么近就继续渲染。 */
const AUTOLOAD_REMAINING_PX = 600

export function ReaderView({ onBack }: { onBack(): void }): React.JSX.Element {
  const book = useReaderStore((s) => s.book)
  const chapters = useReaderStore((s) => s.chapters)
  const chapterIndex = useReaderStore((s) => s.chapterIndex)
  const chapterText = useReaderStore((s) => s.chapterText)
  const visibleChars = useReaderStore((s) => s.visibleChars)
  const loading = useReaderStore((s) => s.loading)
  const pendingOffset = useReaderStore((s) => s.pendingOffset)
  const percent = useReaderStore((s) => s.percent)
  const fontSize = useSettingsStore((s) => s.settings.fontSize)
  const lineHeight = useSettingsStore((s) => s.settings.lineHeight)
  const theme = useSettingsStore((s) => s.settings.theme)
  const applySettings = useSettingsStore((s) => s.apply)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const paraRefs = useRef<Array<HTMLParagraphElement | null>>([])
  /** 段落级 tops（滚动坐标），只在重排版时重算，滚动时不再强制布局。 */
  const topsRef = useRef<number[]>([0])
  /** 最近一次滚动对应的章内偏移；字号变化后靠它回到同一处文字。 */
  const lastOffsetRef = useRef(0)

  const chapter = chapters[chapterIndex]
  const title = chapter ? chapter.title : '正文'
  const truncated = visibleChars < chapterText.length

  const paragraphs = useMemo(
    () => splitParagraphs(chapterText.slice(0, visibleChars)),
    [chapterText, visibleChars]
  )

  // 正文第一段常常就是章节标题，避免重复显示
  const body = useMemo(() => {
    const first = paragraphs[0]
    if (first && first.offset === 0 && first.text.trim().length > 0 && first.text.trim() === title.trim()) {
      return paragraphs.slice(1)
    }
    return paragraphs
  }, [paragraphs, title])

  // 测量序列：[标题, ...正文段落]，标题对应偏移 0
  const measurement = useMemo(() => [{ offset: 0, text: title }, ...body], [title, body])

  const bodyLength = body.length

  const measureTops = useCallback((): number[] => {
    const scroll = scrollRef.current
    if (!scroll) return [0]
    const base = scroll.getBoundingClientRect().top - scroll.scrollTop
    const tops: number[] = [0]
    const refs = paraRefs.current.slice(0, bodyLength)
    for (const el of refs) tops.push(el ? el.getBoundingClientRect().top - base : 0)
    return tops
  }, [bodyLength])

  // 换章 / 换字号 / 换行距后：先按新排版重新量位置，再回到同一处文字
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    topsRef.current = measureTops()
    const wantsAnchor = pendingOffset !== null
    const desired = wantsAnchor ? pendingOffset : lastOffsetRef.current
    const target = scrollTopForOffset(measurement, topsRef.current, desired)
    const tolerance = wantsAnchor ? 0 : DRIFT_TOLERANCE_PX
    if (Math.abs(scroll.scrollTop - target) > tolerance) scroll.scrollTop = target
    if (wantsAnchor) {
      lastOffsetRef.current = desired
      useReaderStore.getState().consumePending()
    }
  }, [pendingOffset, measurement, measureTops, fontSize, lineHeight])

  useEffect(() => {
    const onResize = (): void => {
      topsRef.current = measureTops()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measureTops])

  /** 滚动位置变了就同步一次状态：进度、顶部偏移，以及超长章节的继续加载。 */
  const syncScrollState = useCallback((): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    const offset = offsetForScrollTop(measurement, topsRef.current, scroll.scrollTop)
    lastOffsetRef.current = offset
    useReaderStore.getState().onScrolled(offset)
    if (
      truncated &&
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < AUTOLOAD_REMAINING_PX
    ) {
      useReaderStore.getState().revealMore()
    }
  }, [measurement, truncated])

  /** 一页的步长：留 40px 重叠，前后两页才读得连得上。 */
  const pageScroll = useCallback(
    (direction: 1 | -1): void => {
      const scroll = scrollRef.current
      if (!scroll) return
      const step = Math.max(120, scroll.clientHeight - 40)
      scroll.scrollTop += direction * step
      syncScrollState()
    },
    [syncScrollState]
  )

  /** Home / End：只在当前章内跳到头尾，不换章（Ctrl 组合才跳全书首尾）。 */
  const jumpEdge = useCallback(
    (edge: 'top' | 'bottom'): void => {
      const scroll = scrollRef.current
      if (!scroll) return
      scroll.scrollTop = edge === 'top' ? 0 : scroll.scrollHeight
      syncScrollState()
    },
    [syncScrollState]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const tag = target ? target.tagName : ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      const store = useReaderStore.getState()
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        void store.next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        void store.prev()
      } else if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault()
        pageScroll(event.key === 'PageDown' ? 1 : -1)
      } else if (event.key === ' ' || event.key === 'Spacebar') {
        // 焦点在按钮/链接上时把空格让给原生激活，免得「点过按钮后空格就翻页」
        if (tag === 'BUTTON' || tag === 'A') return
        event.preventDefault()
        pageScroll(event.shiftKey ? -1 : 1)
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        if (event.ctrlKey || event.metaKey) {
          void store.goto(event.key === 'Home' ? 0 : store.chapters.length - 1, 0)
        } else {
          jumpEdge(event.key === 'Home' ? 'top' : 'bottom')
        }
      } else if (event.key === 'Escape') {
        if (store.tocOpen) store.setToc(false)
        else if (store.sheetOpen) store.setSheet(false)
        else onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, pageScroll, jumpEdge])

  useEffect(
    () => () => {
      useReaderStore.getState().flush()
    },
    []
  )

  return (
    <section id="view-reader" className="view active">
      <header className="reader-top">
        <button id="btn-back" className="icon-btn" onClick={onBack}>
          ← 书架
        </button>
        <div className="reader-title">
          <strong id="reader-book">{book ? book.title : '十二阅读'}</strong>
          <span id="reader-chapter-label">{chapterLabel(chapter, chapters.length)}</span>
        </div>
        <button
          id="btn-theme"
          className="icon-btn"
          data-theme-now={theme}
          aria-label={theme === 'night' ? '切换到日间模式' : '切换到夜间模式'}
          title={theme === 'night' ? '切换到日间模式' : '切换到夜间模式'}
          onClick={() => applySettings({ theme: theme === 'night' ? 'day' : 'night' })}
        >
          {theme === 'night' ? '☀ 日间' : '☾ 夜间'}
        </button>
        <button id="btn-toc" className="icon-btn" onClick={() => useReaderStore.getState().setToc(true)}>
          目录
        </button>
        <button id="btn-settings" className="icon-btn" onClick={() => useReaderStore.getState().setSheet(true)}>
          Aa
        </button>
      </header>

      <main className="reader-scroll" id="reader-scroll" ref={scrollRef} onScroll={syncScrollState}>
        {loading ? <div className="reader-loading dim">正在打开…</div> : null}
        {!loading && chapters.length === 0 ? <div className="empty">这本书没有可读的内容</div> : null}
        {!loading && chapters.length > 0 ? (
          <article className="reader-content" id="reader-content">
            <h1 className="chapter-title">{title}</h1>
            {body.map((paragraph, index) =>
              paragraph.text.length === 0 ? (
                <p
                  key={paragraph.offset}
                  className="blank"
                  ref={(el) => {
                    paraRefs.current[index] = el
                  }}
                >
                  &nbsp;
                </p>
              ) : (
                <p
                  key={paragraph.offset}
                  ref={(el) => {
                    paraRefs.current[index] = el
                  }}
                >
                  {paragraph.text}
                </p>
              )
            )}
            {truncated ? (
              <button
                className="btn ghost load-more"
                onClick={() => useReaderStore.getState().revealMore()}
              >
                继续加载本章剩余内容（{chapterText.length - visibleChars} 字）
              </button>
            ) : (
              <div className="chapter-end">本章完</div>
            )}
          </article>
        ) : null}

        <nav className="chapter-nav">
          <button
            id="btn-prev"
            className="btn"
            disabled={chapterIndex <= 0}
            onClick={() => void useReaderStore.getState().prev()}
          >
            ← 上一章
          </button>
          <span className="pos" id="chapter-pos">
            {chapters.length === 0 ? '—' : chapterIndex + 1 + ' / ' + chapters.length}
          </span>
          <button
            id="btn-next"
            className="btn"
            disabled={chapters.length === 0 || chapterIndex >= chapters.length - 1}
            onClick={() => void useReaderStore.getState().next()}
          >
            下一章 →
          </button>
        </nav>
      </main>

      <div className="reader-progress">
        <div id="reader-progress-fill" style={{ width: percent.toFixed(2) + '%' }} />
      </div>

      {book ? (
        <div className="reader-meter" id="reader-meter">
          {progressLabel(book.charCount, percent)}
        </div>
      ) : null}

      <TocDrawer />
      <SettingsSheet />
    </section>
  )
}
