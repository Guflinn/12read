import { useEffect, useRef, useState } from 'react'
import type { Chapter } from '@shared/types'
import { spotLabel } from '@/core/annotations'
import { kindLabel } from '@/core/reading'
import { useReaderStore } from '@/store/reader'
import { Modal } from './Modal'
import { toast } from './Toast'
import { groupChapters } from '@/core/toc-groups'

/** 抽屉里的三个分页：章节目录 / 书签 / 划线。 */
type DrawerTab = 'toc' | 'bookmarks' | 'highlights'

const TABS: readonly { key: DrawerTab; label: string }[] = [
  { key: 'toc', label: '目录' },
  { key: 'bookmarks', label: '书签' },
  { key: 'highlights', label: '划线' }
]

/**
 * 目录抽屉：高亮当前节，点一条即跳转（章内偏移归零）；每行还能改名 / 合并。
 * 书签与划线是另外两个分页签 —— 不占阅读器顶栏，也不影响只想看目录的人。
 */
export function TocDrawer(): React.JSX.Element {
  const chapters = useReaderStore((s) => s.chapters)
  const chapterIndex = useReaderStore((s) => s.chapterIndex)
  const open = useReaderStore((s) => s.tocOpen)
  const setToc = useReaderStore((s) => s.setToc)
  const goto = useReaderStore((s) => s.goto)
  const renameChapter = useReaderStore((s) => s.renameChapter)
  const mergeChapter = useReaderStore((s) => s.mergeChapter)
  const bookmarks = useReaderStore((s) => s.bookmarks)
  const highlights = useReaderStore((s) => s.highlights)
  const removeBookmark = useReaderStore((s) => s.removeBookmark)
  const removeHighlight = useReaderStore((s) => s.removeHighlight)
  const [tab, setTab] = useState<DrawerTab>('toc')
  const [renaming, setRenaming] = useState<Chapter | null>(null)
  const [renameText, setRenameText] = useState('')
  const activeRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (!open) return
    activeRef.current?.scrollIntoView({ block: 'center' })
  }, [open, chapterIndex])

  const count =
    tab === 'toc' ? chapters.length : tab === 'bookmarks' ? bookmarks.length : highlights.length
  const unit = tab === 'toc' ? '节' : '条'

  const jump = (index: number, offset: number): void => {
    setToc(false)
    void goto(index, offset)
  }

  return (
    <>
      <div className={open ? 'scrim on' : 'scrim'} onClick={() => setToc(false)} />
      <aside className={open ? 'drawer on' : 'drawer'} id="toc-drawer" aria-hidden={!open}>
        <div className="drawer-head">
          <span>阅读辅助</span>
          <span className="grow dim">
            {count} {unit}
          </span>
          <button className="icon-btn" aria-label="关闭目录" onClick={() => setToc(false)}>
            ×
          </button>
        </div>
        <div className="drawer-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.key}
              id={'toc-tab-' + item.key}
              role="tab"
              aria-selected={tab === item.key}
              className={tab === item.key ? 'drawer-tab on' : 'drawer-tab'}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 三个分页都惰性渲染：抽屉关着时一条都不建，几千章的书也不拖慢阅读器挂载 */}
        {tab === 'toc' ? (
          <ol className="toc-list" id="toc-list">
            {open
              ? groupChapters(chapters).flatMap((group) => [
                  /* 合集类 EPUB：每卷前面加一行「册名」。普通书没有分组，这一行不会出现 */
                  group.showHeader && group.title !== null ? (
                    <li className="toc-group" key={'group-' + group.title + '-' + group.items[0]?.index} title={group.title}>
                      {group.title}
                    </li>
                  ) : null,
                  ...group.items.map(({ chapter, first }) => (
                  <li
                    key={chapter.index}
                    className={
                      (chapter.index === chapterIndex ? 'on' : '') +
                      (first && group.title !== null ? ' toc-part' : '')
                    }
                    ref={chapter.index === chapterIndex ? activeRef : null}
                    title={chapter.title}
                    onClick={() => jump(chapter.index, 0)}
                  >
                    <span className="toc-label">
                      <span className="toc-kind">{kindLabel(chapter.kind)}</span>
                      {chapter.index + 1}. {chapter.title}
                    </span>
                    <span className="toc-edit">
                      <button
                        id={'toc-rename-' + chapter.index}
                        className="toc-btn"
                        title="改这一章的标题"
                        onClick={(event) => {
                          event.stopPropagation()
                          setRenaming(chapter)
                          setRenameText(chapter.title)
                        }}
                      >
                        改名
                      </button>
                      <button
                        id={'toc-merge-' + chapter.index}
                        className="toc-btn"
                        title="把下一章并进这一章"
                        disabled={chapter.index === chapters.length - 1}
                        onClick={(event) => {
                          event.stopPropagation()
                          void mergeChapter(chapter.index).then(() => toast('已合并到上一章'))
                        }}
                      >
                        合并
                      </button>
                    </span>
                  </li>
                  ))
                ])
              : null}
          </ol>
        ) : null}

        {tab === 'bookmarks' ? (
          <div className="anno-list" id="bookmark-list">
            {open && bookmarks.length === 0 ? (
              <p className="anno-empty dim" id="bookmark-empty">
                还没有书签：读到想记住的地方，点顶栏的 🔖 书签。
              </p>
            ) : null}
            {open
              ? bookmarks.map((item) => (
                  <div className="anno-row" key={item.id} data-bookmark-id={item.id}>
                    <button
                      className="anno-main"
                      id={'bookmark-go-' + item.id}
                      title="跳到这里"
                      onClick={() => jump(item.chapterIndex, item.charOffset)}
                    >
                      <span className="anno-pos">{spotLabel(chapters, item.chapterIndex)}</span>
                      <span className="anno-text">{item.excerpt || '（没有摘要）'}</span>
                    </button>
                    <button
                      className="toc-btn"
                      id={'bookmark-del-' + item.id}
                      title="删除这条书签"
                      onClick={() => void removeBookmark(item.id).then(() => toast('已删除书签'))}
                    >
                      删除
                    </button>
                  </div>
                ))
              : null}
          </div>
        ) : null}

        {tab === 'highlights' ? (
          <div className="anno-list" id="highlight-list">
            {open && highlights.length === 0 ? (
              <p className="anno-empty dim" id="highlight-empty">
                还没有划线：选中正文里的一段字，浮出的工具条上点「划线」。
              </p>
            ) : null}
            {open
              ? highlights.map((item) => (
                  <div className="anno-row" key={item.id} data-highlight-id={item.id}>
                    <button
                      className="anno-main"
                      id={'highlight-go-' + item.id}
                      title="跳到这里"
                      onClick={() => jump(item.chapterIndex, item.startOffset)}
                    >
                      <span className="anno-pos">{spotLabel(chapters, item.chapterIndex)}</span>
                      <span className="anno-text">{item.text}</span>
                    </button>
                    <button
                      className="toc-btn"
                      id={'highlight-del-' + item.id}
                      title="删除这条划线"
                      onClick={() => void removeHighlight(item.id).then(() => toast('已删除划线'))}
                    >
                      删除
                    </button>
                  </div>
                ))
              : null}
          </div>
        ) : null}
      </aside>

      {renaming ? (
        <Modal
          title="改章节标题"
          confirmLabel="保存"
          onCancel={() => setRenaming(null)}
          onConfirm={() => {
            const target = renaming
            const title = renameText.trim()
            setRenaming(null)
            if (!target || title.length === 0) return
            void renameChapter(target.index, title).then(() => toast('已改章节标题'))
          }}
        >
          <input
            id="toc-rename-input"
            autoFocus
            value={renameText}
            onChange={(event) => setRenameText(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Modal>
      ) : null}
    </>
  )
}
