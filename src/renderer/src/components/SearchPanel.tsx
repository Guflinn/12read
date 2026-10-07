import { useEffect, useRef, useState } from 'react'
import { SEARCH_MAX_HITS, SEARCH_MAX_HITS_PER_CHAPTER } from '@shared/core/search'
import type { SearchScope } from '@shared/types'
import { spotLabel } from '@/core/annotations'
import { useReaderStore } from '@/store/reader'
import { placeholderAsText } from '@/core/images'

/** 边打边搜的防抖：打字停这么久才真发请求（大书一次全书搜索要读几十个章文件）。 */
const SEARCH_DEBOUNCE_MS = 320

const SCOPES: readonly { key: SearchScope; label: string }[] = [
  { key: 'chapter', label: '本章' },
  { key: 'book', label: '全书' }
]

/**
 * 搜索面板（0.1.3 第 7 项）：顶栏 🔍 或 Ctrl/Cmd+F 打开。
 * 输入防抖自动搜、回车立刻搜；点一条命中跳到那一段，命中的段落会闪一下。
 */
export function SearchPanel(): React.JSX.Element {
  const open = useReaderStore((s) => s.searchOpen)
  const setSearch = useReaderStore((s) => s.setSearch)
  const chapters = useReaderStore((s) => s.chapters)
  const result = useReaderStore((s) => s.searchResult)
  const searching = useReaderStore((s) => s.searching)
  const error = useReaderStore((s) => s.searchError)
  const runSearch = useReaderStore((s) => s.runSearch)
  const jumpToHit = useReaderStore((s) => s.jumpToHit)
  const clearSearch = useReaderStore((s) => s.clearSearch)
  const [draft, setDraft] = useState('')
  const [scope, setScope] = useState<SearchScope>('book')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timer = useRef<number | null>(null)

  // 每次打开都从空白开始：上一次的关键词留着，容易被当成这次的结果
  useEffect(() => {
    if (!open) return
    setDraft('')
    clearSearch()
    inputRef.current?.focus()
  }, [open, clearSearch])

  // 收起后别把焦点留在隐藏的输入框里：否则用户敲字会打进一个看不见的框
  useEffect(() => {
    if (open) return
    const input = inputRef.current
    if (input && document.activeElement === input) input.blur()
  }, [open])

  // 防抖：draft / 范围变了就重排一次（清空输入等于收起结果）
  useEffect(() => {
    if (!open) return
    if (draft.trim().length === 0) {
      clearSearch()
      return
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      void runSearch(draft, scope)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [draft, scope, open, runSearch, clearSearch])

  const runNow = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    void runSearch(draft, scope)
  }

  return (
    <>
      <div className={open ? 'scrim on' : 'scrim'} onClick={() => setSearch(false)} />
      <aside className={open ? 'drawer on' : 'drawer'} id="search-panel" aria-hidden={!open}>
        <div className="drawer-head">
          <span>搜索</span>
          <span className="grow dim" id="search-summary">
            {result ? result.total + ' 处 · ' + result.counts.length + ' 章' : ''}
          </span>
          <button className="icon-btn" aria-label="关闭搜索" onClick={() => setSearch(false)}>
            ×
          </button>
        </div>

        <div className="search-bar">
          <input
            id="search-input"
            className="search-input"
            ref={inputRef}
            value={draft}
            placeholder="搜人名、地名、一句话…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runNow()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setSearch(false)
              }
            }}
          />
          <button id="btn-search-run" className="btn primary" onClick={runNow}>
            搜索
          </button>
        </div>

        <div className="drawer-tabs" role="tablist">
          {SCOPES.map((item) => (
            <button
              key={item.key}
              id={'search-scope-' + item.key}
              role="tab"
              aria-selected={scope === item.key}
              className={scope === item.key ? 'drawer-tab on' : 'drawer-tab'}
              onClick={() => setScope(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="search-error" id="search-error">
            {error}
          </p>
        ) : null}
        {searching ? (
          <p className="search-status dim" id="search-status">
            正在翻书…
          </p>
        ) : null}
        {result && result.hits.length === 0 && !searching ? (
          <p className="anno-empty" id="search-empty">
            没找到「{result.query}」。换个词，或者切到「全书」再试。
          </p>
        ) : null}

        {/* 面板关着时一条都不建：命中几百条也不会拖慢阅读器 */}
        <ol className="anno-list" id="search-list">
          {open && result
            ? result.hits.map((hit, index) => (
                <li key={hit.chapterIndex + ':' + hit.charOffset} className="anno-row search-row">
                  <button
                    id={'search-hit-' + index}
                    className="anno-main"
                    onClick={() => void jumpToHit(hit)}
                  >
                    <span className="anno-pos">{spotLabel(chapters, hit.chapterIndex)}</span>
                    <span className="anno-text search-text">
                      {placeholderAsText(hit.before)}
                      <mark className="search-hit">{hit.match}</mark>
                      {placeholderAsText(hit.after)}
                    </span>
                  </button>
                </li>
              ))
            : null}
        </ol>

        {result?.truncated ? (
          <p className="search-more" id="search-more">
            命中太多：每章最多 {SEARCH_MAX_HITS_PER_CHAPTER} 条、全书最多 {SEARCH_MAX_HITS} 条，
            这里只列出前 {result.hits.length} 条。
          </p>
        ) : null}
      </aside>
    </>
  )
}
