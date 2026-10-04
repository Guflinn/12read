import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { normalizeSelection, rangesOfChapter, splitHighlighted } from '@/core/annotations'
import { offsetForScrollTop, scrollTopForOffset, splitParagraphs } from '@/core/paragraphs'
import { chapterLabel, progressLabel } from '@/core/reading'
import { BOOKMARK_REST_MS, useReaderStore } from '@/store/reader'
import { useSettingsStore } from '@/store/settings'
import { SearchPanel } from './SearchPanel'
import { SettingsSheet } from './SettingsSheet'
import { TocDrawer } from './TocDrawer'
import { toast } from './Toast'

/** 段落位置允许的漂移（px）：小于一行就不纠正，免得滚动时自己抖。 */
const DRIFT_TOLERANCE_PX = 4
/** 分块渲染的大章节，滚到离底部这么近就继续渲染。 */
const AUTOLOAD_REMAINING_PX = 600
/** 跳到某条搜索结果后，那一小段亮这么久（0.1.3 第 7 项）。 */
const FLASH_MS = 1600

/** 选中文字后浮出来的小工具条：要么划线，要么删掉点中的那条划线。 */
type Toolbar =
  | { kind: 'new'; startOffset: number; endOffset: number; text: string; top: number; left: number }
  | { kind: 'existing'; id: string; top: number; left: number }

/** 选区端点在段落内的文字偏移：段落里只有文字节点，按文档顺序累加即可。 */
function offsetInParagraph(paragraph: HTMLElement, node: Node, offsetInNode: number): number {
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  let total = 0
  while (walker.nextNode()) {
    const current = walker.currentNode
    if (current === node) return total + offsetInNode
    total += current.textContent ? current.textContent.length : 0
  }
  return total
}

/**
 * 选区端点 → 章内字符偏移。
 * 只认带 data-offset 的正文段落：标题、章末、空白段落在外面，返回 null 就不划线。
 */
function chapterOffsetAt(node: Node, offsetInNode: number): number | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const paragraph = (element ? element.closest('p[data-offset]') : null) as HTMLElement | null
  if (!paragraph) return null
  const base = Number(paragraph.getAttribute('data-offset'))
  if (!Number.isFinite(base)) return null
  return base + offsetInParagraph(paragraph, node, offsetInNode)
}

export function ReaderView({ onBack }: { onBack(): void }): React.JSX.Element {
  const book = useReaderStore((s) => s.book)
  const chapters = useReaderStore((s) => s.chapters)
  const chapterIndex = useReaderStore((s) => s.chapterIndex)
  const chapterText = useReaderStore((s) => s.chapterText)
  const visibleChars = useReaderStore((s) => s.visibleChars)
  const loading = useReaderStore((s) => s.loading)
  const pendingOffset = useReaderStore((s) => s.pendingOffset)
  const percent = useReaderStore((s) => s.percent)
  const bookmark = useReaderStore((s) => s.bookmark)
  const highlights = useReaderStore((s) => s.highlights)
  const flash = useReaderStore((s) => s.flash)
  const addBookmark = useReaderStore((s) => s.addBookmark)
  const addHighlight = useReaderStore((s) => s.addHighlight)
  const removeHighlight = useReaderStore((s) => s.removeHighlight)
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
  /** 停顿计时器：连续滚动期间一直往后推，停够 BOOKMARK_REST_MS 才记一次「上次位置」。 */
  const restTimerRef = useRef<number | null>(null)
  /** 正文容器：选区端点要靠它反查章内偏移。 */
  const contentRef = useRef<HTMLElement | null>(null)
  const [toolbar, setToolbar] = useState<Toolbar | null>(null)

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

  /** 当前章的划线范围：只有划过线的书才做切分，普通阅读路径不受影响。 */
  const ranges = useMemo(
    () => rangesOfChapter(highlights, chapterIndex),
    [highlights, chapterIndex]
  )

  /** 刚跳到的搜索命中落在第几段（-1 = 不在本章）：闪一下好让人一眼找到。 */
  const flashIndex = useMemo(() => {
    if (!flash || flash.chapterIndex !== chapterIndex) return -1
    return body.findIndex(
      (paragraph) =>
        flash.offset >= paragraph.offset && flash.offset < paragraph.offset + paragraph.text.length
    )
  }, [flash, chapterIndex, body])

  // 闪一下就撤，别让下次滚动还误以为是新命中
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => useReaderStore.getState().clearFlash(), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

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
    const wantsAnchor = pendingOffset !== null
    const desired = wantsAnchor ? pendingOffset : lastOffsetRef.current
    // 目标还落在没铺出来的那一截里：先把正文铺到那儿，这一轮不滚。
    // 少了这一步，跳进超长章节的深处只会滚到已渲染部分的末尾，
    // 而滚动位置一旦不在底部就不会再触发「继续加载」，人就停在半路（0.1.3 第 10 项）。
    if (truncated && desired >= visibleChars) {
      useReaderStore.getState().revealTo(desired)
      return
    }
    topsRef.current = measureTops()
    const target = scrollTopForOffset(measurement, topsRef.current, desired)
    const tolerance = wantsAnchor ? 0 : DRIFT_TOLERANCE_PX
    if (Math.abs(scroll.scrollTop - target) > tolerance) scroll.scrollTop = target
    if (wantsAnchor) {
      lastOffsetRef.current = desired
      useReaderStore.getState().consumePending()
    }
  }, [pendingOffset, measurement, measureTops, fontSize, lineHeight, truncated, visibleChars])

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
    // 快速滑动期间不记位置：停下来的地方才值得当「上次位置」
    if (restTimerRef.current !== null) window.clearTimeout(restTimerRef.current)
    restTimerRef.current = window.setTimeout(() => {
      restTimerRef.current = null
      useReaderStore.getState().settleBookmark(lastOffsetRef.current)
    }, BOOKMARK_REST_MS)
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
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true
      // 阅读器里的「查找」= 打开搜索面板（0.1.3 第 7 项）。
      // 在搜索框里再按一次也要认，否则面板收起后焦点还在框里，快捷键就成了哑键。
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && (!typing || target?.id === 'search-input')) {
        event.preventDefault()
        useReaderStore.getState().setSearch(true)
        return
      }
      if (typing) return
      const store = useReaderStore.getState()
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        // ← / → 翻页（每次一屏、留 40px 重叠，跟 PageUp/PageDown 同一个动作）；
        // 按住 Ctrl（或 Mac 的 Cmd）才是切换章节。
        event.preventDefault()
        const back = event.key === 'ArrowLeft'
        if (event.ctrlKey || event.metaKey) {
          void (back ? store.prev() : store.next())
        } else {
          pageScroll(back ? -1 : 1)
        }
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
        if (store.searchOpen) store.setSearch(false)
        else if (store.tocOpen) store.setToc(false)
        else if (store.sheetOpen) store.setSheet(false)
        else onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, pageScroll, jumpEdge])

  const clearSelection = useCallback((): void => {
    setToolbar(null)
    const selection = window.getSelection()
    if (selection) selection.removeAllRanges()
  }, [])

  /**
   * 鼠标松开时看选区：选中了正文就浮出「划线」，没选中又点在已有划线上就浮出「删除划线」。
   * 只挂在正文上 —— 点工具条自己的按钮不会触发这里，按钮才不会被提前收掉。
   */
  const onContentMouseUp = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    const selection = window.getSelection()
    const text = selection ? selection.toString() : ''
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || text.trim().length === 0) {
      const mark = (event.target as HTMLElement).closest('mark[data-hl-id]')
      const id = mark ? mark.getAttribute('data-hl-id') : null
      if (mark && id) {
        const rect = mark.getBoundingClientRect()
        setToolbar({ kind: 'existing', id, top: rect.top, left: rect.left + rect.width / 2 })
      } else {
        setToolbar(null)
      }
      return
    }
    const range = selection.getRangeAt(0)
    const start = chapterOffsetAt(range.startContainer, range.startOffset)
    const end = chapterOffsetAt(range.endContainer, range.endOffset)
    const normalized = start === null || end === null ? null : normalizeSelection(start, end)
    if (!normalized) {
      setToolbar(null)
      return
    }
    const rect = range.getBoundingClientRect()
    setToolbar({
      kind: 'new',
      startOffset: normalized.startOffset,
      endOffset: normalized.endOffset,
      text,
      top: rect.top,
      left: rect.left + rect.width / 2
    })
  }, [])

  useEffect(
    () => () => {
      if (restTimerRef.current !== null) window.clearTimeout(restTimerRef.current)
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
          id="btn-bookmark"
          className="icon-btn"
          aria-label="把当前位置加为书签"
          title="把当前位置加为书签（书签列表在目录抽屉里）"
          onClick={() => void addBookmark()}
        >
          🔖 书签
        </button>
        <button
          id="btn-pos-back"
          className="icon-btn"
          disabled={bookmark === null}
          aria-label="回到上次停留的位置"
          title="回到上次停留的位置（再点一次回到刚才那里）"
          onClick={() => void useReaderStore.getState().backToBookmark()}
        >
          ↩ 上次位置
        </button>
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
        <button
          id="btn-split"
          className="icon-btn"
          aria-label="在当前位置把本章拆成两章"
          title="在当前位置把本章拆成两章"
          onClick={() => {
            const store = useReaderStore.getState()
            void store.splitChapter(store.chapterIndex, lastOffsetRef.current)
          }}
        >
          ⑂ 拆分
        </button>
        <button
          id="btn-search"
          className="icon-btn"
          aria-label="在本书里搜索"
          title="搜索（Ctrl/Cmd + F）"
          onClick={() => useReaderStore.getState().setSearch(true)}
        >
          🔍 搜索
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
          <article
            className="reader-content"
            id="reader-content"
            ref={contentRef}
            onMouseUp={onContentMouseUp}
          >
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
                  data-offset={paragraph.offset}
                  className={flashIndex === index ? 'hit' : undefined}
                  ref={(el) => {
                    paraRefs.current[index] = el
                  }}
                >
                  {splitHighlighted(paragraph.text, paragraph.offset, ranges).map((segment, part) =>
                    segment.highlightId ? (
                      <mark
                        key={segment.highlightId + '-' + part}
                        className="hl"
                        data-hl-id={segment.highlightId}
                      >
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={'plain-' + part}>{segment.text}</span>
                    )
                  )}
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

      {toolbar ? (
        <div
          id="hl-toolbar"
          className="hl-toolbar"
          role="dialog"
          aria-label="划线操作"
          style={{ top: Math.max(8, toolbar.top - 48) + 'px', left: toolbar.left + 'px' }}
        >
          {toolbar.kind === 'new' ? (
            <button
              id="btn-hl-add"
              className="btn primary"
              onClick={() => {
                const pending = toolbar
                clearSelection()
                if (pending.kind === 'new') {
                  void addHighlight(pending.startOffset, pending.endOffset, pending.text).then(() =>
                    toast('已划线')
                  )
                }
              }}
            >
              划线
            </button>
          ) : (
            <button
              id="btn-hl-remove"
              className="btn danger"
              onClick={() => {
                const pending = toolbar
                clearSelection()
                if (pending.kind === 'existing') {
                  void removeHighlight(pending.id).then(() => toast('已删除划线'))
                }
              }}
            >
              删除划线
            </button>
          )}
          <button className="btn ghost" onClick={clearSelection}>
            取消
          </button>
        </div>
      ) : null}

      <SearchPanel />
      <TocDrawer />
      <SettingsSheet />
    </section>
  )
}
